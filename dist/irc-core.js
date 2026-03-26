import { state, update } from "./state.js";

const MAX_LINES = 500;
function pushLine(arr, line) { arr.push(line); if (arr.length > MAX_LINES) arr.splice(0, arr.length - MAX_LINES); }

function isDisabled(val) {
    if (!val || typeof val !== 'string') return true;
    const v = val.trim().toLowerCase();
    if (v.startsWith('/')) return false;
    return ['false','off','disable','disabled','no','n/a','none',''].includes(v);
}

// ════════════════════════════════════════════════════════════════
// AVATAR — LOGIQUE CENTRALISÉE
// ════════════════════════════════════════════════════════════════
export function getServerAvatarPrefix(serverHost) {
    if (!state.serverAvatarUrls || !serverHost) return null;
    const host = serverHost.toLowerCase();
    for (const [domain, prefix] of Object.entries(state.serverAvatarUrls)) {
        const d = domain.toLowerCase();
        if (host === d || host.endsWith('.' + d)) return prefix;
    }
    return null;
}

export function getAvatarUrlForNick(serverId, nick, isSelf) {
    const bust = url => window.bustUrl ? window.bustUrl(url) : url;
    if (isSelf) return state.myAvatar ? bust(state.myAvatar) : null;
    const nickLow = nick.toLowerCase();
    const manual = state.avatars?.[nickLow];
    if (manual) return bust(manual);
    if (!serverId) return null;
    const serverHost = serverId.split(':')[0].toLowerCase();
    const urlPrefix  = getServerAvatarPrefix(serverHost);
    if (!urlPrefix) return null;
    const info = state.nickIdentified?.[serverId]?.[nickLow];
    if (!info?.identified) return 'https://www.chaat.fr/upload/avatar-undefined.png';
    const targetNick = info.glistNick || nick;
    return urlPrefix + encodeURIComponent(targetNick);
}

// ════════════════════════════════════════════════════════════════
// CTCP — FILTRE ET RÉPONSE AUTOMATIQUE
// ════════════════════════════════════════════════════════════════
const CTCP_CHAR = '\x01';

/**
 * Détecte si un texte est un message CTCP.
 * Retourne { type, params } ou null.
 */
function parseCTCP(text) {
    if (!text.startsWith(CTCP_CHAR)) return null;
    const inner = text.slice(1).replace(/\x01$/, '');
    const sp = inner.indexOf(' ');
    const type   = sp === -1 ? inner : inner.slice(0, sp);
    const params = sp === -1 ? ''    : inner.slice(sp + 1);
    return { type: type.toUpperCase(), params };
}

/**
 * Gère les CTCP entrants :
 * - VERSION  → répond automatiquement
 * - PING     → répond automatiquement
 * - ACTION   → retourne le texte formaté pour affichage
 * - autres   → ignore silencieusement
 * Retourne null si le message doit être ignoré,
 * ou une string HTML à afficher pour ACTION.
 */
function handleCTCP(serverId, senderNick, target, ctcp) {
    const myNick = state.connectedServers[serverId]?.nick || '';

    if (ctcp.type === 'VERSION') {
        irc.sendRaw(serverId, `NOTICE ${senderNick} :\x01VERSION SKIRC 1.0 (Tauri)\x01`);
        return null; // ne pas afficher
    }
    if (ctcp.type === 'PING') {
        irc.sendRaw(serverId, `NOTICE ${senderNick} :\x01PING ${ctcp.params}\x01`);
        return null;
    }
    if (ctcp.type === 'ACTION') {
        // /me → affiche comme "* nick action"
        const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const time = new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false});
        return `[${time}] * <span style="color:#e0609a;">${esc(senderNick)}</span> ${esc(ctcp.params)}`;
    }
    // Tout autre CTCP → ignorer
    return null;
}

// ════════════════════════════════════════════════════════════════
// CLASSE IRC
// ════════════════════════════════════════════════════════════════
class IRC {
  constructor() {
    this.initialized   = false;
    this._whoisQueue   = [];
    this._whoisTimer   = null;
    this._pmLogsLoaded = new Set();
    this._reconnectTimers  = {};
    this._reconnectDelays  = {};
    this._reconnectAttempt = {};
    this._nickRecheckTimers = {};

    window.setCtx = (server, target, type) => {
        state.currentServer        = server;
        state.currentContextTarget = target;
        state.currentContextType   = type;
        if (state.unread[server]?.[target]) state.unread[server][target] = 0;
        if (type === 'pm' && target && server) {
            if (!state.userProfiles[target.toLowerCase()]) this.queueWhoisDirect(server, target);
            const pmKey = `${server}::${target.toLowerCase()}`;
            if (!this._pmLogsLoaded.has(pmKey)) {
                this._pmLogsLoaded.add(pmKey);
                this._loadPmLogs(server, target).then(() => update());
            }
        }
        update();
    };

    window.closeTab = (server, target, type, event) => {
        if (event) { event.stopPropagation(); event.preventDefault(); }
        if (type === 'channel') {
            this.sendRaw(server, `PART ${target}`);
            if (state.messages[server]) delete state.messages[server][target];
            if (state.nicks[server])    delete state.nicks[server][target];
            if (state.unread[server])   delete state.unread[server][target];
            this._purgeWhoisQueue(server);
        } else if (type === 'pm') {
            if (state.privates[server]) delete state.privates[server][target];
            if (state.unread[server])   delete state.unread[server][target];
            this._pmLogsLoaded.delete(`${server}::${target.toLowerCase()}`);
        }
        if (state.currentServer === server && state.currentContextTarget === target) {
            state.currentContextType   = 'server';
            state.currentContextTarget = server;
        }
        update();
    };

    window.leaveCurrentChannel = () => {
        const s = state.currentServer, t = state.currentContextTarget;
        if (s && t && t.startsWith("#")) this.handleInput(`/part ${t}`);
    };
  }

