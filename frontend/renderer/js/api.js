// Talks to the Hub API. Session = { token, user, apps }.
const api = {
  baseUrl: '',
  token: null,
  // Set by app.js: called when the session is no longer valid.
  onUnauthorized: () => {},
  onMustChangePassword: () => {},

  async request(method, path, body) {
    let res;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error(`Serveur injoignable (${this.baseUrl}). Vérifiez que vous êtes sur le réseau Tacquet.`);
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && this.token) this.onUnauthorized();
    if (res.status === 403 && data.code === 'MUST_CHANGE_PASSWORD') this.onMustChangePassword();
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
    return data;
  },

  get(path) { return this.request('GET', path); },
  post(path, body = {}) { return this.request('POST', path, body); },
  put(path, body = {}) { return this.request('PUT', path, body); },
  patch(path, body = {}) { return this.request('PATCH', path, body); },

  // <img> can't send the auth header, so screenshots are fetched as blobs.
  async imageUrl(path) {
    const res = await fetch(`${this.baseUrl}${path}`, { headers: { Authorization: `Bearer ${this.token}` } });
    if (!res.ok) return null;
    return URL.createObjectURL(await res.blob());
  },
};
