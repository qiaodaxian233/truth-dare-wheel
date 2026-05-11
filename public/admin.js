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

// 转动次数 / 猜左右
const spinCountInput = document.getElementById('spinCountInput');
const spinUnlimitedInput = document.getElementById('spinUnlimitedInput');
const guessEnabledInput = document.getElementById('guessEnabledInput');
const guessRewardInput = document.getElementById('guessRewardInput');
const guessPenaltyMinInput = document.getElementById('guessPenaltyMinInput');
const guessPenaltyMaxInput = document.getElementById('guessPenaltyMaxInput');
const saveSpinSettingsBtn = document.getElementById('saveSpinSettingsBtn');

// IP 管理大后台
const refreshIpsBtn = document.getElementById('refreshIpsBtn');
const resetAllIpsBtn = document.getElementById('resetAllIpsBtn');
const ipSummary = document.getElementById('ipSummary');
const ipTbody = document.getElementById('ipTbody');

// 专属定制版本
const newProfileName = document.getElementById('newProfileName');
const newProfileAllowSelfTopup = document.getElementById('newProfileAllowSelfTopup');
const createProfileBtn = document.getElementById('createProfileBtn');
const profileCreateHint = document.getElementById('profileCreateHint');
const profileTbody = document.getElementById('profileTbody');

// 登录遮罩相关
const loginOverlay = document.getElementById('loginOverlay');
const loginPasswordInput = document.getElementById('loginPasswordInput');
const loginError = document.getElementById('loginError');
const loginSubmitBtn = document.getElementById('loginSubmitBtn');

async function apiSendBroadcast(text) {
  const res = await fetch('/api/broadcast', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ text })
  });
  const json = await res.json();
  if (res.status === 401) throw new Error(json.message || '登录已失效,请刷新页面重新输入密码');
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
    const s = state.data.settings || {};
    pageTitleInput.value = s.pageTitle || '真心话 · 大冒险';
    autoSpinNext.checked = !!s.autoSpinNext;
    // 转动次数 / 猜左右(spinCountDefault = 新 IP 进入时的初始次数)
    if (spinCountInput) spinCountInput.value = Number(s.spinCountDefault) || 0;
    if (spinUnlimitedInput) spinUnlimitedInput.checked = !!s.spinUnlimited;
    if (guessEnabledInput) guessEnabledInput.checked = s.guessEnabled !== false;
    if (guessRewardInput) guessRewardInput.value = String(Math.floor(Number(s.guessRewardOnCorrect) ?? -1));
    if (guessPenaltyMinInput) guessPenaltyMinInput.value = Number(s.guessPenaltyMin) || 1;
    if (guessPenaltyMaxInput) guessPenaltyMaxInput.value = Number(s.guessPenaltyMax) || 10;
    renderCounts();
    renderMainWeights();
    renderPreview();
    if (!silent) showToast('数据已刷新');
  } catch (err) {
    showToast(err.message || '读取数据失败');
  }
}

async function saveSpinSettings() {
  const lo = Math.max(0, parseInt(guessPenaltyMinInput?.value) || 0);
  const hi = Math.max(lo, parseInt(guessPenaltyMaxInput?.value) || lo);
  state.data.settings = {
    ...(state.data.settings || {}),
    spinCountDefault: Math.max(0, parseInt(spinCountInput?.value) || 0),
    spinUnlimited: !!spinUnlimitedInput?.checked,
    guessEnabled: !!guessEnabledInput?.checked,
    guessRewardOnCorrect: Math.floor(Number(guessRewardInput?.value) || 0),
    guessPenaltyMin: lo,
    guessPenaltyMax: hi
  };
  saveSpinSettingsBtn.disabled = true;
  const original = saveSpinSettingsBtn.textContent;
  saveSpinSettingsBtn.textContent = '保存中…';
  try {
    state.data = await apiAdminSaveData(state.data);
    showToast('转动次数 / 猜左右设置已保存');
  } catch (err) {
    showToast(err.message || '保存失败');
  } finally {
    saveSpinSettingsBtn.disabled = false;
    saveSpinSettingsBtn.textContent = original;
  }
}

// ===== IP 管理大后台 =====

function formatRelativeTime(ts) {
  if (!ts) return '从未';
  const diff = Date.now() - ts;
  if (diff < 0) return '未来?';
  if (diff < 60_000) return Math.floor(diff / 1000) + ' 秒前';
  if (diff < 3600_000) return Math.floor(diff / 60_000) + ' 分钟前';
  if (diff < 86400_000) return Math.floor(diff / 3600_000) + ' 小时前';
  return Math.floor(diff / 86400_000) + ' 天前';
}

