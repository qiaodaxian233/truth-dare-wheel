const state = {
  data: {
    main: [
      { label: '真心话', route: 'truth', icon: '💬', weight: 1 },
      { label: '大冒险', route: 'dare', icon: '⚡', weight: 1 }
    ],
    truth: [],
    dare: [],
    settings: { autoSpinNext: false, pageTitle: '真心话 · 大冒险' }
  }
};

const targetSelect = document.getElementById('targetSelect');
const fileInput = document.getElementById('fileInput');
const dataInput = document.getElementById('dataInput');
const replaceBtn = document.getElementById('replaceBtn');
const appendBtn = document.getElementById('appendBtn');
const exportBtn = document.getElementById('exportBtn');
const resetBtn = document.getElementById('resetBtn');
const refreshBtn = document.getElementById('refreshBtn');
const pageTitleInput = document.getElementById('pageTitleInput');
const autoSpinNext = document.getElementById('autoSpinNext');
const saveSettingBtn = document.getElementById('saveSettingBtn');
const previewTitle = document.getElementById('previewTitle');
const previewList = document.getElementById('previewList');
const mainWeightsBox = document.getElementById('mainWeights');
const saveMainBtn = document.getElementById('saveMainBtn');
const saveWeightsBtn = document.getElementById('saveWeightsBtn');
const resetWeightsBtn = document.getElementById('resetWeightsBtn');
const broadcastInput = document.getElementById('broadcastInput');
const broadcastCount = document.getElementById('broadcastCount');
const sendBroadcastBtn = document.getElementById('sendBroadcastBtn');
const clearBroadcastBtn = document.getElementById('clearBroadcastBtn');

// 密码相关
const adminPasswordInput = document.getElementById('adminPasswordInput');
const adminPasswordStatus = document.getElementById('adminPasswordStatus');
const savePasswordBtn = document.getElementById('savePasswordBtn');

// 登录遮罩相关
const loginOverlay = document.getElementById('loginOverlay');
const loginPasswordInput = document.getElementById('loginPasswordInput');
const loginError = document.getElementById('loginError');
const loginSubmitBtn = document.getElementById('loginSubmitBtn');

