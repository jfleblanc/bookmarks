// Capture de la page depuis votre propre navigateur : pas de blocage anti-robots, et moins de travail pour le serveur.
// Fonctionne dans la fenêtre de l'extension et dans le service worker (OffscreenCanvas).

const W = 512, H = 384; // même format que les vignettes du serveur (4:3, ~20 à 50 Ko)

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * mode « top » : remonte en haut de la page, capture, puis revient où vous étiez.
 * mode « view » : capture exactement ce que vous voyez.
 * Retourne une image JPEG en data URL, ou null si la page ne se laisse pas capturer.
 */
export async function captureTab(tab, mode = 'top') {
  let scrolled = false;
  try {
    if (mode === 'top') {
      try {
        const [r] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const y = window.scrollY;
            if (y < 4) return false;
            window.__bmScrollY = y;
            window.scrollTo({ top: 0, left: window.scrollX, behavior: 'instant' });
            return true;
          }
        });
        scrolled = !!r?.result;
        if (scrolled) await sleep(450); // laisse la page se redessiner (menus collants, images)
      } catch { /* page protégée (boutique d'extensions, PDF…) : on capture ce qui est visible */ }
    }
    const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 92 });
    return await shrink(shot);
  } catch {
    return null;
  } finally {
    if (scrolled) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => { window.scrollTo({ top: window.__bmScrollY || 0, left: window.scrollX, behavior: 'instant' }); delete window.__bmScrollY; }
      }).catch(() => {});
    }
  }
}

/** Recadre en 4:3 depuis le haut et réduit à 512 × 384 */
async function shrink(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  let sw = bmp.width, sh = Math.round(bmp.width * 0.75), sx = 0;
  if (sh > bmp.height) { sh = bmp.height; sw = Math.round(sh / 0.75); sx = Math.round((bmp.width - sw) / 2); }
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, sx, 0, sw, sh, 0, 0, W, H);
  bmp.close?.();
  const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
  const bytes = new Uint8Array(await out.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return 'data:image/jpeg;base64,' + btoa(bin);
}
