import { state, subscribe } from "../state.js";
import { irc, getAvatarUrlForNick } from "../irc-core.js";

const IRC_COLORS=[
    {code:'00',hex:'#ffffff',dark:true},{code:'01',hex:'#000000',dark:false},{code:'02',hex:'#00007f',dark:false},{code:'03',hex:'#009300',dark:false},
    {code:'04',hex:'#ff0000',dark:false},{code:'05',hex:'#7f0000',dark:false},{code:'06',hex:'#9c009c',dark:false},{code:'07',hex:'#fc7f00',dark:true},
    {code:'08',hex:'#ffff00',dark:true},{code:'09',hex:'#00fc00',dark:true},{code:'10',hex:'#009393',dark:false},{code:'11',hex:'#00ffff',dark:true},
    {code:'12',hex:'#0000fc',dark:false},{code:'13',hex:'#ff00ff',dark:true},{code:'14',hex:'#7f7f7f',dark:false},{code:'15',hex:'#d2d2d2',dark:true},
];
const IRC_COLOR_CHAR='\x03',IRC_BOLD_CHAR='\x02',IRC_RESET_CHAR='\x0F';

let _rendered={server:null,target:null,type:null,count:0,lastLine:null};
function _resetRender(){_rendered={server:null,target:null,type:null,count:0,lastLine:null};}
function _getActiveLines(){
    const s=state.currentServer,t=state.currentContextTarget,type=state.currentContextType;
    if(!s)return[];if(type==='channel')return state.messages[s]?.[t]||[];if(type==='pm')return state.privates[s]?.[t]||[];return state.serverLogs[s]||[];
}

const msgHistory=[];let historyIdx=-1,historyDraft="";
function historyPush(t){if(!t)return;if(msgHistory[msgHistory.length-1]!==t)msgHistory.push(t);historyIdx=-1;}
function historyUp(cur){if(!msgHistory.length)return null;if(historyIdx===-1){historyDraft=cur;historyIdx=msgHistory.length-1;}else if(historyIdx>0)historyIdx--;return msgHistory[historyIdx];}
function historyDown(){if(historyIdx===-1)return null;if(historyIdx<msgHistory.length-1){historyIdx++;return msgHistory[historyIdx];}historyIdx=-1;return historyDraft;}

let tabState=null;
function getVisibleNicks(){const s=state.currentServer,t=state.currentContextTarget,type=state.currentContextType;if(!s||!t||type!=='channel')return[];return(state.nicks[s]?.[t]||[]).map(n=>n.replace(/^[~&@%+]/,''));}
function handleTab(input){const val=input.value||"",cursor=input.selectionStart||val.length,before=val.slice(0,cursor);if(tabState){tabState.idx=(tabState.idx+1)%tabState.matches.length;_applyTab(input);return;}const wordStart=before.lastIndexOf(' ')+1,word=before.slice(wordStart);if(!word)return;const isFirst=wordStart===0,matches=getVisibleNicks().filter(n=>n.toLowerCase().startsWith(word.toLowerCase()));if(!matches.length)return;tabState={prefix:before.slice(0,wordStart),word,matches,idx:0,suffix:val.slice(cursor),isFirst};_applyTab(input);}
function _applyTab(input){const{prefix,matches,idx,suffix,isFirst}=tabState,nick=matches[idx],completion=isFirst?`${nick}: `:`${nick} `;input.value=prefix+completion+suffix.trimStart();const pos=(prefix+completion).length;try{input.setSelectionRange(pos,pos);}catch(e){}  _renderTabBar(matches,idx);}
function _renderTabBar(matches,currentIdx){const bar=document.getElementById("m-tab-bar");if(!bar)return;bar.innerHTML=matches.map((nick,i)=>{const color=genderColor(nick),av=smallAvHtml(nick,false,18);return`<div class="m-tab-chip ${i===currentIdx?'active':''}" style="${i===currentIdx?'':'color:'+color+';'}" onclick="window._mTabSelect(${i})">${av} ${nick}</div>`;}).join("");bar.classList.add("visible");}
function _closeTabBar(){const bar=document.getElementById("m-tab-bar");if(bar)bar.classList.remove("visible");tabState=null;}
window._mTabSelect=(idx)=>{const input=document.getElementById("m-input");if(!input||!tabState)return;tabState.idx=idx;_applyTab(input);_closeTabBar();input.focus();};

