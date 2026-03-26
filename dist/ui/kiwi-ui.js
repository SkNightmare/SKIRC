// ── kiwi-ui.js ──────────────────────────────────────────────────
import { state, subscribe } from "../state.js";
import { irc, getAvatarUrlForNick } from "../irc-core.js";

// ════════════════════════════════════════════════════════════════
// COULEURS IRC
// ════════════════════════════════════════════════════════════════
const IRC_COLORS=[
    {code:'00',hex:'#ffffff',dark:true},{code:'01',hex:'#000000',dark:false},
    {code:'02',hex:'#00007f',dark:false},{code:'03',hex:'#009300',dark:false},
    {code:'04',hex:'#ff0000',dark:false},{code:'05',hex:'#7f0000',dark:false},
    {code:'06',hex:'#9c009c',dark:false},{code:'07',hex:'#fc7f00',dark:true},
    {code:'08',hex:'#ffff00',dark:true},{code:'09',hex:'#00fc00',dark:true},
    {code:'10',hex:'#009393',dark:false},{code:'11',hex:'#00ffff',dark:true},
    {code:'12',hex:'#0000fc',dark:false},{code:'13',hex:'#ff00ff',dark:true},
    {code:'14',hex:'#7f7f7f',dark:false},{code:'15',hex:'#d2d2d2',dark:true},
];
const IRC_COLOR_CHAR='\x03', IRC_BOLD_CHAR='\x02', IRC_RESET_CHAR='\x0F';

// ════════════════════════════════════════════════════════════════
// RENDU INCREMENTAL
// ════════════════════════════════════════════════════════════════
let _rendered={server:null,target:null,type:null,count:0,lastLine:null};
function _resetRender(){_rendered={server:null,target:null,type:null,count:0,lastLine:null};}
function _getActiveLines(){
    const s=state.currentServer,t=state.currentContextTarget,type=state.currentContextType;
    if(!s)return[];
    if(type==='channel')return state.messages[s]?.[t]||[];
    if(type==='pm')return state.privates[s]?.[t]||[];
    return state.serverLogs[s]||[];
}

// ════════════════════════════════════════════════════════════════
// HISTORIQUE
// ════════════════════════════════════════════════════════════════
const msgHistory=[];let historyIdx=-1,historyDraft="";
function historyPush(t){if(!t)return;if(msgHistory[msgHistory.length-1]!==t)msgHistory.push(t);historyIdx=-1;}
function historyUp(cur){if(!msgHistory.length)return null;if(historyIdx===-1){historyDraft=cur;historyIdx=msgHistory.length-1;}else if(historyIdx>0)historyIdx--;return msgHistory[historyIdx];}
function historyDown(){if(historyIdx===-1)return null;if(historyIdx<msgHistory.length-1){historyIdx++;return msgHistory[historyIdx];}historyIdx=-1;return historyDraft;}

// ════════════════════════════════════════════════════════════════
// TAB COMPLETION
// ════════════════════════════════════════════════════════════════
let tabState=null;
function getVisibleNicks(){const s=state.currentServer,t=state.currentContextTarget,type=state.currentContextType;if(!s||!t||type!=='channel')return[];return(state.nicks[s]?.[t]||[]).map(n=>n.replace(/^[~&@%+]/,''));}
function handleTab(input){
    const val=input.value||"",cursor=input.selectionStart||val.length,before=val.slice(0,cursor);
    if(tabState){tabState.idx=(tabState.idx+1)%tabState.matches.length;_applyTab(input);return;}
    const wordStart=before.lastIndexOf(' ')+1,word=before.slice(wordStart);if(!word)return;
    const isFirst=wordStart===0,matches=getVisibleNicks().filter(n=>n.toLowerCase().startsWith(word.toLowerCase()));
    if(!matches.length)return;
    tabState={prefix:before.slice(0,wordStart),word,matches,idx:0,suffix:val.slice(cursor),isFirst};_applyTab(input);
}
function _applyTab(input){
    const{prefix,matches,idx,suffix,isFirst}=tabState,nick=matches[idx],completion=isFirst?`${nick}: `:`${nick} `;
    input.value=prefix+completion+suffix.trimStart();const pos=(prefix+completion).length;
    try{input.setSelectionRange(pos,pos);}catch(e){}
    _renderTabBar(matches,idx);
}
function _renderTabBar(matches,currentIdx){
    const bar=document.querySelector('.kiwi-tab-bar');if(!bar)return;
    bar.innerHTML=matches.map((nick,i)=>{
        const color=genderColor(nick),av=smallAvHtml(nick,false,18);
        return`<div class="kiwi-tab-chip ${i===currentIdx?'active':''}" style="${i===currentIdx?'':'color:'+color+';'}" onclick="window._kiwiTabSelect(${i})">${av} ${nick}</div>`;
    }).join("");
    bar.style.display='flex';
}
function _closeTabBar(){const bar=document.querySelector('.kiwi-tab-bar');if(bar)bar.style.display='none';tabState=null;}
window._kiwiTabSelect=(idx)=>{const input=document.querySelector('.kiwi-input');if(!input||!tabState)return;tabState.idx=idx;_applyTab(input);_closeTabBar();input.focus();};

