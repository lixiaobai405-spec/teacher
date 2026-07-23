class AuthClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookie = '';
    this.preAuthCsrfToken = '';
    this.sessionCsrfToken = '';
  }

  async request(path, { method = 'GET', body, csrfToken, cookie = this.cookie } = {}) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    if (method !== 'GET' && method !== 'HEAD') headers.origin = this.baseUrl;
    if (csrfToken) headers['x-csrf-token'] = csrfToken;

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      const cookiePair = setCookie.split(';', 1)[0];
      this.cookie = /Max-Age=0/i.test(setCookie) ? '' : cookiePair;
    }
    return response;
  }

  async getPreAuthCsrf() {
    const response = await this.request('/api/auth/csrf');
    const payload = await response.json();
    this.preAuthCsrfToken = payload.csrfToken;
    return payload.csrfToken;
  }

  async register(username, password) {
    if (!this.preAuthCsrfToken) await this.getPreAuthCsrf();
    return this.request('/api/auth/register', {
      method: 'POST',
      csrfToken: this.preAuthCsrfToken,
      body: { username, password },
    });
  }

  async login(username, password) {
    if (!this.preAuthCsrfToken) await this.getPreAuthCsrf();
    return this.request('/api/auth/login', {
      method: 'POST',
      csrfToken: this.preAuthCsrfToken,
      body: { username, password },
    });
  }

  async me() {
    const response = await this.request('/api/auth/me');
    if (response.ok) {
      const payload = await response.clone().json();
      this.sessionCsrfToken = payload.csrfToken;
    }
    return response;
  }

  logout() {
    return this.request('/api/auth/logout', {
      method: 'POST',
      csrfToken: this.sessionCsrfToken,
    });
  }
}

module.exports = { AuthClient };
