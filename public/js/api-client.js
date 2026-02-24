/**
 * BOOKT API CLIENT
 * Shared across all frontend pages.
 * Handles: auth tokens, API calls, error handling, session management.
 *
 * Usage:
 *   <script src="/js/api-client.js"></script>
 *   const api = new BooktAPI();
 *   const data = await api.signup({ ... });
 *   const dashboard = await api.getDashboard();
 */

class BooktAPI {
  constructor(baseURL = '') {
    // Auto-detect base URL (same origin in production, configurable for dev)
    this.baseURL = baseURL || window.location.origin;
    this.tokenKey = 'bookt_token';
    this.userKey = 'bookt_user';
    this.bizKey = 'bookt_business';
  }

  // ============================================================
  // TOKEN MANAGEMENT
  // ============================================================

  getToken() {
    return localStorage.getItem(this.tokenKey);
  }

  setToken(token) {
    localStorage.setItem(this.tokenKey, token);
  }

  clearToken() {
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem(this.userKey);
    localStorage.removeItem(this.bizKey);
  }

  getUser() {
    try { return JSON.parse(localStorage.getItem(this.userKey)); }
    catch { return null; }
  }

  setUser(user) {
    localStorage.setItem(this.userKey, JSON.stringify(user));
  }

  getBusiness() {
    try { return JSON.parse(localStorage.getItem(this.bizKey)); }
    catch { return null; }
  }

  setBusiness(biz) {
    localStorage.setItem(this.bizKey, JSON.stringify(biz));
  }

