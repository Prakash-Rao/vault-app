// app.js — Vault main app logic

const SOURCES = {
  youtube: { label: 'YouTube', match: /youtube\.com|youtu\.be/i, color: '#FF4B4B', icon: '▶' },
  instagram: { label: 'Instagram', match: /instagram\.com/i, color: '#E1306C', icon: '◎' },
  facebook: { label: 'Facebook', match: /facebook\.com|fb\.watch/i, color: '#4267B2', icon: '◆' },
  web: { label: 'Webpage', match: /.*/, color: '#6FA8DC', icon: '⬡' }
};

function detectSource(url) {
  if (!url) return SOURCES.web;
  for (const key of ['youtube', 'instagram', 'facebook']) {
    if (SOURCES[key].match.test(url)) return SOURCES[key];
  }
  return SOURCES.web;
}

const state = {
  folders: [],
  currentFolder: null,
  feedIndex: 0,
  theme: localStorage.getItem('vault-theme') || 'dark',
  pendingSharedFiles: null,
  recordedVoice: null,
  feedViewMode: 'list',
  incomingShare: null
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
  localStorage.setItem('vault-theme', state.theme);
  $('#themeToggle').textContent = state.theme === 'dark' ? '☀' : '☾';
}

// ---------- Home screen: folder grid ----------
async function renderHome() {
  state.folders = await VaultDB.getFolders();
  const grid = $('#folderGrid');
  grid.innerHTML = '';

  for (const folder of state.folders) {
    const items = await VaultDB.getItemsByFolder(folder.id);
    const card = document.createElement('div');
    card.className = 'folder-card';
    card.style.setProperty('--tab-color', folder.color);
    card.innerHTML = `
      <div class="folder-tab"></div>
      <button class="folder-kebab" data-action="menu" title="Options">⋯</button>
      <div class="folder-body">
        <div class="folder-name">${escapeHtml(folder.name)}</div>
        <div class="folder-count">${items.length} item${items.length === 1 ? '' : 's'}</div>
      </div>
    `;
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="menu"]')) { showFolderMenu(folder); return; }
      openFolder(folder.id);
    });
    grid.appendChild(card);
  }

  const addCard = document.createElement('div');
  addCard.className = 'folder-card folder-card--add';
  addCard.innerHTML = `<div class="add-glyph">+</div><div class="folder-name">New folder</div>`;
  addCard.addEventListener('click', promptNewFolder);
  grid.appendChild(addCard);
}

async function promptNewFolder() {
  const name = prompt('Folder name:');
  if (!name || !name.trim()) return;
  const palette = ['#E8A33D', '#6FA8DC', '#7FC29B', '#C97FE0', '#E07F7F'];
  const color = palette[state.folders.length % palette.length];
  await VaultDB.addFolder(name.trim(), color);
  renderHome();
}

function showFolderMenu(folder) {
  $('#folderMenuTitle').textContent = folder.name;
  $('#folderMenuSheet').classList.add('open');
  $('#folderMenuSheet').dataset.folderId = folder.id;
}
function closeFolderMenu() { $('#folderMenuSheet').classList.remove('open'); }

async function renameFolderFlow() {
  const id = $('#folderMenuSheet').dataset.folderId;
  const folder = state.folders.find(f => f.id === id);
  const name = prompt('Rename folder:', folder.name);
  closeFolderMenu();
  if (name && name.trim()) { await VaultDB.renameFolder(id, name.trim()); renderHome(); }
}
async function deleteFolderFlow() {
  const id = $('#folderMenuSheet').dataset.folderId;
  const folder = state.folders.find(f => f.id === id);
  closeFolderMenu();
  if (confirm(`Delete "${folder.name}" and everything saved inside it? This can't be undone.`)) {
    await VaultDB.deleteFolder(id);
    renderHome();
  }
}

// ---------- Folder feed (swipeable) ----------
async function openFolder(folderId) {
  state.currentFolder = state.folders.find(f => f.id === folderId);
  state.feedItems = await VaultDB.getItemsByFolder(folderId);
  state.feedIndex = 0;
  state.feedViewMode = 'list'; // default to list — easier to scan as a folder grows
  $('#feedFolderName').textContent = state.currentFolder.name;
  showScreen('feed');
  renderFeed();
  applyFeedViewMode();
}

