function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2400);
}

function makeParticles() {
  const colors = ['#31f7ff', '#ff3cf0', '#ffd166', '#ffffff'];
  const particleCount = window.innerWidth <= 560 ? 22 : 42;
  for (let i = 0; i < particleCount; i++) {
    const el = document.createElement('span');
    el.className = 'sparkle';
    el.style.left = Math.random() * 100 + 'vw';
    el.style.animationDuration = (8 + Math.random() * 12) + 's';
    el.style.animationDelay = (-Math.random() * 12) + 's';
    el.style.color = colors[i % colors.length];
    el.style.background = 'currentColor';
    document.body.appendChild(el);
  }
}

function normalizeList(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Map();
  for (const item of list) {
    let text = '';
    let weight = 1;
    if (typeof item === 'string') {
      text = item;
    } else if (item && typeof item === 'object') {
      text = (item.text || item.label || '').toString();
      const w = Number(item.weight);
      if (Number.isFinite(w) && w > 0) weight = w;
    } else if (item != null) {
      text = String(item);
    }
    text = text.trim();
    if (!text) continue;
    if (!seen.has(text) || seen.get(text) < weight) seen.set(text, weight);
  }
  return [...seen.entries()].map(([text, weight]) =>
    weight === 1 ? text : { text, weight }
  );
}

// 工具:从条目里取文本和权重
function itemText(item) {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') return item.text || item.label || '';
  return String(item || '');
}
function itemWeight(item) {
  if (item && typeof item === 'object') {
    const w = Number(item.weight);
    if (Number.isFinite(w) && w > 0) return w;
  }
  return 1;
}

function parseImportText(text, target) {
  const raw = String(text || '').trim();
  if (!raw) return [];

  try {
    const json = JSON.parse(raw);
    if (Array.isArray(json)) return normalizeList(json);
    if (json && typeof json === 'object') {
      if (Array.isArray(json[target])) return normalizeList(json[target]);
      const firstArray = Object.values(json).find(Array.isArray);
      if (firstArray) return normalizeList(firstArray);
    }
  } catch (_) {}

  // 文本格式:每行一条;支持 "题目|权重" 或 "题目,权重"
  const items = raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      // 去掉外层引号
      const stripped = line.replace(/^"(.*)"$/, '$1');
      // 优先匹配 "题目|权重"
      const m1 = stripped.match(/^(.*?)[|](\d+(?:\.\d+)?)\s*$/);
      if (m1) return { text: m1[1].trim(), weight: parseFloat(m1[2]) };
      // 再匹配 "题目,权重"(只在没中文逗号且 csv 末尾是数字时,避免误伤普通中文 csv)
      const m2 = stripped.match(/^(.+?)\s*,\s*(\d+(?:\.\d+)?)\s*$/);
      if (m2 && !stripped.includes('，')) return { text: m2[1].trim(), weight: parseFloat(m2[2]) };
      // 普通 CSV:取第一列
      if (stripped.includes(',') && !stripped.includes('，')) {
        return stripped.split(',')[0].trim();
      }
      return stripped;
    })
    .filter(item => (typeof item === 'string' ? item : item.text));

  return normalizeList(items);
}

// ====== 管理员认证(令牌存在 sessionStorage 里,关闭浏览器即失效)======
const ADMIN_TOKEN_KEY = 'tdw_admin_token';
function getAdminToken() {
  try { return sessionStorage.getItem(ADMIN_TOKEN_KEY) || ''; } catch (_) { return ''; }
}
function setAdminToken(token) {
  try {
    if (token) sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
    else sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch (_) {}
}
function adminHeaders(extra) {
  const h = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
  const t = getAdminToken();
  if (t) h['X-Admin-Auth'] = t;
  return h;
}

async function apiGetData() {
  const res = await fetch('/api/data', { cache: 'no-store' });
  const json = await res.json();
  if (!json.ok) throw new Error(json.message || '读取数据失败');
  return json.data;
}

// 玩家页用:只能更新 settings 的非敏感字段
async function apiSaveData(data) {
  const res = await fetch('/api/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data })
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.message || '保存数据失败');
  return json.data;
}

// 管理员用:能改 main/truth/dare/settings(需要密码)
async function apiAdminSaveData(data) {
  const res = await fetch('/api/admin/save', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ data })
  });
  const json = await res.json();
  if (res.status === 401) throw new Error(json.message || '登录已失效,请刷新页面重新输入密码');
  if (!json.ok) throw new Error(json.message || '保存数据失败');
  return json.data;
}

async function apiResetData() {
  const res = await fetch('/api/reset', {
    method: 'POST',
    headers: adminHeaders()
  });
  const json = await res.json();
  if (res.status === 401) throw new Error(json.message || '登录已失效,请刷新页面重新输入密码');
  if (!json.ok) throw new Error(json.message || '恢复失败');
  return json.data;
}

async function apiAdminStatus() {
  const res = await fetch('/api/admin/status', { cache: 'no-store' });
  const json = await res.json();
  if (!json.ok) throw new Error(json.message || '查询状态失败');
  return json;
}

async function apiAdminLogin(password) {
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  const json = await res.json();
  if (!json.ok) {
    const err = new Error(json.message || '登录失败');
    err.status = res.status;
    throw err;
  }
  return json;
}

async function apiAdminSetPassword(newPassword) {
  const res = await fetch('/api/admin/password', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ newPassword })
  });
  const json = await res.json();
  if (res.status === 401) throw new Error(json.message || '登录已失效,请刷新页面重新输入密码');
  if (!json.ok) throw new Error(json.message || '保存密码失败');
  return json;
}


function initCreatorSupport() {
  const modal = document.getElementById('rewardModal');
  const openBtns = document.querySelectorAll('#rewardOpen, [data-open-reward]');
  const closeBtn = document.getElementById('rewardClose');
  if (!modal || !openBtns.length) return;

  const open = () => {
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  };
  const close = () => {
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  };

  openBtns.forEach(btn => btn.addEventListener('click', open));
  if (closeBtn) closeBtn.addEventListener('click', close);
  modal.querySelectorAll('[data-close-reward]').forEach(el => el.addEventListener('click', close));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && modal.classList.contains('show')) close();
  });
}

initCreatorSupport();