// Avatar — utilise la logique centralisée de irc-core.js
function avatarUrl(nick,isSelf){return getAvatarUrlForNick(state.currentServer,nick,isSelf);}
function genderColor(nick){const p=state.userProfiles?.[nick.toLowerCase()];if(!p)return'#888';if(p.gender==='m')return'#5b9bd5';if(p.gender==='f')return'#e0609a';return'#888';}

function smallAvHtml(nick,isSelf,size=18){
    const url=avatarUrl(nick,isSelf),color=genderColor(nick),init=nick.substring(0,1).toUpperCase();
    if(url)return`<img src="${url}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;vertical-align:middle;" onerror="this.style.display='none'" alt="">`;
    return`<span style="display:inline-flex;width:${size}px;height:${size}px;border-radius:50%;background:${color};align-items:center;justify-content:center;font-size:${Math.round(size*0.6)}px;font-weight:700;color:#fff;vertical-align:middle;">${init}</span>`;
}
function avDiv(nick,isSelf,size=34,cls="m-msg-av"){
    const url=avatarUrl(nick,isSelf),color=genderColor(nick),init=nick.substring(0,1).toUpperCase();
    const style=`width:${size}px;height:${size}px;background:${color};`;
    if(url)return`<div class="${cls}" style="${style}"><img src="${url}" alt="${nick}" onerror="this.parentElement.innerHTML='<span style=\\'font-size:${Math.round(size*0.4)}px\\'>${init}</span>';"></div>`;
    return`<div class="${cls}" style="${style}">${init}</div>`;
}

function renderIrcColors(html){
    let result='',i=0,fg=null,bg=null,bold=false,openSpan=false;
    const closeSpan=()=>{if(openSpan){result+='</span>';openSpan=false;}};
    const openColorSpan=()=>{closeSpan();let style='';if(fg!==null)style+=`color:${IRC_COLORS[parseInt(fg,10)]?.hex??'inherit'};`;if(bg!==null)style+=`background:${IRC_COLORS[parseInt(bg,10)]?.hex??'transparent'};`;if(bold)style+='font-weight:700;';if(style){result+=`<span style="${style}">`;openSpan=true;}};
    while(i<html.length){const ch=html[i];if(ch===IRC_COLOR_CHAR){i++;let fgCode='';if(i<html.length&&/\d/.test(html[i])){fgCode+=html[i++];if(i<html.length&&/\d/.test(html[i]))fgCode+=html[i++];}let bgCode='';if(fgCode&&i<html.length&&html[i]===','){i++;if(i<html.length&&/\d/.test(html[i])){bgCode+=html[i++];if(i<html.length&&/\d/.test(html[i]))bgCode+=html[i++];}}if(!fgCode&&!bgCode){fg=null;bg=null;}else{if(fgCode)fg=fgCode;if(bgCode)bg=bgCode;}openColorSpan();continue;}if(ch===IRC_BOLD_CHAR){bold=!bold;openColorSpan();i++;continue;}if(ch===IRC_RESET_CHAR){fg=null;bg=null;bold=false;closeSpan();i++;continue;}if(ch==='\x1F'){i++;continue;}result+=ch;i++;}
    closeSpan();return result;
}

