import { state, subscribe } from "../state.js";
import { irc, getAvatarUrlForNick } from "../irc-core.js";

let _rendered={server:null,target:null,type:null,count:0,lastLine:null};
function _resetRender(){_rendered={server:null,target:null,type:null,count:0,lastLine:null};}
function _getActiveLines(){
    const s=state.currentServer,t=state.currentContextTarget,type=state.currentContextType;
    if(!s)return[];
    if(type==='channel')return state.messages[s]?.[t]||[];
    if(type==='pm')return state.privates[s]?.[t]||[];
    return state.serverLogs[s]||[];
}

// Avatar — utilise la logique centralisée de irc-core.js
function avatarUrl(nick,isSelf){return getAvatarUrlForNick(state.currentServer,nick,isSelf);}

function genderColor(nick){const p=state.userProfiles?.[nick.toLowerCase()];if(!p)return'#888';if(p.gender==='m')return'#5b9bd5';if(p.gender==='f')return'#e0609a';return'#888';}

function avSpan(nick,isSelf,size=22){
    const url=avatarUrl(nick,isSelf),color=genderColor(nick),init=nick.substring(0,1).toUpperCase();
    if(url)return`<img src="${url}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:4px;" onerror="this.style.display='none'" alt="">`;
    return`<span style="display:inline-flex;width:${size}px;height:${size}px;border-radius:50%;background:${color};align-items:center;justify-content:center;font-size:${Math.round(size*0.5)}px;font-weight:700;color:#fff;vertical-align:middle;margin-right:4px;">${init}</span>`;
}

export function renderAdiirc(){
    const app=document.getElementById('app');if(!app)return;
    _resetRender();
    app.innerHTML=`
    <div class="adiirc-root">
        <div class="adiirc-sidebar">
            <div id="adiirc-server-list" class="adiirc-server-list"></div>
        </div>
        <div class="adiirc-main">
            <div class="adiirc-topbar" id="adiirc-topbar" style="display:none;">
                <input id="ai-host" value="${state.defaultHost||'irc.chaat.fr'}" placeholder="serveur" autocomplete="off">
                <input id="ai-port" type="number" value="${state.defaultPort||'6697'}" placeholder="port" style="width:60px;">
                <label><input type="checkbox" id="ai-ssl" ${(state.defaultSsl!==false)?'checked':''}> SSL</label>
                <input id="ai-nick" value="${state.defaultNick||'SKIRC_User'}" placeholder="pseudo" autocomplete="off">
                <button id="ai-connect">Connexion</button>
            </div>
            <div class="adiirc-away-bar" id="adiirc-away-bar" style="display:none;"></div>
            <div class="adiirc-log" id="adiirc-log"></div>
            <div class="adiirc-input-row">
                <input class="adiirc-input" id="adiirc-input" placeholder="Message..." autocomplete="off">
                <button class="adiirc-send" id="adiirc-send">Envoyer</button>
            </div>
        </div>
        <div class="adiirc-nicklist" id="adiirc-nicklist"></div>
    </div>`;

    window.showConnectBar=()=>{const bar=document.getElementById('adiirc-topbar');bar.style.display=bar.style.display==='none'?'flex':'none';};
    document.getElementById('ai-connect').onclick=()=>{
        const host=document.getElementById('ai-host').value.trim(),port=document.getElementById('ai-port').value.trim(),ssl=document.getElementById('ai-ssl').checked,nick=document.getElementById('ai-nick').value.trim();
        if(host&&port&&nick){irc.connect(host,port,ssl,nick);document.getElementById('adiirc-topbar').style.display='none';}
    };

    const input=document.getElementById('adiirc-input');
    const sendMsg=()=>{const v=input.value.trim();if(!v)return;irc.handleInput(v);input.value='';};
    document.getElementById('adiirc-send').onclick=sendMsg;
    input.addEventListener('keydown',(e)=>{if(e.key==='Enter'){e.preventDefault();sendMsg();}});

    updateAdiirc();
}

subscribe(updateAdiirc);

function buildLine(raw,myNick){
    const mm=raw.match(/&lt;([^&]+)&gt;/);if(!mm)return`<div class="ai-line ai-system">${raw}</div>`;
    const nick=mm[1],isSelf=nick==='Moi',color=isSelf?'#4ac7a1':genderColor(nick);
    const isMention=myNick&&!isSelf&&raw.toLowerCase().includes(myNick.toLowerCase());
    return`<div class="ai-line${isMention?' ai-mention':''}${isSelf?' ai-self':''}">${avSpan(nick,isSelf,20)}<span class="ai-nick" style="color:${color};" onclick="window._aiNickClick('${nick.replace(/'/g,"\\'")}')">&lt;${nick}&gt;</span> ${raw.replace(/^\[\d{2}:\d{2}\]\s*/,'').replace(/&lt;[^&]+&gt;\s*/,'')}</div>`;
}

