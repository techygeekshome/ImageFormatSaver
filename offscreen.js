// Chrome and Edge only: a hidden page with a DOM, used to convert pictures on this computer.
'use strict';
const urls = new Set();
function b64ToBytes(b64) { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
function blobToB64(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
}
chrome.runtime.onMessage.addListener((msg, sender, send) => {
  if (!msg || msg.target !== 'ifs-offscreen') return;
  if (msg.type === 'revoke') { if (urls.delete(msg.url)) URL.revokeObjectURL(msg.url); return; }
  if (msg.type !== 'convert') return;
  (async () => {
    const blob = await ifsConvert(b64ToBytes(msg.b64), msg.fmt, msg.quality);
    if (msg.want === 'b64') return { ok: true, b64: await blobToB64(blob) };
    const url = URL.createObjectURL(blob); urls.add(url);
    setTimeout(() => { if (urls.delete(url)) URL.revokeObjectURL(url); }, 600000);
    return { ok: true, url };
  })().then(send, (e) => send({ ok: false, error: String(e && e.message || e) }));
  return true;
});
