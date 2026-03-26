import { state, setUI } from "./state.js";
import { irc } from "./irc-core.js";
import { renderAdiirc } from "./ui/adiirc-ui.js";
import { renderKiwi }   from "./ui/kiwi-ui.js";
import { renderMobile } from "./ui/mobile-ui.js";

// ── Détection mobile ─────────────────────────────────────────────
function isMobile() {
    const ua = navigator.userAgent.toLowerCase();
    return /android|iphone|ipad|ipod|mobile/.test(ua) ||
           window.__TAURI_INTERNALS__?.metadata?.currentPlatform === 'android' ||
           window.__TAURI_INTERNALS__?.metadata?.currentPlatform === 'ios' ||
           (window.innerWidth <= 600 && 'ontouchstart' in window);
}

// ── Thème KiwiIRC dark ───────────────────────────────────────────
let kiwiDark = localStorage.getItem('kiwi-dark') === 'true';
function applyKiwiDark() {
    if (kiwiDark) document.documentElement.classList.add('kiwi-dark');
    else          document.documentElement.classList.remove('kiwi-dark');
    const btn = document.getElementById("kiwi-dark-toggle");
    if (btn) btn.textContent = kiwiDark ? "Mode clair KiwiIRC" : "Mode sombre KiwiIRC";
}
window.toggleKiwiDark = () => { kiwiDark=!kiwiDark; localStorage.setItem('kiwi-dark',kiwiDark); applyKiwiDark(); };

function loadTheme(ui) {
    let link = document.getElementById("theme-link");
    if (!link) { link=document.createElement("link"); link.id="theme-link"; link.rel="stylesheet"; document.head.appendChild(link); }
    if      (ui==='adiirc') link.href=`./css/adiirc.css`;
    else if (ui==='kiwi')   link.href=`./css/kiwi-ui.css`;
    else if (ui==='mobile') link.href=`./css/mobile-ui.css`;
    else                    link.href="";
}

async function initApp() {
    applyKiwiDark();
    try {
        const cfg = await window.__TAURI__.core.invoke('load_config');
        if (cfg) {
            if (cfg.realname)                           state.realname           = cfg.realname;
            if (cfg.blocked)                            state.blocked            = cfg.blocked;
            if (cfg.friends)                            state.friends            = cfg.friends;
            if (cfg.block_all !== undefined)            state.blockAll           = cfg.block_all;
            if (cfg.avatars)                            state.avatars            = cfg.avatars;
            if (cfg.my_avatar)                          state.myAvatar           = cfg.my_avatar;
            if (cfg.connect_messages)                   state.connectMessages    = cfg.connect_messages;
            if (cfg.default_host)                       state.defaultHost        = cfg.default_host;
            if (cfg.default_port)                       state.defaultPort        = cfg.default_port;
            if (cfg.default_ssl !== undefined)          state.defaultSsl         = cfg.default_ssl;
            if (cfg.default_nick)                       state.defaultNick        = cfg.default_nick;
            if (cfg.mention_reply !== undefined)        state.mentionReply       = cfg.mention_reply;
            if (cfg.auto_reply_enabled !== undefined)   state.autoReplyEnabled   = cfg.auto_reply_enabled;
            if (cfg.away_status_content !== undefined)  state.awayStatusContent  = cfg.away_status_content;
            if (cfg.auto_reconnect !== undefined)       state.autoReconnect      = cfg.auto_reconnect;
            if (cfg.server_avatar_urls && Object.keys(cfg.server_avatar_urls).length)
                state.serverAvatarUrls = cfg.server_avatar_urls;
        }
    } catch (e) { console.warn("Impossible de charger la config:", e); }

    await irc.init();

    const defaultUI = isMobile() ? 'mobile' : 'adiirc';
    state.currentUI  = defaultUI;

    if (defaultUI === 'mobile') {
        document.body.classList.add('no-menubar');
    } else {
        renderGlobalMenu();
    }
    window.switchUI(defaultUI);
}