async function loadIpList(silent = false) {
  if (!refreshIpsBtn) return;
  refreshIpsBtn.disabled = true;
  const originalText = refreshIpsBtn.textContent;
  refreshIpsBtn.textContent = '加载中…';
  try {
    const res = await fetch('/api/admin/ips', { headers: adminHeaders() });
    const json = await res.json();
    if (res.status === 401) throw new Error('登录已失效,请刷新页面重新输入密码');
    if (!json.ok) throw new Error(json.message || '获取列表失败');
    renderIpList(json);
    if (!silent) showToast(`已加载 ${json.total} 个 IP`);
  } catch (err) {
    showToast(err.message || '加载失败');
  } finally {
    refreshIpsBtn.disabled = false;
    refreshIpsBtn.textContent = originalText;
  }
}

function renderIpList(json) {
  if (!ipTbody) return;
  if (ipSummary) {
    ipSummary.textContent = `共 ${json.total} 个 IP · 默认初始 ${json.spinCountDefault} 次 · ${json.spinUnlimited ? '♾ 全局无限' : '按次扣减'}`;
  }
  if (!json.list || !json.list.length) {
    ipTbody.innerHTML = '<tr><td colspan="4" class="ip-empty">还没有玩家访问过 / 已被清空</td></tr>';
    return;
  }
  ipTbody.innerHTML = '';
  for (const row of json.list) {
    const tr = document.createElement('tr');
    const empty = row.count <= 0 && !json.spinUnlimited;
    tr.innerHTML = `
      <td class="ip-cell">${escapeHTML(row.ip)}</td>
      <td class="ip-count ${empty ? 'is-empty' : ''}">${row.count}</td>
      <td class="ip-time">${escapeHTML(formatRelativeTime(row.lastActive))}</td>
      <td class="ip-actions">
        <button class="small-btn" data-ip-add="10" data-ip="${escapeHTML(row.ip)}">+10</button>
        <button class="small-btn" data-ip-add="50" data-ip="${escapeHTML(row.ip)}">+50</button>
        <button class="small-btn" data-ip-set data-ip="${escapeHTML(row.ip)}">设值</button>
        <button class="small-btn danger" data-ip-reset data-ip="${escapeHTML(row.ip)}">重置</button>
      </td>
    `;
    ipTbody.appendChild(tr);
  }
  // 绑定操作按钮
  ipTbody.querySelectorAll('[data-ip-add]').forEach(btn => {
    btn.addEventListener('click', () => ipAdd(btn.dataset.ip, parseInt(btn.dataset.ipAdd)));
  });
  ipTbody.querySelectorAll('[data-ip-set]').forEach(btn => {
    btn.addEventListener('click', () => ipSet(btn.dataset.ip));
  });
  ipTbody.querySelectorAll('[data-ip-reset]').forEach(btn => {
    btn.addEventListener('click', () => ipReset(btn.dataset.ip));
  });
}

async function ipAdd(ip, delta) {
  try {
    const res = await fetch('/api/admin/ip/add', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ ip, delta })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.message || '操作失败');
    showToast(`${ip} ${delta > 0 ? '+' : ''}${delta} → ${json.count}`);
    loadIpList(true);
  } catch (err) {
    showToast(err.message || '操作失败');
  }
}

async function ipSet(ip) {
  const v = prompt(`把 IP「${ip}」的剩余次数设为多少?`, '0');
  if (v === null) return;
  const count = Math.max(0, parseInt(v));
  if (!Number.isFinite(count)) { showToast('请输入数字'); return; }
  try {
    const res = await fetch('/api/admin/ip/set', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ ip, count })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.message || '操作失败');
    showToast(`${ip} 已设为 ${json.count}`);
    loadIpList(true);
  } catch (err) {
    showToast(err.message || '操作失败');
  }
}

async function ipReset(ip) {
  if (!confirm(`重置 IP「${ip}」?\n\n该 IP 记录会被删除,下次访问时重新发放默认初始次数。`)) return;
  try {
    const res = await fetch('/api/admin/ip/reset', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ ip })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.message || '操作失败');
    showToast(`${ip} 已重置`);
    loadIpList(true);
  } catch (err) {
    showToast(err.message || '操作失败');
  }
}

