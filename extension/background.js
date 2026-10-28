import { call, getAuth, isSavable } from './api.js';

// Clic droit : ajouter la page ou un lien sans ouvrir la fenêtre
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'add-page', title: 'Ajouter cette page à bookmarks', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'add-link', title: 'Ajouter ce lien à bookmarks', contexts: ['link'] });
  });
});

async function badge(tabId, text, color, title) {
  const opts = tabId ? { tabId } : {};
  await chrome.action.setBadgeBackgroundColor({ ...opts, color });
  await chrome.action.setBadgeText({ ...opts, text });
  if (title) await chrome.action.setTitle({ ...opts, title });
  setTimeout(() => {
    chrome.action.setBadgeText({ ...opts, text: '' });
    chrome.action.setTitle({ ...opts, title: 'Ajouter à bookmarks (Alt+Maj+B)' });
  }, 4000);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.menuItemId === 'add-link' ? info.linkUrl : info.pageUrl || tab?.url;
  const tabId = tab?.id;
  if (!isSavable(url)) return badge(tabId, '!', '#B42318', 'Cette adresse ne peut pas être enregistrée.');
  if (!(await getAuth())) return badge(tabId, '!', '#B42318', 'Ouvrez l’extension pour la connecter à votre compte.');
  try {
    await call('POST', '/api/bookmarks', { url, tags: [] });
    badge(tabId, '✓', '#0A7C55', 'Ajouté à bookmarks.');
  } catch (e) {
    if (e.code === 'duplicate') badge(tabId, '=', '#5E5E5E', 'Déjà dans vos signets.');
    else badge(tabId, '!', '#B42318', e.message);
  }
});
