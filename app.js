(function () {
'use strict';

/* =====================================================
   AYUDAS GENERALES
   ===================================================== */
const cfg = window.APP_CONFIG || {};
const BUCKET = 'biblioteca';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(16).slice(2));

let sb = null;
const S = {
  user: null, folders: [], items: [], layouts: [],
  view: { type: 'all', id: null }, search: '', tag: null, sort: 'new', type: 'all', lastErr: '',
  panels: [], mode: 'grid', bg: null, urls: {}, z: 10
};

let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2800);
}

function openModal(html) {
  $('#modalBody').innerHTML = html;
  $('#modal').classList.remove('hidden');
  return $('#modalBody');
}
function closeModal() {
  $('#modal').classList.add('hidden');
  $('#modalBody').innerHTML = '';
}

function askText(title, value) {
  return new Promise(res => {
    const b = openModal(`<h3>${esc(title)}</h3><input id="askInp" type="text" maxlength="80" value="${esc(value || '')}">
      <div class="row end"><button class="btn ghost" data-act="cancel">Cancelar</button><button class="btn" data-act="ok">Aceptar</button></div>`);
    const inp = $('#askInp', b);
    inp.focus(); inp.select();
    const done = v => { closeModal(); res(v); };
    $('[data-act=cancel]', b).onclick = () => done(null);
    $('[data-act=ok]', b).onclick = () => done(inp.value.trim() || null);
    inp.onkeydown = e => { if (e.key === 'Enter') done(inp.value.trim() || null); };
  });
}

function confirmBox(msg, okLabel) {
  return new Promise(res => {
    const b = openModal(`<h3>${esc(msg)}</h3>
      <div class="row end"><button class="btn ghost" data-act="cancel">Cancelar</button><button class="btn danger" data-act="ok">${esc(okLabel || 'Eliminar')}</button></div>`);
    const done = v => { closeModal(); res(v); };
    $('[data-act=cancel]', b).onclick = () => done(false);
    $('[data-act=ok]', b).onclick = () => done(true);
  });
}

/* =====================================================
   LINKS: reconocer X y PH
   ===================================================== */
function parseLink(raw) {
  let u = String(raw || '').trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  let url;
  try { url = new URL(u); } catch (e) { return null; }
  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^(mobile|m)\./, '');
  if (/(^|\.)(x|twitter)\.com$/.test(host)) {
    const m = url.pathname.match(/status(?:es)?\/(\d+)/);
    if (m) return { kind: 'x', id: m[1], url: u };
    return { kind: 'link', url: u };
  }
  if (/(^|\.)pornhub\.(com|org|net)$/.test(host)) {
    let key = url.searchParams.get('viewkey');
    if (!key) {
      const m = url.pathname.match(/\/embed\/([A-Za-z0-9]+)/);
      if (m) key = m[1];
    }
    if (key && /^[A-Za-z0-9]+$/.test(key)) return { kind: 'ph', id: key, url: u };
    return { kind: 'link', url: u };
  }
  return { kind: 'link', url: u };
}

function domainOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
}
function kindLabel(it) {
  if (it.kind === 'x') return 'X';
  if (it.kind === 'ph') return 'PH';
  if (it.kind === 'file') return (it.mime || '').startsWith('video') ? 'VIDEO' : 'IMG';
  return 'LINK';
}
function defaultTitle(it) {
  if (it.kind === 'x') return 'Video de X';
  if (it.kind === 'ph') return 'Video PH';
  if (it.kind === 'file') return 'Sin título';
  return domainOf(it.url) || 'Link';
}

/* =====================================================
   ARCHIVOS PRIVADOS (direcciones firmadas)
   ===================================================== */
async function signedUrls(paths) {
  const now = Date.now();
  const need = [...new Set(paths)].filter(p => !S.urls[p] || S.urls[p].exp < now + 60000);
  if (need.length) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(need, 3600);
    if (error) { toast('No pude leer los archivos'); }
    else (data || []).forEach(d => { if (d.signedUrl) S.urls[d.path] = { url: d.signedUrl, exp: now + 3600 * 1000 }; });
  }
  return paths.map(p => (S.urls[p] && S.urls[p].url) || null);
}

/* =====================================================
   ACCESO, BLOQUEO
   ===================================================== */