  async init() {
    const tauri = window.__TAURI__;
    if (!tauri || this.initialized) return;
    await tauri.event.listen('irc-message',    (e) => this.handleRawData(e.payload.server_id, e.payload.message));
    await tauri.event.listen('irc-disconnect', (e) => this._handleDisconnect(e.payload.server_id, e.payload.reason));
    this.initialized = true;
  }

  // ── Reconnexion ────────────────────────────────────────────
  _handleDisconnect(serverId, reason) {
    const srv = state.connectedServers[serverId]; if (!srv) return;
    const time = new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false});
    if (!state.serverLogs[serverId]) state.serverLogs[serverId] = [];
    pushLine(state.serverLogs[serverId],
        `[${time}] [!] <span style="color:#e74c3c;font-weight:bold;">Deconnecte : ${this.escapeHTML(reason)}</span>`);
    if (state.nicks[serverId]) Object.keys(state.nicks[serverId]).forEach(chan => { state.nicks[serverId][chan] = []; });
    if (!isDisabled(state.autoReconnect)) this._scheduleReconnect(serverId);
    else pushLine(state.serverLogs[serverId], `[${time}] Auto-reconnexion desactivee (config).`);
    update();
  }

  _scheduleReconnect(serverId) {
    const srv = state.connectedServers[serverId]; if (!srv) return;
    if (this._reconnectTimers[serverId]) { clearTimeout(this._reconnectTimers[serverId]); delete this._reconnectTimers[serverId]; }
    const attempt = (this._reconnectAttempt[serverId] || 0) + 1;
    this._reconnectAttempt[serverId] = attempt;
    const delay = Math.min(5000 * Math.pow(2, attempt - 1), 60000);
    const time = new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false});
    pushLine(state.serverLogs[serverId], `[${time}] [...] Reconnexion dans ${Math.round(delay/1000)}s... (tentative ${attempt})`);
    update();
    this._reconnectTimers[serverId] = setTimeout(async () => {
        delete this._reconnectTimers[serverId];
        if (!state.connectedServers[serverId] || isDisabled(state.autoReconnect)) return;
        try {
            await window.__TAURI__.core.invoke('connect_irc', { host:srv.host, port:parseInt(srv.port), ssl:srv.ssl, nick:srv.nick, realname:state.realname||srv.nick });
        } catch (e) {
            const t = new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false});
            pushLine(state.serverLogs[serverId], `[${t}] [!] Echec : ${this.escapeHTML(String(e))}`); update();
            if (!isDisabled(state.autoReconnect)) this._scheduleReconnect(serverId);
        }
    }, delay);
  }

  _cancelReconnect(serverId) {
    if (this._reconnectTimers[serverId]) { clearTimeout(this._reconnectTimers[serverId]); delete this._reconnectTimers[serverId]; }
    delete this._reconnectAttempt[serverId];
  }
  _resetReconnectCounter(serverId) { this._reconnectAttempt[serverId] = 0; }

  // ── Utilitaires ────────────────────────────────────────────
  escapeHTML(str) {
    if (!str) return "";
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  }
  clean(nick) {
    if (!nick) return "";
    return (nick.startsWith(':') ? nick.substring(1) : nick).split('!')[0].replace(/[~&@%+]/g,'');
  }
  parseRealname(raw) {
    if (!raw) return null;
    const m = raw.trim().match(/^(\d+)\s+([MmFfHh])\s*(.*)$/);
    if (!m) return null;
    return { age: parseInt(m[1],10), gender: m[2].toLowerCase(), city: m[3].trim()||null, raw: raw.trim() };
  }
  _addUnread(serverId, target) {
    if (state.currentServer===serverId && state.currentContextTarget===target) return;
    if (!state.unread[serverId]) state.unread[serverId] = {};
    state.unread[serverId][target] = (state.unread[serverId][target]||0) + 1;
  }

  // ── Identified / Glist ─────────────────────────────────────
  _ensureNickIdMap(s) { if (!state.nickIdentified[s]) state.nickIdentified[s] = {}; }
  _setNickIdentified(s, nick, identified, glistNick=null) {
    this._ensureNickIdMap(s);
    const k = nick.toLowerCase(), ex = state.nickIdentified[s][k] || {};
    state.nickIdentified[s][k] = {
        identified: identified !== undefined ? identified : (ex.identified||false),
        glistNick:  glistNick  !== null      ? glistNick  : (ex.glistNick||null),
    };
  }
  _clearNickIdInfo(s, nick) { this._ensureNickIdMap(s); delete state.nickIdentified[s][nick.toLowerCase()]; }

  // ── WHOIS ──────────────────────────────────────────────────
  _visibleNicks(serverId) {
    const nicks = state.nicks[serverId]; if (!nicks) return new Set();
    const s = new Set();
    Object.values(nicks).forEach(list => list.forEach(raw => s.add(this.clean(raw).toLowerCase())));
    return s;
  }
  _purgeWhoisQueue(serverId) {
    const visible = this._visibleNicks(serverId);
    this._whoisQueue = this._whoisQueue.filter(key => {
        const [srv,n] = key.split("::"); if (srv!==serverId) return true;
        return visible.has(n.toLowerCase());
    });
  }
  queueWhois(serverId, nick) {
    const nickLow=nick.toLowerCase(); if (state.userProfiles[nickLow]) return;
    if (!this._visibleNicks(serverId).has(nickLow)) return;
    const key=`${serverId}::${nickLow}`; if (this._whoisQueue.includes(key)) return;
    this._whoisQueue.push(key); this._startWhoisTimer();
  }
  queueWhoisDirect(serverId, nick) {
    const key=`${serverId}::${nick.toLowerCase()}`; if (this._whoisQueue.includes(key)) return;
    this._whoisQueue.unshift(key); this._startWhoisTimer();
  }
  _startWhoisTimer() {
    if (this._whoisTimer) return;
    this._whoisTimer = setInterval(() => {
        if (!this._whoisQueue.length) { clearInterval(this._whoisTimer); this._whoisTimer=null; return; }
        const [srv,n]=this._whoisQueue.shift().split("::");
        const visible=this._visibleNicks(srv);
        const isPm=!!(state.privates[srv]?.[n]||Object.keys(state.privates[srv]||{}).find(k=>k.toLowerCase()===n));
        if (visible.has(n)||isPm) this.sendRaw(srv,`WHOIS ${n}`);
    }, 600);
  }

  isBlocked(nick, isChannel) {
    const n=nick.toLowerCase();
    if (state.friends.includes(n)) return false;
    if (state.blocked.includes(n)) return true;
    if (!isChannel && state.blockAll) return true;
    return false;
  }

  parseAwayArgs(rawArgs) {
    const tbMatch  = rawArgs.match(/textbox:"([^"]*)"/i);
    const msgMatch = rawArgs.match(/message:"([^"]*)"/i);
    return { textbox: tbMatch?tbMatch[1]:null, message: msgMatch?msgMatch[1]:null };
  }

  // ============================================================
  // AUTO-REPLY UNIFIE
  //
  // textbox:"..." dans /away  = status IRC visible dans /whois
  // message:"..." dans /away  = texte envoye en auto-reply
  //
  // Priorite du message de reponse :
  //   1. state.awayMessage   (defini inline par /away message:"...")
  //   2. state.mentionReply  (defini dans config.json mention_reply)
  //   => si aucun n est defini/active => pas de reponse
  //
  // Master toggle : state.autoReplyEnabled
  //   => /togglemessage bascule true/false
  //
  // Rate-limit : 1 reponse par nick par 10 minutes
  // ============================================================
  _sendAutoReply(serverId, senderNick, target, isChannel) {
    // Master toggle -- /togglemessage desactive tout
    if (!state.autoReplyEnabled) return;

    // Texte de reponse : awayMessage inline > mentionReply config
    const replyVal = (
        (state.away && state.awayMessage && !isDisabled(state.awayMessage))
            ? state.awayMessage
            : (!isDisabled(state.mentionReply) ? state.mentionReply : null)
    );
    if (!replyVal) return;

    // Rate-limit 10 min par nick
    const senderLow = senderNick.toLowerCase();
    const now = Date.now(), TEN_MIN = 10 * 60 * 1000;
    const time = new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false});
    if (!state.awayReplies[serverId]) state.awayReplies[serverId] = {};
    if ((now - (state.awayReplies[serverId][senderLow] ?? 0)) < TEN_MIN) return;
    state.awayReplies[serverId][senderLow] = now;

    if (replyVal.startsWith('/')) {
        // Commande IRC -- envoyee brute sans le /
        this.sendRaw(serverId, replyVal.substring(1));
    } else {
        // Texte -- PRIVMSG vers l'expediteur uniquement
        this.sendRaw(serverId, `PRIVMSG ${senderNick} :${replyVal}`);
        if (!state.privates[serverId])             state.privates[serverId] = {};
        if (!state.privates[serverId][senderNick]) state.privates[serverId][senderNick] = [];
        pushLine(state.privates[serverId][senderNick],
            `[${time}] &lt;Moi&gt; ${this.escapeHTML(replyVal)}`);
        this._addUnread(serverId, senderNick);
    }
    update();
  }

  _handleMentionReply(serverId, senderNick, target, isChannel) {
    this._sendAutoReply(serverId, senderNick, target, isChannel);
  }
  handleAwayMention(serverId, senderNick, target, isChannel) {
    this._sendAutoReply(serverId, senderNick, target, isChannel);
  }

  disconnectServer(serverId) {
    this._cancelReconnect(serverId);
    this._whoisQueue=this._whoisQueue.filter(k=>!k.startsWith(`${serverId}::`));
    for (const key of [...this._pmLogsLoaded]) { if (key.startsWith(`${serverId}::`)) this._pmLogsLoaded.delete(key); }
    delete state.connectedServers[serverId]; delete state.messages[serverId];
    delete state.privates[serverId]; delete state.serverLogs[serverId];
    delete state.nicks[serverId]; delete state.awayReplies[serverId];
    delete state.unread[serverId]; delete state.nickIdentified[serverId];
    if (state.currentServer===serverId) {
        const r=Object.keys(state.connectedServers);
        if (r.length>0) { state.currentServer=r[0]; state.currentContextTarget=r[0]; state.currentContextType='server'; }
        else { state.currentServer=state.currentContextTarget=state.currentContextType=null; }
    }
    update();
  }

  // ── Logs ───────────────────────────────────────────────────
  _logLineToHtml(raw) {
    const tsM=raw.match(/^\[(\d{2}):(\d{2}):\d{2}\]\s*/),time=tsM?`${tsM[1]}:${tsM[2]}`:"??:??";
    const rest=tsM?raw.slice(tsM[0].length):raw;
    const mm=rest.match(/^<([^>]+)>\s*(.*)/s);
    if (mm) return `[${time}] &lt;${this.escapeHTML(mm[1])}&gt; ${this.escapeHTML(mm[2])}`;
    const nm=rest.match(/^-([^-]+)-\s*(.*)/s);
    if (nm) return `[${time}] -${this.escapeHTML(nm[1])}- ${this.escapeHTML(nm[2])}`;
    return `[${time}] ${this.escapeHTML(rest)}`;
  }
  async _loadLogs(serverId) {
    try {
        const logs=await window.__TAURI__.core.invoke('load_logs',{serverId});
        if (!logs||typeof logs!=='object') return;
        Object.entries(logs).forEach(([stem,lines])=>{
            const htmlLines=lines.slice(-MAX_LINES).map(l=>this._logLineToHtml(l));
            if (stem==='_server') state.serverLogs[serverId]=htmlLines;
            else if (stem.startsWith('#')) { if(!state.messages[serverId])state.messages[serverId]={}; state.messages[serverId][stem]=htmlLines; }
        });
    } catch(e) { console.warn('[SKIRC] Logs:',e); }
  }
  async _loadPmLogs(serverId, nick) {
    try {
        const logs=await window.__TAURI__.core.invoke('load_logs',{serverId});
        if (!logs||typeof logs!=='object') return;
        const lines=logs[`&${nick}`]; if (!lines?.length) return;
        const htmlLines=lines.slice(-MAX_LINES).map(l=>this._logLineToHtml(l));
        if (!state.privates[serverId]) state.privates[serverId]={};
        const existing=state.privates[serverId][nick]||[];
        const lastLogLine=htmlLines[htmlLines.length-1]??"";
        const m=lastLogLine.match(/^\[(\d{2}:\d{2})\]/);
        const lastTime=m?m[1]:null;
        const liveOnly=lastTime?existing.filter(msg=>{const tm=msg.match(/^\[(\d{2}:\d{2})\]/);if(!tm)return true;return tm[1]>lastTime;}):existing;
        state.privates[serverId][nick]=[...htmlLines,...liveOnly];
    } catch(e) { console.warn('[SKIRC] PM logs:',e); }
  }

  // ════════════════════════════════════════════════════════════
  // HANDLER DONNÉES BRUTES IRC
  // ════════════════════════════════════════════════════════════
  async handleRawData(serverId, rawLine) {
    const msg=rawLine.trim(); if (!msg) return;
    const time=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false});
    if (!state.serverLogs[serverId])     state.serverLogs[serverId]={};
    if (!state.messages[serverId])       state.messages[serverId]={};
    if (!state.privates[serverId])       state.privates[serverId]={};
    if (!state.nicks[serverId])          state.nicks[serverId]={};
    if (!state.unread[serverId])         state.unread[serverId]={};
    if (!state.nickIdentified[serverId]) state.nickIdentified[serverId]={};
    // fix : serverLogs doit être un array
    if (!Array.isArray(state.serverLogs[serverId])) state.serverLogs[serverId]=[];

    const parts=msg.split(" ");
    if (parts[0]==="PING") { this.sendRaw(serverId,`PONG ${parts[1]}`); return; }
    this._resetReconnectCounter(serverId);
    if (this._reconnectTimers[serverId]) { clearTimeout(this._reconnectTimers[serverId]); delete this._reconnectTimers[serverId]; }

    // ── 001 Welcome ────────────────────────────────────────
    if (parts[1]==="001") {
        Object.keys(state.messages[serverId]||{}).forEach(chan=>{
            if (!chan.startsWith('#')) return;
            state.nicks[serverId][chan]=[];
            this.sendRaw(serverId,`JOIN ${chan}`);
        });
        if (state.connectMessages?.length>0) {
            const msgs=[...state.connectMessages];
            setTimeout(()=>{
                msgs.forEach((m,i)=>setTimeout(()=>{
                    if (!state.connectedServers[serverId]) return;
                    if (m.startsWith('/')) this.sendRaw(serverId,m.substring(1));
                    const t=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false});
                    pushLine(state.serverLogs[serverId],`[${t}] -> <span style="color:#4ac7a1;">${this.escapeHTML(m)}</span>`);
                    update();
                },i*300));
            },1000);
        }
        if (state.away) {
            const awayDelay=1000+(state.connectMessages?.length||0)*300+500;
            setTimeout(()=>{
                if (!state.connectedServers[serverId]||!state.away) return;
                const awayText=state.awayTextbox||(!isDisabled(state.awayStatusContent)?state.awayStatusContent:null)||"Away";
                this.sendRaw(serverId,`AWAY :${awayText}`);
            },awayDelay);
        }
        return;
    }

    // ── 311 WHOIS ──────────────────────────────────────────
    if (parts[1]==="311") {
        const targetNick=parts[3],realname=msg.includes(" :")?msg.substring(msg.lastIndexOf(" :")+2):"";
        if (targetNick&&realname) { const p=this.parseRealname(realname); if(p){state.userProfiles[targetNick.toLowerCase()]=p;update();} }
        this._setNickIdentified(serverId,targetNick,false);
        return; // ne pas logguer le WHOIS brut dans le chat
    }
    if (parts[1]==="307") { const n=parts[3]||parts[2]; if(n){this._setNickIdentified(serverId,n,true);update();} return; }
    if (parts[1]==="330") { const n=parts[3],g=parts[4]; if(n&&g){this._setNickIdentified(serverId,n,true,g);update();} return; }
    if (parts[1]==="318") return; // End of WHOIS
    if (parts[1]==="319") return; // Channels in WHOIS
    if (parts[1]==="312") return; // Server in WHOIS
    if (parts[1]==="313") return; // IRC Op in WHOIS
    if (parts[1]==="317") return; // Idle time in WHOIS
    if (parts[1]==="338") return; // Real IP in WHOIS

    // ── PRIVMSG / NOTICE ───────────────────────────────────
    if (parts[1]==="PRIVMSG"||parts[1]==="NOTICE") {
        const rawSender=parts[0], sender=this.clean(rawSender), target=parts[2];
        const text=msg.includes(" :")?msg.substring(msg.indexOf(" :")+2):parts.slice(3).join(" ");
        const isServerNotice=parts[1]==="NOTICE"&&(target==="*"||target.toUpperCase()==="AUTH"||!rawSender.includes("!"));
        if (isServerNotice) { pushLine(state.serverLogs[serverId],`[${time}] -${this.escapeHTML(sender)}- ${this.escapeHTML(text)}`); update(); return; }
        const isChannel=target.startsWith("#");

        // ── CTCP : filtre et répond automatiquement ─────────
        const ctcp = parseCTCP(text);
        if (ctcp) {
            const displayed = handleCTCP(serverId, sender, target, ctcp);
            if (displayed) {
                // ACTION → afficher dans le canal/PM
                if (isChannel) {
                    if(!state.messages[serverId][target])state.messages[serverId][target]=[];
                    pushLine(state.messages[serverId][target], displayed);
                    this._addUnread(serverId, target);
                } else {
                    if(!state.privates[serverId][sender])state.privates[serverId][sender]=[];
                    pushLine(state.privates[serverId][sender], displayed);
                    this._addUnread(serverId, sender);
                }
                update();
            }
            return; // tous les CTCP sont consommés ici
        }

        if (this.isBlocked(sender,isChannel)) return;
        if (!state.userProfiles[sender.toLowerCase()]) this.queueWhois(serverId,sender);
        const formatted=`[${time}] &lt;${this.escapeHTML(sender)}&gt; ${this.escapeHTML(text)}`;
        const myNick=state.connectedServers[serverId]?.nick||"";
        const isMention=myNick&&text.toLowerCase().includes(myNick.toLowerCase());
        if (isChannel) {
            if(!state.messages[serverId][target])state.messages[serverId][target]=[];
            pushLine(state.messages[serverId][target],formatted);
            this._addUnread(serverId,target);
            if (isMention) { if(state.away)this.handleAwayMention(serverId,sender,target,true); this._handleMentionReply(serverId,sender,target,true); }
        } else {
            if (!state.privates[serverId][sender]) {
                state.privates[serverId][sender]=[];
                const pmKey=`${serverId}::${sender.toLowerCase()}`;
                if (!this._pmLogsLoaded.has(pmKey)) { this._pmLogsLoaded.add(pmKey); this._loadPmLogs(serverId,sender).then(()=>update()); }
            }
            pushLine(state.privates[serverId][sender],formatted);
            this._addUnread(serverId,sender);
            if (!state.userProfiles[sender.toLowerCase()]) this.queueWhoisDirect(serverId,sender);
            if (state.away) this.handleAwayMention(serverId,sender,sender,false);
            this._handleMentionReply(serverId,sender,sender,false);
        }
        update(); return;
    }

    if (parts[1]==="MODE"&&parts[2]?.startsWith("#")) {
        const chan=parts[2],modes=parts[3],targets=parts.slice(4);
        const modeMap={'q':'~','a':'&','o':'@','h':'%','v':'+'};
        if (state.nicks[serverId][chan]) {
            let currentAction='+',targetIdx=0,newNicks=[...state.nicks[serverId][chan]];
            for (let char of modes) {
                if (char==='+'||char==='-') currentAction=char;
                else if (modeMap[char]) { const t=targets[targetIdx++];if(!t)continue;newNicks=newNicks.map(n=>this.clean(n)===this.clean(t)?(currentAction==='+'?modeMap[char]+this.clean(n):this.clean(n)):n); }
            }
            state.nicks[serverId][chan]=newNicks; update();
        }
        return;
    }
    if (parts[1]==="353") {
        const chan=parts[4],nicks=msg.substring(msg.indexOf(" :")+2).split(" ");
        state.nicks[serverId][chan]=[...new Set([...(state.nicks[serverId][chan]||[]),...nicks])];
        nicks.forEach(raw=>{const n=this.clean(raw);if(n)this.queueWhois(serverId,n);});
        update(); return;
    }
    if (parts[1]==="JOIN") {
        const nick=this.clean(parts[0]),chan=parts[2].startsWith(':')?parts[2].substring(1):parts[2];
        if(!state.messages[serverId][chan])state.messages[serverId][chan]=[];
        if(!state.nicks[serverId][chan])state.nicks[serverId][chan]=[];
        if(!state.nicks[serverId][chan].some(n=>this.clean(n)===nick))state.nicks[serverId][chan]=[...state.nicks[serverId][chan],nick];
        this.queueWhois(serverId,nick);
        if(state.friends.includes(nick.toLowerCase()))pushLine(state.serverLogs[serverId],`[${time}] [Ami] <span style="color:#ffd700;font-weight:bold;">${this.escapeHTML(nick)}</span> a rejoint <span style="color:#4ac7a1;">${this.escapeHTML(chan)}</span>`);
        update(); return;
    }
    if (parts[1]==="PART") {
        const nick=this.clean(parts[0]),chan=parts[2].startsWith(':')?parts[2].substring(1):parts[2];
        if(state.nicks[serverId][chan]){state.nicks[serverId][chan]=state.nicks[serverId][chan].filter(n=>this.clean(n)!==nick);this._purgeWhoisQueue(serverId);update();}
        return;
    }
    if (parts[1]==="QUIT") {
        const nick=this.clean(parts[0]);
        Object.keys(state.nicks[serverId]||{}).forEach(chan=>{state.nicks[serverId][chan]=state.nicks[serverId][chan].filter(n=>this.clean(n)!==nick);});
        this._purgeWhoisQueue(serverId); update(); return;
    }
    if (parts[1]==="KICK") {
        const chan=parts[2],victim=this.clean(parts[3]),myNick=state.connectedServers[serverId]?.nick||"";
        if(state.nicks[serverId][chan]){state.nicks[serverId][chan]=state.nicks[serverId][chan].filter(n=>this.clean(n)!==victim);this._purgeWhoisQueue(serverId);}
        if(victim.toLowerCase()===myNick.toLowerCase()){
            const kicker=this.clean(parts[0]),reason=msg.includes(" :")?msg.substring(msg.lastIndexOf(" :")+2):"";
            pushLine(state.serverLogs[serverId],`[${time}] [X] Expulse de <b>${this.escapeHTML(chan)}</b> par <b>${this.escapeHTML(kicker)}</b>${reason?` (${this.escapeHTML(reason)})`:''}`)
            delete state.messages[serverId][chan];delete state.nicks[serverId][chan];
            if(state.unread[serverId])delete state.unread[serverId][chan];
            if(state.currentContextTarget===chan){state.currentContextTarget=serverId;state.currentContextType='server';}
        }
        update(); return;
    }
    if (parts[1]==="NICK") {
        const oldNick=this.clean(parts[0]),newNick=parts[2].startsWith(':')?parts[2].substring(1):parts[2];
        const profile=state.userProfiles[oldNick.toLowerCase()];
        if(profile){state.userProfiles[newNick.toLowerCase()]=profile;delete state.userProfiles[oldNick.toLowerCase()];}
        if(state.unread[serverId]?.[oldNick]){state.unread[serverId][newNick]=state.unread[serverId][oldNick];delete state.unread[serverId][oldNick];}
        const oldPmKey=`${serverId}::${oldNick.toLowerCase()}`,newPmKey=`${serverId}::${newNick.toLowerCase()}`;
        if(this._pmLogsLoaded.has(oldPmKey)){this._pmLogsLoaded.delete(oldPmKey);this._pmLogsLoaded.add(newPmKey);}
        this._clearNickIdInfo(serverId,oldNick);this._clearNickIdInfo(serverId,newNick);
        if(this._nickRecheckTimers[newNick])clearTimeout(this._nickRecheckTimers[newNick]);
        this._nickRecheckTimers[newNick]=setTimeout(()=>{delete this._nickRecheckTimers[newNick];if(state.connectedServers[serverId])this.sendRaw(serverId,`WHOIS ${newNick}`);},60000);
        const myNick=state.connectedServers[serverId]?.nick||"";
        if(oldNick.toLowerCase()===myNick.toLowerCase()){state.connectedServers[serverId].nick=newNick;pushLine(state.serverLogs[serverId],`[${time}] Vous etes maintenant : <b>${this.escapeHTML(newNick)}</b>`);}
        Object.keys(state.nicks[serverId]||{}).forEach(chan=>{state.nicks[serverId][chan]=state.nicks[serverId][chan].map(n=>{const p=n.replace(/^[~&@%+]/,''),prefix=n.match(/^([~&@%+])/)?.[1]||'';return p===oldNick?prefix+newNick:n;});});
        if(state.privates[serverId]?.[oldNick]){state.privates[serverId][newNick]=state.privates[serverId][oldNick];delete state.privates[serverId][oldNick];if(state.currentContextTarget===oldNick)state.currentContextTarget=newNick;}
        update(); return;
    }

    // Numéros IRC courants → log serveur silencieux (pas dans le chat principal)
    const numericSilent=['366','265','266','250','251','252','253','254','255','256','257','258','259','372','375','376'];
    if (numericSilent.includes(parts[1])) { pushLine(state.serverLogs[serverId],`[${time}] ${this.escapeHTML(msg)}`); update(); return; }

    if (/^\d{3}$/.test(parts[1])) { pushLine(state.serverLogs[serverId],`[${time}] ${this.escapeHTML(msg)}`); }
    else { pushLine(state.serverLogs[serverId],`[${time}] ${this.escapeHTML(msg)}`); }
    update();
  }

  // ════════════════════════════════════════════════════════════
  async connect(host, port, ssl, nick) {
    const serverId=`${host}:${port}`,realname=state.realname||nick;
    state.connectedServers[serverId]={nick,host,port,ssl};
    state.currentServer=serverId;state.currentContextType='server';state.currentContextTarget=serverId;
    state.nicks[serverId]={};state.unread[serverId]={};
    state.messages[serverId]={};state.privates[serverId]={};
    state.serverLogs[serverId]=[];state.nickIdentified[serverId]={};
    this._cancelReconnect(serverId);
    await this._loadLogs(serverId);
    const channels=Object.keys(state.messages[serverId]||{});
    if(channels.length>0){state.currentContextTarget=channels[0];state.currentContextType='channel';}
    update();
    await window.__TAURI__.core.invoke('connect_irc',{host,port:parseInt(port),ssl,nick,realname});
  }

  async handleInput(text) {
    const srv=state.currentServer; if (!srv||!text) return;
    if (text.startsWith("/")) {
        const spaceIdx=text.indexOf(" ");
        const cmd=(spaceIdx===-1?text.substring(1):text.substring(1,spaceIdx)).toUpperCase();
        const rawArgs=spaceIdx===-1?"":text.substring(spaceIdx+1).trim();
        const args=rawArgs.split(" ");
        if (cmd==="AWAY") {
            const {textbox,message}=this.parseAwayArgs(rawArgs);
            // textbox:"..." = status IRC visible dans /whois
            //   priorite : arg inline > away_status_content config > "Away"
            const awayText = textbox
                ?? (!isDisabled(state.awayStatusContent) ? state.awayStatusContent : null)
                ?? "Away";
            // message:"..." = texte envoye en auto-reply aux gens qui nous contactent
            //   priorite : arg inline > mention_reply config
            //   si aucun => pas de message auto (awayMessage reste vide)
            const awayMsg = message
                ?? (!isDisabled(state.mentionReply) ? state.mentionReply : "");
            state.away = true;
            state.awayTextbox  = awayText;
            state.awayMessage  = awayMsg;
            state.awayReplies  = {};
            this.sendRaw(srv, `AWAY :${awayText}`);
            const t1=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false});
            const autoInfo = state.autoReplyEnabled && awayMsg
                ? ` | Auto-reply : "${this.escapeHTML(awayMsg)}"`
                : state.autoReplyEnabled ? ' | Auto-reply desactive (aucun message configure)' : ' | Auto-reply OFF (/togglemessage)';
            pushLine(state.serverLogs[srv],
                `[${t1}] [Away] Status : <b>${this.escapeHTML(awayText)}</b>${autoInfo}`);
            update(); return;

        } else if (cmd==="BACK") {
            state.away=false;state.awayTextbox="";state.awayMessage="";state.awayReplies={};
            this.sendRaw(srv,"AWAY");
            const t2=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false});
            pushLine(state.serverLogs[srv],`[${t2}] [OK] Status : <b>De retour</b>`);
            update(); return;

        } else if (cmd==="TOGGLEMESSAGE"||cmd==="TOGGLEMSG") {
            // Bascule le master toggle des messages automatiques
            state.autoReplyEnabled = !state.autoReplyEnabled;
            const t3=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false});
            const status = state.autoReplyEnabled ? "ACTIVE" : "DESACTIVE";
            pushLine(state.serverLogs[srv],
                `[${t3}] Messages automatiques : <b>${status}</b>`);
            // Sauvegarde dans config
            if (window.persistConfig) window.persistConfig();
            update(); return;

        } else if (cmd==="NICK") {
            const newNick=args[0];if(!newNick)return;
            this.sendRaw(srv,`NICK ${newNick}`);
            pushLine(state.serverLogs[srv],`[${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false})}] Changement de pseudo vers ${this.escapeHTML(newNick)}...`);
            update(); return;
        } else if (cmd==="JOIN") {
            const chan=args[0].startsWith("#")?args[0]:"#"+args[0];
            if(!state.messages[srv][chan])state.messages[srv][chan]=[];
            state.nicks[srv][chan]=[];state.currentContextTarget=chan;state.currentContextType='channel';
            this.sendRaw(srv,`JOIN ${chan}`);
        } else if (cmd==="PART") {
            let target=args[0]||(state.currentContextType==='channel'?state.currentContextTarget:null);
            if(target&&target.startsWith("#")){this.sendRaw(srv,`PART ${target}`);delete state.messages[srv][target];delete state.nicks[srv][target];if(state.unread[srv])delete state.unread[srv][target];this._purgeWhoisQueue(srv);state.currentContextTarget=srv;state.currentContextType='server';}
        } else if (cmd==="QUIT") {
            this._cancelReconnect(srv);this.sendRaw(srv,`QUIT :${args.join(" ")||"SKIRC"}`);this.disconnectServer(srv);return;
        } else if (cmd==="MSG"||cmd==="QUERY") {
            const target=args[0],msgText=args.slice(1).join(" ");
            if(target){if(!state.privates[srv])state.privates[srv]={};if(!state.privates[srv][target])state.privates[srv][target]=[];state.currentContextTarget=target;state.currentContextType='pm';if(state.unread[srv])state.unread[srv][target]=0;if(!state.userProfiles[target.toLowerCase()])this.queueWhoisDirect(srv,target);const pmKey=`${srv}::${target.toLowerCase()}`;if(!this._pmLogsLoaded.has(pmKey)){this._pmLogsLoaded.add(pmKey);this._loadPmLogs(srv,target).then(()=>update());}if(msgText)this.sendMessage(target,msgText);else update();}
        } else { this.sendRaw(srv,text.substring(1)); }
    } else { this.sendMessage(state.currentContextTarget,text); }
    update();
  }

  async sendRaw(serverId, message) {
    await window.__TAURI__.core.invoke('send_irc',{serverId,message:message+'\r\n'});
  }
  sendMessage(target, text) {
    const srv=state.currentServer;if(!target||target===srv)return;
    const time=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false});
    this.sendRaw(srv,`PRIVMSG ${target} :${text}`);
    const formatted=`[${time}] &lt;Moi&gt; ${this.escapeHTML(text)}`;
    if(target.startsWith("#")){if(!state.messages[srv][target])state.messages[srv][target]=[];pushLine(state.messages[srv][target],formatted);}
    else{if(!state.privates[srv][target])state.privates[srv][target]=[];pushLine(state.privates[srv][target],formatted);}
    update();
  }
}

export const irc = new IRC();