// ── Sauvegarde ───────────────────────────────────────────────────
async function persistConfig() {
    try {
        await window.__TAURI__.core.invoke('save_config', {
            config: {
                realname:            state.realname,
                blocked:             state.blocked,
                block_all:           state.blockAll,
                friends:             state.friends,
                avatars:             state.avatars,
                my_avatar:           state.myAvatar,
                connect_messages:    state.connectMessages,
                default_host:        state.defaultHost,
                default_port:        state.defaultPort,
                default_ssl:         state.defaultSsl,
                default_nick:        state.defaultNick,
                mention_reply:       state.mentionReply,
                auto_reply_enabled:  state.autoReplyEnabled,
                away_status_content: state.awayStatusContent,
                auto_reconnect:      state.autoReconnect,
                server_avatar_urls:  state.serverAvatarUrls,
            }
        });
    } catch (e) { console.warn("Erreur sauvegarde config:", e); }
}
window.persistConfig = persistConfig;

// ── Menu global (desktop seulement) ─────────────────────────────
function renderGlobalMenu() {
    const oldMenu = document.querySelector(".global-menubar");
    if (oldMenu) oldMenu.remove();
    const menuBar = document.createElement("div");
    menuBar.className = "global-menubar";
    menuBar.innerHTML = `
        <div class="menu-item">
            <span class="menu-title">Affichage</span>
            <div class="menu-dropdown">
                <div class="menu-option" onclick="window.switchUI('adiirc')">Interface AdiIRC</div>
                <div class="menu-option" onclick="window.switchUI('kiwi')">Interface KiwiIRC</div>
                <div class="menu-option" onclick="window.switchUI('mobile')">Interface Mobile</div>
                <div class="menu-separator"></div>
                <div class="menu-option" id="kiwi-dark-toggle" onclick="window.toggleKiwiDark()">
                    ${kiwiDark ? 'Mode clair KiwiIRC' : 'Mode sombre KiwiIRC'}
                </div>
            </div>
        </div>
        <div class="menu-item">
            <span class="menu-title">Social</span>
            <div class="menu-dropdown">
                <div class="menu-option" onclick="window.openBlockedPopup()">Blocked</div>
                <div class="menu-option" onclick="window.openFriendsPopup()">Friends</div>
                <div class="menu-option" onclick="window.openAvatarsPopup()">Avatars</div>
            </div>
        </div>
        <div class="menu-item">
            <span class="menu-title">Connexion</span>
            <div class="menu-dropdown">
                <div class="menu-option" onclick="window.openConnectMessagesPopup()">Messages de connexion</div>
            </div>
        </div>
        <div class="menu-item">
            <span class="menu-title">Serveur</span>
            <div class="menu-dropdown">
                <div class="menu-option" onclick="window.showConnectBar?.()">Connexion...</div>
                <div class="menu-option" onclick="window.openProfilePopup()">Identite...</div>
                <div class="menu-option" onclick="irc.handleInput('/quit')">Quitter</div>
            </div>
        </div>`;
    document.body.prepend(menuBar);
}

function createOverlay(id) {
    if (document.getElementById(id)) return null;
    const overlay = document.createElement("div");
    overlay.id = id; overlay.className = "social-overlay";
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
    return overlay;
}

