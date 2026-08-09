import { loadHandle, saveHandle } from './db.js';
import { CommentsStore, extractDate } from './store.js';
import { scanImages } from './scan.js';
import { matchFiles, getHash, clearHashCache } from './match.js';
import { generateThumbnail, thumbKey, placeholder, getCachedThumb, setCachedThumb, invalidateThumbs } from './thumbs.js';
import { generateComment, testConnection, loadSettings, saveSettings, DEFAULT_PROMPT } from './ai.js';

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const $ = (id) => document.getElementById(id);

const state = {
  rootHandle: null,
  store: null,
  files: [],
  results: [],
  filter: 'all',
  busy: false,
};

let currentGrid = [];
let observer = null;

/* ============================= Folder / permission ============================= */

async function ensurePermission(handle) {
  try {
    return (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
  } catch (e) {
    return false;
  }
}

async function requestPermissionGesture(handle) {
  try {
    return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
  } catch (e) {
    return false;
  }
}

async function pickFolder() {
  if (state.busy) return;
  let handle;
  try {
    handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    alert('无法打开文件夹：' + ((e && e.message) || e));
    return;
  }
  try {
    await saveHandle(handle);
    await initFolder(handle);
  } catch (e) {
    console.error(e);
    alert('读取文件夹失败，可能需要重新授权：' + ((e && e.message) || e));
  }
}

async function reauth() {
  const stored = await loadHandle();
  if (!stored) return pickFolder();
  if (await requestPermissionGesture(stored)) {
    try {
      await initFolder(stored);
    } catch (e) {
      console.error(e);
      showWelcome(true);
    }
  } else {
    alert('未能获取读写权限，请重新选择文件夹。');
    showWelcome(true);
  }
}

/* ============================= Progress ============================= */

function showProgress(text) {
  $('progress-text').textContent = text || '处理中…';
  $('progress').classList.remove('hidden');
}

function updateProgress(text) {
  if (!$('progress').classList.contains('hidden')) $('progress-text').textContent = text;
}

function hideProgress() {
  $('progress').classList.add('hidden');
}

/* ============================= init folder ============================= */

async function initFolder(handle) {
  state.rootHandle = handle;
  invalidateThumbs();
  clearHashCache();
  setBusy(true);
  setFolderName(handle.name);

  state.store = new CommentsStore(handle);
  showProgress('正在读取点评记录…');
  await state.store.load();

  updateProgress('正在扫描图片…');
  state.files = await scanImages(handle, (n) => updateProgress('正在扫描图片… 已找到 ' + n + ' 张'));

  updateProgress('正在匹配点评…');
  state.results = await matchFiles(state.files, state.store, (done, total) =>
    updateProgress('正在匹配点评（计算文件哈希）… ' + done + '/' + total)
  );

  await state.store.ensureFile();

  hideProgress();
  setBusy(false);
  render();
  refreshView();
}

function setFolderName(name) {
  $('folder-name').textContent = name;
  $('folder-name').title = '已选中文件夹：' + name;
}

function setBusy(b) {
  state.busy = b;
  $('btn-folder').disabled = b;
  $('btn-folder-welcome').disabled = b;
  $('btn-reauth').disabled = b;
  $('btn-refresh').disabled = b || !state.rootHandle;
}

/* ============================= View switching ============================= */

function showWelcome(hasStored) {
  state.rootHandle = null;
  $('welcome').classList.remove('hidden');
  $('noimages').classList.add('hidden');
  $('grid-section').classList.add('hidden');
  $('btn-reauth').classList.toggle('hidden', !hasStored);
  $('statusbar').textContent = '共 0 张 | 已点评 0 张';
  $('statusbar').style.visibility = 'hidden';
  setBusy(false);
}

function refreshView() {
  const hasInit = !!state.rootHandle;
  const hasImgs = state.results.length > 0;
  $('welcome').classList.toggle('hidden', hasInit);
  $('noimages').classList.toggle('hidden', !(hasInit && !hasImgs));
  $('grid-section').classList.toggle('hidden', !(hasInit && hasImgs));
  $('statusbar').style.visibility = hasInit ? 'visible' : 'hidden';
}

/* ============================= Filter ============================= */

function hasComment(r) {
  return !!(r.record && r.record.comment && String(r.record.comment).trim());
}

function filteredList() {
  if (state.filter === 'all') return state.results;
  return state.results.filter((r) => (state.filter === 'commented' ? hasComment(r) : !hasComment(r)));
}

/* ============================= Render ============================= */

function fieldValue(r, field) {
  if (field === 'title') return (r.record && r.record.title) || r.file.name;
  if (field === 'time') return (r.record && r.record.time) || extractDate(r.file.name);
  return (r.record && r.record.comment) || '';
}

function buildCards(list) {
  const parts = [];
  list.forEach((r, i) => {
    const key = thumbKey(r.file);
    const cached = getCachedThumb(key);
    const src = cached !== undefined && cached !== null ? cached : placeholder();
    const title = fieldValue(r, 'title');
    const time = fieldValue(r, 'time');
    const comment = fieldValue(r, 'comment');
    const dot = hasComment(r) ? '<span class="dot" title="已点评"></span>' : '';
    parts.push(
      '<div class="card" data-idx="' + i + '">' +
        '<div class="thumb"><img data-idx="' + i + '" data-lazy src="' + src + '" alt="' + esc(r.file.name) + '"></div>' +
        '<div class="card-info">' +
          '<div class="card-title" title="' + esc(r.file.path) + '">' + esc(title) + '</div>' +
          '<div class="name" title="' + esc(r.file.path) + '">' + esc(r.file.name) + '</div>' +
          '<div class="time">' + esc(time) + '</div>' +
          '<div class="preview' + (comment ? '' : ' empty') + '">' +
            (comment ? esc(comment).replace(/\n/g, '<br>') : '（无点评）') +
          '</div>' +
        '</div>' +
        dot +
        '</div>'
    );
  });
  return parts.join('');
}

function makeObserver(onLoad) {
  if (observer) observer.disconnect();
  observer = new IntersectionObserver(
    (entries, obs) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        obs.unobserve(en.target);
        onLoad(en.target);
      }
    },
    { root: document.querySelector('main'), rootMargin: '500px 0px' }
  );
  return observer;
}

