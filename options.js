'use strict';
const DEFAULTS = { quality: 92, saveAs: false };
const ALL = { origins: ['<all_urls>'] };
const $ = (id) => document.getElementById(id);
let t;
function saved() { $('saved').textContent = 'Saved'; clearTimeout(t); t = setTimeout(() => { $('saved').textContent = ''; }, 1500); }
async function load() {
  const o = Object.assign({}, DEFAULTS, await chrome.storage.local.get(DEFAULTS));
  $('q').value = o.quality; $('qv').textContent = o.quality; $('saveAs').checked = !!o.saveAs;
  await showHost();
}
async function showHost() {
  const on = await chrome.permissions.contains(ALL);
  $('host').textContent = on ? 'Turn off' : 'Allow';
  $('host').className = on ? 'ghost' : 'primary';
}
$('q').addEventListener('input', () => { $('qv').textContent = $('q').value; });
$('q').addEventListener('change', async () => { await chrome.storage.local.set({ quality: Number($('q').value) }); saved(); });
$('saveAs').addEventListener('change', async () => { await chrome.storage.local.set({ saveAs: $('saveAs').checked }); saved(); });
$('host').addEventListener('click', async () => {
  try {
    if (await chrome.permissions.contains(ALL)) await chrome.permissions.remove(ALL);
    else await chrome.permissions.request(ALL);
  } catch (e) { /* the browser said no */ }
  await showHost();
});
load();