async function resetAllIps() {
  if (!confirm('⚠ 清空所有 IP 记录?\n\n所有玩家的当前剩余次数会消失,下次访问时统一重新发放默认初始次数。')) return;
  try {
    const res = await fetch('/api/admin/ip/reset-all', {
      method: 'POST',
      headers: adminHeaders()
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.message || '操作失败');
    showToast('已清空所有 IP 记录');
    loadIpList(true);
  } catch (err) {
    showToast(err.message || '操作失败');
  }
}

// ===== 专属定制版本管理 =====

async function loadProfileList(silent = false) {
  try {
    const res = await fetch('/api/admin/profiles', { headers: adminHeaders() });
    const json = await res.json();
    if (res.status === 401) throw new Error('登录已失效');
    if (!json.ok) throw new Error(json.message || '获取列表失败');
    renderProfileList(json.list || []);
    if (!silent) showToast(`已加载 ${json.total} 个专属版本`);
  } catch (err) {
    showToast(err.message || '加载失败');
  }
}

function renderProfileList(list) {
  if (!profileTbody) return;
  if (!list.length) {
    profileTbody.innerHTML = '<tr><td colspan="6" class="ip-empty">还没有专属版本,在上方输入名字创建</td></tr>';
    return;
  }
  const origin = location.origin;
  profileTbody.innerHTML = '';
  for (const p of list) {
    const tr = document.createElement('tr');
    const url = `${origin}/p/${p.slug}`;
    tr.innerHTML = `
      <td class="ip-cell" style="font-family:inherit;">${escapeHTML(p.name)}</td>
      <td class="ip-cell">
        <a href="${escapeHTML(url)}" target="_blank" rel="noopener" style="color:#9be7ff;">${escapeHTML(url)}</a>
      </td>
      <td>
        <label class="switch-row" style="margin:0;">
          <input type="checkbox" data-profile-toggle="${escapeHTML(p.slug)}" ${p.allowSelfTopup ? 'checked' : ''} />
        </label>
      </td>
      <td>
        <input type="number" class="profile-amount" data-profile-amount="${escapeHTML(p.slug)}" min="1" max="50" step="1" value="${Number(p.selfTopupAmount) || 5}" ${p.allowSelfTopup ? '' : 'disabled'} />
      </td>
      <td class="ip-time">${escapeHTML(formatRelativeTime(p.createdAt))}</td>
      <td class="ip-actions">
        <button class="small-btn" data-profile-copy="${escapeHTML(url)}">📋 复制 URL</button>
        <button class="small-btn danger" data-profile-delete="${escapeHTML(p.slug)}" data-profile-name="${escapeHTML(p.name)}">删除</button>
      </td>
    `;
    profileTbody.appendChild(tr);
  }
  // 绑定操作
  profileTbody.querySelectorAll('[data-profile-toggle]').forEach(el => {
    el.addEventListener('change', () => toggleProfileSelfTopup(el.dataset.profileToggle, el.checked));
  });
  profileTbody.querySelectorAll('[data-profile-amount]').forEach(el => {
    el.addEventListener('change', () => updateProfileAmount(el.dataset.profileAmount, parseInt(el.value)));
  });
  profileTbody.querySelectorAll('[data-profile-copy]').forEach(btn => {
    btn.addEventListener('click', () => copyToClipboard(btn.dataset.profileCopy));
  });
  profileTbody.querySelectorAll('[data-profile-delete]').forEach(btn => {
    btn.addEventListener('click', () => deleteProfile(btn.dataset.profileDelete, btn.dataset.profileName));
  });
}

async function createProfile() {
  const name = (newProfileName?.value || '').trim();
  if (!name) {
    if (profileCreateHint) profileCreateHint.textContent = '⚠ 请输入名字';
    newProfileName?.focus();
    return;
  }
  createProfileBtn.disabled = true;
  const original = createProfileBtn.textContent;
  createProfileBtn.textContent = '生成中…';
  try {
    const res = await fetch('/api/admin/profile/create', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        name,
        allowSelfTopup: !!newProfileAllowSelfTopup?.checked,
        selfTopupAmount: 5
      })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.message || '创建失败');
    const url = `${location.origin}/p/${json.profile.slug}`;
    if (profileCreateHint) {
      profileCreateHint.innerHTML = `✅ 已生成,URL:<a href="${escapeHTML(url)}" target="_blank" rel="noopener" style="color:#9be7ff;">${escapeHTML(url)}</a> <button class="small-btn" style="margin-left:8px;" id="postCreateCopy">📋 复制</button>`;
      const copyBtn = document.getElementById('postCreateCopy');
      if (copyBtn) copyBtn.addEventListener('click', () => copyToClipboard(url));
    }
    if (newProfileName) newProfileName.value = '';
    loadProfileList(true);
    showToast(`「${name}」专属版本已创建`);
  } catch (err) {
    if (profileCreateHint) profileCreateHint.textContent = '⚠ ' + (err.message || '创建失败');
  } finally {
    createProfileBtn.disabled = false;
    createProfileBtn.textContent = original;
  }
}

async function toggleProfileSelfTopup(slug, allowSelfTopup) {
  try {
    const res = await fetch('/api/admin/profile/update', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ slug, allowSelfTopup })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.message || '更新失败');
    showToast(allowSelfTopup ? '已开启自助加' : '已关闭自助加');
    loadProfileList(true);
  } catch (err) {
    showToast(err.message || '更新失败');
    loadProfileList(true);
  }
}

