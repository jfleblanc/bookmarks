// Adresse de votre app bookmarks. Si vous la changez, changez aussi « host_permissions » dans manifest.json.
export const SERVER = 'https://bookmarks.jfleblanc.com';

/** Le jeton est gardé seulement sur cet ordinateur (chrome.storage.local, jamais synchronisé) */
export async function getAuth() {
  const { token, email } = await chrome.storage.local.get(['token', 'email']);
  return token ? { token, email } : null;
}
export async function setAuth(token, email) {
  await chrome.storage.local.set({ token, email });
}
export async function clearAuth() {
  await chrome.storage.local.remove(['token', 'email']);
}

export class ApiError extends Error {
  constructor(status, code, message, data) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export async function call(method, path, body, token) {
  const t = token || (await getAuth())?.token;
  if (!t) throw new ApiError(401, 'no_token', 'Extension non connectée.');
  let res;
  try {
    res = await fetch(SERVER + path, {
      method,
      headers: { authorization: `Bearer ${t}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'omit'
    });
  } catch {
    throw new ApiError(0, 'network', 'bookmarks est injoignable. Vérifiez votre connexion.');
  }
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error || 'error', data?.message || 'Une erreur est survenue.', data);
  return data;
}

export const isSavable = url => /^https?:\/\//i.test(url || '');
