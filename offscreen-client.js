// Chrome and Edge only: opens and closes the hidden offscreen page that converts pictures.
'use strict';

let offscreenReady = null;
async function ensureOffscreen() {
  if (offscreenReady) return offscreenReady;
  offscreenReady = (async () => {
    const have = chrome.runtime.getContexts ? await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }) : [];
    if (!have.length) {
      await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['BLOBS'],
        justification: 'Convert pictures to JPG, PNG or WebP on this computer.' });
    }
  })();
  try { await offscreenReady; } catch (e) { offscreenReady = null; throw e; }
  return offscreenReady;
}

let idleTimer = null, busy = 0;
function scheduleClose() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    if (busy) return;
    try { await chrome.offscreen.closeDocument(); } catch (e) { /* already closed */ }
    offscreenReady = null;
  }, 60000);
}

// Chrome: tell the offscreen page to free the picture once the download has finished.
function watchDownload(dlId, url) {
  const done = () => { chrome.downloads.onChanged.removeListener(on); chrome.runtime.sendMessage({ target: 'ifs-offscreen', type: 'revoke', url }).catch(() => {}); };
  const on = (d) => { if (d.id === dlId && d.state && d.state.current !== 'in_progress') done(); };
  chrome.downloads.onChanged.addListener(on);
}