async function updateProfileAmount(slug, amount) {
  const v = Math.max(1, Math.min(50, Math.floor(Number(amount) || 5)));
  try {
    const res = await fetch('/api/admin/profile/update', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ slug, selfTopupAmount: v })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.message || '更新失败');
    showToast(`每次加次数已改为 ${v}`);
  } catch (err) {
    showToast(err.message || '更新失败');
  }
}

async function deleteProfile(slug, name) {
  if (!confirm(`删除专属版本「${name}」?\n\n该 URL 后续会失效,玩家访问会看到提示信息。`)) return;
  try {
    const res = await fetch('/api/admin/profile/delete', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ slug })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.message || '删除失败');
    showToast(`「${name}」已删除`);
    loadProfileList(true);
  } catch (err) {
    showToast(err.message || '删除失败');
  }
}

function copyToClipboard(text) {
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => showToast('已复制到剪贴板'),
      () => fallbackCopy(text)
    );
  } else {
    fallbackCopy(text);
  }
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); showToast('已复制'); }
  catch (_) { showToast('请手动复制:' + text.slice(0, 40) + '…'); }
  document.body.removeChild(ta);
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
      <div class="preview-item-text">
        <em>#${index + 1}</em>
        <span class="preview-item-edit" data-text-idx="${index}" contenteditable="true" spellcheck="false" title="点击直接编辑题目，按 Enter 或点其它地方保存">${escapeHTML(text)}</span>
      </div>
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

  // 题目文本内联编辑:Enter 保存,Esc 取消,失焦也保存
  previewList.querySelectorAll('span[data-text-idx]').forEach(span => {
    // 记录初始内容,便于回滚和判断是否有修改
    span.dataset.original = span.textContent;
    span.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        span.blur(); // 触发 blur 保存
      } else if (e.key === 'Escape') {
        e.preventDefault();
        span.textContent = span.dataset.original || '';
        span.blur();
      }
    });
    span.addEventListener('blur', () => commitTextEdit(span));
    // 粘贴时去掉富文本格式
    span.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text');
      document.execCommand('insertText', false, text);
    });
  });
}

async function commitTextEdit(span) {
  const idx = Number(span.dataset.textIdx);
  const mode = targetSelect.value;
  const list = state.data[mode] || [];
  if (idx < 0 || idx >= list.length) return;
  // 把多行换行折成空格,去掉首尾空白
  const newText = (span.textContent || '').replace(/\s+/g, ' ').trim();
  const original = span.dataset.original || '';
  if (newText === original) return; // 没改
  if (!newText) {
    showToast('题目不能为空,已恢复');
    span.textContent = original;
    return;
  }
  // 重名检查:同列表内若已有相同文本会被服务端去重,提醒一下
  const dup = list.some((it, i) => i !== idx && itemText(it) === newText);
  if (dup) {
    showToast('已有相同题目,合并时会去重,建议改个不同的');
    span.textContent = original;
    return;
  }
  // 更新内存:保留权重
  const cur = list[idx];
  const weight = itemWeight(cur);
  list[idx] = weight === 1 ? newText : { text: newText, weight };
  try {
    state.data = await apiAdminSaveData(state.data);
    span.dataset.original = newText;
    showToast('题目已更新');
  } catch (err) {
    // 回滚
    list[idx] = cur;
    span.textContent = original;
    showToast(err.message || '保存失败');
  }
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

// 转动次数 / 猜左右保存
if (saveSpinSettingsBtn) saveSpinSettingsBtn.addEventListener('click', saveSpinSettings);

// IP 管理
if (refreshIpsBtn) refreshIpsBtn.addEventListener('click', () => loadIpList());
if (resetAllIpsBtn) resetAllIpsBtn.addEventListener('click', resetAllIps);

// 专属定制
if (createProfileBtn) createProfileBtn.addEventListener('click', createProfile);
if (newProfileName) {
  newProfileName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); createProfile(); }
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
    loadIpList(true).catch(() => {});
    loadProfileList(true).catch(() => {});
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
    // 如果 localStorage 有 token,先尝试用它直接拉数据;不行就弹登录框
    const existing = getAdminToken();
    if (existing) {
      try {
        const probe = await apiAdminLogin(existing);
        if (probe && probe.ok) {
          setAdminToken(probe.token || existing);
          await loadData(true);
          await refreshPasswordStatus();
          loadIpList(true).catch(() => {});
          loadProfileList(true).catch(() => {});
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
    loadIpList(true).catch(() => {});
    loadProfileList(true).catch(() => {});
  }
}