function init() {
  document.title = 'Notas';
  bindUI();
  if (!window.supabase) {
    $('#loginMsg').textContent = 'No se pudo cargar la conexión. Revisá tu internet.';
    $('#loginForm').classList.add('disabled');
    return;
  }
  if (!cfg.SUPABASE_URL || /PEGA/.test(cfg.SUPABASE_URL) || !cfg.SUPABASE_ANON_KEY || /PEGA/.test(cfg.SUPABASE_ANON_KEY)) {
    $('#loginMsg').textContent = 'Falta completar config.js (mirá la guía LEEME).';
    $('#loginForm').classList.add('disabled');
    return;
  }
  let baseUrl = String(cfg.SUPABASE_URL).trim();
  try { baseUrl = new URL(baseUrl).origin; } catch (e) {}
  sb = window.supabase.createClient(baseUrl, String(cfg.SUPABASE_ANON_KEY).trim(), {
    auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
  sb.auth.getSession().then(({ data }) => {
    if (data && data.session) start(data.session.user);
  });
}

async function start(user) {
  S.user = user;
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  setTab('lib');
  await loadAll();
  render();
  bumpIdle();
}

async function lock() {
  stopRhythm();
  pfStop(true);
  $('#photosDrawer').classList.add('hidden');
  clearPanels();
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
  S.user = null; S.folders = []; S.items = []; S.layouts = []; S.urls = {}; S.bg = null;
  closeModal();
  $('#rhythm').classList.add('hidden');
  $('#grid').innerHTML = '';
  $('#side').innerHTML = '';
  $('#canvas').style.backgroundImage = '';
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  document.body.classList.remove('sideopen');
  try { await sb.auth.signOut(); } catch (e) {}
}

let idleT;
function bumpIdle() {
  clearTimeout(idleT);
  const m = cfg.IDLE_MINUTES == null ? 30 : cfg.IDLE_MINUTES;
  if (!m || !S.user) return;
  idleT = setTimeout(lock, m * 60000);
}

/* =====================================================
   DATOS
   ===================================================== */
async function loadAll() {
  const [f, i, l] = await Promise.all([
    sb.from('folders').select('*').order('name'),
    sb.from('items').select('*').order('created_at', { ascending: false }),
    sb.from('layouts').select('*').order('created_at', { ascending: false })
  ]);
  const err = f.error || i.error || l.error;
  if (err) toast('Error al cargar: ' + err.message);
  S.folders = f.data || [];
  S.items = i.data || [];
  S.layouts = l.data || [];
}

async function patchItem(it, patch) {
  const { error } = await sb.from('items').update(patch).eq('id', it.id);
  if (error) { toast('No se pudo guardar'); return false; }
  Object.assign(it, patch);
  return true;
}

function folderChildren(pid) {
  return S.folders.filter(f => (f.parent_id || null) === pid).sort((a, b) => a.name.localeCompare(b.name));
}
function flatFolders(pid, depth, out) {
  pid = pid === undefined ? null : pid; depth = depth || 0; out = out || [];
  for (const f of folderChildren(pid)) { out.push({ f, depth }); flatFolders(f.id, depth + 1, out); }
  return out;
}
function descendantIds(id) {
  let ids = [id];
  for (const c of folderChildren(id)) ids = ids.concat(descendantIds(c.id));
  return ids;
}

/* =====================================================
   BIBLIOTECA: dibujar
   ===================================================== */
function render() { renderSide(); renderLib(); updateCount(); }

function renderSide() {
  const it = S.items;
  const nav = (t, label, n) => `<button class="nav ${S.view.type === t && !S.tag ? 'on' : ''}" data-view="${t}">${label}<span>${n}</span></button>`;
  let h = nav('all', 'Todo', it.length)
    + nav('fav', '★ Favoritos', it.filter(i => i.favorite).length)
    + nav('later', 'Ver después', it.filter(i => i.later && !i.seen).length)
    + nav('unfiled', 'Sin carpeta', it.filter(i => !i.folder_id).length);
  h += `<div class="sh">Carpetas <button id="btnNewFolder" class="icon" title="Nueva carpeta">＋</button></div>`;
  const fl = flatFolders();
  h += fl.length ? fl.map(({ f, depth }) => {
    const n = it.filter(i => i.folder_id === f.id).length;
    const on = S.view.type === 'folder' && S.view.id === f.id && !S.tag;
    return `<button class="nav ${on ? 'on' : ''}" style="padding-left:${12 + depth * 14}px" data-view="folder" data-id="${f.id}">📁 ${esc(f.name)}<span>${n}</span></button>`;
  }).join('') : '<p class="muted s" style="padding:0 8px">Sin carpetas todavía.</p>';
  const tc = {};
  it.forEach(i => (i.tags || []).forEach(t => { tc[t] = (tc[t] || 0) + 1; }));
  const tags = Object.keys(tc).sort((a, b) => tc[b] - tc[a]).slice(0, 30);
  if (tags.length) {
    h += `<div class="sh">Etiquetas</div><div>` + tags.map(t => `<button class="chip ${S.tag === t ? 'on' : ''}" data-tag="${esc(t)}">#${esc(t)}</button>`).join('') + `</div>`;
  }
  $('#side').innerHTML = h;
}

function typeMatch(i, t) {
  if (t === 'video') return i.kind === 'x' || i.kind === 'ph' || (i.kind === 'file' && (i.mime || '').startsWith('video'));
  if (t === 'image') return i.kind === 'file' && (i.mime || '').startsWith('image');
  if (t === 'link') return i.kind === 'link';
  return true;
}

function visibleItems() {
  let list = S.items;
  const q = S.search.trim().toLowerCase();
  if (q) {
    list = list.filter(i => [i.title, i.note, i.url, (i.tags || []).join(' ')].join(' ').toLowerCase().includes(q));
  } else {
    const v = S.view;
    if (v.type === 'fav') list = list.filter(i => i.favorite);
    else if (v.type === 'later') list = list.filter(i => i.later && !i.seen);
    else if (v.type === 'unfiled') list = list.filter(i => !i.folder_id);
    else if (v.type === 'folder') list = list.filter(i => i.folder_id === v.id);
  }
  if (S.tag) list = list.filter(i => (i.tags || []).includes(S.tag));
  if (S.type !== 'all') list = list.filter(i => typeMatch(i, S.type));
  list = list.slice();
  if (S.sort === 'old') list.sort((a, b) => a.created_at.localeCompare(b.created_at));
  else if (S.sort === 'name') list.sort((a, b) => (a.title || defaultTitle(a)).localeCompare(b.title || defaultTitle(b)));
  return list;
}

function thumbInner(it) {
  if (it.kind === 'file') {
    if ((it.mime || '').startsWith('video')) return `<video data-path="${esc(it.file_path)}" muted playsinline preload="metadata"></video>`;
    return `<img data-path="${esc(it.file_path)}" alt="">`;
  }
  const cls = it.kind === 'x' ? 'x' : it.kind === 'ph' ? 'ph2' : 'link';
  const big = it.kind === 'x' ? 'X' : it.kind === 'ph' ? 'PH' : '🔗';
  return `<div class="ph ${cls}"><b>${big}</b><small>${esc(domainOf(it.url))}</small></div>`;
}

function cardHtml(it) {
  const title = it.title || defaultTitle(it);
  const tags = (it.tags || []).slice(0, 3).map(t => `<span>#${esc(t)}</span>`).join('');
  return `<div class="card ${it.seen ? 'seen' : ''}" data-id="${it.id}">
    <div class="thumb" data-act="view">${thumbInner(it)}<span class="badge">${kindLabel(it)}</span>${it.seen ? '<span class="seenMark">✓</span>' : ''}</div>
    <div class="cbody">
      <div class="ctitle" title="${esc(title)}">${esc(title)}</div>
      <div class="ctags">${tags}</div>
      <div class="cact">
        <button data-act="add" title="Agregar a la pantalla">＋</button>
        <button data-act="fav" class="${it.favorite ? 'on' : ''}" title="Favorito">★</button>
        <button data-act="later" class="${it.later ? 'on' : ''}" title="Ver después">⏱</button>
        <button data-act="edit" title="Editar">⋯</button>
      </div>
    </div></div>`;
}

function renderLib() {
  const v = S.view;
  let crumb;
  if (S.search.trim()) crumb = `Resultados para “${esc(S.search.trim())}”`;
  else if (v.type === 'folder') {
    const path = [];
    let f = S.folders.find(x => x.id === v.id);
    while (f) { path.unshift(f); const pid = f.parent_id; f = S.folders.find(x => x.id === pid); }
    crumb = `<a data-view="all">Todo</a> › ` + path.map(p => `<a data-view="folder" data-id="${p.id}">${esc(p.name)}</a>`).join(' › ')
      + ` <span class="fa"><button class="btn ghost small" data-fa="sub">＋ Subcarpeta</button> <button class="btn ghost small" data-fa="ren">Renombrar</button> <button class="btn ghost small" data-fa="del">Eliminar</button></span>`;
  } else crumb = { all: 'Todo', fav: '★ Favoritos', later: 'Ver después', unfiled: 'Sin carpeta' }[v.type];
  $('#crumb').innerHTML = crumb;

  let subs = '';
  if (v.type === 'folder' && !S.search.trim()) {
    subs = folderChildren(v.id).map(f => `<button class="chip" data-view="folder" data-id="${f.id}">📁 ${esc(f.name)}</button>`).join('');
  }
  $('#subs').innerHTML = subs;

  const list = visibleItems();
  $('#grid').innerHTML = list.map(cardHtml).join('');
  $('#emptyLib').classList.toggle('hidden', list.length > 0);
  hydrateThumbs();
}

async function hydrateThumbs() {
  const els = $$('#grid [data-path]');
  if (!els.length) return;
  const urls = await signedUrls(els.map(e => e.dataset.path));
  els.forEach((el, i) => {
    const u = urls[i];
    if (!u || !el.isConnected) return;
    el.src = el.tagName === 'VIDEO' ? u + '#t=0.5' : u;
  });
}

/* =====================================================
   CARPETAS
   ===================================================== */
async function createFolder(parentId) {
  const name = await askText(parentId ? 'Nombre de la subcarpeta' : 'Nombre de la carpeta', '');
  if (!name) return;
  const { data, error } = await sb.from('folders').insert({ name, parent_id: parentId || null }).select().single();
  if (error) { toast('No se pudo crear la carpeta'); return; }
  S.folders.push(data);
  S.view = { type: 'folder', id: data.id };
  S.tag = null;
  render();
}
async function renameFolder(id) {
  const f = S.folders.find(x => x.id === id);
  if (!f) return;
  const name = await askText('Nuevo nombre', f.name);
  if (!name) return;
  const { error } = await sb.from('folders').update({ name }).eq('id', id);
  if (error) { toast('No se pudo renombrar'); return; }
  f.name = name;
  render();
}
async function deleteFolder(id) {
  const f = S.folders.find(x => x.id === id);
  if (!f) return;
  const ok = await confirmBox(`¿Eliminar la carpeta “${f.name}” y sus subcarpetas? Lo que hay adentro NO se borra: pasa a “Sin carpeta”.`);
  if (!ok) return;
  const { error } = await sb.from('folders').delete().eq('id', id);
  if (error) { toast('No se pudo eliminar'); return; }
  const gone = descendantIds(id);
  S.folders = S.folders.filter(x => !gone.includes(x.id));
  S.items.forEach(i => { if (gone.includes(i.folder_id)) i.folder_id = null; });
  S.view = { type: 'all', id: null };
  render();
}

/* =====================================================
   AGREGAR (links y archivos)
   ===================================================== */
function folderOptions(sel) {
  return `<option value="">(Sin carpeta)</option>` + flatFolders().map(({ f, depth }) =>
    `<option value="${f.id}" ${f.id === sel ? 'selected' : ''}>${'— '.repeat(depth)}${esc(f.name)}</option>`).join('');
}
function errText(e) {
  const m = String((e && (e.message || e.error_description || e.error)) || e || '');
  if (/relation .* does not exist|could not find the table|schema cache/i.test(m)) return 'Falta preparar la base de datos: pegá setup.sql en Supabase (SQL Editor) y tocá Run.';
  if (/bucket not found/i.test(m)) return 'Falta el almacenamiento “biblioteca”: ejecutá setup.sql de nuevo en Supabase.';
  if (/row-level security|violates row/i.test(m)) return 'Supabase bloqueó el permiso: ejecutá setup.sql completo de nuevo.';
  if (/exceeded the maximum allowed size|too large|payload/i.test(m)) return 'El archivo es demasiado grande para el plan gratis.';
  if (/jwt|not authenticated|expired/i.test(m)) return 'La sesión venció: bloqueá y volvé a entrar.';
  if (/failed to fetch|network/i.test(m)) return 'Sin conexión con Supabase. Revisá internet y la URL de config.js.';
  return m || 'Error desconocido';
}
function parseTags(s) {
  return [...new Set(String(s || '').split(',').map(t => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean))].slice(0, 20);
}

function openAdd() {
  const curFolder = S.view.type === 'folder' ? S.view.id : null;
  const b = openModal(`<h3>Agregar</h3>
    <div class="mtabs"><button class="on" data-mt="link">Links</button><button data-mt="file">Mis archivos</button></div>
    <div id="mLink">
      <label>Links (uno por línea)<textarea id="aUrls" rows="4" placeholder="Pegá acá los links de X o PH"></textarea></label>
      <div class="row" style="margin-top:6px"><button class="btn ghost small" id="aPaste">Pegar del portapapeles</button></div>
      <label>Título (opcional, si es un solo link)<input id="aTitle" maxlength="150"></label>
    </div>
    <div id="mFile" class="hidden">
      <label>Imágenes o videos tuyos<input id="aFiles" type="file" accept="image/*,video/*" multiple></label>
      <p class="muted s">Hay un límite de tamaño por archivo en el plan gratis (alrededor de 50 MB).</p>
    </div>
    <label>Carpeta<select id="aFolder">${folderOptions(curFolder)}</select></label>
    <label>Etiquetas (separadas por coma)<input id="aTags" placeholder="ej: favoritos, noche"></label>
    <p id="aStatus" class="muted s"></p>
    <div class="row end"><button class="btn ghost" data-act="cancel">Cerrar</button><button class="btn" data-act="go">Guardar</button></div>`);
  let mode = 'link';
  $$('[data-mt]', b).forEach(btn => btn.onclick = () => {
    mode = btn.dataset.mt;
    $$('[data-mt]', b).forEach(x => x.classList.toggle('on', x === btn));
    $('#mLink', b).classList.toggle('hidden', mode !== 'link');
    $('#mFile', b).classList.toggle('hidden', mode !== 'file');
  });
  $('#aPaste', b).onclick = async () => {
    try { const t = await navigator.clipboard.readText(); $('#aUrls', b).value = ($('#aUrls', b).value + '\n' + t).trim(); }
    catch (e) { toast('No pude leer el portapapeles. Pegá con mantener apretado.'); }
  };
  $('[data-act=cancel]', b).onclick = closeModal;
  $('[data-act=go]', b).onclick = async () => {
    const folderId = $('#aFolder', b).value || null;
    const tags = parseTags($('#aTags', b).value);
    const st = $('#aStatus', b);
    const btn = $('[data-act=go]', b);
    btn.disabled = true;
    if (mode === 'link') {
      const r = await addLinks($('#aUrls', b).value, folderId, tags, $('#aTitle', b).value.trim());
      st.textContent = r;
      $('#aUrls', b).value = '';
    } else {
      const files = Array.from($('#aFiles', b).files || []);
      if (!files.length) { st.textContent = 'Elegí al menos un archivo.'; btn.disabled = false; return; }
      const r = await uploadFiles(files, folderId, tags, msg => { st.textContent = msg; });
      st.textContent = r;
      $('#aFiles', b).value = '';
    }
    btn.disabled = false;
    render();
  };
}

async function addLinks(text, folderId, tags, title) {
  const parts = String(text || '').split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Pegá al menos un link.';
  let added = 0, dup = 0, bad = 0;
  S.lastErr = '';
  for (const raw of parts) {
    const pl = parseLink(raw);
    if (!pl) { bad++; continue; }
    const key = pl.id || pl.url;
    const exists = S.items.some(i => i.kind === pl.kind && i.url && ((parseLink(i.url) || {}).id || i.url) === key);
    if (exists) { dup++; continue; }
    const row = { kind: pl.kind, url: pl.url, folder_id: folderId, tags, title: (parts.length === 1 && title) ? title : null };
    const { data, error } = await sb.from('items').insert(row).select().single();
    if (error) { bad++; S.lastErr = errText(error); continue; }
    S.items.unshift(data); added++;
  }
  return `Guardados: ${added}` + (dup ? ` · Ya estaban: ${dup}` : '') + (bad ? ` · Con problemas: ${bad}` : '') + (S.lastErr ? ` — Motivo: ${S.lastErr}` : '');
}

async function uploadFiles(files, folderId, tags, progress) {
  let ok = 0, fail = 0;
  S.lastErr = '';
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const isMedia = (f.type || '').startsWith('image/') || (f.type || '').startsWith('video/');
    if (!isMedia) { fail++; S.lastErr = 'El archivo no es una imagen ni un video.'; continue; }
    progress(`Subiendo ${i + 1} de ${files.length}…`);
    const ext = ((f.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5)) || 'bin';
    const path = `${S.user.id}/${uid()}.${ext}`;
    const up = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type, upsert: false });
    if (up.error) { fail++; S.lastErr = errText(up.error); continue; }
    const row = { kind: 'file', file_path: path, mime: f.type, title: f.name.replace(/\.[^.]+$/, ''), folder_id: folderId, tags };
    const { data, error } = await sb.from('items').insert(row).select().single();
    if (error) { fail++; S.lastErr = errText(error); await sb.storage.from(BUCKET).remove([path]); continue; }
    S.items.unshift(data); ok++;
  }
  return `Subidos: ${ok}` + (fail ? ` · Con problemas: ${fail}` : '') + (S.lastErr ? ` — Motivo: ${S.lastErr}` : '');
}