// ════════════════════════════════════════════════════════════════
// POPUP MESSAGES DE CONNEXION
// ════════════════════════════════════════════════════════════════
window.openConnectMessagesPopup = () => {
    const overlay = createOverlay("connmsg-overlay"); if (!overlay) return;
    overlay.innerHTML = `
        <div class="social-popup" style="width:460px;max-height:560px;">
            <div class="social-title">Messages de connexion</div>
            <div class="connmsg-info">
                Chaque commande est envoyee automatiquement au serveur lors de la connexion (code 001).<br>
                Exemples : <code>/ns identify monpassword</code> · <code>/join #salon</code>
            </div>
            <div class="social-add-row">
                <input id="connmsg-input" class="social-input" placeholder="Commande ou message..." autocomplete="off" spellcheck="false">
                <button class="social-btn-add" id="connmsg-add-btn">Add</button>
            </div>
            <ul id="connmsg-list" class="social-list" style="max-height:260px;"></ul>
            <div class="social-footer" style="justify-content:space-between;">
                <span class="connmsg-hint">Ordre : du haut vers le bas</span>
                <button class="social-btn-close" id="connmsg-close">Fermer</button>
            </div>
        </div>`;
    renderConnMsgList();
    const addMsg = async () => {
        const val = document.getElementById("connmsg-input").value.trim(); if (!val) return;
        state.connectMessages.push(val); await persistConfig(); renderConnMsgList();
        document.getElementById("connmsg-input").value = "";
        document.getElementById("connmsg-input").focus();
    };
    document.getElementById("connmsg-add-btn").onclick = addMsg;
    document.getElementById("connmsg-input").onkeypress = (e) => { if(e.key==="Enter") addMsg(); };
    document.getElementById("connmsg-close").onclick = () => overlay.remove();
};
function renderConnMsgList() {
    const ul = document.getElementById("connmsg-list"); if (!ul) return;
    if (!state.connectMessages.length) { ul.innerHTML=`<li class="social-empty">Aucun message configure.</li>`; return; }
    ul.innerHTML = state.connectMessages.map((msg,i) => `
        <li class="social-list-item connmsg-item">
            <span class="connmsg-num">${i+1}</span>
            <span class="connmsg-text">${escapeHtmlMenu(msg)}</span>
            <div class="connmsg-actions">
                <button class="connmsg-move-btn" onclick="window.connMsgMove(${i},-1)" ${i===0?'disabled':''}>^</button>
                <button class="connmsg-move-btn" onclick="window.connMsgMove(${i},1)" ${i===state.connectMessages.length-1?'disabled':''}>v</button>
                <button class="social-btn-remove" onclick="window.connMsgRemove(${i})">x</button>
            </div>
        </li>`).join("");
}
function escapeHtmlMenu(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
window.connMsgRemove = async (idx) => { state.connectMessages.splice(idx,1); await persistConfig(); renderConnMsgList(); };
window.connMsgMove   = async (idx,dir) => { const a=state.connectMessages,d=idx+dir; if(d<0||d>=a.length)return; [a[idx],a[d]]=[a[d],a[idx]]; await persistConfig(); renderConnMsgList(); };

// ════════════════════════════════════════════════════════════════
// POPUP AVATARS
// ════════════════════════════════════════════════════════════════
window.openAvatarsPopup = () => {
    const overlay = createOverlay("avatars-overlay"); if (!overlay) return;
    overlay.innerHTML = `
        <div class="social-popup" style="width:400px;max-height:560px;">
            <div class="social-title">Avatars</div>
            <div class="av-section-title">Mon avatar</div>
            <div class="av-my-row">
                <img id="av-my-preview" class="av-preview" src="${state.myAvatar?_bustUrl(state.myAvatar):''}" style="display:${state.myAvatar?'block':'none'};" onerror="this.style.display='none'">
                <div class="av-my-inputs">
                    <input id="av-my-url" class="social-input" placeholder="URL de votre photo..." value="${state.myAvatar}" autocomplete="off">
                    <button class="social-btn-add" id="av-my-save">Enregistrer</button>
                </div>
            </div>
            <div class="av-section-title" style="margin-top:12px;">Avatars des utilisateurs</div>
            <div class="av-add-row">
                <input id="av-nick-input" class="social-input" placeholder="Pseudo..." style="width:100px;flex:none;">
                <input id="av-url-input" class="social-input" placeholder="URL de l'image..." style="flex:1;">
                <button class="social-btn-add" id="av-add-btn">Add</button>
            </div>
            <ul id="av-list" class="social-list" style="max-height:200px;"></ul>
            <div class="social-footer"><button class="social-btn-close" id="av-close">Fermer</button></div>
        </div>`;
    document.getElementById("av-my-save").onclick = async () => {
        const url=document.getElementById("av-my-url").value.trim(); state.myAvatar=url;
        const prev=document.getElementById("av-my-preview"); prev.src=url?_bustUrl(url):''; prev.style.display=url?'block':'none';
        await persistConfig();
    };
    const addAvatar = async () => {
        const nick=document.getElementById("av-nick-input").value.trim().toLowerCase(), url=document.getElementById("av-url-input").value.trim();
        if (!nick||!url) return; state.avatars[nick]=url; await persistConfig(); renderAvatarList();
        document.getElementById("av-nick-input").value=""; document.getElementById("av-url-input").value=""; document.getElementById("av-nick-input").focus();
    };
    document.getElementById("av-add-btn").onclick = addAvatar;
    document.getElementById("av-url-input").onkeypress = (e) => { if(e.key==="Enter") addAvatar(); };
    document.getElementById("av-close").onclick = () => overlay.remove();
    renderAvatarList();
};
function renderAvatarList() {
    const ul=document.getElementById("av-list"); if(!ul)return;
    const entries=Object.entries(state.avatars);
    if(!entries.length){ul.innerHTML=`<li class="social-empty">Aucun avatar configure.</li>`;return;}
    ul.innerHTML=entries.map(([nick,url])=>`
        <li class="social-list-item" style="gap:8px;">
            <img src="${_bustUrl(url)}" class="av-list-thumb" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22/>'">
            <span class="social-nick" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;">${nick}</span>
            <button class="social-btn-remove" onclick="window.removeAvatar('${nick}')">x</button>
        </li>`).join("");
}
window.removeAvatar = async (nick) => { delete state.avatars[nick]; await persistConfig(); renderAvatarList(); };
function _bustUrl(url) {
    if (!url) return "";
    const slot=Math.floor(Date.now()/(5*60*1000));
    return `${url}${url.includes('?')?'&':'?'}_t=${slot}`;
}
window.bustUrl = _bustUrl;

// ════════════════════════════════════════════════════════════════
// POPUP BLOCKED
// ════════════════════════════════════════════════════════════════
window.openBlockedPopup = () => {
    const overlay=createOverlay("blocked-overlay"); if(!overlay)return;
    overlay.innerHTML=`<div class="social-popup"><div class="social-title">Blocked</div>
        <div class="social-blockall-row"><label class="social-blockall-label">
            <input type="checkbox" id="block-all-chk" ${state.blockAll?'checked':''}> Block All <span class="social-hint">(sauf Friends)</span>
        </label></div>
        <div class="social-add-row"><input id="blocked-input" class="social-input" placeholder="Pseudo..." autocomplete="off"><button class="social-btn-add" id="blocked-add-btn">Add</button></div>
        <ul id="blocked-list" class="social-list"></ul>
        <div class="social-footer"><button class="social-btn-close" id="blocked-close">Fermer</button></div></div>`;
    renderBlockedList();
    document.getElementById("block-all-chk").onchange=async(e)=>{state.blockAll=e.target.checked;await persistConfig();};
    const addBlocked=async()=>{const val=document.getElementById("blocked-input").value.trim().toLowerCase();if(!val||state.blocked.includes(val))return;state.blocked.push(val);await persistConfig();renderBlockedList();document.getElementById("blocked-input").value="";};
    document.getElementById("blocked-add-btn").onclick=addBlocked;
    document.getElementById("blocked-input").onkeypress=(e)=>{if(e.key==="Enter")addBlocked();};
    document.getElementById("blocked-close").onclick=()=>overlay.remove();
};
function renderBlockedList(){const ul=document.getElementById("blocked-list");if(!ul)return;if(!state.blocked.length){ul.innerHTML=`<li class="social-empty">Aucun pseudo bloque.</li>`;return;}ul.innerHTML=state.blocked.map(nick=>`<li class="social-list-item"><span class="social-nick">${nick}</span><button class="social-btn-remove" onclick="window.removeBlocked('${nick}')">x</button></li>`).join("");}
window.removeBlocked=async(nick)=>{state.blocked=state.blocked.filter(n=>n!==nick);await persistConfig();renderBlockedList();};

// ════════════════════════════════════════════════════════════════
// POPUP FRIENDS
// ════════════════════════════════════════════════════════════════
window.openFriendsPopup=()=>{const overlay=createOverlay("friends-overlay");if(!overlay)return;overlay.innerHTML=`<div class="social-popup"><div class="social-title">Friends</div><div class="social-add-row"><input id="friends-input" class="social-input" placeholder="Pseudo ami..." autocomplete="off"><button class="social-btn-add" id="friends-add-btn">Add</button></div><ul id="friends-list" class="social-list"></ul><div class="social-footer"><button class="social-btn-close" id="friends-close">Fermer</button></div></div>`;renderFriendsList();const addFriend=async()=>{const val=document.getElementById("friends-input").value.trim().toLowerCase();if(!val||state.friends.includes(val))return;state.friends.push(val);await persistConfig();renderFriendsList();document.getElementById("friends-input").value="";};document.getElementById("friends-add-btn").onclick=addFriend;document.getElementById("friends-input").onkeypress=(e)=>{if(e.key==="Enter")addFriend();};document.getElementById("friends-close").onclick=()=>overlay.remove();};
function renderFriendsList(){const ul=document.getElementById("friends-list");if(!ul)return;if(!state.friends.length){ul.innerHTML=`<li class="social-empty">Aucun ami.</li>`;return;}ul.innerHTML=state.friends.map(nick=>`<li class="social-list-item"><span class="social-nick">[Ami] ${nick}</span><button class="social-btn-remove" onclick="window.removeFriend('${nick}')">x</button></li>`).join("");}
window.removeFriend=async(nick)=>{state.friends=state.friends.filter(n=>n!==nick);await persistConfig();renderFriendsList();};

// ════════════════════════════════════════════════════════════════
// POPUP IDENTITE
// ════════════════════════════════════════════════════════════════
window.openProfilePopup=()=>{if(document.getElementById("profile-overlay"))return;const overlay=document.createElement("div");overlay.id="profile-overlay";overlay.innerHTML=`<div id="profile-popup"><div id="profile-title">Identite IRC</div><label for="profile-realname">Nom reel :</label><input id="profile-realname" type="text" value="${state.realname}" placeholder="Votre nom reel..." autocomplete="off"><p class="profile-hint">Sera utilise lors des prochaines connexions.</p><div id="profile-status"></div><div id="profile-buttons"><button id="profile-cancel">Annuler</button><button id="profile-save">Enregistrer</button></div></div>`;document.body.appendChild(overlay);const statusEl=()=>document.getElementById("profile-status");document.getElementById("profile-cancel").onclick=()=>overlay.remove();overlay.onclick=(e)=>{if(e.target===overlay)overlay.remove();};document.getElementById("profile-save").onclick=async()=>{const val=document.getElementById("profile-realname").value.trim();if(!val)return;state.realname=val;try{await persistConfig();statusEl().textContent="OK Enregistre.";statusEl().style.color="#4ac7a1";setTimeout(()=>overlay.remove(),800);}catch(e){statusEl().textContent="Erreur : "+e;statusEl().style.color="#ff5555";}};document.getElementById("profile-realname").onkeypress=(e)=>{if(e.key==="Enter")document.getElementById("profile-save").click();};setTimeout(()=>document.getElementById("profile-realname").focus(),50);};

// ════════════════════════════════════════════════════════════════
// SWITCH UI
// ════════════════════════════════════════════════════════════════
window.switchUI = (ui) => {
    setUI(ui); loadTheme(ui);
    const app = document.getElementById("app");
    if (app) app.innerHTML = "";
    if      (ui==='adiirc') { renderGlobalMenu(); renderAdiirc(); }
    else if (ui==='kiwi')   { renderGlobalMenu(); renderKiwi();   }
    else if (ui==='mobile') { renderMobile(); }
};

// ════════════════════════════════════════════════════════════════
// STYLES GLOBAUX
// ════════════════════════════════════════════════════════════════
const style = document.createElement('style');
style.textContent = `
body,html{margin:0;padding:0;height:100vh;width:100vw;overflow:hidden;background:#000;}
.global-menubar{display:flex;background:#222;color:#ccc;font-family:'Segoe UI',sans-serif;font-size:12px;border-bottom:1px solid #333;height:25px;box-sizing:border-box;align-items:center;padding-left:10px;position:relative;z-index:9999;}
#app{height:calc(100vh - 25px);width:100vw;position:relative;}
.menu-item{position:relative;padding:0 10px;cursor:default;height:100%;display:flex;align-items:center;}
.menu-item:hover{background:#444;color:#fff;}
.menu-dropdown{display:none;position:absolute;top:25px;left:0;background:#222;border:1px solid #444;min-width:180px;box-shadow:0 4px 8px rgba(0,0,0,.5);}
.menu-item:hover .menu-dropdown{display:block;}
.menu-option{padding:8px 12px;cursor:pointer;}
.menu-option:hover{background:#0078d7;color:#fff;}
.menu-separator{height:1px;background:#333;margin:3px 0;}
.social-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center;}
.social-popup{background:#1e1e1e;border:1px solid #444;border-radius:6px;padding:20px 24px;width:340px;max-height:480px;display:flex;flex-direction:column;gap:12px;color:#ccc;font-family:'Segoe UI',sans-serif;font-size:13px;}
.social-title{font-size:15px;font-weight:700;color:#fff;border-bottom:1px solid #333;padding-bottom:8px;}
.social-blockall-row{background:#2a2a2a;border:1px solid #3a3a3a;border-radius:4px;padding:8px 12px;}
.social-blockall-label{display:flex;align-items:center;gap:8px;cursor:pointer;color:#eee;font-weight:700;font-size:13px;}
.social-blockall-label input[type=checkbox]{width:15px;height:15px;cursor:pointer;accent-color:#e05555;}
.social-hint{color:#888;font-weight:normal;font-size:11px;}
.social-add-row{display:flex;gap:8px;}
.social-input{flex:1;background:#0a0a0a;border:1px solid #555;color:#fff;padding:6px 10px;font-size:13px;border-radius:3px;outline:none;min-width:0;}
.social-input:focus{border-color:#0078d7;}
.social-btn-add{background:#0078d7;color:#fff;border:none;border-radius:3px;padding:6px 14px;cursor:pointer;font-size:12px;flex-shrink:0;}
.social-btn-add:hover{background:#005fa3;}
.social-list{list-style:none;padding:0;margin:0;overflow-y:auto;flex:1;border:1px solid #2a2a2a;border-radius:4px;background:#111;min-height:60px;}
.social-list-item{display:flex;justify-content:space-between;align-items:center;padding:6px 12px;border-bottom:1px solid #1e1e1e;}
.social-list-item:last-child{border-bottom:none;}
.social-list-item:hover{background:#1a1a1a;}
.social-nick{font-size:13px;color:#ddd;}
.social-btn-remove{background:none;border:none;color:#ff5555;cursor:pointer;font-size:13px;padding:0 4px;}
.social-btn-remove:hover{color:#ff0000;}
.social-empty{padding:12px;color:#555;font-style:italic;text-align:center;}
.social-footer{display:flex;justify-content:flex-end;align-items:center;gap:8px;}
.social-btn-close{background:#333;color:#ccc;border:none;border-radius:3px;padding:5px 14px;cursor:pointer;font-size:12px;}
.social-btn-close:hover{background:#444;}
.connmsg-info{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:4px;padding:8px 10px;font-size:11px;color:#888;line-height:1.6;}
.connmsg-info code{background:#2a2a2a;color:#4ac7a1;padding:1px 4px;border-radius:3px;font-family:monospace;font-size:11px;}
.connmsg-item{gap:8px!important;}
.connmsg-num{min-width:20px;height:20px;background:#2a2a2a;color:#666;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0;}
.connmsg-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace;font-size:12px;color:#ddd;}
.connmsg-actions{display:flex;align-items:center;gap:3px;flex-shrink:0;}
.connmsg-move-btn{background:#2a2a2a;border:1px solid #3a3a3a;color:#888;width:22px;height:22px;border-radius:3px;cursor:pointer;font-size:10px;padding:0;display:flex;align-items:center;justify-content:center;}
.connmsg-move-btn:hover:not(:disabled){background:#3a3a3a;color:#fff;}
.connmsg-move-btn:disabled{opacity:0.3;cursor:default;}
.connmsg-hint{font-size:11px;color:#555;font-style:italic;}
.av-section-title{font-size:11px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:.5px;}
.av-my-row{display:flex;gap:10px;align-items:flex-start;}
.av-preview{width:52px;height:52px;border-radius:50%;object-fit:cover;border:2px solid #444;flex-shrink:0;}
.av-my-inputs{display:flex;flex-direction:column;gap:6px;flex:1;min-width:0;}
.av-add-row{display:flex;gap:6px;}
.av-list-thumb{width:28px;height:28px;border-radius:50%;object-fit:cover;border:1px solid #333;flex-shrink:0;}
#profile-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center;}
#profile-popup{background:#1e1e1e;border:1px solid #444;border-radius:6px;padding:20px 24px;min-width:320px;display:flex;flex-direction:column;gap:10px;color:#ccc;font-family:'Segoe UI',sans-serif;font-size:13px;}
#profile-title{font-size:15px;font-weight:700;color:#fff;border-bottom:1px solid #333;padding-bottom:8px;}
#profile-popup label{color:#aaa;font-size:12px;}
#profile-realname{background:#0a0a0a;border:1px solid #555;color:#fff;padding:6px 10px;font-size:13px;border-radius:3px;outline:none;width:100%;box-sizing:border-box;}
#profile-realname:focus{border-color:#0078d7;}
.profile-hint{margin:0;color:#666;font-size:11px;font-style:italic;}
#profile-status{font-size:12px;min-height:16px;}
#profile-buttons{display:flex;gap:8px;justify-content:flex-end;margin-top:6px;}
#profile-buttons button{padding:5px 14px;border:none;border-radius:3px;cursor:pointer;font-size:12px;}
#profile-cancel{background:#333;color:#ccc;} #profile-cancel:hover{background:#444;}
#profile-save{background:#0078d7;color:#fff;} #profile-save:hover{background:#005fa3;}
body.no-menubar #app { height: 100vh !important; }
`;
document.head.appendChild(style);
initApp();