function extractTime(l){const m=l.match(/^\[(\d{2}:\d{2})\]/);return m?m[1]:"";}
function extractNick(l){const m=l.match(/&lt;([^&]+)&gt;/);return m?m[1]:"";}
function extractText(l){return l.replace(/^\[\d{2}:\d{2}\]\s*/,"").replace(/&lt;[^&]+&gt;\s*/,"");}

function buildMsgEl(raw,myNick){
    const time=extractTime(raw),nick=extractNick(raw),textRaw=extractText(raw);
    const isSystem=!nick,isSelf=nick==="Moi";
    const isMention=myNick&&!isSelf&&textRaw.toLowerCase().includes(myNick.toLowerCase());
    const textColored=renderIrcColors(textRaw);
    const div=document.createElement("div");
    if(isSystem){div.className="m-msg is-system";div.innerHTML=`<div class="m-msg-body"><span class="m-msg-text">${textColored}</span></div>`;return div;}
    div.className=["m-msg",isSelf?'is-self':'',isMention?'is-mention':''].filter(Boolean).join(' ');
    const color=isSelf?'#42b883':genderColor(nick);
    div.innerHTML=`${avDiv(nick,isSelf,34,"m-msg-av")}
        <div class="m-msg-body">
            <div class="m-msg-top">
                <span class="m-msg-nick ${isSelf?'is-self':''}" style="color:${color};" onclick="window.mOpenNickPopup('${nick.replace(/'/g,"\\'")}')">${nick}</span>
                <span class="m-msg-time">${time}</span>
            </div>
            <div class="m-msg-text">${textColored}</div>
        </div>`;
    return div;
}

window.mOpenNickPopup=(nick)=>{
    let popup=document.getElementById("m-nick-popup");if(!popup)return;
    const profile=state.userProfiles?.[nick.toLowerCase()],color=genderColor(nick),av=avDiv(nick,false,52,"m-popup-av");
    const genderLabel=profile?.gender==='m'?'Homme':profile?.gender==='f'?'Femme':null;
    const infoStr=[profile?.age?`${profile.age} ans`:null,genderLabel,profile?.city?`${profile.city}`:null].filter(Boolean).join(' · ');
    popup.querySelector(".m-popup-av-row").innerHTML=`${av}<div><div class="m-popup-nick" style="color:${color};">${nick}</div>${infoStr?`<div class="m-popup-info">${infoStr}</div>`:''}</div>`;
    popup.querySelector(".m-popup-actions").innerHTML=`<button class="m-popup-action" onclick="window.mNickPM('${nick.replace(/'/g,"\\'")}')"><span class="m-popup-action-icon">[PM]</span> Message prive</button>`;
    popup.classList.add("open");document.getElementById("m-overlay")?.classList.add("visible");
};
window.mNickPM=(nick)=>{
    const srv=state.currentServer;if(srv){if(!state.privates[srv])state.privates[srv]={};if(!state.privates[srv][nick])state.privates[srv][nick]=[];window.setCtx(srv,nick,'pm');}
    closeNickPopup();closeSidebar();
};
function closeNickPopup(){document.getElementById("m-nick-popup")?.classList.remove("open");const o=document.getElementById("m-overlay");if(o&&!document.querySelector(".m-sidebar.open")&&!document.querySelector(".m-nicklist-panel.open"))o.classList.remove("visible");}
function buildNicklistHtml(nicks){if(!nicks?.length)return`<div class="m-nick-group">Aucun utilisateur</div>`;const ops=[],hops=[],vops=[],users=[];nicks.forEach(raw=>{const pm={'~':'op','&':'op','@':'op','%':'hop','+':'vop'},f=raw[0];const cssClass=pm[f]||'none',prefix=pm[f]?f:'',name=pm[f]?raw.substring(1):raw;if(cssClass==='op')ops.push({prefix,cssClass,name});else if(cssClass==='hop')hops.push({prefix,cssClass,name});else if(cssClass==='vop')vops.push({prefix,cssClass,name});else users.push({prefix,cssClass,name});});const renderGroup=(label,list)=>{if(!list.length)return"";return`<div class="m-nick-group">${label} — ${list.length}</div>`+list.map(p=>`<div class="m-nick-item" onclick="window.mOpenNickPopup('${p.name.replace(/'/g,"\\'")}')">${avDiv(p.name,false,30,"m-nick-av")}<span class="m-nick-name" style="color:${genderColor(p.name)};">${p.name}</span></div>`).join('');};return renderGroup("Operateurs",ops)+renderGroup("Demi-ops",hops)+renderGroup("Voiced",vops)+renderGroup("Utilisateurs",users);}
function openSidebar(){document.querySelector(".m-sidebar")?.classList.add("open");document.getElementById("m-overlay")?.classList.add("visible");}
function closeSidebar(){document.querySelector(".m-sidebar")?.classList.remove("open");const o=document.getElementById("m-overlay");if(o&&!document.querySelector(".m-nicklist-panel.open")&&!document.querySelector("#m-nick-popup.open"))o.classList.remove("visible");}
function openNicklist(){document.querySelector(".m-nicklist-panel")?.classList.add("open");document.getElementById("m-overlay")?.classList.add("visible");}
function closeNicklist(){document.querySelector(".m-nicklist-panel")?.classList.remove("open");const o=document.getElementById("m-overlay");if(o&&!document.querySelector(".m-sidebar.open")&&!document.querySelector("#m-nick-popup.open"))o.classList.remove("visible");}
function insertAtCursor(input,text){const s=input.selectionStart??input.value.length,e=input.selectionEnd??s;input.value=input.value.slice(0,s)+text+input.value.slice(e);const pos=s+text.length;try{input.setSelectionRange(pos,pos);}catch(e){}input.focus();}
function toggleColorPicker(){document.getElementById("m-color-picker")?.classList.toggle("visible");}

