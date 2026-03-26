#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{AppHandle, Manager, State, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::time::{self, Duration, interval};
use tokio_rustls::TlsConnector;
use rustls::ClientConfig;
use rustls::pki_types::ServerName;
use rustls::crypto::ring as crypto_ring;
use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use serde::{Serialize, Deserialize};

// ════════════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════════════
struct AppState {
    connections: Arc<Mutex<HashMap<String, mpsc::Sender<String>>>>,
}

#[derive(Clone, Serialize)]
struct IrcEvent { server_id: String, message: String }

#[derive(Clone, Serialize)]
struct IrcDisconnectEvent { server_id: String, reason: String }

// ════════════════════════════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════════════════════════════
#[derive(Serialize, Deserialize, Clone)]
struct AppConfig {
    realname: String,
    #[serde(default)] blocked:             Vec<String>,
    #[serde(default)] block_all:           bool,
    #[serde(default)] friends:             Vec<String>,
    #[serde(default)] avatars:             HashMap<String, String>,
    #[serde(default)] my_avatar:           String,
    #[serde(default)] connect_messages:    Vec<String>,

    // Presets de connexion
    #[serde(default = "default_host")]     default_host:        String,
    #[serde(default = "default_port")]     default_port:        String,
    #[serde(default = "default_ssl")]      default_ssl:         bool,
    #[serde(default = "default_nick")]     default_nick:        String,

    // Mention reply
    // Priorité : message:"..." inline > cette valeur
    #[serde(default)]                      mention_reply:       String,

    // Active/désactive le mention reply (true/false)
    #[serde(default = "default_true")]     auto_reply_enabled:  bool,

    // Away status content
    // Priorité : textbox:"..." inline > cette valeur
    // Valeurs désactivantes : "false","off","disable",...
    #[serde(default)]                      away_status_content: String,

    // Auto-reconnexion — "false","off",... = désactivé
    #[serde(default = "default_auto_rec")] auto_reconnect:      String,

    // URLs d'avatars par domaine serveur
    // Clé : domaine (ex. "chaat.fr"), Valeur : préfixe URL (ex. "https://…?nick=")
    // Tous les sous-domaines correspondent automatiquement.
    #[serde(default = "default_server_avatar_urls")] server_avatar_urls: HashMap<String, String>,
}

fn default_host()     -> String { "irc.chaat.fr".to_string() }
fn default_port()     -> String { "6697".to_string() }
fn default_ssl()      -> bool   { true }
fn default_nick()     -> String { "JCIRC_User".to_string() }
fn default_true()     -> bool   { true }
fn default_auto_rec() -> String { "true".to_string() }
fn default_server_avatar_urls() -> HashMap<String, String> {
    let mut m = HashMap::new();
    m.insert("chaat.fr".to_string(), "https://www.chaat.fr/avatarkiwi.php?nick=".to_string());
    m
}

impl Default for AppConfig {
    fn default() -> Self {
        AppConfig {
            realname:            "JCIRC User".to_string(),
            blocked:             vec![],
            block_all:           false,
            friends:             vec![],
            avatars:             HashMap::new(),
            my_avatar:           String::new(),
            connect_messages:    vec![],
            default_host:        default_host(),
            default_port:        default_port(),
            default_ssl:         default_ssl(),
            default_nick:        default_nick(),
            mention_reply:       String::new(),
            auto_reply_enabled:  true,
            away_status_content: String::new(),
            auto_reconnect:      default_auto_rec(),
            server_avatar_urls:  default_server_avatar_urls(),
        }
    }
}

// ════════════════════════════════════════════════════════════════
// CHEMINS DE STOCKAGE
// ════════════════════════════════════════════════════════════════
fn jcirc_base_dir(app: &AppHandle) -> PathBuf {
    match app.path().app_data_dir() {
        Ok(p)  => p,
        Err(_) => PathBuf::from("."),
    }
}

fn config_path(app: &AppHandle)   -> PathBuf { jcirc_base_dir(app).join("config.json") }
fn server_log_dir(app: &AppHandle, id: &str) -> PathBuf {
    jcirc_base_dir(app).join("logs").join(sanitize_name(id))
}