/* =====================================================
   EDITAR / ELIMINAR
   ===================================================== */
function editItem(id) {
  const it = S.items.find(i => i.id === id);
  if (!it) return;
  const b = openModal(`<h3>Editar</h3>
    <label>Título<input id="eT" maxlength="150" value="${esc(it.title || '')}"></label>
    <label>Nota<textarea id="eN" rows="3">${esc(it.note || '')}</textarea></label>
    <label>Etiquetas (separadas por coma)<input id="eG" value="${esc((it.tags || []).join(', '))}"></label>
    <label>Carpeta<select id="eF">${folderOptions(it.folder_id)}</select></label>
    <div class="checks">
      <label><input type="checkbox" id="eFav" ${it.favorite ? 'checked' : ''}> Favorito</label>
      <label><input type="checkbox" id="eLater" ${it.later ? 'checked' : ''}> Ver después</label>
      <label><input type="checkbox" id="eSeen" ${it.seen ? 'checked' : ''}> Visto</label>
    </div>
    <div class="row">
      <button class="btn danger small" data-act="del">Eliminar</button>
      <span class="grow"></span>
      ${it.url ? `<a class="btn ghost small" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">Abrir original</a>` : ''}
      <button class="btn ghost small" data-act="cancel">Cancelar</button>
      <button class="btn small" data-act="save">Guardar</button>
    </div>`);
  $('[data-act=cancel]', b).onclick = closeModal;
  $('[data-act=save]', b).onclick = async () => {
    const patch = {
      title: $('#eT', b).value.trim() || null,
      note: $('#eN', b).value.trim() || null,
      tags: parseTags($('#eG', b).value),
      folder_id: $('#eF', b).value || null,
      favorite: $('#eFav', b).checked,
      later: $('#eLater', b).checked,
      seen: $('#eSeen', b).checked
    };
    if (await patchItem(it, patch)) { closeModal(); render(); }
  };
  $('[data-act=del]', b).onclick = async () => {
    const ok = await confirmBox('¿Eliminar este elemento? No se puede deshacer.');
    if (!ok) return;
    if (it.file_path) await sb.storage.from(BUCKET).remove([it.file_path]);
    const { error } = await sb.from('items').delete().eq('id', it.id);
    if (error) { toast('No se pudo eliminar'); return; }
    S.items = S.items.filter(x => x.id !== it.id);
    S.panels.filter(p => p.itemId === it.id || (p.itemIds || []).includes(it.id)).forEach(p => removePanel(p.pid));
    render();
  };
}

/* =====================================================
   PANTALLA DIVIDIDA
   ===================================================== */
let twP = null;
function loadTwitter() {
  if (twP) return twP;
  twP = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://platform.twitter.com/widgets.js';
    s.async = true;
    s.onload = () => (window.twttr && window.twttr.ready) ? window.twttr.ready(res) : rej(new Error('twitter'));
    s.onerror = () => rej(new Error('twitter'));
    document.head.appendChild(s);
  });
  return twP;
}

function itemsToGallery(imgs) {
  return { kind: 'gallery', itemIds: imgs.map(i => i.id), idx: 0, title: `Galería (${imgs.length})` };
}

function itemToPanel(it) {
  const title = it.title || defaultTitle(it);
  if (it.kind === 'file') return { kind: 'file', itemId: it.id, path: it.file_path, mime: it.mime || '', title };
  const pl = parseLink(it.url || '');
  if ((it.kind === 'x' || it.kind === 'ph') && pl && pl.kind === it.kind) return { kind: it.kind, ref: pl.id, itemId: it.id, url: it.url, title };
  return { kind: 'link', itemId: it.id, url: it.url, title };
}

function panelEl(p) { return $(`#canvas [data-pid="${p.pid}"]`); }

function fallbackHtml(p) {
  return `<div class="fallback"><p>No se pudo mostrar acá.</p>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Abrir en el sitio</a>` : ''}</div>`;
}

function buildPanel(p) {
  const el = document.createElement('div');
  el.className = 'panel';
  el.dataset.pid = p.pid;
  el.innerHTML = `<div class="phead"><span class="ptitle">${esc(p.title || '')}</span>
      <span class="pbtns"><button data-a="left" title="Mover antes">◀</button><button data-a="right" title="Mover después">▶</button><button data-a="full" title="Pantalla completa">⛶</button>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" title="Abrir original">↗</a>` : ''}<button data-a="close" title="Quitar">✕</button></span></div>
    <div class="pbody"></div><div class="presize"></div>`;
  const body = $('.pbody', el);

  if (p.kind === 'x') {
    body.classList.add('xbody');
    const w = document.createElement('div');
    w.className = 'xwrap';
    body.appendChild(w);
    loadTwitter()
      .then(() => window.twttr.widgets.createTweet(p.ref, w, { theme: 'dark', dnt: true, conversation: 'none', align: 'center' }))
      .then(r => { if (!r) w.innerHTML = fallbackHtml(p); })
      .catch(() => { w.innerHTML = fallbackHtml(p); });
  } else if (p.kind === 'ph') {
    body.innerHTML = `<iframe src="https://www.pornhub.com/embed/${esc(p.ref)}" allow="autoplay; fullscreen" allowfullscreen scrolling="no" frameborder="0"></iframe>`;
  } else if (p.kind === 'file') {
    body.innerHTML = '<div class="fallback">Cargando…</div>';
    signedUrls([p.path]).then(arr => {
      const u = arr[0];
      if (!u) { body.innerHTML = fallbackHtml(p); return; }
      if ((p.mime || '').startsWith('video')) {
        const v = document.createElement('video');
        v.src = u; v.controls = true; v.playsInline = true; v.preload = 'metadata';
        body.innerHTML = ''; body.appendChild(v);
      } else {
        const im = document.createElement('img');
        im.src = u; im.alt = '';
        im.style.cursor = 'zoom-in';
        im.onclick = () => openLightbox(u);
        body.innerHTML = ''; body.appendChild(im);
      }
    });
  } else if (p.kind === 'gallery') {
    buildGallery(p, body);
  } else {
    body.innerHTML = fallbackHtml(p);
  }

  el.addEventListener('pointerdown', () => { el.style.zIndex = ++S.z; }, true);
  $('.pbtns', el).addEventListener('click', e => {
    const a = e.target.closest('button');
    if (!a) return;
    const act = a.dataset.a;
    if (act === 'close') removePanel(p.pid);
    else if (act === 'left') movePanel(p.pid, -1);
    else if (act === 'right') movePanel(p.pid, 1);
    else if (act === 'full') {
      const t = $('.pbody', el);
      try { (t.requestFullscreen || t.webkitRequestFullscreen).call(t); } catch (err) {}
    }
  });
  enableDrag(el, p);
  enableResize(el, p);
  $('#canvas').appendChild(el);
}

function buildGallery(p, body) {
  const its = (p.itemIds || []).map(id => S.items.find(i => i.id === id)).filter(Boolean);
  if (!its.length) { body.innerHTML = fallbackHtml(p); return; }
  if (p.idx == null || p.idx >= its.length) p.idx = 0;
  body.innerHTML = `<div class="gal"><img alt=""><button class="gnav gprev">‹</button><button class="gnav gnext">›</button><span class="gcnt"></span></div>`;
  const img = $('img', body), cnt = $('.gcnt', body);
  let cur = '';
  const show = async () => {
    const it = its[p.idx];
    cnt.textContent = `${p.idx + 1} / ${its.length}`;
    const arr = await signedUrls([it.file_path]);
    cur = arr[0] || '';
    if (cur) img.src = cur;
  };
  $('.gprev', body).onclick = () => { p.idx = (p.idx - 1 + its.length) % its.length; show(); };
  $('.gnext', body).onclick = () => { p.idx = (p.idx + 1) % its.length; show(); };
  img.onclick = () => { if (cur) openLightbox(cur); };
  show();
}

function addPanel(p) {
  p.pid = uid();
  S.panels.push(p);
  buildPanel(p);
  applyLayout();
  updateCount();
}
function addPanelFromItem(it) { addPanel(itemToPanel(it)); }

function removePanel(pid) {
  const i = S.panels.findIndex(p => p.pid === pid);
  if (i < 0) return;
  const el = panelEl(S.panels[i]);
  if (el) el.remove();
  S.panels.splice(i, 1);
  applyLayout();
  updateCount();
}
function clearPanels() {
  S.panels = [];
  $('#canvas').innerHTML = '';
  updateCount();
}
function movePanel(pid, d) {
  const i = S.panels.findIndex(p => p.pid === pid);
  const j = i + d;
  if (i < 0 || j < 0 || j >= S.panels.length) return;
  const t = S.panels[i]; S.panels[i] = S.panels[j]; S.panels[j] = t;
  applyLayout();
}

function updateCount() {
  const n = S.panels.length;
  $('#pCount').textContent = n ? String(n) : '';
  $('#emptyCanvas').classList.toggle('hidden', n > 0);
}

function ensureGeom(p, i) {
  if (p.w != null && p.h != null && p.x != null && p.y != null) return;
  const c = $('#canvas');
  p.w = Math.max(200, Math.min(520, c.clientWidth - 24));
  p.h = Math.max(160, Math.min(340, c.clientHeight - 24));
  p.x = 12 + i * 28;
  p.y = 12 + i * 28;
}
function place(el, p) {
  el.style.left = p.x + 'px';
  el.style.top = p.y + 'px';
  el.style.width = p.w + 'px';
  el.style.height = p.h + 'px';
}

function applyLayout() {
  const c = $('#canvas');
  const n = S.panels.length;
  c.classList.toggle('free', S.mode === 'free');
  c.classList.toggle('grid', S.mode === 'grid');
  if (S.mode === 'grid') {
    const w = c.clientWidth;
    const cols = w < 700 ? (n <= 2 ? 1 : 2) : (n <= 1 ? 1 : n <= 4 ? 2 : n <= 6 ? 3 : 4);
    c.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  } else {
    c.style.gridTemplateColumns = '';
  }
  S.panels.forEach((p, i) => {
    const el = panelEl(p);
    if (!el) return;
    el.style.order = i;
    if (S.mode === 'free') { ensureGeom(p, i); place(el, p); }
    else { el.style.left = el.style.top = el.style.width = el.style.height = ''; }
  });
  updateModeBtn();
}

function setMode(m) {
  if (m === S.mode) return;
  if (m === 'free') {
    const c = $('#canvas');
    const cr = c.getBoundingClientRect();
    S.panels.forEach(p => {
      const el = panelEl(p);
      if (!el) return;
      const r = el.getBoundingClientRect();
      p.x = r.left - cr.left + c.scrollLeft;
      p.y = r.top - cr.top + c.scrollTop;
      p.w = r.width;
      p.h = r.height;
    });
  }
  S.mode = m;
  applyLayout();
}
function updateModeBtn() {
  $('#tbMode').textContent = 'Modo: ' + (S.mode === 'free' ? 'Libre' : 'Cuadrícula');
}

function enableDrag(el, p) {
  const head = $('.phead', el);
  head.addEventListener('pointerdown', e => {
    if (S.mode !== 'free' || e.target.closest('button,a')) return;
    e.preventDefault();
    head.setPointerCapture(e.pointerId);
    const sx = e.clientX, sy = e.clientY, ox = p.x, oy = p.y;
    document.body.classList.add('dragging');
    const mv = ev => { p.x = Math.max(0, ox + ev.clientX - sx); p.y = Math.max(0, oy + ev.clientY - sy); place(el, p); };
    const up = () => {
      head.removeEventListener('pointermove', mv);
      head.removeEventListener('pointerup', up);
      head.removeEventListener('pointercancel', up);
      document.body.classList.remove('dragging');
    };
    head.addEventListener('pointermove', mv);
    head.addEventListener('pointerup', up);
    head.addEventListener('pointercancel', up);
  });
}
function enableResize(el, p) {
  const h = $('.presize', el);
  h.addEventListener('pointerdown', e => {
    if (S.mode !== 'free') return;
    e.preventDefault(); e.stopPropagation();
    h.setPointerCapture(e.pointerId);
    const sx = e.clientX, sy = e.clientY, ow = p.w, oh = p.h;
    document.body.classList.add('dragging');
    const mv = ev => { p.w = Math.max(180, ow + ev.clientX - sx); p.h = Math.max(120, oh + ev.clientY - sy); place(el, p); };
    const up = () => {
      h.removeEventListener('pointermove', mv);
      h.removeEventListener('pointerup', up);
      h.removeEventListener('pointercancel', up);
      document.body.classList.remove('dragging');
    };
    h.addEventListener('pointermove', mv);
    h.addEventListener('pointerup', up);
    h.addEventListener('pointercancel', up);
  });
}

async function applyBg() {
  const c = $('#canvas');
  const it = S.bg ? S.items.find(i => i.id === S.bg) : null;
  if (!it || !it.file_path) { c.style.backgroundImage = ''; return; }
  const arr = await signedUrls([it.file_path]);
  c.style.backgroundImage = arr[0] ? `url("${arr[0]}")` : '';
}

function stopAllMedia() {
  $$('#canvas video').forEach(v => v.pause());
  $$('#canvas iframe').forEach(f => { const s = f.src; f.src = s; });
}

function openLightbox(u) {
  const b = openModal(`<img src="${esc(u)}" alt="" style="width:100%;max-height:78vh;object-fit:contain;border-radius:8px">
    <div class="row end"><button class="btn ghost" data-act="close">Cerrar</button></div>`);
  $('#modalBody').style.maxWidth = 'min(92vw, 1000px)';
  $('[data-act=close]', b).onclick = closeModal;
}

function openPicker(opts) {
  const single = typeof opts.onPick === 'function';
  const sel = new Set();
  let type = opts.onlyImages ? 'image' : (opts.type || 'all');
  const typeBtns = opts.onlyImages ? '' : '<button data-t="all">Todo</button><button data-t="video">Videos</button>';
  const folderOpts = flatFolders().map(({ f, depth }) => `<option value="${f.id}">${'— '.repeat(depth)}${esc(f.name)}</option>`).join('');
  const b = openModal(`<h3>${esc(opts.title)}</h3>
    <div class="mtabs" id="pkTypes">${typeBtns}<button data-t="image">Imágenes</button></div>
    <select id="pkFolder"><option value="">(Todas las carpetas)</option>${folderOpts}</select>
    <input id="pkQ" placeholder="Buscar…" style="margin-top:6px">
    <div id="pkList" class="pklist"></div>
    <div class="row"><span id="pkSel" class="muted s grow"></span>
      ${single ? '' : '<button class="btn ghost small" data-act="all">Elegir todo</button><button class="btn ghost small" data-act="none">Ninguno</button>'}
    </div>
    <div class="row end">
      <button class="btn ghost" data-act="close">Cerrar</button>
      ${single ? '' : '<button class="btn ghost" data-act="gallery">Juntar en una galería</button><button class="btn" data-act="add">Agregar</button>'}
    </div>`);

  const filtered = () => {
    const q = $('#pkQ', b).value.trim().toLowerCase();
    const fid = $('#pkFolder', b).value;
    const ids = fid ? descendantIds(fid) : null;
    let list = S.items.filter(i => i.kind !== 'link' && typeMatch(i, type));
    if (ids) list = list.filter(i => ids.includes(i.folder_id));
    if (q) list = list.filter(i => [i.title, i.url, (i.tags || []).join(' ')].join(' ').toLowerCase().includes(q));
    return list.slice(0, 300);
  };
  const updSel = () => {
    $('#pkSel', b).textContent = single ? '' : (sel.size ? `${sel.size} elegidos` : 'Tocá para elegir varios');
    $$('#pkTypes [data-t]', b).forEach(x => x.classList.toggle('on', x.dataset.t === type));
  };
  const draw = () => {
    const list = filtered();
    $('#pkList', b).innerHTML = list.map(i =>
      `<div class="pkrow ${sel.has(i.id) ? 'on' : ''}" data-id="${i.id}">${single ? '' : `<input type="checkbox" class="pkchk" ${sel.has(i.id) ? 'checked' : ''} tabindex="-1">`}<span class="badge s">${kindLabel(i)}</span><span>${esc(i.title || defaultTitle(i))}</span></div>`
    ).join('') || '<p class="muted">No hay nada para elegir.</p>';
    updSel();
  };
  draw();

  $('#pkQ', b).oninput = draw;
  $('#pkFolder', b).onchange = draw;
  $('#pkTypes', b).onclick = e => {
    const t = e.target.closest('[data-t]');
    if (t) { type = t.dataset.t; draw(); }
  };
  $('#pkList', b).onclick = e => {
    const row = e.target.closest('.pkrow');
    if (!row) return;
    const it = S.items.find(i => i.id === row.dataset.id);
    if (!it) return;
    if (single) { opts.onPick(it); return; }
    if (sel.has(it.id)) sel.delete(it.id); else sel.add(it.id);
    row.classList.toggle('on', sel.has(it.id));
    const chk = $('.pkchk', row);
    if (chk) chk.checked = sel.has(it.id);
    updSel();
  };
  $$('[data-act]', b).forEach(btn => btn.onclick = () => {
    const a = btn.dataset.act;
    if (a === 'close') { closeModal(); return; }
    if (a === 'all') { filtered().forEach(i => sel.add(i.id)); draw(); return; }
    if (a === 'none') { sel.clear(); draw(); return; }
    const its = [...sel].map(id => S.items.find(i => i.id === id)).filter(Boolean);
    if (!its.length) { toast('Elegí al menos uno'); return; }
    if (a === 'add') {
      its.forEach(addPanelFromItem);
      closeModal();
      toast(`Agregados: ${its.length}`);
    } else if (a === 'gallery') {
      const imgs = its.filter(i => i.kind === 'file' && (i.mime || '').startsWith('image'));
      if (imgs.length < 2) { toast('Elegí al menos 2 imágenes'); return; }
      addPanel(itemsToGallery(imgs));
      closeModal();
      toast('Galería agregada');
    }
  });
  $('#pkQ', b).focus();
}

async function saveScene() {
  if (!S.panels.length) { toast('No hay nada en la pantalla para guardar'); return; }
  const name = await askText('Nombre de la escena', '');
  if (!name) return;
  const data = {
    mode: S.mode, bg: S.bg || null,
    panels: S.panels.map(p => ({ itemIds: p.itemIds || null, itemId: p.itemId || null, url: p.itemId ? null : (p.url || null), x: p.x == null ? null : p.x, y: p.y == null ? null : p.y, w: p.w == null ? null : p.w, h: p.h == null ? null : p.h }))
  };
  const { data: row, error } = await sb.from('layouts').insert({ name, data }).select().single();
  if (error) { toast('No se pudo guardar la escena'); return; }
  S.layouts.unshift(row);
  toast('Escena guardada');
}

function loadScene(sc) {
  const d = sc.data || {};
  clearPanels();
  S.mode = d.mode === 'free' ? 'free' : 'grid';
  S.bg = d.bg || null;
  for (const q of (d.panels || [])) {
    let p = null;
    if (q.itemIds && q.itemIds.length) {
      const imgs = q.itemIds.map(id => S.items.find(i => i.id === id)).filter(Boolean);
      if (imgs.length) p = itemsToGallery(imgs);
    } else if (q.itemId) {
      const it = S.items.find(i => i.id === q.itemId);
      if (it) p = itemToPanel(it);
    } else if (q.url) {
      const pl = parseLink(q.url);
      if (pl && pl.kind !== 'link') p = { kind: pl.kind, ref: pl.id, url: pl.url, title: pl.kind === 'x' ? 'X' : 'PH' };
    }
    if (!p) continue;
    p.x = q.x; p.y = q.y; p.w = q.w; p.h = q.h;
    p.pid = uid();
    S.panels.push(p);
    buildPanel(p);
  }
  applyLayout();
  applyBg();
  updateCount();
}

function openScenes() {
  const draw = () => S.layouts.map(s => `<div class="pkrow" data-id="${s.id}"><span style="flex:1">${esc(s.name)}</span><button class="btn ghost small" data-del="${s.id}">✕</button></div>`).join('')
    || '<p class="muted">Todavía no guardaste escenas.</p>';
  const b = openModal(`<h3>Escenas guardadas</h3><div id="scList" class="pklist">${draw()}</div>
    <div class="row end"><button class="btn ghost" data-act="close">Cerrar</button></div>`);
  $('[data-act=close]', b).onclick = closeModal;
  $('#scList', b).onclick = async e => {
    const del = e.target.closest('[data-del]');
    if (del) {
      const id = del.dataset.del;
      const { error } = await sb.from('layouts').delete().eq('id', id);
      if (error) { toast('No se pudo eliminar'); return; }
      S.layouts = S.layouts.filter(s => s.id !== id);
      $('#scList', b).innerHTML = draw();
      return;
    }
    const row = e.target.closest('.pkrow');
    if (!row) return;
    const sc = S.layouts.find(s => s.id === row.dataset.id);
    if (sc) { closeModal(); loadScene(sc); }
  };
}

/* =====================================================
   RITMO (sonido que va cambiando)
   ===================================================== */
const R = {
  ctx: null, master: null, on: false, timer: null, uiT: null, next: 0, t0: 0, cur: 80,
  mode: 'fixed', fixed: 80, min: 60, max: 120, period: 30, vol: 0.6, sound: 'click', vib: false,
  bpm: 90, target: 90, until: 0, wake: null,
  rest: false, restEvery: 60, restFor: 8, nextRest: Infinity, restUntil: 0,
  finale: false, finalBpm: 180, finBpm: 180
};

function readRhythm() {
  R.mode = $('#rMode').value;
  R.fixed = +$('#rFixed').value;
  R.min = +$('#rMin').value;
  R.max = +$('#rMax').value;
  if (R.min > R.max) { const t = R.min; R.min = R.max; R.max = t; }
  R.period = +$('#rPer').value;
  R.vol = +$('#rVol').value / 100;
  R.sound = $('#rSound').value;
  R.vib = $('#rVib').checked;
  R.rest = $('#rRest').checked;
  R.restEvery = +$('#rRestEvery').value;
  R.restFor = +$('#rRestFor').value;
  R.finalBpm = +$('#rFinalBpm').value;
  $('#oFixed').textContent = R.fixed;
  $('#oMin').textContent = $('#rMin').value;
  $('#oMax').textContent = $('#rMax').value;
  $('#oPer').textContent = R.period;
  $('#oRestEvery').textContent = R.restEvery;
  $('#oRestFor').textContent = R.restFor;
  $('#oFinal').textContent = R.finalBpm;
  $('#rFixedRow').classList.toggle('hidden', R.mode !== 'fixed');
  $('#rRangeRow').classList.toggle('hidden', R.mode === 'fixed');
  $('#rRestRow').classList.toggle('hidden', !R.rest);
  if (R.master) R.master.gain.value = R.vol * R.vol;
  if (!R.rest) R.nextRest = Infinity;
  else if (R.on && !isFinite(R.nextRest)) R.nextRest = (R.ctx.currentTime - R.t0) + R.restEvery * (0.5 + Math.random());
}

function bpmAt(t) {
  const span = R.max - R.min, P = R.period;
  switch (R.mode) {
    case 'ramp': {
      const ph = (t % (2 * P)) / P;
      return R.min + span * (ph < 1 ? ph : 2 - ph);
    }
    case 'wave':
      return R.min + span * (0.5 - 0.5 * Math.cos(Math.PI * t / P));
    case 'steps': {
      const seq = [0, 1, 2, 3, 4, 3, 2, 1];
      return R.min + span * seq[Math.floor(t / P) % seq.length] / 4;
    }
    case 'jump': {
      if (t >= R.until) {
        let nb = R.bpm;
        for (let k = 0; k < 8; k++) {
          nb = R.min + Math.random() * span;
          if (Math.abs(nb - R.bpm) > span * 0.25) break;
        }
        R.bpm = nb;
        R.until = t + P * (0.4 + Math.random() * 1.2);
      }
      return R.bpm;
    }
    case 'random': {
      if (t >= R.until) {
        R.target = R.min + Math.random() * span;
        R.until = t + P * (0.5 + Math.random());
      }
      R.bpm += (R.target - R.bpm) * 0.12;
      return R.bpm;
    }
    default:
      return R.fixed;
  }
}

function pulse() {
  const d = $('#rDot');
  d.classList.add('pulse');
  setTimeout(() => d.classList.remove('pulse'), 90);
}

function beat(t) {
  const ctx = R.ctx;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  let f = 1400, f2 = null, dur = 0.04, type = 'triangle';
  if (R.sound === 'wood') { f = 900; f2 = 650; dur = 0.07; }
  else if (R.sound === 'thud') { f = 150; f2 = 55; dur = 0.17; type = 'sine'; }
  else if (R.sound === 'tone') { f = 440; dur = 0.12; type = 'sine'; }
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(1, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(R.master);
  o.start(t); o.stop(t + dur + 0.03);
  const wait = Math.max(0, (t - ctx.currentTime) * 1000);
  setTimeout(pulse, wait);
  if (R.vib && navigator.vibrate) setTimeout(() => navigator.vibrate(25), wait);
}

function tick() {
  const ctx = R.ctx;
  while (R.next < ctx.currentTime + 0.6) {
    const t = Math.max(0, R.next - R.t0);
    if (R.rest && !R.finale && t >= R.nextRest) {
      R.restUntil = t + R.restFor * (0.5 + Math.random());
      R.nextRest = R.restUntil + R.restEvery * (0.5 + Math.random());
    }
    if (R.rest && !R.finale && t < R.restUntil) {
      R.next = R.t0 + R.restUntil + 0.001;
      continue;
    }
    let b;
    if (R.finale) {
      R.finBpm += (R.finalBpm - R.finBpm) * 0.25;
      b = R.finBpm;
    } else {
      b = bpmAt(t);
    }
    b = Math.max(20, Math.min(300, b));
    R.cur = b;
    beat(R.next);
    R.next += 60 / b;
  }
}

async function wakeOn() {
  try { if ('wakeLock' in navigator) R.wake = await navigator.wakeLock.request('screen'); } catch (e) {}
}

function startRhythm() {
  readRhythm();
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) { toast('Este navegador no permite sonido.'); return; }
  R.ctx = new AC();
  R.ctx.resume();
  R.master = R.ctx.createGain();
  R.master.gain.value = R.vol * R.vol;
  R.master.connect(R.ctx.destination);
  R.bpm = (R.min + R.max) / 2; R.target = R.bpm; R.until = 0;
  R.t0 = R.ctx.currentTime;
  R.next = R.t0 + 0.1;
  R.restUntil = 0;
  R.nextRest = R.rest ? R.restEvery * (0.5 + Math.random()) : Infinity;
  R.on = true;
  R.timer = setInterval(tick, 100);
  R.uiT = setInterval(() => {
    const tn = R.ctx ? R.ctx.currentTime - R.t0 : 0;
    $('#rBpm').textContent = (R.rest && !R.finale && tn < R.restUntil) ? 'pausa' : Math.round(R.cur);
    bumpIdle();
  }, 300);
  tick();
  wakeOn();
  $('#rPlay').textContent = '■ Detener';
}

function stopRhythm() {
  if (!R.on) return;
  R.on = false;
  R.finale = false;
  $('#btnFinale').classList.remove('on');
  clearInterval(R.timer); clearInterval(R.uiT);
  try { R.ctx.close(); } catch (e) {}
  R.ctx = null; R.master = null;
  try { if (R.wake) R.wake.release(); } catch (e) {}
  R.wake = null;
  $('#rPlay').textContent = '▶ Iniciar';
  $('#rBpm').textContent = '—';
}

function toggleFinale() {
  readRhythm();
  if (R.finale) {
    R.finale = false;
    $('#btnFinale').classList.remove('on');
    toast('Velocidad rápida desactivada');
    return;
  }
  R.finBpm = R.cur > 0 ? R.cur : (R.mode === 'fixed' ? R.fixed : (R.min + R.max) / 2);
  R.finale = true;
  $('#btnFinale').classList.add('on');
  if (!R.on) startRhythm();
  toast('Velocidad rápida activada');
}

/* =====================================================
   FOTOS AL AZAR (aparecen, flotan y se desvanecen)
   ===================================================== */
const PF = { on: false, timer: null, last: null, active: 0 };
const rnd = (a, b) => a + Math.random() * (b - a);

function pfImages() {
  const folderId = $('#pfFolder').value;
  let list = S.items.filter(i => i.kind === 'file' && (i.mime || '').startsWith('image'));
  if (folderId) {
    const ids = $('#pfSub').checked ? descendantIds(folderId) : [folderId];
    list = list.filter(i => ids.includes(i.folder_id));
  }
  return list;
}

function pfRefreshInfo() {
  const n = pfImages().length;
  $('#pfInfo').textContent = n ? `${n} imágenes disponibles` : 'No hay imágenes en esa carpeta.';
}

function readPhotos() {
  $('#oPfMin').textContent = $('#pfMin').value;
  $('#oPfMax').textContent = $('#pfMax').value;
  $('#oPfStayMin').textContent = $('#pfStayMin').value;
  $('#oPfStayMax').textContent = $('#pfStayMax').value;
  $('#oPfCount').textContent = $('#pfCount').value;
}

function pfSchedule() {
  if (!PF.on) return;
  const lo = +$('#pfMin').value, hi = Math.max(lo, +$('#pfMax').value);
  PF.timer = setTimeout(() => { pfShow(); pfSchedule(); }, rnd(lo, hi) * 1000);
}

async function pfShow() {
  const list = pfImages();
  if (!list.length || PF.active >= +$('#pfCount').value) return;
  let it = list[Math.floor(Math.random() * list.length)];
  for (let k = 0; k < 6 && list.length > 1 && it.id === PF.last; k++) it = list[Math.floor(Math.random() * list.length)];
  PF.last = it.id;
  PF.active++;
  const arr = await signedUrls([it.file_path]);
  const u = arr[0];
  if (!u || !PF.on) { PF.active = Math.max(0, PF.active - 1); return; }
  const img = document.createElement('img');
  img.className = 'pop';
  img.alt = '';
  const drop = () => { img.remove(); PF.active = Math.max(0, PF.active - 1); };
  img.onerror = drop;
  img.onload = () => {
    if (!PF.on) { drop(); return; }
    const vw = window.innerWidth, vh = window.innerHeight, base = Math.min(vw, vh);
    const m = $('#pfSize').value;
    const frac = m === 's' ? rnd(0.2, 0.3) : m === 'm' ? rnd(0.35, 0.5) : m === 'l' ? rnd(0.6, 0.85) : rnd(0.2, 0.85);
    const box = Math.max(120, base * frac);
    const sc = Math.min(box / img.naturalWidth, box / img.naturalHeight);
    const w = Math.max(60, Math.round(img.naturalWidth * sc));
    const h = Math.max(60, Math.round(img.naturalHeight * sc));
    img.style.width = w + 'px';
    img.style.height = h + 'px';
    img.style.left = Math.round(rnd(0, Math.max(0, vw - w))) + 'px';
    img.style.top = Math.round(rnd(0, Math.max(0, vh - h))) + 'px';
    img.style.setProperty('--rot', rnd(-4, 4).toFixed(1) + 'deg');
    requestAnimationFrame(() => requestAnimationFrame(() => img.classList.add('in')));
    const lo = +$('#pfStayMin').value, hi = Math.max(lo, +$('#pfStayMax').value);
    setTimeout(() => { img.classList.remove('in'); setTimeout(drop, 1400); }, rnd(lo, hi) * 1000);
  };
  img.src = u;
  $('#photoLayer').appendChild(img);
}

function pfStart() {
  if (!pfImages().length) { toast('No hay imágenes en esa carpeta.'); return; }
  PF.on = true;
  $('#pfPlay').textContent = '■ Detener';
  pfShow();
  pfSchedule();
}

function pfStop(instant) {
  PF.on = false;
  clearTimeout(PF.timer);
  const layer = $('#photoLayer');
  if (instant) layer.innerHTML = '';
  else $$('.pop', layer).forEach(p => { p.classList.remove('in'); setTimeout(() => p.remove(), 1400); });
  PF.active = 0;
  const btn = $('#pfPlay');
  if (btn) btn.textContent = '▶ Iniciar';
}

function openPhotos() {
  const d = $('#photosDrawer');
  const wasHidden = d.classList.contains('hidden');
  $('#rhythm').classList.add('hidden');
  if (!wasHidden) { d.classList.add('hidden'); return; }
  const cur = $('#pfFolder').value;
  $('#pfFolder').innerHTML = `<option value="">Todas las imágenes</option>` + flatFolders().map(({ f, depth }) =>
    `<option value="${f.id}" ${f.id === cur ? 'selected' : ''}>${'— '.repeat(depth)}${esc(f.name)}</option>`).join('');
  d.classList.remove('hidden');
  readPhotos();
  pfRefreshInfo();
}

/* =====================================================
   CONEXIÓN DE BOTONES
   ===================================================== */
function setTab(t) {
  $$('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $('#lib').classList.toggle('hidden', t !== 'lib');
  $('#screen').classList.toggle('hidden', t !== 'screen');
  document.body.classList.remove('sideopen');
  if (t === 'screen') applyLayout();
}

function bindUI() {
  // Acceso
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!sb) return;
    $('#loginMsg').textContent = '…';
    const { data, error } = await sb.auth.signInWithPassword({ email: $('#lEmail').value.trim(), password: $('#lPass').value });
    if (error) {
      const m = String(error.message || '');
      let txt;
      if (/invalid login credentials/i.test(m)) txt = 'Correo o clave incorrectos (o ese usuario no existe en este proyecto).';
      else if (/not confirmed/i.test(m)) txt = 'El correo todavía no está confirmado en Supabase.';
      else if (/invalid api key|apikey/i.test(m)) txt = 'La clave pegada en config.js no es válida.';
      else if (/failed to fetch|network/i.test(m)) txt = 'No se pudo conectar. Revisá la URL en config.js y tu internet.';
      else txt = 'Error: ' + m;
      $('#loginMsg').textContent = txt;
      return;
    }
    $('#lPass').value = '';
    $('#loginMsg').textContent = '';
    start(data.user);
  });

  // Barra superior
  $$('.tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('#btnLock').addEventListener('click', lock);
  $('#btnSide').addEventListener('click', () => document.body.classList.toggle('sideopen'));
  $('#btnRhythm').addEventListener('click', () => { $('#photosDrawer').classList.add('hidden'); $('#rhythm').classList.toggle('hidden'); });
  $('#btnFinale').addEventListener('click', toggleFinale);
  $('#typeBar').addEventListener('click', e => {
    const t = e.target.closest('[data-type]');
    if (!t) return;
    S.type = t.dataset.type;
    $$('#typeBar [data-type]').forEach(x => x.classList.toggle('on', x === t));
    renderLib();
  });
  $('#tbImgs').addEventListener('click', () => openPicker({ title: 'Elegir imágenes', type: 'image' }));
  $('#tbPhotos').addEventListener('click', openPhotos);
  $('#pClose').addEventListener('click', () => $('#photosDrawer').classList.add('hidden'));
  $('#pfPlay').addEventListener('click', () => { PF.on ? pfStop(false) : pfStart(); });
  ['pfMin', 'pfMax', 'pfStayMin', 'pfStayMax', 'pfCount'].forEach(id => $('#' + id).addEventListener('input', readPhotos));
  ['pfFolder', 'pfSub'].forEach(id => $('#' + id).addEventListener('change', pfRefreshInfo));
  $('#rClose').addEventListener('click', () => $('#rhythm').classList.add('hidden'));

  // Modal: cerrar tocando afuera
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

  // Barra lateral
  $('#side').addEventListener('click', e => {
    if (e.target.closest('#btnNewFolder')) { createFolder(null); return; }
    const tg = e.target.closest('[data-tag]');
    if (tg) { S.tag = S.tag === tg.dataset.tag ? null : tg.dataset.tag; document.body.classList.remove('sideopen'); render(); return; }
    const nv = e.target.closest('[data-view]');
    if (nv) {
      S.view = { type: nv.dataset.view, id: nv.dataset.id || null };
      S.tag = null; S.search = ''; $('#q').value = '';
      document.body.classList.remove('sideopen');
      render();
    }
  });

  // Encabezado de la biblioteca
  const libHead = e => {
    const nv = e.target.closest('[data-view]');
    if (nv) { S.view = { type: nv.dataset.view, id: nv.dataset.id || null }; S.tag = null; render(); return; }
    const fa = e.target.closest('[data-fa]');
    if (fa && S.view.type === 'folder') {
      if (fa.dataset.fa === 'sub') createFolder(S.view.id);
      else if (fa.dataset.fa === 'ren') renameFolder(S.view.id);
      else if (fa.dataset.fa === 'del') deleteFolder(S.view.id);
    }
  };
  $('#crumb').addEventListener('click', libHead);
  $('#subs').addEventListener('click', libHead);

  $('#q').addEventListener('input', e => { S.search = e.target.value; renderLib(); });
  $('#sort').addEventListener('change', e => { S.sort = e.target.value; renderLib(); });
  $('#btnAdd').addEventListener('click', openAdd);

  // Tarjetas
  $('#grid').addEventListener('click', async e => {
    const card = e.target.closest('.card');
    if (!card) return;
    const it = S.items.find(i => i.id === card.dataset.id);
    const btn = e.target.closest('[data-act]');
    if (!it || !btn) return;
    const act = btn.dataset.act;
    if (act === 'view') {
      addPanelFromItem(it);
      setTab('screen');
      if (!it.seen) { await patchItem(it, { seen: true }); renderSide(); renderLib(); }
    } else if (act === 'add') {
      addPanelFromItem(it);
      toast(`Agregado a la pantalla (${S.panels.length})`);
    } else if (act === 'fav') {
      if (await patchItem(it, { favorite: !it.favorite })) render();
    } else if (act === 'later') {
      if (await patchItem(it, { later: !it.later })) render();
    } else if (act === 'edit') {
      editItem(it.id);
    }
  });

  // Barra de la pantalla
  $('#tbLib').addEventListener('click', () => openPicker({
    title: 'Agregar a la pantalla',
    onPick: it => { addPanelFromItem(it); toast(`Agregado (${S.panels.length})`); }
  }));
  $('#quickForm').addEventListener('submit', e => {
    e.preventDefault();
    const pl = parseLink($('#quickUrl').value);
    if (!pl) { toast('Ese link no es válido'); return; }
    if (pl.kind === 'link') { toast('Solo se pueden mostrar links de videos de X o PH. Guardalo en la biblioteca para abrirlo.'); return; }
    addPanel({ kind: pl.kind, ref: pl.id, url: pl.url, title: pl.kind === 'x' ? 'X' : 'PH' });
    $('#quickUrl').value = '';
  });
  $('#tbMode').addEventListener('click', () => setMode(S.mode === 'grid' ? 'free' : 'grid'));
  $('#tbBg').addEventListener('click', () => {
    if (S.bg) {
      S.bg = null; applyBg(); toast('Fondo quitado'); return;
    }
    openPicker({
      title: 'Elegir imagen de fondo', onlyImages: true,
      onPick: it => { S.bg = it.id; applyBg(); closeModal(); }
    });
  });
  $('#tbSave').addEventListener('click', saveScene);
  $('#tbScenes').addEventListener('click', openScenes);
  $('#tbStop').addEventListener('click', () => { stopAllMedia(); toast('Todo pausado'); });
  $('#tbClear').addEventListener('click', async () => {
    if (!S.panels.length) return;
    if (await confirmBox('¿Sacar todo de la pantalla?', 'Vaciar')) clearPanels();
  });
  window.addEventListener('resize', () => { if (!$('#screen').classList.contains('hidden')) applyLayout(); });

  // Ritmo
  ['rMode', 'rFixed', 'rMin', 'rMax', 'rPer', 'rVol', 'rSound', 'rVib', 'rRest', 'rRestEvery', 'rRestFor', 'rFinalBpm'].forEach(id => $('#' + id).addEventListener('input', readRhythm));
  $('#rPlay').addEventListener('click', () => { R.on ? stopRhythm() : startRhythm(); });
  if (!navigator.vibrate) $('#rVibRow').classList.add('hidden');
  readRhythm();
  readPhotos();
  document.addEventListener('visibilitychange', () => { if (R.on && document.visibilityState === 'visible') wakeOn(); });

  // Bloqueo automático y tecla de pánico
  ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'].forEach(ev => window.addEventListener(ev, bumpIdle, { passive: true, capture: true }));
  window.addEventListener('blur', bumpIdle);
  let lastEsc = 0;
  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const now = Date.now();
    if (now - lastEsc < 600 && S.user) lock();
    lastEsc = now;
  });
}

init();
})();