function applyFeedViewMode() {
  const isList = state.feedViewMode === 'list';
  $('#feedViewport').classList.toggle('hidden', isList);
  $('#feedList').classList.toggle('active', isList);
  $('#feedViewToggle').textContent = isList ? '▤' : '☰';
  $('#feedViewToggle').title = isList ? 'Switch to swipe view' : 'Switch to list view';
}

function toggleFeedViewMode() {
  state.feedViewMode = state.feedViewMode === 'list' ? 'swipe' : 'list';
  applyFeedViewMode();
}

function openFeedAtIndex(i) {
  state.feedViewMode = 'swipe';
  applyFeedViewMode();
  goToFeedIndex(i, false);
}

function renderFeed() {
  const wrap = $('#feedTrack');
  const list = $('#feedList');
  wrap.innerHTML = '';
  list.innerHTML = '';
  wrap.style.transform = 'translateX(0)';

  if (state.feedItems.length === 0) {
    const emptyHtml = `<div class="feed-empty">
      <div class="feed-empty-glyph">⬡</div>
      <p>Nothing saved here yet.</p>
      <p class="muted">Share a link into Vault, or tap + to add one.</p>
    </div>`;
    wrap.innerHTML = emptyHtml;
    list.innerHTML = emptyHtml;
    return;
  }

  state.feedItems.forEach((item, i) => {
    wrap.appendChild(renderFeedCard(item));
    list.appendChild(renderListRow(item, i));
  });
  goToFeedIndex(0, false);
}

function renderListRow(item, index) {
  const src = detectSource(item.url);
  const row = document.createElement('div');
  row.className = 'list-row';

  let thumbHtml;
  if ((item.type === 'screenshot') && item.dataUrl) {
    thumbHtml = `<img class="list-thumb" src="${item.dataUrl}" alt="">`;
  } else if (item.type === 'link' && item.thumbnail) {
    thumbHtml = `<img class="list-thumb" src="${item.thumbnail}" alt="">`;
  } else if (item.type === 'link') {
    thumbHtml = `<div class="list-thumb" style="color:${src.color}">${src.icon}</div>`;
  } else if (item.type === 'note') {
    thumbHtml = `<div class="list-thumb">📝</div>`;
  } else if (item.type === 'voice') {
    thumbHtml = `<div class="list-thumb">🎤</div>`;
  } else {
    thumbHtml = `<div class="list-thumb">${fileGlyph(item.fileType)}</div>`;
  }

  const subtitle = item.type === 'link' ? (item.url || '')
    : item.type === 'note' ? (item.text || '')
    : item.type === 'voice' ? 'Voice memo'
    : (item.fileType || 'File');

  row.innerHTML = `
    ${thumbHtml}
    <div class="list-row-text">
      <div class="list-row-title">${escapeHtml(item.title || subtitle || 'Untitled')}</div>
      <div class="list-row-sub">${escapeHtml(subtitle)}</div>
    </div>
  `;
  row.addEventListener('click', () => openFeedAtIndex(index));
  return row;
}

function renderFeedCard(item) {
  const src = detectSource(item.url);
  const card = document.createElement('div');
  card.className = 'feed-card';

  let mediaHtml = '';
  if (item.type === 'screenshot' || item.type === 'image') {
    mediaHtml = `<img class="feed-media" src="${item.dataUrl}" alt="">`;
  } else if (item.type === 'note') {
    mediaHtml = `<div class="feed-note">${escapeHtml(item.text || '')}</div>`;
  } else if (item.type === 'file') {
    mediaHtml = `<div class="feed-file">
      <div class="file-glyph">${fileGlyph(item.fileType)}</div>
      <div class="file-name">${escapeHtml(item.title || 'File')}</div>
    </div>`;
  } else if (item.type === 'voice') {
    mediaHtml = `<div class="feed-voice">
      <div class="file-glyph">🎤</div>
      <div class="file-name">${escapeHtml(item.title || 'Voice memo')}</div>
      <audio controls src="${item.dataUrl}" style="width:100%; margin-top:14px;"></audio>
    </div>`;
  } else {
    mediaHtml = `<div class="feed-link" style="--src-color:${src.color}">
      <div class="src-badge">${src.icon} ${src.label}</div>
      ${item.thumbnail ? `<img class="link-thumb" src="${item.thumbnail}" alt="">` : ''}
      <div class="link-title">${escapeHtml(item.title || item.url || '')}</div>
      <div class="link-url">${escapeHtml(item.url || '')}</div>
    </div>`;
  }

  card.innerHTML = `
    <div class="feed-media-wrap">${mediaHtml}</div>
    <div class="feed-actions">
      ${item.url ? `<button class="btn-primary" data-action="open">Open in ${src.label}</button>` : ''}
      ${navigator.share ? `<button class="btn-ghost" data-action="claude">Send to Claude</button>` : ''}
      <button class="btn-ghost btn-danger" data-action="delete">Delete</button>
    </div>
  `;

  card.querySelector('[data-action="delete"]')?.addEventListener('click', () => deleteCurrentItem(item.id));
  card.querySelector('[data-action="open"]')?.addEventListener('click', () => openInApp(item.url));
  card.querySelector('[data-action="claude"]')?.addEventListener('click', () => sendToClaude(item));

  return card;
}