fn try_mirror_config(_internal: &PathBuf, _content: &str) {
    #[cfg(target_os = "android")]
    {
        let s = internal.to_string_lossy().into_owned();
        let ext = if s.contains("/data/user/0/") {
            s.replacen("/data/user/0/", "/sdcard/Android/data/", 1)
        } else if s.contains("/data/data/") {
            s.replacen("/data/data/", "/sdcard/Android/data/", 1)
        } else { return; };
        let ext_path = PathBuf::from(&ext);
        if let Some(parent) = ext_path.parent() {
            if fs::create_dir_all(parent).is_ok() {
                let _ = fs::write(&ext_path, content);
            }
        }
    }
}

// ════════════════════════════════════════════════════════════════
// COMMANDES CONFIG
// ════════════════════════════════════════════════════════════════
#[tauri::command]
fn load_config(app_handle: AppHandle) -> AppConfig {
    let path = config_path(&app_handle);
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(cfg) = serde_json::from_str::<AppConfig>(&content) {
                return cfg;
            }
        }
    }
    AppConfig::default()
}

#[tauri::command]
fn save_config(app_handle: AppHandle, config: AppConfig) -> Result<(), String> {
    let path = config_path(&app_handle);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&path, &content).map_err(|e| e.to_string())?;
    try_mirror_config(&path, &content);
    Ok(())
}

// ════════════════════════════════════════════════════════════════
// LOGS FICHIERS
// ════════════════════════════════════════════════════════════════
fn sanitize_name(name: &str) -> String {
    name.chars().map(|c| match c {
        '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_', c => c,
    }).collect()
}

fn utc_time_str() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    format!("{:02}:{:02}:{:02}", (secs%86400)/3600, (secs%3600)/60, secs%60)
}

fn write_log(app: &AppHandle, server_id: &str, target: &str, line: &str) {
    let dir = server_log_dir(app, server_id);
    if fs::create_dir_all(&dir).is_err() { return; }
    let filename = format!("{}.log", sanitize_name(target));
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(dir.join(filename)) {
        let _ = writeln!(f, "[{}] {}", utc_time_str(), line);
    }
}

fn clean_nick(raw: &str) -> String {
    let s = if raw.starts_with(':') { &raw[1..] } else { raw };
    s.split('!').next().unwrap_or(s)
     .trim_start_matches(|c| matches!(c, '~'|'&'|'@'|'%'|'+')).to_string()
}

fn log_irc_line(app: &AppHandle, server_id: &str, raw: &str) {
    let msg = raw.trim();
    if msg.is_empty() { return; }
    let parts: Vec<&str> = msg.splitn(4, ' ').collect();
    if parts.len() < 2 { return; }
    if parts[0]=="PING" || parts[0]=="PONG" { return; }
    let cmd = parts.get(1).copied().unwrap_or("");

    match cmd {
        "PRIVMSG" => {
            if parts.len() < 4 { return; }
            let sender = clean_nick(parts[0]); let target = parts[2]; let text: &str = if let Some(p) = msg.find(" :") { &msg[p+2..] } else { parts.get(3).copied().unwrap_or("") };
            if target.starts_with('#') { write_log(app, server_id, target, &format!("<{}> {}", sender, text)); }
            else { write_log(app, server_id, &format!("&{}", sender), &format!("<{}> {}", sender, text)); }
        }
        "NOTICE" => {
            if parts.len() < 4 { return; }
            let sr = parts[0]; let snd = clean_nick(sr); let dst = parts[2]; let txt: &str = if let Some(p) = msg.find(" :") { &msg[p+2..] } else { parts.get(3).copied().unwrap_or("") };
            let is_srv = dst=="*" || dst.to_uppercase()=="AUTH" || !sr.contains('!');
            let ft = if is_srv { "_server".to_string() } else { format!("&{}", snd) };
            write_log(app, server_id, &ft, &format!("-{}- {}", snd, txt));
        }
        "JOIN" => { let nick=clean_nick(parts[0]); let chan=parts.get(2).unwrap_or(&"").trim_start_matches(':'); if !chan.is_empty() { write_log(app,server_id,chan,&format!("*** {} a rejoint {}",nick,chan)); } }
        "PART" => { let nick=clean_nick(parts[0]); let chan=parts.get(2).unwrap_or(&"").trim_start_matches(':'); let reason=if let Some(p)=msg.find(" :"){&msg[p+2..]}else{""}; if !chan.is_empty() { write_log(app,server_id,chan,&format!("*** {} a quitte {} ({})",nick,chan,reason)); } }
        "QUIT" => { let nick=clean_nick(parts[0]); let reason=if let Some(p)=msg.find(" :"){&msg[p+2..]}else{""}; write_log(app,server_id,"_server",&format!("*** {} a quitte le reseau ({})",nick,reason)); }
        "NICK" => { let old=clean_nick(parts[0]); let new=parts.get(2).unwrap_or(&"").trim_start_matches(':'); write_log(app,server_id,"_server",&format!("*** {} est maintenant {}",old,new)); }
        c if c.chars().all(|x| x.is_ascii_digit()) => { write_log(app, server_id, "_server", msg); }
        _ => { write_log(app, server_id, "_server", msg); }
    }
}