window._aiNickClick=(nick)=>{
    const srv=state.currentServer;
    if(srv){if(!state.privates[srv])state.privates[srv]={};if(!state.privates[srv][nick])state.privates[srv][nick]=[];window.setCtx(srv,nick,'pm');}
};

function updateAdiirc(){
    if(state.currentUI!=='adiirc')return;
    const s=state.currentServer,t=state.currentContextTarget,type=state.currentContextType;
    const myNick=s?(state.connectedServers[s]?.nick||'—'):'—';

    // Away bar
    const awayBar=document.getElementById('adiirc-away-bar');
    if(awayBar){awayBar.style.display=state.away?'block':'none';awayBar.textContent=state.away?`[Away] ${state.awayTextbox||''}`:'';}

    // Sidebar
    const sl=document.getElementById('adiirc-server-list');
    if(sl){
        let html='';
        Object.keys(state.connectedServers).forEach(srv=>{
            const srvActive=s===srv&&type==='server';
            html+=`<div class="ai-chan-item ${srvActive?'active':''}" onclick="window.setCtx('${srv}','${srv}','server');">[S] ${srv.split(':')[0]}</div>`;
            if(state.messages[srv])Object.keys(state.messages[srv]).forEach(chan=>{
                const isActive=s===srv&&t===chan&&type==='channel',unread=state.unread[srv]?.[chan]||0;
                html+=`<div class="ai-chan-item ${isActive?'active':''} ${unread>0?'has-unread':''}" onclick="window.setCtx('${srv}','${chan}','channel');">
                    # ${chan}${unread>0?` (${unread})`:''} <span class="ai-close" onclick="window.closeTab('${srv}','${chan}','channel',event)">x</span>
                </div>`;
            });
            if(state.privates[srv])Object.keys(state.privates[srv]).forEach(nick=>{
                const isActive=s===srv&&t===nick&&type==='pm',unread=state.unread[srv]?.[nick]||0;
                html+=`<div class="ai-chan-item ${isActive?'active':''} ${unread>0?'has-unread':''}" onclick="window.setCtx('${srv}','${nick}','pm');">
                    [PM] ${nick}${unread>0?` (${unread})`:''} <span class="ai-close" onclick="window.closeTab('${srv}','${nick}','pm',event)">x</span>
                </div>`;
            });
        });
        sl.innerHTML=html;
    }

    // Nicklist
    const nl=document.getElementById('adiirc-nicklist');
    if(nl){
        if(type==='channel'&&s&&t){
            nl.style.display='block';
            const nicks=state.nicks[s]?.[t]||[];
            nl.innerHTML=nicks.map(raw=>{const n=raw.replace(/^[~&@%+]/,''),prefix=raw.match(/^([~&@%+])/)?.[1]||'';return`<div class="ai-nick-item" onclick="window._aiNickClick('${n.replace(/'/g,"\\'")}')">${prefix?`<span style="color:#e67e22;">${prefix}</span>`:''} ${avSpan(n,false,18)} <span style="color:${genderColor(n)};">${n}</span></div>`;}).join('');
        } else { nl.style.display='none'; }
    }

    // Messages — RENDU INCREMENTAL
    const log=document.getElementById('adiirc-log');if(!log)return;
    const lines=_getActiveLines(),lastLine=lines[lines.length-1]??null;
    const ctxSame=_rendered.server===s&&_rendered.target===t&&_rendered.type===type;
    const wasAtBottom=log.scrollHeight-log.scrollTop-log.clientHeight<60;
    const rebuild=()=>{log.innerHTML=lines.map(l=>buildLine(l,myNick)).join('');_rendered={server:s,target:t,type,count:lines.length,lastLine};};
    if(!ctxSame){rebuild();log.scrollTop=log.scrollHeight;}
    else if(lines.length>_rendered.count){log.insertAdjacentHTML('beforeend',lines.slice(_rendered.count).map(l=>buildLine(l,myNick)).join(''));_rendered.count=lines.length;_rendered.lastLine=lastLine;if(wasAtBottom)log.scrollTop=log.scrollHeight;}
    else if(lastLine!==_rendered.lastLine){rebuild();if(wasAtBottom)log.scrollTop=log.scrollHeight;}
}