async function apiSendBroadcast(text) {
  const res = await fetch('/api/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.message || '发送飘屏失败');
  return json.data;
}

async function sendBroadcast() {
  const text = (broadcastInput?.value || '').trim();
  if (!text) {
    showToast('请输入飘屏内容');
    broadcastInput?.focus();
    return;
  }
  sendBroadcastBtn.disabled = true;
  const original = sendBroadcastBtn.textContent;
  sendBroadcastBtn.textContent = '发送中…';
  try {
    state.data = await apiSendBroadcast(text);
    showToast('飘屏已发送,玩家页将很快显示');
  } catch (err) {
    showToast(err.message || '发送失败');
  } finally {
    sendBroadcastBtn.disabled = false;
    sendBroadcastBtn.textContent = original;
  }
}

function updateBroadcastCount() {
  if (!broadcastInput || !broadcastCount) return;
  broadcastCount.textContent = String(broadcastInput.value.length);
}

async function loadData(silent = false) {
  try {
    state.data = await apiGetData();
    pageTitleInput.value = state.data.settings?.pageTitle || '真心话 · 大冒险';
    autoSpinNext.checked = !!state.data.settings?.autoSpinNext;
    renderCounts();
    renderMainWeights();
    renderPreview();
    if (!silent) showToast('数据已刷新');
  } catch (err) {
    showToast(err.message || '读取数据失败');
  }
}

function renderCounts() {
  document.getElementById('countMain').textContent = state.data.main?.length || 0;
  document.getElementById('countTruth').textContent = state.data.truth?.length || 0;
  document.getElementById('countDare').textContent = state.data.dare?.length || 0;
}

// 主转盘权重 UI
function renderMainWeights() {
  const list = state.data.main || [];
  const total = list.reduce((a, b) => a + (Number(b.weight) > 0 ? Number(b.weight) : 1), 0) || 1;
  mainWeightsBox.innerHTML = '';
  list.forEach((item, idx) => {
    const w = Number(item.weight) > 0 ? Number(item.weight) : 1;
    const pct = ((w / total) * 100).toFixed(1);
    const row = document.createElement('div');
    row.className = 'main-weight-row';
    row.innerHTML = `
      <div class="main-weight-label">
        <span class="main-weight-icon">${escapeHTML(item.icon || '')}</span>
        <span class="main-weight-name">${escapeHTML(item.label || '')}</span>
        <span class="main-weight-pct" data-pct-for="${idx}">${pct}%</span>
      </div>
      <div class="main-weight-controls">
        <input type="range" min="0.1" max="10" step="0.1" value="${w}" data-main-range="${idx}" />
        <input type="number" min="0.1" max="100" step="0.1" value="${w}" data-main-number="${idx}" />
      </div>
    `;
    mainWeightsBox.appendChild(row);
  });

  mainWeightsBox.querySelectorAll('input[data-main-range]').forEach(el => {
    el.addEventListener('input', () => {
      const idx = Number(el.dataset.mainRange);
      const v = Math.max(0.1, Number(el.value) || 1);
      state.data.main[idx].weight = v;
      const num = mainWeightsBox.querySelector(`input[data-main-number="${idx}"]`);
      if (num) num.value = v;
      updateMainPct();
    });
  });
  mainWeightsBox.querySelectorAll('input[data-main-number]').forEach(el => {
    el.addEventListener('input', () => {
      const idx = Number(el.dataset.mainNumber);
      const v = Math.max(0.1, Number(el.value) || 1);
      state.data.main[idx].weight = v;
      const range = mainWeightsBox.querySelector(`input[data-main-range="${idx}"]`);
      if (range) range.value = Math.min(10, v);
      updateMainPct();
    });
  });
}

function updateMainPct() {
  const list = state.data.main || [];
  const total = list.reduce((a, b) => a + (Number(b.weight) > 0 ? Number(b.weight) : 1), 0) || 1;
  list.forEach((item, idx) => {
    const w = Number(item.weight) > 0 ? Number(item.weight) : 1;
    const el = mainWeightsBox.querySelector(`[data-pct-for="${idx}"]`);
    if (el) el.textContent = ((w / total) * 100).toFixed(1) + '%';
  });
}

function renderPreview() {
  const mode = targetSelect.value;
  const names = { truth: '真心话转盘', dare: '大冒险转盘' };
  const list = state.data[mode] || [];
  previewTitle.textContent = `${names[mode]}数据预览(可单条调权重)`;
  previewList.innerHTML = '';

  if (!list.length) {
    const li = document.createElement('li');
    li.innerHTML = '<em>暂无数据,请导入。</em>';
    previewList.appendChild(li);
    return;
  }

  list.forEach((item, index) => {
    const text = itemText(item);
    const weight = itemWeight(item);
    const li = document.createElement('li');
    li.className = 'preview-item';
    li.innerHTML = `
      <div class="preview-item-text"><em>#${index + 1}</em> ${escapeHTML(text)}</div>
      <div class="preview-item-actions">
        <div class="preview-item-weight">
          <label>权重</label>
          <input type="number" min="0.1" max="100" step="0.1" value="${weight}" data-weight-idx="${index}" />
        </div>
        <button class="preview-item-delete" data-delete-idx="${index}" title="删除此条" aria-label="删除此条">🗑</button>
      </div>
    `;
    previewList.appendChild(li);
  });

  previewList.querySelectorAll('input[data-weight-idx]').forEach(el => {
    el.addEventListener('change', () => {
      const idx = Number(el.dataset.weightIdx);
      const v = Math.max(0.1, Number(el.value) || 1);
      el.value = v;
      const cur = state.data[mode][idx];
      const text = itemText(cur);
      state.data[mode][idx] = v === 1 ? text : { text, weight: v };
    });
  });

  previewList.querySelectorAll('button[data-delete-idx]').forEach(btn => {
    btn.addEventListener('click', () => deletePreviewItem(Number(btn.dataset.deleteIdx)));
  });
}

async function deletePreviewItem(idx) {
  const mode = targetSelect.value;
  const list = state.data[mode] || [];
  if (idx < 0 || idx >= list.length) return;
  const item = list[idx];
  const text = itemText(item);
  const preview = text.length > 28 ? text.slice(0, 28) + '…' : text;
  if (!confirm(`确定删除这一条吗?\n\n${preview}`)) return;
  // 从内存先删,保存到服务器,失败则回滚
  const backup = list.slice();
  list.splice(idx, 1);
  try {
    state.data = await apiAdminSaveData(state.data);
    renderCounts();
    renderPreview();
    showToast('已删除');
  } catch (err) {
    state.data[mode] = backup;
    renderPreview();
    showToast(err.message || '删除失败');
  }
}

function escapeHTML(str) {
  return String(str).replace(/[&<>'"]/g, s => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[s]));
}

async function importData(mode, append) {
  try {
    const list = parseImportText(dataInput.value, mode);
    if (!list.length) {
      showToast('没有读取到有效数据,请一行一条粘贴或上传文件。');
      return;
    }
    state.data[mode] = append ? normalizeList([...(state.data[mode] || []), ...list]) : normalizeList(list);
    state.data = await apiAdminSaveData(state.data);
    renderCounts();
    renderPreview();
    showToast(`${append ? '追加' : '覆盖'}成功:${list.length} 条数据,转盘页已同步`);
  } catch (err) {
    showToast(err.message || '导入失败');
  }
}

async function saveSettings() {
  try {
    state.data.settings = {
      ...(state.data.settings || {}),
      pageTitle: pageTitleInput.value.trim() || '真心话 · 大冒险',
      autoSpinNext: autoSpinNext.checked
    };
    state.data = await apiAdminSaveData(state.data);
    showToast('全局设置已保存');
  } catch (err) {
    showToast(err.message || '保存设置失败');
  }
}

async function saveMainWeights() {
  try {
    state.data = await apiAdminSaveData(state.data);
    renderMainWeights();
    showToast('主转盘概率已保存');
  } catch (err) {
    showToast(err.message || '保存失败');
  }
}

async function saveWeights() {
  try {
    state.data = await apiAdminSaveData(state.data);
    renderPreview();
    showToast('单条权重已保存');
  } catch (err) {
    showToast(err.message || '保存失败');
  }
}

async function resetAllWeights() {
  const mode = targetSelect.value;
  if (!confirm(`确定把【${mode === 'truth' ? '真心话' : '大冒险'}】所有题目的权重重置为 1 吗?`)) return;
  state.data[mode] = (state.data[mode] || []).map(it => itemText(it));
  try {
    state.data = await apiAdminSaveData(state.data);
    renderPreview();
    showToast('已全部重置为 1');
  } catch (err) {
    showToast(err.message || '重置失败');
  }
}

function exportJSON() {
  const blob = new Blob([JSON.stringify({ main: state.data.main, truth: state.data.truth, dare: state.data.dare, settings: state.data.settings }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'truth-dare-wheel-data.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('已导出 JSON 数据');
}

async function resetData() {
  if (!confirm('确定恢复示例数据?当前真心话和大冒险数据会被覆盖。')) return;
  try {
    state.data = await apiResetData();
    renderCounts();
    renderMainWeights();
    renderPreview();
    showToast('已恢复示例数据');
  } catch (err) {
    showToast(err.message || '恢复失败');
  }
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    dataInput.value = String(reader.result || '');
    showToast(`已读取文件:${file.name}`);
  };
  reader.readAsText(file, 'utf-8');
});

targetSelect.addEventListener('change', renderPreview);
replaceBtn.addEventListener('click', () => importData(targetSelect.value, false));
appendBtn.addEventListener('click', () => importData(targetSelect.value, true));
exportBtn.addEventListener('click', exportJSON);
resetBtn.addEventListener('click', resetData);
refreshBtn.addEventListener('click', () => loadData(false));
saveSettingBtn.addEventListener('click', saveSettings);
saveMainBtn.addEventListener('click', saveMainWeights);
saveWeightsBtn.addEventListener('click', saveWeights);
resetWeightsBtn.addEventListener('click', resetAllWeights);

if (broadcastInput) {
  broadcastInput.addEventListener('input', updateBroadcastCount);
  broadcastInput.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + Enter 快捷发送
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      sendBroadcast();
    }
  });
}
if (sendBroadcastBtn) sendBroadcastBtn.addEventListener('click', sendBroadcast);
if (clearBroadcastBtn) clearBroadcastBtn.addEventListener('click', () => {
  if (broadcastInput) {
    broadcastInput.value = '';
    updateBroadcastCount();
    broadcastInput.focus();
  }
});

// 密码保存
if (savePasswordBtn) savePasswordBtn.addEventListener('click', savePassword);
if (adminPasswordInput) {
  adminPasswordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      savePassword();
    }
  });
}