#[tauri::command]
fn load_logs(app_handle: AppHandle, server_id: String) -> HashMap<String, Vec<String>> {
    let dir = server_log_dir(&app_handle, &server_id);
    let mut result: HashMap<String, Vec<String>> = HashMap::new();
    let entries = match fs::read_dir(&dir) { Ok(e) => e, Err(_) => return result };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("log") { continue; }
        let stem = match path.file_stem().and_then(|s| s.to_str()) { Some(s) => s.to_string(), None => continue };
        let content = match fs::read_to_string(&path) { Ok(c) => c, Err(_) => continue };
        let lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();
        if !lines.is_empty() { result.insert(stem, lines); }
    }
    result
}

// ════════════════════════════════════════════════════════════════
// TLS
// ════════════════════════════════════════════════════════════════
fn build_tls_config() -> Arc<ClientConfig> {
    let mut root_store = rustls::RootCertStore::empty();
    root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    if let Ok(native) = std::panic::catch_unwind(|| rustls_native_certs::load_native_certs()) {
        for cert in native.certs { let _ = root_store.add(cert); }
    }
    Arc::new(ClientConfig::builder().with_root_certificates(root_store).with_no_client_auth())
}

// ════════════════════════════════════════════════════════════════
// TCP KEEPALIVE
// ════════════════════════════════════════════════════════════════
fn apply_keepalive(stream: &TcpStream) {
    use socket2::SockRef;
    let sock = SockRef::from(stream);
    if let Err(e) = sock.set_keepalive(true) { eprintln!("[keepalive] set_keepalive failed: {}", e); return; }
    let ka = socket2::TcpKeepalive::new()
        .with_time(Duration::from_secs(60))
        .with_interval(Duration::from_secs(30));
    if let Err(e) = sock.set_tcp_keepalive(&ka) { eprintln!("[keepalive] set_tcp_keepalive params failed: {}", e); }
}

// ════════════════════════════════════════════════════════════════
// IRC — CONNEXION + BOUCLE
// ════════════════════════════════════════════════════════════════
const PING_INTERVAL_SECS: u64 = 90;
const READ_TIMEOUT_SECS:  u64 = 270;