// ════════════════════════════════════════════════════════════════
// UTILITAIRES VISUELS
// ════════════════════════════════════════════════════════════════
function genderColor(nick){const p=state.userProfiles?.[nick.toLowerCase()];if(!p)return'#888';if(p.gender==='m')return'#5b9bd5';if(p.gender==='f')return'#e0609a';return'#888';}

// Avatar — utilise la logique centralisée de irc-core.js
function avatarUrl(nick, isSelf) {
    return getAvatarUrlForNick(state.currentServer, nick, isSelf);
}

function smallAvHtml(nick,isSelf,size=18){
    const url=avatarUrl(nick,isSelf),color=genderColor(nick),init=nick.substring(0,1).toUpperCase();
    if(url)return`<img src="${url}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;vertical-align:middle;" onerror="this.style.display='none'" alt="">`;
    return`<span style="display:inline-flex;width:${size}px;height:${size}px;border-radius:50%;background:${color};align-items:center;justify-content:center;font-size:${Math.round(size*0.6)}px;font-weight:700;color:#fff;vertical-align:middle;">${init}</span>`;
}
function avHtml(nick,isSelf,size=34,cls='kiwi-av'){
    const url=avatarUrl(nick,isSelf),color=genderColor(nick),init=nick.substring(0,1).toUpperCase();
    if(url)return`<div class="${cls}" style="width:${size}px;height:${size}px;background:${color};border-radius:50%;overflow:hidden;flex-shrink:0;"><img src="${url}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.innerHTML='<span style=\\'font-size:${Math.round(size*0.4)}px\\'>${init}</span>';"></div>`;
    return`<div class="${cls}" style="width:${size}px;height:${size}px;background:${color};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:${Math.round(size*0.4)}px;font-weight:700;color:#fff;flex-shrink:0;">${init}</div>`;
}

// ── Rendu couleurs IRC ───────────────────────────────────────────
function renderIrcColors(html){
    let result='',i=0,fg=null,bg=null,bold=false,openSpan=false;
    const closeSpan=()=>{if(openSpan){result+='</span>';openSpan=false;}};
    const openColorSpan=()=>{closeSpan();let style='';if(fg!==null)style+=`color:${IRC_COLORS[parseInt(fg,10)]?.hex??'inherit'};`;if(bg!==null)style+=`background:${IRC_COLORS[parseInt(bg,10)]?.hex??'transparent'};`;if(bold)style+='font-weight:700;';if(style){result+=`<span style="${style}">`;openSpan=true;}};
    while(i<html.length){const ch=html[i];
        if(ch===IRC_COLOR_CHAR){i++;let fgCode='';if(i<html.length&&/\d/.test(html[i])){fgCode+=html[i++];if(i<html.length&&/\d/.test(html[i]))fgCode+=html[i++];}let bgCode='';if(fgCode&&i<html.length&&html[i]===','){i++;if(i<html.length&&/\d/.test(html[i])){bgCode+=html[i++];if(i<html.length&&/\d/.test(html[i]))bgCode+=html[i++];}}if(!fgCode&&!bgCode){fg=null;bg=null;}else{if(fgCode)fg=fgCode;if(bgCode)bg=bgCode;}openColorSpan();continue;}
        if(ch===IRC_BOLD_CHAR){bold=!bold;openColorSpan();i++;continue;}
        if(ch===IRC_RESET_CHAR){fg=null;bg=null;bold=false;closeSpan();i++;continue;}
        if(ch==='\x1F'){i++;continue;}
        result+=ch;i++;
    }
    closeSpan();return result;
}