// Open a link natively — Android will hand off to the installed app (YouTube/Instagram/
// Facebook) automatically via verified app links; browser is the fallback.
function openInApp(url) {
  window.open(url, '_blank', 'noopener');
}

// "Send to Claude" — uses the native Android share sheet so the person can pick the
// Claude app (or claude.ai) directly, same as sharing to any other app.
async function sendToClaude(item) {
  const shareData = {};
  if (item.url) { shareData.url = item.url; shareData.title = item.title || item.url; }
  else if (item.text) { shareData.text = item.text; shareData.title = item.title || 'Note from Vault'; }
  else { shareData.title = item.title || 'Item from Vault'; shareData.text = 'Shared from Vault'; }

  try {
    if (navigator.canShare && item.dataUrl && (item.type === 'screenshot' || item.type === 'file')) {
      const blob = await (await fetch(item.dataUrl)).blob();
      const file = new File([blob], item.title || 'file', { type: item.fileType || blob.type });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: item.title });
        return;
      }
    }
    await navigator.share(shareData);
  } catch (e) { /* user cancelled share sheet — no-op */ }
}

function fileGlyph(type) {
  if (!type) return '📄';
  if (type.includes('pdf')) return '📕';
  if (type.includes('sheet') || type.includes('excel') || type.includes('csv')) return '📊';
  if (type.includes('word') || type.includes('doc')) return '📘';
  if (type.includes('html')) return '🌐';
  return '📄';
}

async function deleteCurrentItem(id) {
  if (!confirm('Delete this item?')) return;
  await VaultDB.deleteItem(id);
  state.feedItems = state.feedItems.filter(it => it.id !== id);
  renderHome();
  renderFeed();
}

function goToFeedIndex(i, animate = true) {
  const track = $('#feedTrack');
  const max = state.feedItems.length - 1;
  state.feedIndex = Math.max(0, Math.min(max, i));
  track.style.transition = animate ? 'transform 0.28s ease' : 'none';
  track.style.transform = `translateX(-${state.feedIndex * 100}%)`;
  $('#feedProgress').textContent = `${state.feedIndex + 1} / ${state.feedItems.length}`;
}

// swipe handling
function setupSwipe() {
  const track = $('#feedTrack');
  let startX = 0, startY = 0, dragging = false;
  track.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX; startY = e.touches[0].clientY; dragging = true;
  });
  track.addEventListener('touchmove', (e) => {
    if (!dragging) return;
  });
  track.addEventListener('touchend', (e) => {
    if (!dragging) return;
    dragging = false;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) goToFeedIndex(state.feedIndex + 1);
      else goToFeedIndex(state.feedIndex - 1);
    }
  });
}

// ---------- Add item ----------
function openAddSheet() {
  $('#addSheet').classList.add('open');
  $('#addUrl').value = '';
  $('#addNote').value = '';
  $('#addFileInput').value = '';
  $('#addCameraInput').value = '';
  state.pendingSharedFiles = null;
  state.recordedVoice = null;
  resetVoiceRecorder();
  $('#addTab-link').click();
  populateFolderSelect();
}
function closeAddSheet() { $('#addSheet').classList.remove('open'); }

function populateFolderSelect() {
  const sel = $('#addFolderSelect');
  sel.innerHTML = state.folders.map(f =>
    `<option value="${f.id}" ${state.currentFolder && f.id === state.currentFolder.id ? 'selected' : ''}>${escapeHtml(f.name)}</option>`
  ).join('');
}