export function renderMobile(){
    const app=document.getElementById("app");if(!app)return;_resetRender();
    app.innerHTML=`
    <div class="m-overlay" id="m-overlay"></div>
    <div class="m-sidebar" id="m-sidebar">
        <div class="m-sidebar-header">
            <div class="m-net-dot offline" id="m-net-dot"></div>
            <div class="m-net-name" id="m-net-name">Non connecte</div>
            <button class="m-conn-btn" id="m-conn-toggle" title="Connexion">+</button>
        </div>
        <div class="m-conn-panel" id="m-conn-panel" style="display:none;">
            <div class="m-conn-row"><label class="m-conn-label">Serveur</label><input class="m-conn-input" id="m-conn-host" autocomplete="off" autocapitalize="none" spellcheck="false"></div>
            <div class="m-conn-row"><label class="m-conn-label">Port</label><input class="m-conn-input" id="m-conn-port" type="number" style="width:80px;flex:none;"><label class="m-conn-ssl"><input type="checkbox" id="m-conn-ssl"> SSL</label></div>
            <div class="m-conn-row"><label class="m-conn-label">Pseudo</label><input class="m-conn-input" id="m-conn-nick" autocomplete="off" autocapitalize="none" spellcheck="false"></div>
            <button class="m-conn-go" id="m-conn-go">Connexion</button>
        </div>
        <div class="m-chan-list" id="m-chan-list"></div>
        <div class="m-sidebar-footer">
            <input class="m-join-input" id="m-join-input" placeholder="#salon" autocomplete="off">
            <button class="m-join-btn" id="m-join-btn">Join</button>
        </div>
    </div>
    <div class="m-nicklist-panel" id="m-nicklist-panel">
        <div class="m-nicklist-header">Utilisateurs <span class="m-nicklist-count" id="m-nick-count">0</span></div>
        <div class="m-nicklist-scroll" id="m-nick-scroll"></div>
    </div>
    <div id="m-nick-popup"><div class="m-popup-handle"></div><div class="m-popup-av-row"></div><div class="m-popup-actions"></div></div>
    <div class="m-main" id="m-main">
        <div class="m-header">
            <button class="m-burger" id="m-burger"><span></span><span></span><span></span></button>
            <div class="m-header-center"><div class="m-header-name" id="m-header-name">JCIRC</div><div class="m-header-sub" id="m-header-sub"></div></div>
            <button class="m-header-btn" id="m-nicklist-btn" style="display:none;" title="Utilisateurs">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </button>
        </div>
        <div class="m-messages" id="m-log"></div>
        <div id="m-away-bar"><span>[Away]</span><span id="m-away-text"></span><button class="m-back-btn" id="m-back-btn">Retour</button></div>
        <div id="m-tab-bar"></div>
        <div id="m-color-picker"></div>
        <div class="m-input-wrap">
            <div class="m-input-av" id="m-input-av">?</div>
            <textarea id="m-input" placeholder="Ecrire un message..." rows="1" autocomplete="off" spellcheck="true"></textarea>
            <button class="m-color-btn" id="m-color-btn">[C]</button>
            <button class="m-send-btn" id="m-send-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
        </div>
    </div>`;

    // Color picker
    const picker=document.getElementById("m-color-picker");
    picker.innerHTML=`<div class="m-color-grid">${IRC_COLORS.map(({code,hex,dark})=>`<div class="m-color-swatch" style="background:${hex};color:${dark?'#333':'#fff'};" onclick="window._mPickColor('${code}')">${code}</div>`).join("")}</div><div class="m-color-utils"><button class="m-color-util-btn" onclick="window._mColorUtil('bold')"><b>Gras</b></button><button class="m-color-util-btn" onclick="window._mColorUtil('reset')">Reset</button><button class="m-color-util-btn" onclick="window._mColorUtil('end')">Fin</button></div>`;
    window._mPickColor=(code)=>{insertAtCursor(document.getElementById("m-input"),`${IRC_COLOR_CHAR}${code}`);picker.classList.remove("visible");};
    window._mColorUtil=(type)=>{const input=document.getElementById("m-input");if(type==='bold')insertAtCursor(input,IRC_BOLD_CHAR);else if(type==='reset')insertAtCursor(input,IRC_RESET_CHAR);else insertAtCursor(input,IRC_COLOR_CHAR);picker.classList.remove("visible");};

    const inputEl=document.getElementById("m-input");
    inputEl.addEventListener("input",()=>{inputEl.style.height="auto";inputEl.style.height=Math.min(inputEl.scrollHeight,120)+"px";});
    const sendMsg=()=>{const v=inputEl.value.trim();if(!v)return;historyPush(v);_closeTabBar();historyIdx=-1;irc.handleInput(v);inputEl.value="";inputEl.style.height="auto";};
    inputEl.addEventListener("keydown",(e)=>{
        if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMsg();return;}
        if(e.key==="Tab"){e.preventDefault();handleTab(inputEl);return;}
        if(e.key==="ArrowUp"){e.preventDefault();const v=historyUp(inputEl.value);if(v!==null)inputEl.value=v;_closeTabBar();return;}
        if(e.key==="ArrowDown"){e.preventDefault();const v=historyDown();if(v!==null)inputEl.value=v;_closeTabBar();return;}
        if(e.ctrlKey&&e.key==='k'){e.preventDefault();toggleColorPicker();return;}
        if(!e.ctrlKey&&!e.altKey&&!e.metaKey&&e.key.length===1){_closeTabBar();historyIdx=-1;}
    });
    document.getElementById("m-send-btn").onclick=sendMsg;
    document.getElementById("m-color-btn").onclick=()=>toggleColorPicker();
    document.getElementById("m-back-btn").onclick=()=>irc.handleInput('/back');
    document.getElementById("m-burger").onclick=openSidebar;
    document.getElementById("m-nicklist-btn").onclick=()=>openNicklist();
    document.getElementById("m-join-btn").onclick=()=>{const v=document.getElementById("m-join-input").value.trim();if(v){irc.handleInput(`/join ${v}`);document.getElementById("m-join-input").value="";closeSidebar();}};
    document.getElementById("m-join-input").onkeypress=(e)=>{if(e.key==="Enter")document.getElementById("m-join-btn").click();};
    document.getElementById("m-overlay").onclick=()=>{closeSidebar();closeNicklist();closeNickPopup();};

    // Pre-remplit depuis state/config
    const hostEl=document.getElementById("m-conn-host"),portEl=document.getElementById("m-conn-port"),sslEl=document.getElementById("m-conn-ssl"),nickEl=document.getElementById("m-conn-nick");
    if(hostEl)hostEl.value=state.defaultHost||"irc.chaat.fr";if(portEl)portEl.value=state.defaultPort||"6697";if(sslEl)sslEl.checked=state.defaultSsl!==false;if(nickEl)nickEl.value=state.defaultNick||"JCIRC_User";

    document.getElementById("m-conn-toggle").onclick=()=>{const panel=document.getElementById("m-conn-panel"),isVisible=panel.style.display!=='none';panel.style.display=isVisible?'none':'block';document.getElementById("m-conn-toggle").textContent=isVisible?'+':'x';};
    document.getElementById("m-conn-go").onclick=()=>{
        const host=document.getElementById("m-conn-host").value.trim(),port=document.getElementById("m-conn-port").value.trim(),ssl=document.getElementById("m-conn-ssl").checked,nick=document.getElementById("m-conn-nick").value.trim();
        if(!host||!port||!nick)return;document.getElementById("m-conn-panel").style.display='none';document.getElementById("m-conn-toggle").textContent='+';closeSidebar();irc.connect(host,port,ssl,nick);
    };

    updateMobileUI();
}