function buildMsgLine(raw,myNick){
    const timeM=raw.match(/^\[(\d{2}:\d{2})\]/),time=timeM?timeM[1]:"",nick=(raw.match(/&lt;([^&]+)&gt;/)||[])[1]||"";
    const textRaw=raw.replace(/^\[\d{2}:\d{2}\]\s*/,"").replace(/&lt;[^&]+&gt;\s*/,"");
    const isSystem=!nick,isSelf=nick==="Moi";
    const isMention=myNick&&!isSelf&&textRaw.toLowerCase().includes(myNick.toLowerCase());
    const textColored=renderIrcColors(textRaw);
    if(isSystem)return`<div class="kiwi-line kiwi-system">${textColored}</div>`;
    const color=isSelf?'var(--kiwi-accent)':genderColor(nick);
    const mention=isMention?' kiwi-mention':'',self=isSelf?' kiwi-self':'';
    return`<div class="kiwi-line${mention}${self}">
        ${avHtml(nick,isSelf,28,'kiwi-av')}
        <div class="kiwi-msg-body">
            <span class="kiwi-nick" style="color:${color};" onclick="window._kiwiNickClick('${nick.replace(/'/g,"\\'")}')">${nick}</span>
            <span class="kiwi-time">${time}</span>
            <div class="kiwi-text">${textColored}</div>
        </div>
    </div>`;
}

// ════════════════════════════════════════════════════════════════
// POPUP PROFIL
// ════════════════════════════════════════════════════════════════
window._kiwiNickClick=(nick)=>{
    let popup=document.getElementById('kiwi-nick-popup');
    if(popup){popup.remove();return;}
    popup=document.createElement('div');popup.id='kiwi-nick-popup';popup.className='kiwi-popup';
    const srv=state.currentServer,profile=state.userProfiles?.[nick.toLowerCase()];
    const color=genderColor(nick);
    const gLabel=profile?.gender==='m'?'Homme':profile?.gender==='f'?'Femme':null;
    const info=[profile?.age?`${profile.age} ans`:null,gLabel,profile?.city||null].filter(Boolean).join(' · ');
    popup.innerHTML=`
        <div class="kiwi-popup-header">
            ${avHtml(nick,false,42,'kiwi-popup-av')}
            <div>
                <div class="kiwi-popup-nick" style="color:${color};">${nick}</div>
                ${info?`<div class="kiwi-popup-info">${info}</div>`:''}
            </div>
        </div>
        <div class="kiwi-popup-actions">
            <button onclick="window._kiwiOpenPM('${nick.replace(/'/g,"\\'")}')">Message prive</button>
        </div>`;
    popup.onclick=e=>e.stopPropagation();
    document.querySelector('.kiwi-root')?.appendChild(popup);
    setTimeout(()=>document.addEventListener('click',()=>popup.remove(),{once:true}),10);
};
window._kiwiOpenPM=(nick)=>{
    const srv=state.currentServer;
    if(srv){if(!state.privates[srv])state.privates[srv]={};if(!state.privates[srv][nick])state.privates[srv][nick]=[];window.setCtx(srv,nick,'pm');}
    document.getElementById('kiwi-nick-popup')?.remove();
};

// ════════════════════════════════════════════════════════════════
// NICKLIST
// ════════════════════════════════════════════════════════════════
function buildNicklistHtml(nicks){
    if(!nicks?.length)return'<div class="kiwi-nl-empty">Aucun utilisateur</div>';
    const ops=[],hops=[],vops=[],users=[];
    nicks.forEach(raw=>{const pm={'~':'op','&':'op','@':'op','%':'hop','+':'vop'},f=raw[0];const cssClass=pm[f]||'none',prefix=pm[f]?f:'',name=pm[f]?raw.substring(1):raw;if(cssClass==='op')ops.push({prefix,cssClass,name});else if(cssClass==='hop')hops.push({prefix,cssClass,name});else if(cssClass==='vop')vops.push({prefix,cssClass,name});else users.push({prefix,cssClass,name});});
    const renderGroup=(label,list)=>{if(!list.length)return'';return`<div class="kiwi-nl-group">${label} (${list.length})</div>`+list.map(p=>`<div class="kiwi-nl-item" onclick="window._kiwiNickClick('${p.name.replace(/'/g,"\\'")}')"><span class="kiwi-nl-prefix ${p.cssClass}">${p.prefix}</span>${smallAvHtml(p.name,false,22)}<span class="kiwi-nl-name" style="color:${genderColor(p.name)};">${p.name}</span></div>`).join('');};
    return renderGroup('Operateurs',ops)+renderGroup('Demi-ops',hops)+renderGroup('Voiced',vops)+renderGroup('Utilisateurs',users);
}