async function submitAdd(type) {
  const folderId = $('#addFolderSelect').value;
  if (!folderId) { alert('Create a folder first.'); return; }

  if (type === 'link') {
    const url = $('#addUrl').value.trim();
    if (!url) return;
    const src = detectSource(url);
    const item = await VaultDB.addItem({ folderId, type: 'link', url, title: url.replace(/^https?:\/\//, '').slice(0, 60) });
    closeAddSheet();
    showToast('Link saved');
    renderHome();
    if (state.currentFolder && state.currentFolder.id === folderId) {
      state.feedItems = await VaultDB.getItemsByFolder(folderId);
      renderFeed();
    }
    // Fetch a real title/thumbnail in the background (YouTube only — see note below)
    if (src === SOURCES.youtube) fetchYoutubePreview(item);
    return;
  }

  if (type === 'note') {
    const text = $('#addNote').value.trim();
    if (!text) return;
    await VaultDB.addItem({ folderId, type: 'note', text, title: text.slice(0, 40) });
  } else if (type === 'file') {
    const files = Array.from($('#addFileInput').files).length
      ? Array.from($('#addFileInput').files)
      : Array.from($('#addCameraInput').files);
    if (files.length) {
      for (const file of files) {
        const dataUrl = await fileToDataUrl(file);
        const itemType = file.type.startsWith('image/') ? 'screenshot' : file.type.startsWith('audio/') ? 'voice' : 'file';
        await VaultDB.addItem({ folderId, type: itemType, dataUrl, fileType: file.type, title: file.name });
      }
    } else if (state.pendingSharedFiles && state.pendingSharedFiles.length) {
      for (const f of state.pendingSharedFiles) {
        const itemType = (f.fileType || '').startsWith('image/') ? 'screenshot' : (f.fileType || '').startsWith('audio/') ? 'voice' : 'file';
        await VaultDB.addItem({ folderId, type: itemType, dataUrl: f.dataUrl, fileType: f.fileType, title: f.fileName || 'Shared file' });
      }
      state.pendingSharedFiles = null;
    } else {
      return;
    }
  } else if (type === 'voice') {
    if (!state.recordedVoice) return;
    const { dataUrl, fileType } = state.recordedVoice;
    const title = `Voice memo — ${new Date().toLocaleString()}`;
    await VaultDB.addItem({ folderId, type: 'voice', dataUrl, fileType, title });
    state.recordedVoice = null;
    resetVoiceRecorder();
  }

  closeAddSheet();
  showToast(type === 'note' ? 'Note saved' : type === 'voice' ? 'Voice memo saved' : 'Saved');
  renderHome();
  if (state.currentFolder && state.currentFolder.id === folderId) {
    state.feedItems = await VaultDB.getItemsByFolder(folderId);
    renderFeed();
  }
}

// YouTube's oEmbed endpoint allows anonymous cross-origin requests, so this works
// entirely client-side with no backend. Instagram/Facebook require a Meta developer
// app + access token for oEmbed now, and generic webpages block cross-origin HTML
// fetches by default — both of those genuinely need a small server-side fetch, which
// is deliberately left out for now given the local-first preference.
async function fetchYoutubePreview(item) {
  try {
    const resp = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(item.url)}&format=json`);
    if (!resp.ok) return;
    const data = await resp.json();
    const updated = { ...item, title: data.title || item.title, thumbnail: data.thumbnail_url };
    await VaultDB.updateItem(updated);
    if (state.currentFolder && state.currentFolder.id === item.folderId) {
      state.feedItems = await VaultDB.getItemsByFolder(item.folderId);
      renderFeed();
    }
    renderHome();
  } catch (e) { /* offline or blocked — silently keep the plain link */ }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------- Voice memo recording ----------
let mediaRecorder = null;
let recordedChunks = [];
let recordingStartTime = null;
let recordingTimerInterval = null;

function resetVoiceRecorder() {
  $('#voiceRecordBtn').textContent = '🎤 Start recording';
  $('#voiceRecordBtn').classList.remove('recording');
  $('#voiceTimer').textContent = '00:00';
  $('#voicePreview').style.display = 'none';
  $('#voicePreview').src = '';
  $('#submitVoice').style.display = 'none';
  clearInterval(recordingTimerInterval);
}

async function toggleVoiceRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      clearInterval(recordingTimerInterval);
      const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      const dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
      state.recordedVoice = { dataUrl, fileType: blob.type };
      $('#voicePreview').src = dataUrl;
      $('#voicePreview').style.display = 'block';
      $('#submitVoice').style.display = 'block';
      $('#voiceRecordBtn').textContent = '🎤 Re-record';
      $('#voiceRecordBtn').classList.remove('recording');
    };
    mediaRecorder.start();
    recordingStartTime = Date.now();
    $('#voiceRecordBtn').textContent = '⏹ Stop recording';
    $('#voiceRecordBtn').classList.add('recording');
    $('#voicePreview').style.display = 'none';
    $('#submitVoice').style.display = 'none';
    recordingTimerInterval = setInterval(() => {
      const secs = Math.floor((Date.now() - recordingStartTime) / 1000);
      const m = String(Math.floor(secs / 60)).padStart(2, '0');
      const s = String(secs % 60).padStart(2, '0');
      $('#voiceTimer').textContent = `${m}:${s}`;
    }, 500);
  } catch (e) {
    alert('Microphone access was denied or is unavailable.');
  }
}

// ---------- Search ----------
async function runSearch(query) {
  const results = $('#searchResults');
  if (!query.trim()) { results.innerHTML = ''; return; }
  const items = await VaultDB.searchItems(query);
  results.innerHTML = items.map(it => {
    const folder = state.folders.find(f => f.id === it.folderId);
    return `<div class="search-row" data-folder="${it.folderId}">
      <div class="search-row-title">${escapeHtml(it.title || it.url || it.text || '')}</div>
      <div class="search-row-meta">${folder ? escapeHtml(folder.name) : ''}</div>
    </div>`;
  }).join('') || '<p class="muted">No matches.</p>';

  $$('.search-row').forEach(row => {
    row.addEventListener('click', () => {
      showScreen('feed');
      closeSearch();
      openFolder(row.dataset.folder);
    });
  });
}

function openSearch() { $('#searchSheet').classList.add('open'); $('#searchInput').focus(); }
function closeSearch() { $('#searchSheet').classList.remove('open'); $('#searchInput').value = ''; $('#searchResults').innerHTML = ''; }

// ---------- Sync / Backup ----------
function openSyncSheet() {
  const { serverUrl, apiKey } = VaultSync.getSettings();
  $('#syncServerUrl').value = serverUrl;
  $('#syncApiKey').value = apiKey;
  $('#syncStatus').textContent = '';
  $('#syncSheet').classList.add('open');
}

async function runSyncFromSheet() {
  const serverUrl = $('#syncServerUrl').value.trim();
  const apiKey = $('#syncApiKey').value.trim();
  if (!serverUrl || !apiKey) { $('#syncStatus').textContent = 'Enter both the server URL and API key.'; return; }
  VaultSync.saveSettings(serverUrl, apiKey);
  $('#syncStatus').textContent = 'Syncing…';
  try {
    const result = await VaultSync.syncNow();
    $('#syncStatus').textContent =
      `Synced. Sent ${result.pushedItems} item(s), received ${result.pulledItems} item(s).`;
    await renderHome();
    if (state.currentFolder) {
      state.feedItems = await VaultDB.getItemsByFolder(state.currentFolder.id);
      renderFeed();
    }
  } catch (e) {
    $('#syncStatus').textContent = `Sync failed: ${e.message}`;
  }
}

// ---------- Screens ----------
function showScreen(name) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  $(`#screen-${name}`).classList.add('active');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Handle incoming share (from share.html via localStorage handoff) ----------
async function handlePendingShare() {
  const pending = localStorage.getItem('vault-pending-share');
  if (!pending) return;
  localStorage.removeItem('vault-pending-share');
  try {
    const { url, text } = JSON.parse(pending);
    const link = url || (text && /^https?:\/\//i.test(text.trim()) ? text.trim() : null);
    await VaultDB.init();
    state.folders = await VaultDB.getFolders();

    if (link) {
      state.incomingShare = { kind: 'link', url: link };
      openQuickSaveSheet(link);
    } else if (text) {
      state.incomingShare = { kind: 'note', text };
      openQuickSaveSheet(text);
    }
  } catch (e) { /* ignore malformed */ }
}

// Tap-a-folder-to-save flow — used for incoming shares so there's no separate
// "Save" button to miss. Saving happens the instant a folder is tapped.
function openQuickSaveSheet(previewText) {
  $('#quickSavePreview').textContent = previewText.length > 90 ? previewText.slice(0, 90) + '…' : previewText;
  const list = $('#quickSaveFolderList');
  list.innerHTML = '';
  state.folders.forEach((f) => {
    const row = document.createElement('button');
    row.className = 'quick-folder-row';
    row.innerHTML = `<span class="quick-folder-dot" style="background:${f.color}"></span> ${escapeHtml(f.name)}`;
    row.addEventListener('click', () => quickSaveToFolder(f.id, f.name));
    list.appendChild(row);
  });
  $('#quickSaveSheet').classList.add('open');
}

async function quickSaveToFolder(folderId, folderName) {
  const share = state.incomingShare;
  if (!share) return;
  if (share.kind === 'link') {
    const item = await VaultDB.addItem({ folderId, type: 'link', url: share.url, title: share.url.replace(/^https?:\/\//, '').slice(0, 60) });
    const src = detectSource(share.url);
    if (src === SOURCES.youtube) fetchYoutubePreview(item);
  } else if (share.kind === 'note') {
    await VaultDB.addItem({ folderId, type: 'note', text: share.text, title: share.text.slice(0, 40) });
  }
  state.incomingShare = null;
  $('#quickSaveSheet').classList.remove('open');
  showToast(`Saved to ${folderName}`);
  await renderHome();
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 2200);
}

// ---------- Init ----------
async function init() {
  applyTheme();
  await VaultDB.init();
  await renderHome();
  setupSwipe();
  showScreen('home');

  $('#themeToggle').addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
  });

  $('#backToHome').addEventListener('click', () => { showScreen('home'); renderHome(); });
  $('#feedViewToggle').addEventListener('click', toggleFeedViewMode);
  $('#closeQuickSave').addEventListener('click', () => { $('#quickSaveSheet').classList.remove('open'); state.incomingShare = null; });
  $('#closeFolderMenu').addEventListener('click', closeFolderMenu);
  $('#folderMenuRename').addEventListener('click', renameFolderFlow);
  $('#folderMenuDelete').addEventListener('click', deleteFolderFlow);
  $('#fabAdd').addEventListener('click', openAddSheet);
  $('#feedFabAdd').addEventListener('click', openAddSheet);
  $('#closeAddSheet').addEventListener('click', closeAddSheet);
  $('#searchOpen').addEventListener('click', openSearch);
  $('#closeSearch').addEventListener('click', closeSearch);
  $('#searchInput').addEventListener('input', (e) => runSearch(e.target.value));

  $$('.add-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.add-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      $$('.add-pane').forEach(p => p.classList.remove('active'));
      $(`#addPane-${tab.dataset.tab}`).classList.add('active');
    });
  });
  $('#submitLink').addEventListener('click', () => submitAdd('link'));
  $('#submitNote').addEventListener('click', () => submitAdd('note'));
  $('#submitFile').addEventListener('click', () => submitAdd('file'));
  $('#takePhotoBtn').addEventListener('click', () => $('#addCameraInput').click());
  $('#addCameraInput').addEventListener('change', () => submitAdd('file'));
  $('#voiceRecordBtn').addEventListener('click', toggleVoiceRecording);
  $('#submitVoice').addEventListener('click', () => submitAdd('voice'));

  $('#syncOpen').addEventListener('click', openSyncSheet);
  $('#closeSync').addEventListener('click', () => $('#syncSheet').classList.remove('open'));
  $('#syncSave').addEventListener('click', runSyncFromSheet);

  $('#feedPrev').addEventListener('click', () => goToFeedIndex(state.feedIndex - 1));
  $('#feedNext').addEventListener('click', () => goToFeedIndex(state.feedIndex + 1));

  await handlePendingShare();
  await handleQuickShortcut();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }
}

// Handles the long-press home-screen shortcuts ("Quick Note" / "Quick Voice Memo")
async function handleQuickShortcut() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('quicknote')) {
    openAddSheet();
    $('#addTab-note').click();
    $('#addNote').focus();
  } else if (params.has('quickvoice')) {
    openAddSheet();
    $('#addTab-voice').click();
  }
}

document.addEventListener('DOMContentLoaded', init);
