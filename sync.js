// sync.js — cloud backup & sync against the Vault FastAPI backend

const VaultSync = {
  getSettings() {
    return {
      serverUrl: (localStorage.getItem('vault-server-url') || '').replace(/\/$/, ''),
      apiKey: localStorage.getItem('vault-api-key') || ''
    };
  },

  saveSettings(serverUrl, apiKey) {
    localStorage.setItem('vault-server-url', serverUrl.replace(/\/$/, ''));
    localStorage.setItem('vault-api-key', apiKey);
  },

  isConfigured() {
    const s = this.getSettings();
    return !!(s.serverUrl && s.apiKey);
  },

  async lastSyncedAt() {
    return (await VaultDB.getMeta('lastSyncedAt')) || 0;
  },

  // Runs a full push-then-pull cycle. Returns a short status string for the UI.
  async syncNow() {
    if (!this.isConfigured()) throw new Error('Server not configured yet.');
    const { serverUrl, apiKey } = this.getSettings();
    const since = await this.lastSyncedAt();

    const [allFolders, allItems] = await Promise.all([
      VaultDB.getAllFoldersRaw(),
      VaultDB.getAllItemsRaw()
    ]);
    const changedFolders = allFolders.filter(f => f.updatedAt > since);
    const changedItems = await Promise.all(
      allItems.filter(it => it.updatedAt > since).map(async (it) => {
        const payload = {
          id: it.id, folderId: it.folderId, type: it.type, url: it.url || null,
          title: it.title || null, text: it.text || null, fileType: it.fileType || null,
          createdAt: it.createdAt, updatedAt: it.updatedAt, deleted: !!it.deleted
        };
        if (it.dataUrl && !it.deleted) payload.dataUrl = it.dataUrl;
        return payload;
      })
    );

    // PUSH
    const pushRes = await fetch(`${serverUrl}/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({
        folders: changedFolders.map(f => ({
          id: f.id, name: f.name, color: f.color, order: f.order,
          createdAt: f.createdAt, updatedAt: f.updatedAt, deleted: !!f.deleted
        })),
        items: changedItems
      })
    });
    if (!pushRes.ok) throw new Error(`Push failed (${pushRes.status})`);

    // PULL
    const pullRes = await fetch(`${serverUrl}/sync/pull?since=${since}`, {
      headers: { 'X-API-Key': apiKey }
    });
    if (!pullRes.ok) throw new Error(`Pull failed (${pullRes.status})`);
    const pulled = await pullRes.json();

    for (const f of pulled.folders) {
      await VaultDB.upsertFromServer('folders', {
        id: f.id, name: f.name, color: f.color, order: f.order,
        createdAt: f.createdAt, updatedAt: f.updatedAt, deleted: f.deleted
      });
    }
    for (const it of pulled.items) {
      const local = (await VaultDB.getAllItemsRaw()).find(x => x.id === it.id);
      await VaultDB.upsertFromServer('items', {
        id: it.id, folderId: it.folderId, type: it.type, url: it.url,
        title: it.title, text: it.text, fileType: it.fileType,
        // keep local dataUrl (base64) if we already have it; otherwise reference server file
        dataUrl: (local && local.dataUrl) || (it.filePath ? `${serverUrl}${it.filePath}` : undefined),
        createdAt: it.createdAt, updatedAt: it.updatedAt, deleted: it.deleted
      });
    }

    await VaultDB.setMeta('lastSyncedAt', pulled.serverTime);
    return {
      pushedFolders: changedFolders.length,
      pushedItems: changedItems.length,
      pulledFolders: pulled.folders.length,
      pulledItems: pulled.items.length
    };
  }
};