// ════════════════════════════════════════════════════════════════
// RENDER PRINCIPAL
// ════════════════════════════════════════════════════════════════
export function renderKiwi(){
    const app=document.getElementById('app');if(!app)return;
    _resetRender();
    app.innerHTML=`
    <div class="kiwi-root">
        <div class="kiwi-sidebar">
            <div class="kiwi-server-list" id="kiwi-server-list"></div>
            <div class="kiwi-conn-bar" id="kiwi-conn-bar" style="display:none;">
                <div class="kiwi-conn-row"><label>Serveur</label><input id="kiwi-host" value="${state.defaultHost||'irc.chaat.fr'}" autocomplete="off"></div>
                <div class="kiwi-conn-row"><label>Port</label><input id="kiwi-port" type="number" value="${state.defaultPort||'6697'}" style="width:70px;">
                <label style="margin-left:8px;"><input type="checkbox" id="kiwi-ssl" ${(state.defaultSsl!==false)?'checked':''}> SSL</label></div>
                <div class="kiwi-conn-row"><label>Pseudo</label><input id="kiwi-nick" value="${state.defaultNick||'SKIRC_User'}" autocomplete="off"></div>
                <button id="kiwi-connect-btn">Connexion</button>
            </div>
        </div>
        <div class="kiwi-main">
            <div class="kiwi-header">
                <div class="kiwi-header-name" id="kiwi-header-name">SKIRC</div>
                <div class="kiwi-header-topic" id="kiwi-header-topic"></div>
                <div class="kiwi-header-actions">
                    <button class="kiwi-icon-btn" id="kiwi-conn-toggle" title="Connexion">+/-</button>
                    <button class="kiwi-icon-btn" id="kiwi-nl-toggle" title="Utilisateurs">[#]</button>
                </div>
            </div>
            <div class="kiwi-away-bar" id="kiwi-away-bar" style="display:none;">
                <span id="kiwi-away-text"></span>
                <button id="kiwi-back-btn">/back</button>
            </div>
            <div class="kiwi-messages" id="kiwi-messages"></div>
            <div class="kiwi-tab-bar" style="display:none;"></div>
            <div class="kiwi-color-picker" id="kiwi-color-picker" style="display:none;"></div>
            <div class="kiwi-input-bar">
                ${avHtml(state.connectedServers[state.currentServer]?.nick||'?',true,26,'kiwi-input-av')}
                <textarea class="kiwi-input" id="kiwi-input" placeholder="Ecrire un message..." rows="1" autocomplete="off"></textarea>
                <button class="kiwi-icon-btn" id="kiwi-color-btn">[C]</button>
                <button class="kiwi-send-btn" id="kiwi-send-btn">Envoyer</button>
            </div>
        </div>
        <div class="kiwi-nicklist" id="kiwi-nicklist"></div>
    </div>`;

    // Color picker
    const picker=document.getElementById('kiwi-color-picker');
    picker.innerHTML=`<div class="kiwi-color-grid">${IRC_COLORS.map(({code,hex,dark})=>`<div class="kiwi-color-swatch" style="background:${hex};color:${dark?'#333':'#fff'};" onclick="window._kiwiPickColor('${code}')">${code}</div>`).join('')}</div>
    <div class="kiwi-color-utils"><button onclick="window._kiwiColorUtil('bold')"><b>Gras</b></button><button onclick="window._kiwiColorUtil('reset')">Reset</button><button onclick="window._kiwiColorUtil('end')">Fin</button></div>`;
    window._kiwiPickColor=(code)=>{_insertAtCursor(document.getElementById('kiwi-input'),`${IRC_COLOR_CHAR}${code}`);picker.style.display='none';};
    window._kiwiColorUtil=(type)=>{const i=document.getElementById('kiwi-input');if(type==='bold')_insertAtCursor(i,IRC_BOLD_CHAR);else if(type==='reset')_insertAtCursor(i,IRC_RESET_CHAR);else _insertAtCursor(i,IRC_COLOR_CHAR);picker.style.display='none';};

    const input=document.getElementById('kiwi-input');
    input.addEventListener('input',()=>{input.style.height='auto';input.style.height=Math.min(input.scrollHeight,120)+'px';});
    const sendMsg=()=>{const v=input.value.trim();if(!v)return;historyPush(v);_closeTabBar();historyIdx=-1;irc.handleInput(v);input.value='';input.style.height='auto';};
    input.addEventListener('keydown',(e)=>{
        if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMsg();return;}
        if(e.key==='Tab'){e.preventDefault();handleTab(input);return;}
        if(e.key==='ArrowUp'){e.preventDefault();const v=historyUp(input.value);if(v!==null)input.value=v;_closeTabBar();return;}
        if(e.key==='ArrowDown'){e.preventDefault();const v=historyDown();if(v!==null)input.value=v;_closeTabBar();return;}
        if(e.ctrlKey&&e.key==='k'){e.preventDefault();picker.style.display=picker.style.display==='none'?'block':'none';return;}
        if(!e.ctrlKey&&!e.altKey&&!e.metaKey&&e.key.length===1){_closeTabBar();historyIdx=-1;}
    });
    document.getElementById('kiwi-send-btn').onclick=sendMsg;
    document.getElementById('kiwi-color-btn').onclick=()=>{picker.style.display=picker.style.display==='none'?'block':'none';};
    document.getElementById('kiwi-back-btn').onclick=()=>irc.handleInput('/back');
    document.getElementById('kiwi-conn-toggle').onclick=()=>{const bar=document.getElementById('kiwi-conn-bar');bar.style.display=bar.style.display==='none'?'block':'none';};
    document.getElementById('kiwi-nl-toggle').onclick=()=>{const nl=document.getElementById('kiwi-nicklist');nl.style.display=nl.style.display==='none'?'block':'none';};
    document.getElementById('kiwi-connect-btn').onclick=()=>{
        const host=document.getElementById('kiwi-host').value.trim(),port=document.getElementById('kiwi-port').value.trim(),ssl=document.getElementById('kiwi-ssl').checked,nick=document.getElementById('kiwi-nick').value.trim();
        if(host&&port&&nick){irc.connect(host,port,ssl,nick);document.getElementById('kiwi-conn-bar').style.display='none';}
    };

    updateKiwi();
}

