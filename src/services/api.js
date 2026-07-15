const API_BASE = '/api';

async function request(endpoint, options = {}) {
  const token = localStorage.getItem('auvia_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    localStorage.removeItem('auvia_token');
    localStorage.removeItem('auvia_user');
    if (!window.location.pathname.endsWith('/login')) {
      window.location.href = '/login';
    }
    throw new Error('Unauthorized');
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'API Request failed');
  }

  return data;
}

export const api = {
  // Auth
  async login(email, password) {
    const data = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (data.token) {
      localStorage.setItem('auvia_token', data.token);
      localStorage.setItem('auvia_user', JSON.stringify(data.user));
    }
    return data;
  },

  async register(fullName, email, password) {
    const data = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ fullName, email, password }),
    });
    if (data.token) {
      localStorage.setItem('auvia_token', data.token);
      localStorage.setItem('auvia_user', JSON.stringify(data.user));
    }
    return data;
  },

  logout() {
    localStorage.removeItem('auvia_token');
    localStorage.removeItem('auvia_user');
    window.location.href = '/login';
  },

  getCurrentUser() {
    try {
      const u = localStorage.getItem('auvia_user');
      return u ? JSON.parse(u) : null;
    } catch {
      return null;
    }
  },

  async getMe() {
    return request('/auth/me');
  },

  // Campaigns
  async getCampaigns() {
    return request('/campaigns');
  },

  async getCampaign(id) {
    return request(`/campaigns/${id}`);
  },

  async createCampaign(name) {
    return request('/campaigns', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },

  async getContacts(campaignId) {
    return request(`/campaigns/${campaignId}/contacts`);
  },

  async uploadContacts(campaignId, contacts, filename) {
    return request(`/campaigns/${campaignId}/contacts`, {
      method: 'POST',
      body: JSON.stringify({ contacts, filename }),
    });
  },

  async toggleContactSelection(campaignId, contactId, isSelected) {
    return request(`/campaigns/${campaignId}/contacts/toggle`, {
      method: 'PUT',
      body: JSON.stringify({ contactId, isSelected }),
    });
  },

  async getCampaignSummary(campaignId) {
    return request(`/campaigns/${campaignId}/summary`);
  },

  async getLiveCampaign(campaignId) {
    return request(`/campaigns/${campaignId}/live`);
  },

  async startCampaign(campaignId) {
    return request(`/campaigns/${campaignId}/start`, {
      method: 'POST',
    });
  },

  async startCampaign(campaignId) {
    return request(`/campaigns/${campaignId}/start`, {
      method: 'POST',
    });
  },

  async stopCampaign(campaignId) {
    return request(`/campaigns/${campaignId}/stop`, {
      method: 'POST',
    });
  },

  async deleteCampaign(campaignId) {
    return request(`/campaigns/${campaignId}`, {
      method: 'DELETE',
    });
  },

  // Voice Bot
  async startVoiceBot(campaignId, contactId = null) {
    return request('/voice/start', {
      method: 'POST',
      body: JSON.stringify({ campaignId, ...(contactId ? { contactId } : {}) }),
    });
  },


  async stopVoiceBot(campaignId) {
    return request('/voice/stop', {
      method: 'POST',
      body: JSON.stringify({ campaignId }),
    });
  },

  async getVoiceBotStatus(campaignId) {
    return request(`/voice/status?campaignId=${campaignId}`);
  },

  async getCampaignReport(campaignId) {
    return request(`/campaigns/${campaignId}/report`);
  },

  // Calls
  async getCalls() {
    return request('/calls');
  },

  async getCall(id) {
    return request(`/calls/${id}`);
  },

  async getCallbackQueue() {
    return request('/calls/callback/queue');
  },

  async saveCallFeedback(callId, { notes, outcome, callbackDate, callbackTime }) {
    return request(`/calls/${callId}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ notes, outcome, callbackDate, callbackTime }),
    });
  },

  // Settings
  async getSettings() {
    return request('/settings');
  },

  async saveSettings(settings) {
    return request('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  },

  async getBillingHistory() {
    return request('/settings/billing-history');
  },

  async rechargeCredits(credits, amount) {
    return request('/settings/recharge', {
      method: 'POST',
      body: JSON.stringify({ credits, amount }),
    });
  },

  // Users
  async getUsers() {
    return request('/users');
  },

  async inviteUser({ name, email, role }) {
    return request('/users', {
      method: 'POST',
      body: JSON.stringify({ name, email, role }),
    });
  },

  async removeUser(id) {
    return request(`/users/${id}`, {
      method: 'DELETE',
    });
  },

  // Platform Admin
  async getAdminClinics() {
    return request('/admin/clinics');
  },

  async getAdminClinic(id) {
    return request(`/admin/clinics/${id}`);
  },

  async updateAdminClinic(id, data) {
    return request(`/admin/clinics/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async getAdminClinicCalls(id) {
    return request(`/admin/clinics/${id}/calls`);
  },

  async getAdminClinicAuditLogs(id) {
    return request(`/admin/clinics/${id}/audit-logs`);
  },

  async getAdminClinicActivityLogs(id) {
    return request(`/admin/clinics/${id}/activity-logs`);
  },

  async getAdminClinicCreditTransactions(id) {
    return request(`/admin/clinics/${id}/credit-transactions`);
  },

  async getAdminAnalytics(startDate, endDate) {
    let query = '';
    if (startDate && endDate) {
      query = `?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
    }
    return request(`/admin/analytics${query}`);
  },

  async getAdminUsers() {
    return request('/admin/users');
  },

  async updateAdminUserStatus(id, status) {
    return request(`/admin/users/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
  },

  async updateAdminUser(id, data) {
    return request(`/admin/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async getAdminCredits() {
    return request('/admin/credits');
  },


  async grantAdminCredits(clinicId, credits, note) {
    return request('/admin/credits/grant', {
      method: 'POST',
      body: JSON.stringify({ clinic_id: clinicId, credits, note }),
    });
  },

  async getAdminDashboard() {
    return request('/admin/dashboard');
  },
};


/**
 * Fetch a call recording via the authenticated proxy and return a Blob Object URL.
 * new Audio() cannot send Authorization headers, so we must fetch the audio
 * ourselves with the token, convert to a Blob, then create an object URL.
 */
export async function fetchRecordingBlobUrl(callId) {
  const token = localStorage.getItem('auvia_token');
  const response = await fetch(`/api/calls/${callId}/recording`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error(`Recording fetch failed: ${response.status}`);
  }

  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