  isLoggedIn() {
    const token = this.getToken();
    if (!token) return false;
    // Check expiry (JWT decode without verification — just for UI)
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp * 1000 > Date.now();
    } catch {
      return false;
    }
  }

  logout() {
    this.clearToken();
    window.location.href = '/login.html';
  }

  // ============================================================
  // HTTP HELPERS
  // ============================================================

  async _fetch(method, path, body = null, options = {}) {
    const url = `${this.baseURL}${path}`;
    const headers = { 'Content-Type': 'application/json' };

    // Add auth token for staff routes
    if (!options.noAuth) {
      const token = this.getToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    const config = { method, headers };
    if (body && method !== 'GET') {
      config.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, config);

      // Handle common error codes
      if (response.status === 401) {
        // Token expired or invalid
        if (!options.noAuth) {
          this.clearToken();
          if (!options.silent401) {
            window.location.href = '/login.html?expired=1';
          }
        }
        throw new APIError('Session expirée', 401);
      }

      if (response.status === 403) {
        throw new APIError('Accès non autorisé', 403);
      }

      if (response.status === 429) {
        throw new APIError('Trop de requêtes, réessayez dans un moment', 429);
      }

      const data = await response.json();

      if (!response.ok) {
        throw new APIError(data.error || `Erreur ${response.status}`, response.status, data);
      }

      return data;
    } catch (err) {
      if (err instanceof APIError) throw err;
      // Network error
      throw new APIError('Erreur réseau — vérifiez votre connexion', 0);
    }
  }

  get(path, options) { return this._fetch('GET', path, null, options); }
  post(path, body, options) { return this._fetch('POST', path, body, options); }
  patch(path, body, options) { return this._fetch('PATCH', path, body, options); }
  delete(path, options) { return this._fetch('DELETE', path, null, options); }

  // ============================================================
  // AUTH
  // ============================================================

  async signup(data) {
    const result = await this.post('/api/auth/signup', data, { noAuth: true });
    this.setToken(result.token);
    this.setUser(result.user);
    this.setBusiness(result.business);
    return result;
  }

  async login(email, password) {
    const result = await this.post('/api/auth/login', { email, password }, { noAuth: true });
    this.setToken(result.token);
    this.setUser(result.user);
    this.setBusiness(result.business);
    return result;
  }

  // ============================================================
  // DASHBOARD
  // ============================================================

  async getDashboard() {
    return this.get('/api/dashboard');
  }

  // ============================================================
  // BOOKINGS (staff)
  // ============================================================

  async getBookings(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/api/bookings${qs ? '?' + qs : ''}`);
  }

  async getBooking(id) {
    return this.get(`/api/bookings/${id}`);
  }

  async createBooking(data) {
    return this.post('/api/bookings', data);
  }

  async updateBookingStatus(id, status, reason) {
    return this.patch(`/api/bookings/${id}/status`, { status, reason });
  }

  // ============================================================
  // SERVICES (staff)
  // ============================================================

  async getServices() {
    return this.get('/api/services');
  }

  async createService(data) {
    return this.post('/api/services', data);
  }

  async updateService(id, data) {
    return this.patch(`/api/services/${id}`, data);
  }

  async deleteService(id) {
    return this.delete(`/api/services/${id}`);
  }

  // ============================================================
  // CLIENTS (staff)
  // ============================================================

  async getClients(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/api/clients${qs ? '?' + qs : ''}`);
  }

  async getClient(id) {
    return this.get(`/api/clients/${id}`);
  }

  // ============================================================
  // AVAILABILITY (staff)
  // ============================================================

  async getAvailabilities() {
    return this.get('/api/availabilities');
  }

  async setAvailabilities(data) {
    return this.post('/api/availabilities', data);
  }

  async getExceptions() {
    return this.get('/api/availabilities/exceptions');
  }

  async createException(data) {
    return this.post('/api/availabilities/exceptions', data);
  }

  async deleteException(id) {
    return this.delete(`/api/availabilities/exceptions/${id}`);
  }

  // ============================================================
  // BUSINESS SETTINGS (staff)
  // ============================================================

  async getSettings() {
    return this.get('/api/business');
  }

  async updateSettings(data) {
    return this.patch('/api/business', data);
  }

  // ============================================================
  // CALLS (staff)
  // ============================================================

  async getCallSettings() {
    return this.get('/api/calls/settings');
  }

  async updateCallSettings(data) {
    return this.patch('/api/calls/settings', data);
  }

  async getCallLogs(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/api/calls/logs${qs ? '?' + qs : ''}`);
  }

  async getCallStats() {
    return this.get('/api/calls/stats');
  }

  // ============================================================
  // SITE MANAGEMENT (staff)
  // ============================================================

  // Testimonials
  async getTestimonials() {
    return this.get('/api/site/testimonials');
  }

  async createTestimonial(data) {
    return this.post('/api/site/testimonials', data);
  }

  async updateTestimonial(id, data) {
    return this.patch(`/api/site/testimonials/${id}`, data);
  }

  async deleteTestimonial(id) {
    return this.delete(`/api/site/testimonials/${id}`);
  }

  // Specializations
  async getSpecializations() {
    return this.get('/api/site/specializations');
  }

  async createSpecialization(data) {
    return this.post('/api/site/specializations', data);
  }

  async updateSpecialization(id, data) {
    return this.patch(`/api/site/specializations/${id}`, data);
  }

  async deleteSpecialization(id) {
    return this.delete(`/api/site/specializations/${id}`);
  }

  // Value Propositions
  async getValues() {
    return this.get('/api/site/values');
  }

  async createValue(data) {
    return this.post('/api/site/values', data);
  }

  async updateValue(id, data) {
    return this.patch(`/api/site/values/${id}`, data);
  }

  async deleteValue(id) {
    return this.delete(`/api/site/values/${id}`);
  }

  // Page Sections
  async getSections() {
    return this.get('/api/site/sections');
  }

  async updateSections(data) {
    return this.patch('/api/site/sections', data);
  }

  // Custom Domain
  async getDomain() {
    return this.get('/api/site/domain');
  }

  async setDomain(domain) {
    return this.post('/api/site/domain', { domain });
  }

  async verifyDomain() {
    return this.post('/api/site/domain/verify');
  }

  async deleteDomain() {
    return this.delete('/api/site/domain');
  }

  // Practitioners (extended)
  async updatePractitioner(id, data) {
    return this.patch(`/api/site/practitioners/${id}`, data);
  }

  // Onboarding
  async getOnboarding() {
    return this.get('/api/site/onboarding');
  }

  async updateOnboarding(step) {
    return this.patch('/api/site/onboarding', { step });
  }

  // ============================================================
  // PUBLIC API (no auth — for booking flow)
  // ============================================================

  async getPublicSite(slug) {
    return this.get(`/api/public/${slug}`, { noAuth: true });
  }

  async getPublicSlots(slug, params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/api/public/${slug}/slots${qs ? '?' + qs : ''}`, { noAuth: true });
  }

  async createPublicBooking(slug, data) {
    return this.post(`/api/public/${slug}/bookings`, data, { noAuth: true });
  }

  async cancelPublicBooking(slug, token) {
    return this.post(`/api/public/${slug}/bookings/cancel`, { token }, { noAuth: true });
  }
}