function _insertAtCursor(input,text){const s=input.selectionStart??input.value.length,e=input.selectionEnd??s;input.value=input.value.slice(0,s)+text+input.value.slice(e);const pos=s+text.length;try{input.setSelectionRange(pos,pos);}catch(e){}input.focus();}

subscribe(updateKiwi);

function updateKiwi(){
    if(state.currentUI!=='kiwi')return;
    const s=state.currentServer,t=state.currentContextTarget,type=state.currentContextType;
    const myNick=s?(state.connectedServers[s]?.nick||'—'):'—';

    // Away bar
    const awayBar=document.getElementById('kiwi-away-bar');
    if(awayBar){awayBar.style.display=state.away?'flex':'none';const at=document.getElementById('kiwi-away-text');if(at)at.textContent=state.awayTextbox?`Away : "${state.awayTextbox}"`:'Away';}

    // Header
    const hn=document.getElementById('kiwi-header-name'),ht=document.getElementById('kiwi-header-topic');
    if(hn){if(type==='channel')hn.textContent=t||'—';else if(type==='pm')hn.innerHTML=`<span style="color:${genderColor(t||'')}">${t||'—'}</span>`;else hn.textContent=s||'SKIRC';}
    if(ht){const nicks=(type==='channel'&&s&&t)?(state.nicks[s]?.[t]||[]):[];ht.textContent=type==='channel'?`${nicks.length} utilisateurs`:type==='pm'?(()=>{const p=t?state.userProfiles?.[t.toLowerCase()]:null;return p?[p.age?`${p.age} ans`:null,p.gender?(p.gender==='m'?'Homme':'Femme'):null,p.city||null].filter(Boolean).join(' · '):''})():'';}

    // Sidebar
    const sl=document.getElementById('kiwi-server-list');
    if(sl){
        let html='';
        Object.keys(state.connectedServers).forEach(srv=>{
            const dot=`<span class="kiwi-dot"></span>`;
            const srvActive=s===srv&&type==='server';
            html+=`<div class="kiwi-chan-item ${srvActive?'active':''}" onclick="window.setCtx('${srv}','${srv}','server');">${dot}<span class="kiwi-chan-name">[srv] ${srv.split(':')[0]}</span></div>`;
            if(state.messages[srv])Object.keys(state.messages[srv]).forEach(chan=>{
                const isActive=s===srv&&t===chan&&type==='channel',unread=state.unread[srv]?.[chan]||0;
                const ub=unread>0?`<span class="kiwi-unread-badge">${unread>99?'99+':unread}</span>`:'';
                html+=`<div class="kiwi-chan-item ${isActive?'active':''} ${unread>0?'has-unread':''}" onclick="window.setCtx('${srv}','${chan}','channel');">
                    <span style="color:${isActive?'var(--kiwi-accent)':'var(--kiwi-text-muted)'}">#</span>
                    <span class="kiwi-chan-name">${chan}</span>${ub}
                    <span class="kiwi-close-tab" onclick="window.closeTab('${srv}','${chan}','channel',event)">x</span>
                </div>`;
            });
            if(state.privates[srv])Object.keys(state.privates[srv]).forEach(nick=>{
                const isActive=s===srv&&t===nick&&type==='pm',unread=state.unread[srv]?.[nick]||0;
                const ub=unread>0?`<span class="kiwi-unread-badge">${unread>99?'99+':unread}</span>`:'';
                html+=`<div class="kiwi-chan-item ${isActive?'active':''} ${unread>0?'has-unread':''}" onclick="window.setCtx('${srv}','${nick}','pm');">
                    ${smallAvHtml(nick,false,18)}<span class="kiwi-chan-name" style="color:${genderColor(nick)};">${nick}</span>${ub}
                    <span class="kiwi-close-tab" onclick="window.closeTab('${srv}','${nick}','pm',event)">x</span>
                </div>`;
            });
        });
        sl.innerHTML=html;
    }

    // Mon avatar dans l'input bar
    const inputAv=document.querySelector('.kiwi-input-av');
    if(inputAv){const url=avatarUrl(myNick,true);const color='var(--kiwi-accent)',init=myNick.substring(0,1).toUpperCase();inputAv.style.background=color;inputAv.innerHTML=url?`<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.style.display='none'">`:`${init}`;}

    // Nicklist
    const nicks=(type==='channel'&&s&&t)?(state.nicks[s]?.[t]||[]):[];
    const nl=document.getElementById('kiwi-nicklist');if(nl)nl.innerHTML=buildNicklistHtml(nicks);

    // Messages — RENDU INCREMENTAL
    const messages=document.getElementById('kiwi-messages');if(!messages)return;
    const lines=_getActiveLines(),lastLine=lines[lines.length-1]??null;
    const ctxSame=_rendered.server===s&&_rendered.target===t&&_rendered.type===type;
    const wasAtBottom=messages.scrollHeight-messages.scrollTop-messages.clientHeight<60;
    const rebuild=()=>{messages.innerHTML=lines.map(l=>buildMsgLine(l,myNick)).join('');_rendered={server:s,target:t,type,count:lines.length,lastLine};};
    if(!ctxSame){rebuild();messages.scrollTop=messages.scrollHeight;}
    else if(lines.length>_rendered.count){messages.insertAdjacentHTML('beforeend',lines.slice(_rendered.count).map(l=>buildMsgLine(l,myNick)).join(''));_rendered.count=lines.length;_rendered.lastLine=lastLine;if(wasAtBottom)messages.scrollTop=messages.scrollHeight;}
    else if(lastLine!==_rendered.lastLine){rebuild();if(wasAtBottom)messages.scrollTop=messages.scrollHeight;}
}