#[tauri::command]
async fn connect_irc(
    app_handle: AppHandle, state: State<'_, AppState>,
    host: String, port: u16, ssl: bool, nick: String, realname: String,
) -> Result<(), String> {
    let server_id = format!("{}:{}", host, port);
    let (tx, mut rx) = mpsc::channel::<String>(100);
    state.connections.lock().await.insert(server_id.clone(), tx);
    let _ = fs::create_dir_all(server_log_dir(&app_handle, &server_id));
    let sid = server_id.clone();
    tokio::spawn(async move {
        let stream = match TcpStream::connect((host.as_str(), port)).await {
            Ok(s) => s,
            Err(e) => {
                write_log(&app_handle, &sid, "_server", &format!("*** Erreur connexion : {}", e));
                let _ = app_handle.emit("irc-disconnect", IrcDisconnectEvent { server_id: sid.clone(), reason: format!("Connexion refusee : {}", e) });
                return;
            }
        };
        apply_keepalive(&stream);
        let reason = if ssl {
            let connector = TlsConnector::from(build_tls_config());
            let server_name = match ServerName::try_from(host.as_str()).map(|n| n.to_owned()) {
                Ok(n) => n,
                Err(e) => { let r=format!("Nom serveur invalide : {}",e); let _=app_handle.emit("irc-disconnect",IrcDisconnectEvent{server_id:sid.clone(),reason:r.clone()}); return; }
            };
            match connector.connect(server_name, stream).await {
                Ok(s) => { let (r,mut w)=tokio::io::split(s); irc_loop(r,&mut w,&mut rx,&app_handle,sid.clone(),nick,realname).await }
                Err(e) => format!("Erreur TLS : {}", e),
            }
        } else {
            let (r,mut w) = tokio::io::split(stream);
            irc_loop(r,&mut w,&mut rx,&app_handle,sid.clone(),nick,realname).await
        };
        write_log(&app_handle, &sid, "_server", &format!("*** Deconnecte : {}", reason));
        let _ = app_handle.emit("irc-disconnect", IrcDisconnectEvent { server_id: sid, reason });
    });
    Ok(())
}

async fn irc_loop<R,W>(
    reader: R, writer: &mut W, rx: &mut mpsc::Receiver<String>,
    app: &AppHandle, server_id: String, nick: String, realname: String,
) -> String
where R: tokio::io::AsyncRead+Unpin, W: tokio::io::AsyncWrite+Unpin
{
    let mut buf: BufReader<R> = BufReader::new(reader);
    let mut raw_line: Vec<u8> = Vec::with_capacity(512);
    if writer.write_all(format!("NICK {}\r\nUSER {} 0 * :{}\r\n", nick, nick, realname).as_bytes()).await.is_err() {
        return "Impossible d'envoyer NICK/USER".into();
    }
    let mut ticker = interval(Duration::from_secs(PING_INTERVAL_SECS));
    ticker.tick().await;
    loop {
        tokio::select! {
            res = time::timeout(Duration::from_secs(READ_TIMEOUT_SECS), buf.read_until(b'\n', &mut raw_line)) => match res {
                Err(_)     => return "Timeout — connexion morte".into(),
                Ok(Ok(0))  => return "Connexion fermee par le serveur".into(),
                Ok(Err(e)) => return format!("Erreur reseau : {}", e),
                Ok(Ok(_))  => {
                    // Conversion lossy : les bytes non-UTF-8 (Latin-1, ISO-8859-1...)
                    // sont remplaces par U+FFFD au lieu de crasher la connexion.
                    let line = String::from_utf8_lossy(&raw_line).into_owned();
                    let trimmed = line.trim_end_matches(|c| c == '\r' || c == '\n').to_string();
                    log_irc_line(app, &server_id, &trimmed);
                    let _ = app.emit("irc-message", IrcEvent { server_id: server_id.clone(), message: line });
                    raw_line.clear();
                }
            },
            _ = ticker.tick() => {
                let ts = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
                if writer.write_all(format!("PING :jcirc-ka-{}\r\n", ts).as_bytes()).await.is_err() {
                    return "Echec PING keepalive".into();
                }
            },
            msg = rx.recv() => match msg {
                None    => return "Deconnexion volontaire".into(),
                Some(m) => {
                    log_irc_line(app, &server_id, m.trim_end_matches("\r\n"));
                    if writer.write_all(m.as_bytes()).await.is_err() {
                        return "Erreur ecriture socket".into();
                    }
                }
            },
        }
    }
}

#[tauri::command]
async fn send_irc(state: State<'_, AppState>, server_id: String, message: String) -> Result<(), String> {
    if let Some(tx) = state.connections.lock().await.get(&server_id) { let _ = tx.send(message).await; }
    Ok(())
}

// ════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════
fn main() {
    std::panic::set_hook(Box::new(|info| {
        eprintln!("[JCIRC PANIC] {}", info);
    }));
    let _ = crypto_ring::default_provider().install_default();
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .manage(AppState { connections: Arc::new(Mutex::new(HashMap::new())) })
        .invoke_handler(tauri::generate_handler![
            connect_irc, send_irc, load_config, save_config, load_logs
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}