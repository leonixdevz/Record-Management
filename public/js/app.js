const api = {
    async request(endpoint, options = {}) {
        const token = localStorage.getItem('token');
        const headers = { 'Content-Type': 'application/json', ...options.headers };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(endpoint, { ...options, headers });
        if (res.status === 401) {
            localStorage.removeItem('token');
            window.location.href = '/';
            throw new Error('Session expired');
        }
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Request failed');
        }
        return res.status === 204 ? null : res.json();
    },

    async login(username, password) {
        return this.request('/api/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
    },

    async logout() {
        return this.request('/api/logout', { method: 'POST' });
    },

    async getCollections() {
        return this.request('/api/collections');
    },

    async createCollection(data) {
        return this.request('/api/collections', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async deleteCollection(id) {
        return this.request(`/api/collections/${id}`, { method: 'DELETE' });
    },

    async getRecords(colId, search = '', filter = '') {
        return this.request(`/api/records/${colId}?search=${encodeURIComponent(search)}&filter=${encodeURIComponent(filter)}`);
    },

    async addRecord(colId, data) {
        return this.request(`/api/records/${colId}`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async updateRecord(colId, recId, data) {
        return this.request(`/api/records/${colId}/${recId}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },

    async deleteRecord(colId, recId) {
        return this.request(`/api/records/${colId}/${recId}`, { method: 'DELETE' });
    },

    async exportRecords(colId) {
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/records/${colId}/export`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `export_${colId}.json`;
        a.click();
    },

    async importRecords(colId, data) {
        return this.request(`/api/records/${colId}/import`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async deduplicate(colId, field) {
        return this.request(`/api/records/${colId}/deduplicate`, {
            method: 'POST',
            body: JSON.stringify({ field })
        });
    }
};

function closeModal() {
    document.getElementById('modalOverlay').classList.add('hidden');
}
