// Image Format Saver: right-click any picture and save it as JPG, PNG or WebP, or copy it as PNG.
// Pictures are converted on your computer. Nothing is sent anywhere.
'use strict';

const LOCAL = typeof ifsConvert === 'function';   // Firefox background page has a DOM; Chrome uses an offscreen page
if (!LOCAL) importScripts('offscreen-client.js');
const DEFAULTS = { quality: 92, saveAs: false };
const EXT = { jpg: 'jpg', png: 'png', webp: 'webp' };

function setupMenus() {
  chrome.contextMenus.removeAll(() => {
    const c = ['image'];
    chrome.contextMenus.create({ id: 'ifs', title: 'Save image as JPG, PNG or WebP', contexts: c });
    chrome.contextMenus.create({ id: 'ifs-jpg', parentId: 'ifs', title: 'Save as JPG', contexts: c });
    chrome.contextMenus.create({ id: 'ifs-png', parentId: 'ifs', title: 'Save as PNG', contexts: c });
    chrome.contextMenus.create({ id: 'ifs-webp', parentId: 'ifs', title: 'Save as WebP', contexts: c });
    chrome.contextMenus.create({ id: 'ifs-sep', parentId: 'ifs', type: 'separator', contexts: c });
    chrome.contextMenus.create({ id: 'ifs-copy', parentId: 'ifs', title: 'Copy as PNG', contexts: c });
  });
}
chrome.runtime.onInstalled.addListener(setupMenus);
chrome.runtime.onStartup.addListener(setupMenus);

chrome.contextMenus.onClicked.addListener((info, tab) => { handleClick(info, tab); });

async function getOpts() {
  try { return Object.assign({}, DEFAULTS, await chrome.storage.local.get(DEFAULTS)); } catch (e) { return DEFAULTS; }
}

// ---------- bytes helpers ----------
function b64ToBytes(b64) {
  const s = atob(b64); const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
function bytesToB64(u) {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
function dataUrlBytes(url) {
  const i = url.indexOf(',');
  if (i < 0) throw new Error('Broken data address');
  const meta = url.slice(5, i), body = url.slice(i + 1);
  if (/;base64$/i.test(meta)) return b64ToBytes(decodeURIComponent(body).replace(/\s+/g, ''));
  // percent-encoded: turn %XX into bytes, other characters as UTF-8
  const out = [], enc = new TextEncoder();
  for (let k = 0; k < body.length; k++) {
    if (body[k] === '%' && /^[0-9a-f]{2}$/i.test(body.substr(k + 1, 2))) { out.push(parseInt(body.substr(k + 1, 2), 16)); k += 2; }
    else for (const x of enc.encode(body[k])) out.push(x);
  }
  return new Uint8Array(out);
}
function sniffOk(u) {
  if (LOCAL) return !!ifsSniff(u);
  // same checks as convert.js, kept short here for the service worker
  const s = String.fromCharCode.apply(null, u.subarray(0, 4096));
  return /^\x89PNG|^\xFF\xD8\xFF|^GIF8|^RIFF[\s\S]{4}WEBP|^[\s\S]{4}ftypavi[fs]|^BM|^\x00\x00\x01\x00/.test(s) ||
    /^(\xEF\xBB\xBF)?\s*<[\s\S]*<svg[\s>]/i.test(s);
}

// ---------- file name ----------
function baseName(src) {
  if (/^(data|blob):/i.test(src)) return 'image';
  let seg = '', host = '';
  try {
    const u = new URL(src); host = u.hostname.replace(/^www\./, '');
    seg = u.pathname.split('/').filter(Boolean).pop() || '';
    try { seg = decodeURIComponent(seg); } catch (e) { /* keep as is */ }
  } catch (e) { /* not a normal address */ }
  seg = seg.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[\\/:*?"<>|\x00-\x1f\x7f]+/g, '_').replace(/^[\s.]+|[\s.]+$/g, '').slice(0, 120);
  return seg || host.replace(/[^a-z0-9.-]+/gi, '_') || 'image';
}

// ---------- getting the picture ----------
async function fetchFromExtension(src) {
  let r;
  // With cookies first; some servers only allow reading without them, so try that too.
  try { r = await fetch(src, { credentials: 'include', cache: 'force-cache' }); } catch (e) { r = null; }
  if (!r || !r.ok) r = await fetch(src, { credentials: 'omit', cache: 'force-cache' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const u = new Uint8Array(await r.arrayBuffer());
  if (!sniffOk(u)) throw new Error('Not a picture');
  return u;
}

// Runs inside the page (the frame that was right-clicked). Fetches the picture as the page would,
// with its cookies and referrer, then hands back base64 text.
async function pageGrab(src) {
  const toB64 = (u) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const own = (buf) => { const v = new Uint8Array(buf); const o = new Uint8Array(v.length); o.set(v); return o; };  // Firefox: copy out of the page's memory
  const errors = [];
  const fetchers = [];
  try { if (typeof content === 'object' && content && typeof content.fetch === 'function') fetchers.push((u, o) => content.fetch(u, o)); } catch (e) { /* not Firefox */ }
  fetchers.push((u, o) => fetch(u, o));
  const tries = [];
  for (const f of fetchers) for (const credentials of ['include', 'same-origin']) tries.push([f, credentials]);
  for (const [f, credentials] of tries) {
    try {
      const r = await f(src, { credentials });
      if (!r.ok) { errors.push('HTTP ' + r.status); continue; }
      return { b64: toB64(own(await r.arrayBuffer())) };
    } catch (e) { errors.push(String(e && e.message || e)); }
  }
  // Last try: draw the picture the page already shows. Only works when the site allows it.
  const draw = (img) => {
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    const d = c.toDataURL('image/png'); return d.slice(d.indexOf(',') + 1);
  };
  const imgs = document.images;
  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i];
    if ((img.currentSrc === src || img.src === src) && img.complete && img.naturalWidth) {
      try { return { b64: draw(img), drawn: true }; } catch (e) { errors.push('tainted'); break; }
    }
  }
  try {
    const img = new Image(); img.crossOrigin = 'anonymous';
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
    return { b64: draw(img), drawn: true };
  } catch (e) { errors.push('cors'); }
  return { error: errors.join(', ') };
}

async function inPage(target, func, args) {
  const res = await chrome.scripting.executeScript({ target, func, args: args || [] });
  return res && res[0] ? res[0].result : undefined;
}

async function getBytes(src, target) {
  if (/^data:/i.test(src)) return dataUrlBytes(src);
  if (/^https?:/i.test(src)) {
    try { return await fetchFromExtension(src); } catch (e) { /* try the page next */ }
  }
  let r;
  try { r = await inPage(target, pageGrab, [src]); } catch (e) { r = { error: String(e && e.message || e) }; }
  if (r && r.b64) return b64ToBytes(r.b64);
  throw new Error('BLOCKED');
}

// ---------- converting ----------
// Returns { url } (a blob address to download) or { b64 } (PNG bytes for the clipboard).
async function convert(bytes, fmt, quality, want) {
  if (LOCAL) {
    const blob = await ifsConvert(bytes, fmt, quality);
    if (want === 'b64') return { bytes: new Uint8Array(await blob.arrayBuffer()) };
    const url = URL.createObjectURL(blob);
    setTimeout(() => URL.revokeObjectURL(url), 120000);
    return { url };
  }
  busy++; clearTimeout(idleTimer);
  try {
    await ensureOffscreen();
    const r = await chrome.runtime.sendMessage({ target: 'ifs-offscreen', type: 'convert', b64: bytesToB64(bytes), fmt, quality, want });
    if (!r || !r.ok) throw new Error(r && r.error || 'Could not convert this picture.');
    return r;
  } finally { busy--; scheduleClose(); }
}

// ---------- clipboard ----------
// Chrome and Edge: written by the page itself (needs the page to have focus, which it has after a right-click).
async function pageCopy(b64) {
  try {
    const s = atob(b64); const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([u], { type: 'image/png' }) })]);
    return 'ok';
  } catch (e) { return String(e && e.message || e); }
}

