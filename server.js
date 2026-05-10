const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3101);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'wheel-data.json');
const ADMIN_AUTH_HEADER = 'x-admin-auth';

const defaultData = {
  main: [
    { label: '真心话', route: 'truth', icon: '💬', weight: 1 },
    { label: '大冒险', route: 'dare', icon: '⚡', weight: 1 }
  ],
  truth: [
    '你最近一次心动是什么时候？',
    '说一个你偷偷坚持很久的小习惯。',
    '现场选一个人，说出 TA 的一个优点。',
    '你最想重来的一天是哪一天？',
    '你最近一次撒谎是因为什么？',
    '说一个你一直不好意思承认的爱好。',
    '你最容易被哪种细节打动？',
    '你手机里最近一张照片是什么？'
  ],
  dare: [
    '用夸张语气介绍自己 30 秒。',
    '模仿一种动物，坚持 15 秒。',
    '给最近联系人发一句：今天也要开心。',
    '现场摆一个最酷的拍照姿势。',
    '闭眼原地转三圈，然后说一句台词。',
    '用三种表情完成自拍。',
    '唱一句你最熟悉的歌。',
    '随机夸一位朋友 20 秒。'
  ],
  settings: {
    autoSpinNext: false,
    pageTitle: '真心话 · 大冒险',
    adminPassword: '',
    // ===== 转动次数 / 猜左右 =====
    spinCount: 0,            // 剩余转动次数(主播在 admin 设置)
    spinUnlimited: false,    // 无限转模式,开启后忽略次数限制
    guessEnabled: true,      // 启用「猜左右」环节
    guessRewardOnCorrect: 1, // 猜对返还次数(0=不变,1=返还1次=本次主转盘相当于不扣)
    guessPenaltyMin: 1,      // 猜错惩罚最小值
    guessPenaltyMax: 10      // 猜错惩罚最大值
  },
  broadcast: { id: 0, text: '', createdAt: 0 }
};

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8'
};

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2), 'utf8');
  }
}

function normalizeList(list) {
  if (!Array.isArray(list)) return [];
  // 接受字符串、{text, weight} 对象,保留权重信息
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
    // 重复项保留较大的权重
    if (!seen.has(text) || seen.get(text) < weight) {
      seen.set(text, weight);
    }
  }
  return [...seen.entries()].map(([text, weight]) =>
    weight === 1 ? text : { text, weight }
  );
}

function normalizeMain(list) {
  if (!Array.isArray(list) || !list.length) return defaultData.main;
  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const w = Number(raw.weight);
    out.push({
      label: String(raw.label || '').trim() || '选项',
      route: String(raw.route || '').trim() || 'truth',
      icon: String(raw.icon || '').trim(),
      weight: Number.isFinite(w) && w > 0 ? w : 1
    });
  }
  return out.length ? out : defaultData.main;
}

function normalizeData(input) {
  const src = input && typeof input === 'object' ? input : {};
  const settingsIn = src.settings && typeof src.settings === 'object' ? src.settings : {};
  const broadcastIn = src.broadcast && typeof src.broadcast === 'object' ? src.broadcast : {};
  // 数字字段统一转换 + 边界裁剪
  const num = (v, def, min, max) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    if (typeof min === 'number') return Math.max(min, Math.min(typeof max === 'number' ? max : n, n));
    return n;
  };
  return {
    main: normalizeMain(src.main),
    truth: normalizeList(src.truth && src.truth.length ? src.truth : defaultData.truth),
    dare: normalizeList(src.dare && src.dare.length ? src.dare : defaultData.dare),
    settings: {
      ...defaultData.settings,
      ...settingsIn,
      // 密码默认空字符串,稍后由调用方决定
      adminPassword: typeof settingsIn.adminPassword === 'string' ? settingsIn.adminPassword : '',
      // 转动次数 / 猜左右(数字字段做边界裁剪)
      spinCount: Math.max(0, Math.floor(num(settingsIn.spinCount, 0, 0, 99999))),
      spinUnlimited: !!settingsIn.spinUnlimited,
      guessEnabled: settingsIn.guessEnabled === undefined ? true : !!settingsIn.guessEnabled,
      guessRewardOnCorrect: Math.max(0, Math.floor(num(settingsIn.guessRewardOnCorrect, 1, 0, 100))),
      guessPenaltyMin: Math.max(0, Math.floor(num(settingsIn.guessPenaltyMin, 1, 0, 100))),
      guessPenaltyMax: Math.max(0, Math.floor(num(settingsIn.guessPenaltyMax, 10, 0, 100)))
    },
    broadcast: {
      id: Number(broadcastIn.id) || 0,
      text: String(broadcastIn.text || '').slice(0, 200),
      createdAt: Number(broadcastIn.createdAt) || 0
    }
  };
}

