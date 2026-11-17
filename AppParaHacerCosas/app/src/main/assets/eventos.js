// eventos.js - eventos de la app, enviados por Discord como archivo .js.
//
// Cómo se usa:
//   1) Escribe un archivo cuyo nombre empiece por "evento" (eventos.js, eventos-navidad.js...).
//      Mira eventos-ejemplo.js para el formato.
//   2) Envíalo como adjunto a un canal que el bot pueda leer.
//      Solo lo acepta OWNER_ID (y los ids de EVENTS_ADMIN_IDS, separados por coma).
//      Opcional: EVENTS_CHANNEL_ID = solo se escucha ese canal.
//   3) El bot responde con "✅ N eventos cargados" y la app los muestra en la pantalla Eventos.
//   Para vaciarlos: escribe  eventos borrar  (solo los mismos usuarios).
//   Si no hay eventos cargados, la app muestra su texto de siempre ("Aún no hay eventos disponibles...").
//
// Seguridad: el archivo NO se hace require(). Se ejecuta en un vm aislado (sin require, process ni
// fs), sin eval/Function, con límite de 1 s, y solo se conserva el resultado como datos (JSON)
// con campos permitidos. Aun así, solo envíalo tú: node:vm no es una frontera de seguridad perfecta.
const vm = require('vm');

const KEY = 'events_json';
const MAX_BYTES = 200 * 1024;
const MAX_EVENTS = 50;
const NAME_RE = /^eventos?.*\.js$/i;

const clip = (v, n) => String(v ?? '').replace(/\r/g, '').trim().slice(0, n);
const first = (o, keys) => { for (const k of keys) if (o[k] != null && o[k] !== '') return o[k]; return ''; };
function cleanUrl(u) {
  try { const p = new URL(String(u || '').trim()); return /^https?:$/.test(p.protocol) ? p.href : ''; } catch { return ''; }
}

/** Ejecuta el .js aislado y devuelve la lista normalizada de eventos. Lanza Error con un mensaje claro. */
function parseEventsJs(src) {
  let code = String(src || '').replace(/^\uFEFF/, '');
  code = code.replace(/\bexport\s+default\b/, 'module.exports =');   // también vale "export default [...]"
  const ctx = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  let raw;
  try {
    vm.runInContext('var module = { exports: {} }; var exports = module.exports;', ctx, { timeout: 1000 });
    vm.runInContext(code, ctx, { timeout: 1000, filename: 'eventos.js' });
    // se pasa a texto DENTRO del vm: así ningún objeto del archivo llega al bot
    raw = vm.runInContext('JSON.stringify(module.exports)', ctx, { timeout: 1000 });
  } catch (e) {
    throw new Error('No pude leer el archivo: ' + String(e && e.message || e).slice(0, 160));
  }
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error('El archivo no exporta nada. Usa  module.exports = [ {...}, {...} ]'); }
  const list = Array.isArray(data) ? data : (data && Array.isArray(data.eventos || data.events) ? (data.eventos || data.events) : null);
  if (!list) throw new Error('Debe exportar una lista:  module.exports = [ { titulo: "...", fecha: "2026-12-01T18:00" } ]');

  const items = [];
  for (const e of list.slice(0, MAX_EVENTS)) {
    if (!e || typeof e !== 'object') continue;
    const title = clip(first(e, ['titulo', 'título', 'title', 'nombre', 'name']), 120);
    if (!title) continue;
    items.push({
      id: clip(first(e, ['id']), 40) || String(items.length + 1),
      title,
      description: clip(first(e, ['descripcion', 'descripción', 'description', 'detalle', 'texto']), 1000),
      date: clip(first(e, ['fecha', 'date', 'inicio', 'start']), 40),
      end: clip(first(e, ['fin', 'end', 'hasta']), 40),
      place: clip(first(e, ['lugar', 'place', 'ubicacion', 'ubicación']), 120),
      image: cleanUrl(first(e, ['imagen', 'image', 'banner'])),
      url: cleanUrl(first(e, ['enlace', 'url', 'link'])),
    });
  }
  if (!items.length) throw new Error('No encontré ningún evento con título dentro del archivo.');
  return items;
}

/** Eventos guardados: { items, updated_at } (vacío si nunca se envió nada). */
function getEvents() {
  try {
    const raw = require('./db').getSetting(KEY);
    if (!raw) return { items: [], updated_at: null };
    const d = JSON.parse(raw);
    return { items: Array.isArray(d.items) ? d.items : [], updated_at: d.updated_at || null };
  } catch { return { items: [], updated_at: null }; }
}
function saveEvents(items, by, file) {
  require('./db').setSetting(KEY, JSON.stringify({ items, updated_at: Date.now(), by: String(by || ''), file: String(file || '') }));
}
function clearEvents() { require('./db').clearSetting(KEY); }

const admins = () => new Set([process.env.OWNER_ID, ...String(process.env.EVENTS_ADMIN_IDS || '').split(',')].map((s) => String(s || '').trim()).filter(Boolean));

function register(client) {
  const { Events } = require('discord.js');
  client.on(Events.MessageCreate, async (msg) => {
    try {
      if (msg.author.bot || !msg.guild) return;
      if (process.env.EVENTS_CHANNEL_ID && msg.channelId !== process.env.EVENTS_CHANNEL_ID) return;
      const att = msg.attachments.find((a) => NAME_RE.test(a.name || ''));
      const wantsClear = /^\s*eventos\s+borrar\s*$/i.test(msg.content || '');
      if (!att && !wantsClear) return;
      if (!admins().has(msg.author.id)) return;               // el resto de usuarios se ignora en silencio

      if (wantsClear) {
        clearEvents();
        await msg.reply({ content: '🗑️ Eventos borrados. La app mostrará "no hay eventos disponibles".', allowedMentions: { repliedUser: false } });
        return;
      }
      if (att.size > MAX_BYTES) { await msg.reply({ content: '❌ El archivo pesa demasiado (máx. 200 KB).', allowedMentions: { repliedUser: false } }); return; }
      const r = await fetch(att.url, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`no pude descargar el archivo (HTTP ${r.status})`);
      const items = parseEventsJs(await r.text());
      saveEvents(items, msg.author.id, att.name);
      await msg.reply({ content: `✅ ${items.length} evento${items.length === 1 ? '' : 's'} cargado${items.length === 1 ? '' : 's'}. Ya se ven en la app.`, allowedMentions: { repliedUser: false } });
      console.log(`[eventos] ${items.length} eventos cargados desde ${att.name} por ${msg.author.id}`);
    } catch (e) {
      console.error('[eventos]', e);
      msg.reply({ content: '❌ ' + String(e && e.message || e).slice(0, 300), allowedMentions: { repliedUser: false } }).catch(() => {});
    }
  });
}

module.exports = { register, getEvents, parseEventsJs, saveEvents, clearEvents };