async function copyPng(bytes, tab) {
  if (LOCAL && typeof browser === 'object' && browser.clipboard && browser.clipboard.setImageData) {
    await browser.clipboard.setImageData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'png');
    return;
  }
  const r = await inPage({ tabId: tab.id, frameIds: [0] }, pageCopy, [bytesToB64(bytes)]);
  if (r !== 'ok') throw new Error('COPY:' + r);
}

// ---------- small message on the page ----------
function pageToast(text, bad) {
  const id = 'image-format-saver-toast';
  const old = document.getElementById(id); if (old) old.remove();
  const host = document.createElement('div'); host.id = id;
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;right:20px;bottom:20px;';
  const root = host.attachShadow({ mode: 'open' });
  const box = document.createElement('div');
  box.textContent = text;
  box.style.cssText = 'font:600 14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#fff;background:' + (bad ? '#9f1239' : '#4c1d95') +
    ';padding:12px 16px;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.3);max-width:360px;';
  root.appendChild(box);
  (document.body || document.documentElement).appendChild(host);
  setTimeout(() => host.remove(), bad ? 6000 : 2500);
}
function toast(tab, text, bad) {
  if (!tab || tab.id == null || tab.id < 0) return;
  chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, func: pageToast, args: [text, !!bad] }).catch(() => {});
}

// ---------- the menu click ----------
const lastResult = [];   // kept for the automated tests
async function handleClick(info, tab) {
  const id = String(info.menuItemId || '');
  const action = id.replace(/^ifs-/, '');
  if (!['jpg', 'png', 'webp', 'copy'].includes(action)) return;
  const src = info.srcUrl || '';
  const target = { tabId: tab.id, frameIds: [info.frameId || 0] };
  const result = { action, src: src.slice(0, 120) };
  try {
    if (!src) throw new Error('No picture found here.');
    const opts = await getOpts();
    const q = Math.min(100, Math.max(10, Number(opts.quality) || 92)) / 100;
    const bytes = await getBytes(src, target);
    if (action === 'copy') {
      const r = await convert(bytes, 'png', 1, 'b64');
      const png = r.bytes || b64ToBytes(r.b64);
      await copyPng(png, tab);
      toast(tab, 'Copied as PNG');
      result.ok = true; result.size = png.length;
    } else {
      const r = await convert(bytes, action, q, 'url');
      const filename = baseName(src) + '.' + EXT[action];
      const dlId = await chrome.downloads.download({ url: r.url, filename, saveAs: !!opts.saveAs, conflictAction: 'uniquify' });
      result.ok = true; result.filename = filename; result.downloadId = dlId;
      if (!LOCAL) watchDownload(dlId, r.url);
    }
  } catch (e) {
    const m = String(e && e.message || e);
    result.ok = false; result.error = m;
    if (m === 'BLOCKED') toast(tab, 'This site blocks other apps from reading this picture. To allow it, open the Image Format Saver options.', true);
    else if (m.startsWith('COPY:')) toast(tab, 'Could not copy. Click the page once, then try again.', true);
    else toast(tab, 'Image Format Saver: ' + m, true);
  }
  lastResult.push(result);
  if (lastResult.length > 50) lastResult.shift();
  return result;
}

// Toolbar button opens the options page.
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