// 登录遮罩
if (loginSubmitBtn) loginSubmitBtn.addEventListener('click', handleLoginSubmit);
if (loginPasswordInput) {
  loginPasswordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleLoginSubmit();
    }
  });
}

bootstrap();

// ====== 登录 / 密码管理 ======
function showLoginOverlay(reason) {
  if (!loginOverlay) return;
  loginOverlay.classList.add('show');
  loginOverlay.setAttribute('aria-hidden', 'false');
  if (loginError) loginError.textContent = reason || '';
  if (loginPasswordInput) {
    loginPasswordInput.value = '';
    setTimeout(() => loginPasswordInput.focus(), 60);
  }
}
function hideLoginOverlay() {
  if (!loginOverlay) return;
  loginOverlay.classList.remove('show');
  loginOverlay.setAttribute('aria-hidden', 'true');
}

async function handleLoginSubmit() {
  const pwd = (loginPasswordInput?.value || '').trim();
  if (!pwd) {
    if (loginError) loginError.textContent = '请输入密码';
    return;
  }
  loginSubmitBtn.disabled = true;
  const originalText = loginSubmitBtn.textContent;
  loginSubmitBtn.textContent = '验证中…';
  try {
    const json = await apiAdminLogin(pwd);
    setAdminToken(json.token || pwd);
    hideLoginOverlay();
    await loadData(true);
    await refreshPasswordStatus();
    showToast('登录成功');
  } catch (err) {
    if (loginError) loginError.textContent = err.message || '密码不正确';
  } finally {
    loginSubmitBtn.disabled = false;
    loginSubmitBtn.textContent = originalText;
  }
}

