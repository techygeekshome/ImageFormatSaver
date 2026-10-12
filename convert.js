// Image Format Saver: turns image bytes into a JPG, PNG or WebP file.
// Runs where there is a DOM: the offscreen page in Chrome and Edge, the background page in Firefox.
// Everything happens on your computer. Nothing is uploaded.
'use strict';

const IFS_TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const IFS_SVG_MIN = 1024;       // SVG pictures are drawn at least this many pixels across
const IFS_MAX_SIDE = 16384;     // biggest canvas side browsers allow
const IFS_MAX_AREA = 16384 * 16384 / 2;

// Works out what an image really is from its first bytes.
function ifsSniff(b) {
  const at = (i, s) => { for (let k = 0; k < s.length; k++) if (b[i + k] !== s.charCodeAt(k)) return false; return true; };
  if (b.length < 4) return '';
  if (b[0] === 0x89 && at(1, 'PNG')) return 'image/png';
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (at(0, 'GIF8')) return 'image/gif';
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp';
  if (at(4, 'ftyp') && (at(8, 'avif') || at(8, 'avis'))) return 'image/avif';
  if (at(0, 'BM')) return 'image/bmp';
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'image/x-icon';
  // SVG is text: look for an <svg> tag near the start
  let head = '';
  const n = Math.min(b.length, 4096);
  for (let i = 0; i < n; i++) head += String.fromCharCode(b[i]);
  head = head.replace(/^﻿|^\xEF\xBB\xBF/, '').trimStart();
  if (head[0] === '<' && /<svg[\s>]/i.test(head)) return 'image/svg+xml';
  return '';
}

// Gives an SVG a fixed size in pixels, so every browser can draw it on a canvas.
function ifsFixSvg(text) {
  let doc;
  try { doc = new DOMParser().parseFromString(text, 'image/svg+xml'); } catch (e) { return { text, w: 0, h: 0 }; }
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) return { text, w: 0, h: 0 };
  const px = (v) => { const m = /^\s*([\d.]+)\s*(px)?\s*$/.exec(v || ''); return m ? parseFloat(m[1]) : 0; };
  let w = px(root.getAttribute('width')), h = px(root.getAttribute('height'));
  const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const vw = vb.length === 4 && vb[2] > 0 ? vb[2] : 0, vh = vb.length === 4 && vb[3] > 0 ? vb[3] : 0;
  if (!w && !h) { w = vw || 300; h = vh || 150; }
  else if (!w) w = vw && vh ? h * vw / vh : h;
  else if (!h) h = vw && vh ? w * vh / vw : w;
  if (!vw && !vh && !root.getAttribute('viewBox')) root.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const scale = Math.max(1, IFS_SVG_MIN / Math.max(w, h));
  w = Math.round(w * scale); h = Math.round(h * scale);
  root.setAttribute('width', String(w)); root.setAttribute('height', String(h));
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return { text: new XMLSerializer().serializeToString(doc), w, h };
}

function ifsLoadImg(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This browser cannot open this picture.'));
    img.src = url;
  });
}

// bytes: Uint8Array. fmt: 'jpg' | 'png' | 'webp'. quality: 0 to 1. Returns a Blob.
async function ifsConvert(bytes, fmt, quality) {
  const outType = IFS_TYPES[fmt];
  if (!outType) throw new Error('Unknown format');
  const mime = ifsSniff(bytes);
  let blob, w = 0, h = 0;
  if (mime === 'image/svg+xml') {
    const fixed = ifsFixSvg(new TextDecoder().decode(bytes));
    blob = new Blob([fixed.text], { type: mime }); w = fixed.w; h = fixed.h;
  } else {
    blob = new Blob([bytes], mime ? { type: mime } : {});
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await ifsLoadImg(url);
    w = w || img.naturalWidth; h = h || img.naturalHeight;
    if (!w || !h) throw new Error('This picture has no size, so it cannot be converted.');
    if (w > IFS_MAX_SIDE || h > IFS_MAX_SIDE || w * h > IFS_MAX_AREA) throw new Error('This picture is too big to convert in the browser.');
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (fmt === 'jpg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }   // JPG has no see-through parts
    ctx.drawImage(img, 0, 0, w, h);
    const out = await new Promise((r) => canvas.toBlob(r, outType, fmt === 'png' ? undefined : quality));
    if (!out || out.type !== outType) throw new Error('This browser cannot make ' + fmt.toUpperCase() + ' files.');
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}
