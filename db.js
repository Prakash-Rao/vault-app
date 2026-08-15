// db.js — tiny IndexedDB wrapper for Vault, with sync-friendly fields
// (updatedAt on every record, soft-delete tombstones so deletes can sync too)
const DB_NAME = 'vault-db';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('folders')) {
        const fs = db.createObjectStore('folders', { keyPath: 'id' });
        fs.createIndex('order', 'order');
      }
      if (!db.objectStoreNames.contains('items')) {
        const is = db.createObjectStore('items', { keyPath: 'id' });
        is.createIndex('folderId', 'folderId');
        is.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const VaultDB = {
  async init() {
    this.db = await openDB();
    const folders = await this.getFolders();
    if (folders.length === 0) {
      await this.addFolder('Watch Later', '#E8A33D');
      await this.addFolder('Notes', '#6FA8DC');
    }
  },

  tx(storeName, mode) {
    return this.db.transaction(storeName, mode).objectStore(storeName);
  },

  // ---- Meta (sync bookkeeping) ----
  async getMeta(key) {
    return new Promise((resolve, reject) => {
      const req = this.tx('meta', 'readonly').get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => reject(req.error);
    });
  },
  async setMeta(key, value) {
    return new Promise((resolve, reject) => {
      const req = this.tx('meta', 'readwrite').put({ key, value });
      req.onsuccess = () => resolve(value);
      req.onerror = () => reject(req.error);
    });
  },

  // ---- Folders ----
  async getFolders() {
    return new Promise((resolve, reject) => {
      const req = this.tx('folders', 'readonly').getAll();
      req.onsuccess = () => resolve(req.result.filter(f => !f.deleted).sort((a, b) => a.order - b.order));
      req.onerror = () => reject(req.error);
    });
  },

  async getAllFoldersRaw() {
    return new Promise((resolve, reject) => {
      const req = this.tx('folders', 'readonly').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async addFolder(name, color) {
    const folders = await this.getFolders();
    const now = Date.now();
    const folder = {
      id: uid(), name, color: color || '#E8A33D', order: folders.length,
      createdAt: now, updatedAt: now, deleted: false
    };
    return new Promise((resolve, reject) => {
      const req = this.tx('folders', 'readwrite').add(folder);
      req.onsuccess = () => resolve(folder);
      req.onerror = () => reject(req.error);
    });
  },

  async deleteFolder(id) {
    const items = await this.getItemsByFolder(id);
    const now = Date.now();
    const istore = this.tx('items', 'readwrite');
    items.forEach(it => istore.put({ ...it, deleted: true, updatedAt: now }));
    const fstore = this.tx('folders', 'readwrite');
    const getReq = fstore.get(id);
    return new Promise((resolve, reject) => {
      getReq.onsuccess = () => {
        const f = getReq.result;
        if (!f) return resolve();
        const putReq = fstore.put({ ...f, deleted: true, updatedAt: now });
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      };
    });
  },

  async renameFolder(id, name) {
    const store = this.tx('folders', 'readwrite');
    const getReq = store.get(id);
    return new Promise((resolve, reject) => {
      getReq.onsuccess = () => {
        const f = getReq.result;
        f.name = name;
        f.updatedAt = Date.now();
        const putReq = store.put(f);
        putReq.onsuccess = () => resolve(f);
        putReq.onerror = () => reject(putReq.error);
      };
    });
  },

  // ---- Items ----
  async getItemsByFolder(folderId) {
    return new Promise((resolve, reject) => {
      const idx = this.tx('items', 'readonly').index('folderId');
      const req = idx.getAll(folderId);
      req.onsuccess = () => resolve(req.result.filter(it => !it.deleted).sort((a, b) => b.createdAt - a.createdAt));
      req.onerror = () => reject(req.error);
    });
  },

  async getAllItems() {
    return new Promise((resolve, reject) => {
      const req = this.tx('items', 'readonly').getAll();
      req.onsuccess = () => resolve(req.result.filter(it => !it.deleted).sort((a, b) => b.createdAt - a.createdAt));
      req.onerror = () => reject(req.error);
    });
  },

  async getAllItemsRaw() {
    return new Promise((resolve, reject) => {
      const req = this.tx('items', 'readonly').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async addItem(item) {
    const now = Date.now();
    const full = { id: uid(), createdAt: now, updatedAt: now, deleted: false, ...item };
    return new Promise((resolve, reject) => {
      const req = this.tx('items', 'readwrite').add(full);
      req.onsuccess = () => resolve(full);
      req.onerror = () => reject(req.error);
    });
  },

  async updateItem(item) {
    item.updatedAt = Date.now();
    return new Promise((resolve, reject) => {
      const req = this.tx('items', 'readwrite').put(item);
      req.onsuccess = () => resolve(item);
      req.onerror = () => reject(req.error);
    });
  },

  async deleteItem(id) {
    const store = this.tx('items', 'readwrite');
    const getReq = store.get(id);
    return new Promise((resolve, reject) => {
      getReq.onsuccess = () => {
        const it = getReq.result;
        if (!it) return resolve();
        const putReq = store.put({ ...it, deleted: true, updatedAt: Date.now() });
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      };
    });
  },

  async searchItems(query) {
    const all = await this.getAllItems();
    const q = query.toLowerCase();
    return all.filter(it =>
      (it.title || '').toLowerCase().includes(q) ||
      (it.text || '').toLowerCase().includes(q) ||
      (it.url || '').toLowerCase().includes(q)
    );
  },

  // ---- Sync helpers ----
  // Upsert a record coming from the server (last-write-wins by updatedAt)
  async upsertFromServer(storeName, record) {
    const store = this.tx(storeName, 'readwrite');
    const getReq = store.get(record.id);
    return new Promise((resolve, reject) => {
      getReq.onsuccess = () => {
        const existing = getReq.result;
        if (existing && existing.updatedAt > record.updatedAt) { resolve(); return; }
        const putReq = store.put(record);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }
};