// ============================================================
// API ERROR CLASS
// ============================================================

class APIError extends Error {
  constructor(message, status, data = null) {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.data = data;
  }
}

// ============================================================
// UI HELPERS
// ============================================================

const BooktUI = {
  /**
   * Show a toast notification
   */
  toast(message, type = 'info', duration = 4000) {
    // Remove existing toasts
    document.querySelectorAll('.bookt-toast').forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = `bookt-toast bookt-toast-${type}`;
    toast.innerHTML = `
      <span class="bookt-toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✕' : type === 'warning' ? '⚠' : 'ℹ'}</span>
      <span class="bookt-toast-msg">${message}</span>
    `;

    // Add styles if not already present
    if (!document.getElementById('bookt-toast-styles')) {
      const style = document.createElement('style');
      style.id = 'bookt-toast-styles';
      style.textContent = `
        .bookt-toast { position:fixed; top:20px; right:20px; z-index:10000; padding:12px 20px; border-radius:10px; font-family:'Plus Jakarta Sans',-apple-system,sans-serif; font-size:0.85rem; font-weight:500; display:flex; align-items:center; gap:8px; box-shadow:0 4px 20px rgba(0,0,0,0.12); animation:booktToastIn 0.3s ease-out; max-width:400px; }
        .bookt-toast-success { background:#EEFAF1; color:#1B7A42; border:1px solid #B8E6C4; }
        .bookt-toast-error { background:#FEF2F2; color:#DC2626; border:1px solid #FECACA; }
        .bookt-toast-warning { background:#FAF6EC; color:#A68B3C; border:1px solid #E8DCBA; }
        .bookt-toast-info { background:#EFF9F8; color:#0D7377; border:1px solid #B8DDD9; }
        .bookt-toast-icon { font-weight:700; }
        @keyframes booktToastIn { from { opacity:0; transform:translateY(-10px) translateX(20px); } to { opacity:1; transform:translateY(0) translateX(0); } }
        @keyframes booktToastOut { from { opacity:1; } to { opacity:0; transform:translateX(20px); } }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'booktToastOut 0.3s ease-in forwards';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  /**
   * Show loading state on a button
   */
  btnLoading(btn, loading = true) {
    if (loading) {
      btn.dataset.originalText = btn.textContent;
      btn.disabled = true;
      btn.style.opacity = '0.7';
      btn.textContent = 'Chargement...';
    } else {
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.textContent = btn.dataset.originalText || btn.textContent;
    }
  },

  /**
   * Format price from cents
   */
  formatPrice(cents) {
    if (!cents && cents !== 0) return 'Gratuit';
    return new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
  },

  /**
   * Format date
   */
  formatDate(dateStr) {
    return new Intl.DateTimeFormat('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(dateStr));
  },

  /**
   * Format time
   */
  formatTime(timeStr) {
    return timeStr.slice(0, 5);
  },

  /**
   * Require auth — redirect to login if not logged in
   */
  requireAuth() {
    const api = new BooktAPI();
    if (!api.isLoggedIn()) {
      window.location.href = '/login.html?redirect=' + encodeURIComponent(window.location.pathname);
      return false;
    }
    return true;
  }
};

// Export for module systems (if needed)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BooktAPI, APIError, BooktUI };
}
