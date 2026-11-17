// bot.js - capa LÓGICA de la app (sin interfaz): habla con el bot de Render.
// La interfaz (pantallas del .fig) llama a window.Bot.xxx(...). Todo devuelve Promesas.
window.Bot = (function () {
  "use strict";
  const C = window.APP_CONFIG || {};
  const API = C.API || "", KEY = C.API_KEY || "";
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // Bot en tu PC / red local: no hay que esperar a que "despierte" (Render tarda ~30 s), así que se falla rápido
  const LOCAL = /^https?:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/i.test(API);
  const lostMsg = () => LOCAL ? "No encuentro el bot en tu PC (" + API + "). ¿Está encendido y en la misma red?" : "sin conexión";

  // ---- sesión de Discord (cuentas) ----
  let session = "";
  try { session = localStorage.getItem("bot_session") || ""; } catch (e) {}
  function setSession(t, user) {
    session = t || "";
    try {
      if (t) localStorage.setItem("bot_session", t); else { localStorage.removeItem("bot_session"); localStorage.removeItem("bot_user"); }
      if (user) localStorage.setItem("bot_user", JSON.stringify(user));
    } catch (e) {}
  }

  async function call(method, path, body, opts) {
    opts = opts || {};
    const tries = opts.tries || (method === "GET" ? 4 : 2); // Render puede tardar ~30 s en despertar
    let last;
    for (let i = 0; i < tries; i++) {
      try {
        const init = { method, headers: { "x-api-key": KEY } };
        if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) init.signal = AbortSignal.timeout(LOCAL ? 6000 : 45000);
        if (session) init.headers["x-session"] = session;
        if (opts.raw) { init.body = opts.raw; init.headers["content-type"] = opts.type; }
        else if (body !== undefined) { init.body = JSON.stringify(body); init.headers["content-type"] = "application/json"; }
        const r = await fetch(API + path, init);
        const data = await r.json().catch(() => ({}));
        if (r.ok) return data;
        const err = new Error(data.error || ("HTTP " + r.status)); err.status = r.status;
        if (r.status === 401 && /^Inicia sesi/.test(data.error || "")) { err.needLogin = true; try { window.dispatchEvent(new Event("needlogin")); } catch (e) {} }
        if (r.status >= 400 && r.status < 500) throw err;  // error del usuario: no se reintenta
        last = err;
      } catch (e) { if (e.status) throw e; last = e; }
      if (i < tries - 1) await sleep(LOCAL ? 700 : 3500);
    }
    throw (last && last.status) ? last : new Error(lostMsg());
  }
  const get = (p, o) => call("GET", p, undefined, o);
  const post = (p, b, o) => call("POST", p, b === undefined ? {} : b, o);
  const url = p => API + p + (p.includes("?") ? "&" : "?") + "k=" + encodeURIComponent(KEY); // para <img src>

  // ---- emojis del servidor (el bot los lee con EMOJI_GUILD_ID) ----
  let emojiList = null, emojiMap = null;
  async function emojis() {
    if (emojiList) return emojiList;
    emojiList = (await get("/api/emojis")).items;
    emojiMap = new Map(emojiList.map(e => [e.id, e]));
    return emojiList;
  }
  /** Convierte <:nombre:id> / <a:nombre:id> en <img> (el texto se escapa). Sirve para títulos y comentarios. */
  function renderText(text) {
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    return String(text || "").split(/(<a?:\w+:\d+>)/g).map(part => {
      const m = part.match(/^<(a?):(\w+):(\d+)>$/);
      if (!m) return esc(part);
      return '<img class="emoji" alt=":' + m[2] + ':" src="https://cdn.discordapp.com/emojis/' + m[3] + "." + (m[1] ? "gif" : "png") + '?size=64">';
    }).join("");
  }

  const auth = {
    get token() { return session; },
    get user() { try { return session ? JSON.parse(localStorage.getItem("bot_user") || "null") : null; } catch (e) { return null; } },
    /** Pide la URL de Discord. Ábrela en el navegador y llama a poll(state) cada 2 s. */
    start: () => post("/api/auth/start", {}, { tries: 2 }),
    /** { pending:true } mientras esperas; al terminar guarda la sesión y devuelve { token, user }. */
    poll: async state => { const r = await get("/api/auth/poll?state=" + encodeURIComponent(state), { tries: 1 }); if (r.token) setSession(r.token, r.user); return r; },
    /** Revisa que la sesión guardada siga viva. Devuelve el usuario o null. */
    check: async () => {
      if (!session) return null;
      try { const u = await get("/api/auth/me", { tries: 2 }); if (u && u.id) { setSession(session, u); return u; } setSession(""); return null; }
      catch (e) { return auth.user; } // sin conexión: se conserva la sesión
    },
    logout: async () => { try { await post("/api/auth/logout", {}, { tries: 1 }); } catch (e) {} setSession(""); },
  };

  return {
    auth,
    me: () => get("/api/me"),
    emojis,
    renderText,
    /** Última versión (el bot la saca del último release de GitHub; url = el .apk): { name, version, notes, url }. Requiere GET /api/app/version. */
    appVersion: () => get("/api/app/version", { tries: 2 }),
    /** Servidor en uso ("" = el mismo origen) y si es un bot local. */
    server: { url: API, local: LOCAL },
    /** Sube un embed: ejecuta lo mismo que /agregar del bot. publish=false => solo se guarda. */
    addEmbed: ({ title, url: link, publish = true, ia = false, tags = [] }) => post("/api/embeds", { title, url: link, publish, ia: !!ia, tags }, { tries: 1 }),
    /** Cambia el título de un embed propio. Requiere POST /api/embeds/:id/edit en el bot. Devuelve { title }. */
    editEmbed: (id, { title }) => post("/api/embeds/" + id + "/edit", { title }, { tries: 1 }),
    /** Borra un embed propio. Requiere POST /api/embeds/:id/delete en el bot. */
    deleteEmbed: id => post("/api/embeds/" + id + "/delete", {}, { tries: 1 }),
    /** Tags de un embed propio (varios). setTags reemplaza todos; addTags agrega; removeTag quita uno. Devuelven { tags }. */
    setTags: (id, tags) => post("/api/embeds/" + id + "/tags", { tags }),
    addTags: (id, add) => post("/api/embeds/" + id + "/tags", { add }),
    removeTag: (id, remove) => post("/api/embeds/" + id + "/tags", { remove }),
    embedSocial: id => get("/api/embeds/" + id + "/social"),
    /** Se copió el mensaje original: suma 1 al contador de copias. Devuelve { shares }. */
    share: id => post("/api/embeds/" + id + "/share"),
    /** Guarda / quita el embed de tus favoritos (privado). Devuelve { favorited }. */
    favorite: (id, on) => post("/api/embeds/" + id + "/favorite", typeof on === "boolean" ? { on } : {}),
    /** Tus favoritos: { ids:[...], items:[{ id, title, username, thumb, saved_at }] }. Para la pantalla que harás luego. */
    myFavorites: () => get("/api/me/favorites"),
    dislike: (id, on = true) => post("/api/embeds/" + id + "/dislike", { on }),
    myDislikes: () => get("/api/me/dislikes"),
    userProfile: id => get("/api/users/" + id + "/profile"),
    heart: (id, on) => post("/api/embeds/" + id + "/heart", typeof on === "boolean" ? { on } : {}),
    comments: (id, before) => get("/api/embeds/" + id + "/comments" + (before ? "?before=" + before : "")),
    /** parentId (opcional) = comentario al que respondes (el bot lo cuelga del comentario raíz). embedId (opcional) = embed adjunto al comentario; el comentario vuelve con { embed:{ id, title, username, thumb } }. */
    addComment: (id, { text, imageId, embedId, parentId }) => post("/api/embeds/" + id + "/comments", { text, image_id: imageId || null, embed_id: embedId || null, parent_id: parentId || null }, { tries: 1 }),
    deleteComment: id => post("/api/comments/" + id + "/delete"),
    /** Edita el texto de un comentario propio. Requiere POST /api/comments/:id/edit en el bot. */
    editComment: (id, { text }) => post("/api/comments/" + id + "/edit", { text }, { tries: 1 }),
    follow: (userId, on = true) => post("/api/users/" + userId + "/follow", { follow: on }),
    userSocial: userId => get("/api/users/" + userId + "/social"),
    /** Seguidores de un usuario (cualquier cuenta): { items:[{ id, username, nickname, avatar, joined_at, is_following }] }. Requiere GET /api/users/:id/followers en el bot. */
    followers: userId => get("/api/users/" + userId + "/followers"),
    /** Tus amigues = quienes te siguen y tú sigues (solo tu cuenta). Misma forma que followers. Requiere GET /api/me/friends en el bot. */
    friends: () => get("/api/me/friends"),
    /** Tu historial privado (likes, dislikes, favoritos, compartidos, seguidos, comentarios). Lo guarda el bot cifrado por usuario. Requiere GET /api/me/activity. */
    myActivity: () => get("/api/me/activity"),
    /** Amigues = seguimiento mutuo: A sigue a B y B sigue a A. */
    isFriend: async userId => { const r = await get("/api/me/friends"); return (r.items || []).some(u => String(u.id) === String(userId)); },
    /** file = File de <input type="file"> (máx. 8 MB). Devuelve { id, url }. */
    uploadImage: file => call("POST", "/api/images?name=" + encodeURIComponent(file.name || "imagen"), undefined, { raw: file, type: file.type, tries: 1 }),
    /** file = video de la galería (máx. 10 MB). Requiere POST /api/videos en el bot. Devuelve { id, url }. */
    uploadVideo: file => {
      if (file.size > 10 * 1024 * 1024) return Promise.reject(new Error("El video supera los 10 MB"));
      return call("POST", "/api/videos?name=" + encodeURIComponent(file.name || "video"), undefined, { raw: file, type: file.type || "video/mp4", tries: 1 });
    },
    imageSrc: p => url(p),
  };
})();