async function loadThumb(img) {
  const r = currentGrid[+img.dataset.idx];
  if (!r) return;
  const key = thumbKey(r.file);
  try {
    const file = await r.file.handle.getFile();
    const thumb = await generateThumbnail(file);
    setCachedThumb(key, thumb);
    img.src = thumb || placeholder();
  } catch (e) {
    img.src = placeholder();
  }
}

function render() {
  const mainEl = document.querySelector('main');
  const scrollTop = mainEl.scrollTop;
  const grid = $('grid');

  const list = filteredList();
  currentGrid = list;
  grid.innerHTML = buildCards(list);

  const obs = makeObserver(loadThumb);
  for (const img of grid.querySelectorAll('img[data-lazy]')) {
    const r = currentGrid[+img.dataset.idx];
    if (!r) continue;
    const key = thumbKey(r.file);
    const cached = getCachedThumb(key);
    if (cached !== undefined && cached !== null) {
      img.src = cached;
      img.removeAttribute('data-lazy');
    } else {
      obs.observe(img);
    }
  }

  updateStatus();
  requestAnimationFrame(() => {
    mainEl.scrollTop = scrollTop;
  });
}

function updateStatus() {
  const total = state.results.length;
  const commented = state.results.filter(hasComment).length;
  $('statusbar').textContent = '共 ' + total + ' 张 | 已点评 ' + commented + ' 张';
}

/* ============================= Dialog ============================= */

let editing = null;
let dialogUrl = null;

function openDialog(r) {
  editing = r;
  setAiStatus($('dialog-ai-status'), '', null);
  $('dialog-title').textContent = r.file.name;
  $('dialog-path').textContent = r.file.path;
  $('dialog-field-title').value = (r.record && r.record.title) || '';
  $('dialog-field-time').value = (r.record && r.record.time) || '';
  $('dialog-text').value = (r.record && r.record.comment) || '';
  const imgEl = $('dialog-img');
  r.file.handle
    .getFile()
    .then((f) => {
      if (dialogUrl) URL.revokeObjectURL(dialogUrl);
      dialogUrl = URL.createObjectURL(f);
      imgEl.src = dialogUrl;
      imgEl.classList.remove('hidden');
    })
    .catch(() => {
      imgEl.classList.add('hidden');
    });
  $('dialog').classList.remove('hidden');
  $('dialog-field-title').focus();
}

function closeDialog() {
  $('dialog').classList.add('hidden');
  const imgEl = $('dialog-img');
  if (dialogUrl) URL.revokeObjectURL(dialogUrl);
  dialogUrl = null;
  imgEl.src = '';
  imgEl.classList.add('hidden');
  editing = null;
}