subscribe(updateMobileUI);

function updateMobileUI(){
    if(state.currentUI!=='mobile')return;
    const s=state.currentServer,t=state.currentContextTarget,type=state.currentContextType;
    const myNick=s?(state.connectedServers[s]?.nick||"—"):"—";

    // Away bar
    const awayBar=document.getElementById("m-away-bar");
    if(awayBar){awayBar.classList.toggle("visible",!!state.away);const at=document.getElementById("m-away-text");if(at)at.textContent=state.awayTextbox?`"${state.awayTextbox}"`:""; }

    // Mon avatar input
    const inputAv=document.getElementById("m-input-av");
    if(inputAv){const url=avatarUrl(myNick,true);const color='#42b883',init=myNick.substring(0,1).toUpperCase();inputAv.style.background=color;inputAv.innerHTML=url?`<img src="${url}" alt="" onerror="this.style.display='none'" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`:`${init}`;}

    // Network
    const dot=document.getElementById("m-net-dot"),netName=document.getElementById("m-net-name");
    if(dot)dot.className="m-net-dot"+(s?"":" offline");if(netName)netName.textContent=s||"Non connecte";

    // Sidebar
    const chanList=document.getElementById("m-chan-list");
    if(chanList){
        let html="";
        Object.keys(state.connectedServers).forEach(srv=>{
            const isSrvActive=(s===srv&&type==='server');
            html+=`<div class="m-chan-item ${isSrvActive?'active':''}" onclick="window.setCtx('${srv}','${srv}','server');window._closeMSidebar();"><span class="m-chan-icon">[=]</span><span class="m-chan-name">Logs serveur</span></div>`;
            if(state.messages[srv])Object.keys(state.messages[srv]).forEach(chan=>{
                const isActive=(s===srv&&t===chan&&type==='channel'),unread=state.unread[srv]?.[chan]||0;
                const ub=unread>0?`<span class="m-chan-badge">${unread>99?'99+':unread}</span>`:'';
                html+=`<div class="m-chan-item ${isActive?'active':''} ${unread>0?'has-unread':''}" onclick="window.setCtx('${srv}','${chan}','channel');window._closeMSidebar();"><span class="m-chan-icon">#</span><span class="m-chan-name">${chan}</span>${ub}</div>`;
            });
            if(state.privates[srv]&&Object.keys(state.privates[srv]).length){
                html+=`<div class="m-section-label">Messages prives</div>`;
                Object.keys(state.privates[srv]).forEach(nick=>{
                    const isActive=(s===srv&&t===nick&&type==='pm'),color=genderColor(nick),unread=state.unread[srv]?.[nick]||0;
                    const ub=unread>0?`<span class="m-chan-badge">${unread>99?'99+':unread}</span>`:'';
                    html+=`<div class="m-pm-item ${isActive?'active':''} ${unread>0?'has-unread':''}" onclick="window.setCtx('${srv}','${nick}','pm');window._closeMSidebar();">
                        <div class="m-pm-av" style="background:${color};">${smallAvHtml(nick,false,34)}</div>
                        <span class="m-pm-name">${nick}</span>${ub}
                    </div>`;
                });
            }
        });
        chanList.innerHTML=html;
    }

    // Header
    const headerName=document.getElementById("m-header-name"),headerSub=document.getElementById("m-header-sub");
    const nlBtn=document.getElementById("m-nicklist-btn");
    const nicks=(type==='channel'&&s&&t)?(state.nicks[s]?.[t]||[]):[];
    if(headerName){if(type==='channel')headerName.textContent=t||"—";else if(type==='pm')headerName.innerHTML=`<span style="color:${genderColor(t||'')}">${t||"—"}</span>`;else headerName.textContent=s||"JCIRC";}
    if(headerSub){if(type==='channel')headerSub.textContent=`${nicks.length} utilisateurs`;else if(type==='pm'){const p=t?state.userProfiles?.[t.toLowerCase()]:null;headerSub.textContent=p?[p.age?`${p.age} ans`:null,p.gender?(p.gender==='m'?'Homme':'Femme'):null,p.city||null].filter(Boolean).join(' · '):""; }else headerSub.textContent="";}
    if(nlBtn)nlBtn.style.display=(type==='channel')?'flex':'none';
    document.getElementById("m-main")?.classList.toggle("m-server-view",type==='server');

    // Nicklist
    const nickScroll=document.getElementById("m-nick-scroll"),nickCount=document.getElementById("m-nick-count");
    if(nickCount)nickCount.textContent=nicks.length;if(nickScroll)nickScroll.innerHTML=buildNicklistHtml(nicks);

    // Messages — RENDU INCREMENTAL
    const log=document.getElementById("m-log");if(!log)return;
    const lines=_getActiveLines(),lastLine=lines[lines.length-1]??null;
    const ctxSame=_rendered.server===s&&_rendered.target===t&&_rendered.type===type;
    const wasAtBottom=log.scrollHeight-log.scrollTop-log.clientHeight<60;
    const rebuild=()=>{const frag=document.createDocumentFragment();lines.forEach(m=>frag.appendChild(buildMsgEl(m,myNick)));log.innerHTML="";log.appendChild(frag);_rendered={server:s,target:t,type,count:lines.length,lastLine};};
    if(!ctxSame){rebuild();log.scrollTop=log.scrollHeight;}
    else if(lines.length>_rendered.count){const frag=document.createDocumentFragment();lines.slice(_rendered.count).forEach(m=>frag.appendChild(buildMsgEl(m,myNick)));log.appendChild(frag);_rendered.count=lines.length;_rendered.lastLine=lastLine;if(wasAtBottom)log.scrollTop=log.scrollHeight;}
    else if(lastLine!==_rendered.lastLine){rebuild();if(wasAtBottom)log.scrollTop=log.scrollHeight;}
}

window._closeMSidebar=()=>{setTimeout(closeSidebar,120);};