// 内部读取(包含 adminPassword)
function readDataInternal() {
  ensureDataFile();
  try {
    return normalizeData(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
  } catch (err) {
    return normalizeData(defaultData);
  }
}

// 对外读取(剥离 adminPassword,绝不暴露给前端)
function readDataPublic() {
  const d = readDataInternal();
  if (d.settings) {
    const { adminPassword, ...rest } = d.settings;
    d.settings = rest;
  }
  return d;
}

// 管理员保存:能改 main/truth/dare/settings(但不能通过此接口改密码)
function writeDataInternal(newData) {
  ensureDataFile();
  const existing = readDataInternal();
  const normalized = normalizeData(newData);
  // 始终保留磁盘上原有的密码,密码只能通过 /api/admin/password 修改
  normalized.settings.adminPassword = existing.settings.adminPassword || '';
  fs.writeFileSync(DATA_FILE, JSON.stringify(normalized, null, 2), 'utf8');
  const out = JSON.parse(JSON.stringify(normalized));
  if (out.settings) delete out.settings.adminPassword;
  return out;
}

// 玩家页保存:只允许更新 settings 中的非敏感字段(autoSpinNext, peopleCount 等)
// 不能改 main/truth/dare,不能改密码,不能改 pageTitle,不能改 broadcast
function writePlayerSafe(newData) {
  ensureDataFile();
  const existing = readDataInternal();
  const incoming = newData && typeof newData === 'object' ? newData : {};
  const incomingSettings = incoming.settings && typeof incoming.settings === 'object' ? incoming.settings : {};
  // 白名单:玩家页只能改这些字段
  const allowedKeys = ['autoSpinNext', 'peopleCount'];
  const mergedSettings = { ...existing.settings };
  for (const k of allowedKeys) {
    if (k in incomingSettings) mergedSettings[k] = incomingSettings[k];
  }
  // 密码绝不被覆盖
  mergedSettings.adminPassword = existing.settings.adminPassword || '';
  const merged = {
    main: existing.main,
    truth: existing.truth,
    dare: existing.dare,
    settings: mergedSettings,
    broadcast: existing.broadcast || { id: 0, text: '', createdAt: 0 }
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(merged, null, 2), 'utf8');
  const out = JSON.parse(JSON.stringify(merged));
  if (out.settings) delete out.settings.adminPassword;
  return out;
}

function setAdminPassword(newPassword) {
  ensureDataFile();
  const existing = readDataInternal();
  existing.settings.adminPassword = String(newPassword || '');
  fs.writeFileSync(DATA_FILE, JSON.stringify(existing, null, 2), 'utf8');
  return existing.settings.adminPassword;
}

function setBroadcast(text) {
  ensureDataFile();
  const existing = readDataInternal();
  const cleaned = String(text || '').slice(0, 200).trim();
  existing.broadcast = {
    id: Date.now(),
    text: cleaned,
    createdAt: Date.now()
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(existing, null, 2), 'utf8');
  // 返回剥离密码版
  const out = JSON.parse(JSON.stringify(existing));
  if (out.settings) delete out.settings.adminPassword;
  return out;
}

// 主转盘启动消耗 1 次
// 返回 { ok, remaining, unlimited, message? }
function consumeSpin() {
  ensureDataFile();
  const existing = readDataInternal();
  const s = existing.settings;
  if (s.spinUnlimited) {
    return { ok: true, remaining: s.spinCount, unlimited: true };
  }
  if (s.spinCount <= 0) {
    return { ok: false, remaining: 0, unlimited: false, message: '转动次数已用完,请联系主播添加' };
  }
  s.spinCount = Math.max(0, s.spinCount - 1);
  fs.writeFileSync(DATA_FILE, JSON.stringify(existing, null, 2), 'utf8');
  return { ok: true, remaining: s.spinCount, unlimited: false };
}

// 猜左右
// guess: 'left' | 'right'
// 返回 { ok, correct, answer, delta, remaining, unlimited }
function applyGuess(guess) {
  ensureDataFile();
  const existing = readDataInternal();
  const s = existing.settings;
  const g = guess === 'left' ? 'left' : guess === 'right' ? 'right' : null;
  if (!g) {
    return { ok: false, message: '无效的猜测,只能是 left 或 right' };
  }
  // 服务端随机生成正确答案(防前端作弊)
  const answer = Math.random() < 0.5 ? 'left' : 'right';
  const correct = (g === answer);
  let delta = 0;
  if (correct) {
    delta = +Math.max(0, Math.floor(Number(s.guessRewardOnCorrect) || 0));
  } else {
    const lo = Math.max(0, Math.floor(Number(s.guessPenaltyMin) || 1));
    const hi = Math.max(lo, Math.floor(Number(s.guessPenaltyMax) || 10));
    delta = lo + Math.floor(Math.random() * (hi - lo + 1)); // [lo, hi]
  }
  // 应用 delta(无限模式也累加,主播切回有限模式后值仍正确)
  s.spinCount = Math.max(0, (Number(s.spinCount) || 0) + delta);
  fs.writeFileSync(DATA_FILE, JSON.stringify(existing, null, 2), 'utf8');
  return {
    ok: true,
    correct,
    answer,
    delta,
    remaining: s.spinCount,
    unlimited: !!s.spinUnlimited
  };
}

function isAuthorized(req) {
  const data = readDataInternal();
  const pwd = data.settings.adminPassword || '';
  if (!pwd) return true; // 未设置密码 → 任何人均可
  const token = String(req.headers[ADMIN_AUTH_HEADER] || '');
  return token === pwd;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function readBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) {
        reject(new Error('请求内容过大'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function safeJoin(base, target) {
  const targetPath = path.normalize(path.join(base, target));
  return targetPath.startsWith(base) ? targetPath : null;
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let filePath = safeJoin(PUBLIC_DIR, urlPath === '/' ? '/index.html' : urlPath);

  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': mimeTypes[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600'
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const pathname = (req.url || '/').split('?')[0];

    // ===== 公共数据读取(剥离 adminPassword)=====
    if (pathname === '/api/data' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, data: readDataPublic() });
    }

    // ===== 玩家页保存:仅允许 autoSpinNext / peopleCount =====
    if (pathname === '/api/data' && req.method === 'POST') {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      const saved = writePlayerSafe(payload.data || payload);
      return sendJson(res, 200, { ok: true, data: saved });
    }

    // ===== 检查是否需要密码 =====
    if (pathname === '/api/admin/status' && req.method === 'GET') {
      const data = readDataInternal();
      const passwordRequired = !!(data.settings.adminPassword && data.settings.adminPassword.length);
      return sendJson(res, 200, { ok: true, passwordRequired });
    }

    // ===== 管理员登录 =====
    if (pathname === '/api/admin/login' && req.method === 'POST') {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      const data = readDataInternal();
      const pwd = data.settings.adminPassword || '';
      if (!pwd) {
        return sendJson(res, 200, { ok: true, token: '', passwordRequired: false });
      }
      if (String(payload.password || '') === pwd) {
        return sendJson(res, 200, { ok: true, token: pwd, passwordRequired: true });
      }
      return sendJson(res, 401, { ok: false, message: '密码不正确' });
    }

    // ===== 管理员设置/修改密码 =====
    if (pathname === '/api/admin/password' && req.method === 'POST') {
      if (!isAuthorized(req)) {
        return sendJson(res, 401, { ok: false, message: '未授权,请先登录' });
      }
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      const newPwd = setAdminPassword(payload.newPassword);
      return sendJson(res, 200, {
        ok: true,
        token: newPwd,
        passwordRequired: !!newPwd,
        message: newPwd ? '密码已更新' : '密码已清空(密码保护已关闭)'
      });
    }

    // ===== 管理员保存全量数据(导入、改权重、删除等)=====
    if (pathname === '/api/admin/save' && req.method === 'POST') {
      if (!isAuthorized(req)) {
        return sendJson(res, 401, { ok: false, message: '未授权,请先登录' });
      }
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      const saved = writeDataInternal(payload.data || payload);
      return sendJson(res, 200, { ok: true, data: saved });
    }

    // ===== 恢复示例数据(管理员)=====
    if (pathname === '/api/reset' && req.method === 'POST') {
      if (!isAuthorized(req)) {
        return sendJson(res, 401, { ok: false, message: '未授权,请先登录' });
      }
      const saved = writeDataInternal(defaultData);
      return sendJson(res, 200, { ok: true, data: saved });
    }

    // ===== GM 飘屏(管理员)=====
    // 把消息写到 data.broadcast,玩家页轮询 GET /api/data 时拿到新 id 就触发飘屏
    if (pathname === '/api/broadcast' && req.method === 'POST') {
      if (!isAuthorized(req)) {
        return sendJson(res, 401, { ok: false, message: '未授权,请先登录' });
      }
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      const text = String(payload.text || '').trim();
      if (!text) {
        return sendJson(res, 400, { ok: false, message: '飘屏内容不能为空' });
      }
      const saved = setBroadcast(text);
      return sendJson(res, 200, { ok: true, data: saved });
    }

    // ===== 玩家:主转盘启动消耗 1 次(无需鉴权)=====
    if (pathname === '/api/spin/start' && req.method === 'POST') {
      const result = consumeSpin();
      return sendJson(res, result.ok ? 200 : 409, result);
    }

    // ===== 玩家:猜左右(无需鉴权,正确答案服务端生成防作弊)=====
    if (pathname === '/api/guess' && req.method === 'POST') {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      const result = applyGuess(payload.guess);
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    return serveStatic(req, res);
  } catch (err) {
    return sendJson(res, 500, { ok: false, message: err.message || 'Server error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  ensureDataFile();
  console.log(`Truth Dare Wheel running at http://0.0.0.0:${PORT}`);
  console.log(`Wheel page: http://0.0.0.0:${PORT}/`);
  console.log(`Admin page: http://0.0.0.0:${PORT}/admin.html`);
});