async function saveDialog() {
  if (!editing) return;
  const r = editing;
  const path = r.file.path;
  const title = $('dialog-field-title').value;
  const time = $('dialog-field-time').value;
  const comment = $('dialog-text').value;
  let file_hash = r.record && r.record.file_hash ? r.record.file_hash : '';
  if (!file_hash) {
    try {
      file_hash = await getHash(r.file);
    } catch (e) {
      file_hash = '';
    }
  }
  r.record = state.store.set(path, {
    title,
    time,
    comment,
    file_hash,
    filename: r.file.name,
    file_size: r.file.size,
  });
  closeDialog();
  try {
    await state.store.save();
  } catch (e) {
    console.error('保存点评失败', e);
    alert('保存点评失败：' + ((e && e.message) || e));
  }
  render();
  refreshView();
}

/* ============================= AI 点评 ============================= */

function setAiStatus(el, text, cls) {
  el.textContent = text || '';
  el.classList.toggle('error', cls === 'error');
  el.classList.toggle('ok', cls === 'ok');
}

function aiForm() {
  return {
    apiKey: $('ai-key').value.trim(),
    prompt: $('ai-prompt').value.trim() || DEFAULT_PROMPT,
  };
}

async function openAiSettings() {
  const s = await loadSettings();
  $('ai-key').value = s.apiKey || '';
  $('ai-prompt').value = s.prompt || DEFAULT_PROMPT;
  setAiStatus($('ai-status'), '', null);
  $('ai-dialog').classList.remove('hidden');
  $('ai-key').focus();
}

function closeAiSettings() {
  $('ai-dialog').classList.add('hidden');
}

async function aiSave() {
  try {
    await saveSettings(aiForm());
    closeAiSettings();
  } catch (e) {
    console.error('保存 AI 设置失败', e);
    alert('保存 AI 设置失败：' + ((e && e.message) || e));
  }
}

async function aiTest() {
  const statusEl = $('ai-status');
  setAiStatus(statusEl, '测试中…', null);
  try {
    await testConnection(aiForm());
    setAiStatus(statusEl, '连接成功 ✓', 'ok');
  } catch (e) {
    setAiStatus(statusEl, '测试失败：' + e.message, 'error');
  }
}

async function aiComment() {
  if (!editing) return;
  const btn = $('dialog-ai');
  const statusEl = $('dialog-ai-status');
  btn.disabled = true;
  setAiStatus(statusEl, 'AI 正在看图生成点评…', null);
  try {
    const s = await loadSettings();
    const text = await generateComment(editing.file, s);
    const cur = $('dialog-text').value.trim();
    $('dialog-text').value = cur ? cur + '\n' + text : text;
    setAiStatus(statusEl, '已生成，可修改后保存 ✓', 'ok');
  } catch (e) {
    setAiStatus(statusEl, '生成失败：' + e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

/* ============================= Refresh ============================= */

async function refresh() {
  if (state.busy || !state.rootHandle) return;
  const handle = state.rootHandle;
  invalidateThumbs();
  clearHashCache();
  await initFolder(handle);
}

/* ============================= Events ============================= */

function wireEvents() {
  $('btn-folder').addEventListener('click', pickFolder);
  $('btn-folder-welcome').addEventListener('click', pickFolder);
  $('btn-folder-again').addEventListener('click', pickFolder);
  $('btn-reauth').addEventListener('click', reauth);
  $('btn-refresh').addEventListener('click', refresh);
  $('filter').addEventListener('change', (e) => {
    state.filter = e.target.value;
    render();
  });

  $('grid').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const r = currentGrid[+card.dataset.idx];
    if (r) openDialog(r);
  });

  $('dialog-save').addEventListener('click', saveDialog);
  $('dialog-cancel').addEventListener('click', closeDialog);
  $('dialog-overlay').addEventListener('click', closeDialog);
  $('dialog-ai').addEventListener('click', aiComment);

  $('btn-ai-settings').addEventListener('click', openAiSettings);
  $('ai-save').addEventListener('click', aiSave);
  $('ai-cancel').addEventListener('click', closeAiSettings);
  $('ai-overlay').addEventListener('click', closeAiSettings);
  $('ai-test').addEventListener('click', aiTest);

  $('dialog-text').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeDialog();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!editing) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      saveDialog();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeDialog();
    }
  });

  window.addEventListener('unhandledrejection', (e) => {
    console.error('未处理的错误：', e.reason);
  });
}

/* ============================= Boot ============================= */

async function boot() {
  wireEvents();
  let stored = null;
  try {
    stored = await loadHandle();
  } catch (e) {
    stored = null;
  }
  if (stored) {
    if (await ensurePermission(stored)) {
      try {
        await initFolder(stored);
        return;
      } catch (e) {
        console.error(e);
      }
    }
    showWelcome(true);
  } else {
    showWelcome(false);
  }
}

boot();