async function refreshPasswordStatus() {
  if (!adminPasswordStatus) return;
  try {
    const status = await apiAdminStatus();
    adminPasswordStatus.textContent = status.passwordRequired
      ? '当前状态:已设置密码 ✅(再次进入控制台需要输入密码)'
      : '当前状态:未设置密码(任何人都可进入控制台)';
  } catch (_) {
    adminPasswordStatus.textContent = '当前状态:未知';
  }
}

async function savePassword() {
  const newPwd = (adminPasswordInput?.value || '').trim();
  const isClearing = newPwd.length === 0;
  const confirmText = isClearing
    ? '确定要清空密码、关闭密码保护吗?'
    : `确定将控制台密码设置为「${newPwd}」吗?\n\n请记住这个密码,下次进入控制台需要输入它。`;
  if (!confirm(confirmText)) return;
  savePasswordBtn.disabled = true;
  const original = savePasswordBtn.textContent;
  savePasswordBtn.textContent = '保存中…';
  try {
    const json = await apiAdminSetPassword(newPwd);
    // 把新密码保存为当前会话的 token,这样不会立刻被踢出
    setAdminToken(json.token || '');
    if (adminPasswordInput) adminPasswordInput.value = '';
    await refreshPasswordStatus();
    showToast(json.message || (isClearing ? '密码已清空' : '密码已更新'));
  } catch (err) {
    showToast(err.message || '保存密码失败');
  } finally {
    savePasswordBtn.disabled = false;
    savePasswordBtn.textContent = original;
  }
}

// 启动:先验证是否需要登录,再加载数据
async function bootstrap() {
  makeParticles();
  let status;
  try {
    status = await apiAdminStatus();
  } catch (err) {
    showToast('无法连接到服务器');
    return;
  }

  if (status.passwordRequired) {
    // 如果 sessionStorage 有 token,先尝试用它直接拉数据;不行就弹登录框
    const existing = getAdminToken();
    if (existing) {
      // 用一个轻量的请求验证 token 是否有效:尝试 admin/save 一个无变化的数据
      // 简单做法:先拉 public 数据,通过 admin/login 校验当前 token
      try {
        const probe = await apiAdminLogin(existing);
        if (probe && probe.ok) {
          setAdminToken(probe.token || existing);
          await loadData(true);
          await refreshPasswordStatus();
          return;
        }
      } catch (_) {
        setAdminToken('');
      }
    }
    showLoginOverlay();
  } else {
    // 未设置密码,直接进入
    await loadData(true);
    await refreshPasswordStatus();
  }
}
