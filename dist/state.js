export const state = {
  currentUI: 'adiirc',
  connectedServers: {},
  messages: {},
  privates: {},
  serverLogs: {},
  nicks: {},
  currentServer: null,
  currentContextTarget: null,
  currentContextType: null,
  realname: "SKIRC User",
  blocked: [],
  blockAll: false,
  friends: [],

  // ── Away ──────────────────────────────────────────────────────
  away: false,
  awayTextbox: "",
  awayMessage: "",
  awayReplies: {},

  // ── Profils WHOIS ─────────────────────────────────────────────
  userProfiles: {},

  // ── Statut identified + glist par nick (WHOIS) ───────────────
  // { serverId: { nickLow: { identified: bool, glistNick: string|null } } }
  nickIdentified: {},

  // ── Non-lus ───────────────────────────────────────────────────
  unread: {},

  // ── Avatars manuels ───────────────────────────────────────────
  avatars: {},    // { nickLow: url }  — saisie manuelle via l'interface
  myAvatar: "",

  // ── Messages de connexion automatique ─────────────────────────
  connectMessages: [],

  // ── Presets de connexion (mobile / config.json) ───────────────
  defaultHost: "irc.chaat.fr",
  defaultPort: "6697",
  defaultSsl:  true,
  defaultNick: "SKIRC_User",

  // ── Auto-reply sur mention ────────────────────────────────────
  // autoReplyEnabled : bool — active/désactive le mention reply
  // mentionReply     : texte ou /commande envoyé en réponse à une mention
  //   → message:"..." inline prend la priorité sur cette valeur
  autoReplyEnabled: true,
  mentionReply: "",

  // ── Away status content ───────────────────────────────────────
  // Texte envoyé avec AWAY si non vide.
  // → textbox:"..." inline prend la priorité sur cette valeur
  // Valeurs désactivantes : "false","off","disable","no","n/a","none",""
  awayStatusContent: "",

  // ── Auto-reconnexion ─────────────────────────────────────────
  // "false","off",... = désactivé
  autoReconnect: "true",

  // ── URLs d'avatars par domaine serveur ────────────────────────
  // Associe un domaine (ou fragment de domaine) à un préfixe d'URL avatar.
  // Le nick (ou glist) est concaténé au préfixe pour former l'URL complète.
  // Exemple : { "chaat.fr": "https://www.chaat.fr/avatarkiwi.php?nick=" }
  // Tous les sous-domaines de chaat.fr (irc1.chaat.fr, irc2.chaat.fr…)
  // utiliseront ce préfixe.
  // Un nick non identifié reçoit l'image : upload/avatar-undefined.png
  serverAvatarUrls: {
    "chaat.fr": "https://www.chaat.fr/avatarkiwi.php?nick="
  },
};

let listeners = [];
export const subscribe = (fn) => listeners.push(fn);
export const update   = () => listeners.forEach(fn => fn());
export const setUI    = (uiName) => { state.currentUI = uiName; update(); };