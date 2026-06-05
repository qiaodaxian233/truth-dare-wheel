const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3101);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'wheel-data.json');
const ADMIN_AUTH_HEADER = 'x-admin-auth';

// ===== 海龟汤 AI 主持人:转发到 qwen2API(同源代理,免跨域)=====
// 优先读环境变量,没有则用默认值。生产建议在 ecosystem.config.js 的 env 里设。
const QWEN_BASE = process.env.QWEN_BASE || 'http://127.0.0.1:7860';
const QWEN_KEY = process.env.QWEN_KEY || '';   // qwen2API 后台签发的 API Key
const QWEN_MODEL = process.env.QWEN_MODEL || 'qwen3.6-plus';

// 转发一次 chat 请求到 qwen2API,返回 assistant 文本
function qwenChat(system, user, maxTokens) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: QWEN_MODEL,
      stream: false,
      enable_thinking: false,
      max_tokens: maxTokens || 200,
      messages: [
        { role: 'system', content: String(system || '') },
        { role: 'user', content: String(user || '') }
      ]
    });
    let u;
    try { u = new URL(QWEN_BASE + '/v1/chat/completions'); }
    catch (e) { return reject(new Error('QWEN_BASE 配置错误')); }
    const lib = u.protocol === 'https:' ? https : http;
    const opt = {
      method: 'POST',
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + QWEN_KEY,
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 60000
    };
    const r = lib.request(opt, resp => {
      let body = '';
      resp.on('data', c => body += c);
      resp.on('end', () => {
        if (resp.statusCode < 200 || resp.statusCode >= 300) {
          return reject(new Error('qwen2API ' + resp.statusCode + '：' + body.slice(0, 160)));
        }
        try {
          const data = JSON.parse(body);
          const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '';
          resolve(String(text).trim());
        } catch (e) { reject(new Error('解析 qwen2API 响应失败')); }
      });
    });
    r.on('timeout', () => { r.destroy(); reject(new Error('qwen2API 响应超时')); });
    r.on('error', e => reject(new Error('连接 qwen2API 失败：' + e.message)));
    r.write(payload);
    r.end();
  });
}

// ===== 获取客户端真实 IP =====
// 按优先级:X-Forwarded-For 首段 → X-Real-IP → socket.remoteAddress
// 宝塔 nginx 反代会设置前两个头
function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const first = String(xff).split(',')[0].trim();
    if (first) return cleanIp(first);
  }
  const xri = req.headers['x-real-ip'];
  if (xri) return cleanIp(String(xri).trim());
  return cleanIp(req.socket?.remoteAddress || '');
}
function cleanIp(ip) {
  if (!ip) return '';
  let s = String(ip).trim();
  // IPv4-mapped IPv6 前缀
  if (s.startsWith('::ffff:')) s = s.slice(7);
  return s;
}

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
    spinCountDefault: 0,     // 新 IP 进入时默认获得的转动次数
    spinUnlimited: false,    // 全局无限转,开启后所有玩家忽略次数限制
    guessEnabled: true,      // 启用「猜左右」环节
    guessRewardOnCorrect: -1,// 猜对时 spinCount 增量(默认 -1=再扣 1; 0=不变; +1=返还)
    guessPenaltyMin: 1,      // 猜错惩罚最小值
    guessPenaltyMax: 10      // 猜错惩罚最大值
  },
  broadcast: { id: 0, text: '', createdAt: 0 },
  // ===== 按 IP 隔离的转动次数池 =====
  spinByIp: {},
  // ===== 专属定制版本 =====
  // key = slug(URL 段), value = { name, slug, allowSelfTopup, selfTopupAmount, createdAt }
  profiles: {}
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

  // 兼容旧版:settings.spinCount(单一全局值) → settings.spinCountDefault
  let defaultCount;
  if (settingsIn.spinCountDefault !== undefined && Number.isFinite(Number(settingsIn.spinCountDefault))) {
    defaultCount = Math.max(0, Math.floor(Number(settingsIn.spinCountDefault)));
  } else if (Number.isFinite(Number(settingsIn.spinCount))) {
    // 老字段迁移
    defaultCount = Math.max(0, Math.floor(Number(settingsIn.spinCount)));
  } else {
    defaultCount = 0;
  }

  // spinByIp 校验:key 必须是合法字符串 IP,value 必须是 {count,lastActive}
  const rawIpMap = src.spinByIp && typeof src.spinByIp === 'object' ? src.spinByIp : {};
  const spinByIp = {};
  for (const [ip, v] of Object.entries(rawIpMap)) {
    if (!ip || typeof ip !== 'string' || ip.length > 80) continue;
    const entry = v && typeof v === 'object' ? v : {};
    spinByIp[ip] = {
      count: Math.max(0, Math.floor(num(entry.count, 0, 0, 99999))),
      lastActive: Math.max(0, Math.floor(num(entry.lastActive, 0, 0, Number.MAX_SAFE_INTEGER)))
    };
  }

  // profiles 校验:key 必须是 [a-zA-Z0-9_-]{2,32}
  // value 是 {name, slug, allowSelfTopup, selfTopupAmount, initialCount, claimedIps, createdAt}
  const rawProfiles = src.profiles && typeof src.profiles === 'object' ? src.profiles : {};
  const profiles = {};
  for (const [slug, p] of Object.entries(rawProfiles)) {
    if (!slug || typeof slug !== 'string') continue;
    if (!/^[a-zA-Z0-9_-]{2,32}$/.test(slug)) continue;
    const entry = p && typeof p === 'object' ? p : {};
    const name = String(entry.name || '').trim().slice(0, 32);
    if (!name) continue;
    // claimedIps: { "<ip>": timestamp_ms }
    const rawClaimed = entry.claimedIps && typeof entry.claimedIps === 'object' ? entry.claimedIps : {};
    const claimedIps = {};
    for (const [ip, ts] of Object.entries(rawClaimed)) {
      if (!ip || typeof ip !== 'string' || ip.length > 80) continue;
      const t = Math.max(0, Math.floor(num(ts, 0, 0, Number.MAX_SAFE_INTEGER)));
      if (t > 0) claimedIps[ip] = t;
    }
    profiles[slug] = {
      name,
      slug,
      allowSelfTopup: !!entry.allowSelfTopup,
      selfTopupAmount: Math.max(1, Math.min(50, Math.floor(num(entry.selfTopupAmount, 5, 1, 50)))),
      // initialCount: 首次访问该专属页时一次性赠送的次数(0~9999,跟礼物分挂钩)
      initialCount: Math.max(0, Math.min(9999, Math.floor(num(entry.initialCount, 0, 0, 9999)))),
      claimedIps,
      createdAt: Math.max(0, Math.floor(num(entry.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER)))
    };
  }

  return {
    main: normalizeMain(src.main),
    truth: normalizeList(src.truth && src.truth.length ? src.truth : defaultData.truth),
    dare: normalizeList(src.dare && src.dare.length ? src.dare : defaultData.dare),
    settings: {
      ...defaultData.settings,
      ...settingsIn,
      adminPassword: typeof settingsIn.adminPassword === 'string' ? settingsIn.adminPassword : '',
      spinCountDefault: defaultCount,
      spinUnlimited: !!settingsIn.spinUnlimited,
      guessEnabled: settingsIn.guessEnabled === undefined ? true : !!settingsIn.guessEnabled,
      // 猜对增量:允许负数(-1=猜对再扣 1, 0=不变, 1=返还 1)
      guessRewardOnCorrect: Math.floor(num(settingsIn.guessRewardOnCorrect, -1, -100, 100)),
      guessPenaltyMin: Math.max(0, Math.floor(num(settingsIn.guessPenaltyMin, 1, 0, 100))),
      guessPenaltyMax: Math.max(0, Math.floor(num(settingsIn.guessPenaltyMax, 10, 0, 100)))
    },
    broadcast: {
      id: Number(broadcastIn.id) || 0,
      text: String(broadcastIn.text || '').slice(0, 200),
      createdAt: Number(broadcastIn.createdAt) || 0
    },
    spinByIp,
    profiles
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

// 对外读取(剥离 adminPassword + spinByIp + profiles,注入当前 IP 的剩余次数)
// profiles 不整体暴露(隐私 + 防探测),玩家页通过 /api/profile/get?slug=xxx 单独查询
function readDataPublic(clientIp) {
  const d = readDataInternal();
  if (d.settings) {
    const { adminPassword, ...rest } = d.settings;
    d.settings = rest;
    // 注入当前 IP 的剩余次数(向前兼容前端 settings.spinCount 字段)
    const ipEntry = clientIp && d.spinByIp && d.spinByIp[clientIp];
    d.settings.spinCount = ipEntry
      ? ipEntry.count
      : Math.max(0, Math.floor(Number(d.settings.spinCountDefault) || 0));
  }
  delete d.spinByIp;
  delete d.profiles;
  return d;
}

// 单个专属页查询(玩家页用,只返回必要的公开字段)
// 返回 alreadyClaimed:让前端知道这个 IP 是否已领过 initialCount(不重复显示"已发放"提示)
function getProfilePublic(slug, ip) {
  if (!slug) return null;
  const d = readDataInternal();
  const p = d.profiles && d.profiles[slug];
  if (!p) return null;
  return {
    slug: p.slug,
    name: p.name,
    allowSelfTopup: !!p.allowSelfTopup,
    selfTopupAmount: Number(p.selfTopupAmount) || 5,
    initialCount: Number(p.initialCount) || 0,
    alreadyClaimed: ip && p.claimedIps && !!p.claimedIps[ip]
  };
}

// 管理员保存:能改 main/truth/dare/settings(但不能通过此接口改密码 / spinByIp / profiles)
function writeDataInternal(newData) {
  ensureDataFile();
  const existing = readDataInternal();
  const normalized = normalizeData(newData);
  // 始终保留磁盘上原有的密码 + spinByIp + profiles,这些有专用接口修改
  normalized.settings.adminPassword = existing.settings.adminPassword || '';
  normalized.spinByIp = existing.spinByIp || {};
  normalized.profiles = existing.profiles || {};
  fs.writeFileSync(DATA_FILE, JSON.stringify(normalized, null, 2), 'utf8');
  // 返回对外版(剥离密码 + spinByIp + profiles)
  const out = JSON.parse(JSON.stringify(normalized));
  if (out.settings) delete out.settings.adminPassword;
  delete out.spinByIp;
  delete out.profiles;
  return out;
}

// 玩家页保存:只允许更新 settings 中的非敏感字段(autoSpinNext, peopleCount 等)
// 不能改 main/truth/dare,不能改密码,不能改 spinCountDefault,不能改 spinByIp
function writePlayerSafe(newData, clientIp) {
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
    broadcast: existing.broadcast || { id: 0, text: '', createdAt: 0 },
    spinByIp: existing.spinByIp || {},
    profiles: existing.profiles || {}
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(merged, null, 2), 'utf8');
  // 返回时构造对外版(注入当前 IP 的 spinCount,剥离密码/spinByIp)
  const out = JSON.parse(JSON.stringify(merged));
  if (out.settings) delete out.settings.adminPassword;
  const ipEntry = clientIp && out.spinByIp && out.spinByIp[clientIp];
  out.settings.spinCount = ipEntry
    ? ipEntry.count
    : Math.max(0, Math.floor(Number(out.settings.spinCountDefault) || 0));
  delete out.spinByIp;
  delete out.profiles;
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

// 取/初始化某个 IP 的 spin 记录(惰性创建)
// 注意:这个 helper 会修改传入的 data 对象,调用者负责写盘
function ensureIpEntry(data, ip) {
  if (!ip) return null;
  if (!data.spinByIp || typeof data.spinByIp !== 'object') data.spinByIp = {};
  if (!data.spinByIp[ip]) {
    data.spinByIp[ip] = {
      count: Math.max(0, Math.floor(Number(data.settings.spinCountDefault) || 0)),
      lastActive: 0
    };
  }
  return data.spinByIp[ip];
}

// 主转盘启动:当前 IP 消耗 1 次
// 返回 { ok, remaining, unlimited, message? }
function consumeSpin(ip) {
  ensureDataFile();
  const existing = readDataInternal();
  const s = existing.settings;
  if (s.spinUnlimited) {
    // 无限模式不扣,但仍记录活跃时间
    const entry = ensureIpEntry(existing, ip);
    if (entry) {
      entry.lastActive = Date.now();
      fs.writeFileSync(DATA_FILE, JSON.stringify(existing, null, 2), 'utf8');
    }
    return { ok: true, remaining: entry ? entry.count : 0, unlimited: true };
  }
  const entry = ensureIpEntry(existing, ip);
  if (!entry || entry.count <= 0) {
    return {
      ok: false,
      remaining: 0,
      unlimited: false,
      message: '转动次数已用完,请联系主播添加'
    };
  }
  entry.count = Math.max(0, entry.count - 1);
  entry.lastActive = Date.now();
  fs.writeFileSync(DATA_FILE, JSON.stringify(existing, null, 2), 'utf8');
  return { ok: true, remaining: entry.count, unlimited: false };
}

// 猜左右
// guess: 'left' | 'right'
// 返回 { ok, correct, answer, delta, remaining, unlimited }
function applyGuess(ip, guess) {
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
    delta = Math.floor(Number(s.guessRewardOnCorrect));
    if (!Number.isFinite(delta)) delta = -1;
  } else {
    const lo = Math.max(0, Math.floor(Number(s.guessPenaltyMin) || 1));
    const hi = Math.max(lo, Math.floor(Number(s.guessPenaltyMax) || 10));
    delta = lo + Math.floor(Math.random() * (hi - lo + 1)); // [lo, hi]
  }
  // 找到该 IP 的记录,应用 delta(无 IP 时仍然算,记录到一个 "unknown" 桶不太合适,直接返回 default+delta 不写盘)
  const entry = ensureIpEntry(existing, ip);
  if (entry) {
    entry.count = Math.max(0, Math.min(99999, entry.count + delta));
    entry.lastActive = Date.now();
    fs.writeFileSync(DATA_FILE, JSON.stringify(existing, null, 2), 'utf8');
  }
  return {
    ok: true,
    correct,
    answer,
    delta,
    remaining: entry ? entry.count : 0,
    unlimited: !!s.spinUnlimited
  };
}

// ===== Admin:IP 管理 =====

function listIps() {
  const d = readDataInternal();
  const byIp = d.spinByIp || {};
  const out = Object.entries(byIp).map(([ip, v]) => ({
    ip,
    count: Number(v.count) || 0,
    lastActive: Number(v.lastActive) || 0
  }));
  // 按最近活跃时间倒序
  out.sort((a, b) => b.lastActive - a.lastActive);
  return {
    total: out.length,
    spinCountDefault: Number(d.settings.spinCountDefault) || 0,
    spinUnlimited: !!d.settings.spinUnlimited,
    list: out
  };
}

// 设置特定 IP 的次数(覆盖)
function setIpCount(ip, count) {
  if (!ip) return { ok: false, message: 'IP 不能为空' };
  const v = Math.max(0, Math.min(99999, Math.floor(Number(count))));
  if (!Number.isFinite(v)) return { ok: false, message: '次数不合法' };
  ensureDataFile();
  const existing = readDataInternal();
  if (!existing.spinByIp) existing.spinByIp = {};
  if (!existing.spinByIp[ip]) {
    existing.spinByIp[ip] = { count: 0, lastActive: Date.now() };
  }
  existing.spinByIp[ip].count = v;
  fs.writeFileSync(DATA_FILE, JSON.stringify(existing, null, 2), 'utf8');
  return { ok: true, ip, count: v };
}

// 给特定 IP 加减次数(增量)
function addIpCount(ip, delta) {
  if (!ip) return { ok: false, message: 'IP 不能为空' };
  const d = Math.floor(Number(delta));
  if (!Number.isFinite(d) || d === 0) return { ok: false, message: '增量不合法' };
  ensureDataFile();
  const existing = readDataInternal();
  const entry = ensureIpEntry(existing, ip);
  entry.count = Math.max(0, Math.min(99999, entry.count + d));
  fs.writeFileSync(DATA_FILE, JSON.stringify(existing, null, 2), 'utf8');
  return { ok: true, ip, count: entry.count, delta: d };
}

// 删除特定 IP 的记录(下次该 IP 访问会重新分配 default)
function deleteIp(ip) {
  if (!ip) return { ok: false, message: 'IP 不能为空' };
  ensureDataFile();
  const existing = readDataInternal();
  if (existing.spinByIp && existing.spinByIp[ip]) {
    delete existing.spinByIp[ip];
    fs.writeFileSync(DATA_FILE, JSON.stringify(existing, null, 2), 'utf8');
  }
  return { ok: true, ip };
}

// 清空所有 IP 记录
function deleteAllIps() {
  ensureDataFile();
  const existing = readDataInternal();
  existing.spinByIp = {};
  fs.writeFileSync(DATA_FILE, JSON.stringify(existing, null, 2), 'utf8');
  return { ok: true };
}

// ===== Admin: 专属定制版本管理 =====

function generateSlug(existing) {
  // 6 位 [a-z0-9] 随机,冲突就重试
  for (let i = 0; i < 20; i++) {
    const s = Math.random().toString(36).slice(2, 8).replace(/[^a-z0-9]/g, 'x');
    if (s.length === 6 && !existing[s]) return s;
  }
  // 极端情况兜底
  return 'p' + Date.now().toString(36).slice(-5);
}

function listProfiles() {
  const d = readDataInternal();
  const list = Object.values(d.profiles || {}).sort((a, b) => b.createdAt - a.createdAt);
  return { ok: true, total: list.length, list };
}

function createProfile(payload) {
  const name = String(payload?.name || '').trim().slice(0, 32);
  if (!name) return { ok: false, message: '名字不能为空' };
  let slug = String(payload?.slug || '').trim();
  ensureDataFile();
  const existing = readDataInternal();
  if (!existing.profiles) existing.profiles = {};
  // slug 校验或自动生成
  if (slug) {
    if (!/^[a-zA-Z0-9_-]{2,32}$/.test(slug)) {
      return { ok: false, message: 'slug 只能含字母数字和 _-, 2-32 位' };
    }
    if (existing.profiles[slug]) return { ok: false, message: '该 URL 标识已存在' };
  } else {
    slug = generateSlug(existing.profiles);
  }
  const profile = {
    name,
    slug,
    allowSelfTopup: !!payload?.allowSelfTopup,
    selfTopupAmount: Math.max(1, Math.min(50, Math.floor(Number(payload?.selfTopupAmount) || 5))),
    initialCount: Math.max(0, Math.min(9999, Math.floor(Number(payload?.initialCount) || 0))),
    claimedIps: {},
    createdAt: Date.now()
  };
  existing.profiles[slug] = profile;
  fs.writeFileSync(DATA_FILE, JSON.stringify(existing, null, 2), 'utf8');
  return { ok: true, profile };
}

function updateProfile(payload) {
  const slug = String(payload?.slug || '').trim();
  if (!slug) return { ok: false, message: 'slug 不能为空' };
  ensureDataFile();
  const existing = readDataInternal();
  if (!existing.profiles || !existing.profiles[slug]) {
    return { ok: false, message: '专属版本不存在' };
  }
  const p = existing.profiles[slug];
  if (typeof payload.name === 'string') {
    const name = payload.name.trim().slice(0, 32);
    if (name) p.name = name;
  }
  if ('allowSelfTopup' in payload) p.allowSelfTopup = !!payload.allowSelfTopup;
  if ('selfTopupAmount' in payload) {
    p.selfTopupAmount = Math.max(1, Math.min(50, Math.floor(Number(payload.selfTopupAmount) || 5)));
  }
  if ('initialCount' in payload) {
    p.initialCount = Math.max(0, Math.min(9999, Math.floor(Number(payload.initialCount) || 0)));
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(existing, null, 2), 'utf8');
  return { ok: true, profile: p };
}

// 玩家首次访问某专属页时领取 initialCount(同一 IP 不重复领)
// 返回 { ok, added, remaining, alreadyClaimed }
function claimProfile(slug, ip) {
  if (!slug || !ip) return { ok: false, message: '参数不完整' };
  ensureDataFile();
  const existing = readDataInternal();
  const p = existing.profiles && existing.profiles[slug];
  if (!p) return { ok: false, message: '专属页不存在或已删除' };
  if (!p.claimedIps) p.claimedIps = {};
  const initialCount = Math.max(0, Math.floor(Number(p.initialCount) || 0));
  // 已经领过 → 不重复发,只返回当前状态
  if (p.claimedIps[ip]) {
    const entry = ensureIpEntry(existing, ip);
    return {
      ok: true,
      added: 0,
      remaining: entry.count,
      alreadyClaimed: true,
      initialCount
    };
  }
  // initialCount 为 0 → 啥都不加,但仍标记已领防止以后改了又重发
  const entry = ensureIpEntry(existing, ip);
  if (initialCount > 0) {
    entry.count = Math.max(0, Math.min(99999, entry.count + initialCount));
    entry.lastActive = Date.now();
  }
  p.claimedIps[ip] = Date.now();
  fs.writeFileSync(DATA_FILE, JSON.stringify(existing, null, 2), 'utf8');
  return {
    ok: true,
    added: initialCount,
    remaining: entry.count,
    alreadyClaimed: false,
    initialCount
  };
}

// 管理员重置某专属页的认领状态(让所有 IP 可以重新领 initialCount)
function resetProfileClaims(slug) {
  if (!slug) return { ok: false, message: 'slug 不能为空' };
  ensureDataFile();
  const existing = readDataInternal();
  if (!existing.profiles || !existing.profiles[slug]) {
    return { ok: false, message: '专属页不存在' };
  }
  existing.profiles[slug].claimedIps = {};
  fs.writeFileSync(DATA_FILE, JSON.stringify(existing, null, 2), 'utf8');
  return { ok: true };
}

function deleteProfile(slug) {
  if (!slug) return { ok: false, message: 'slug 不能为空' };
  ensureDataFile();
  const existing = readDataInternal();
  if (existing.profiles && existing.profiles[slug]) {
    delete existing.profiles[slug];
    fs.writeFileSync(DATA_FILE, JSON.stringify(existing, null, 2), 'utf8');
  }
  return { ok: true };
}

// 玩家通过专属页面自助加次数(允许时)
// 返回 { ok, remaining, added }
function profileSelfTopup(slug, ip) {
  if (!slug || !ip) return { ok: false, message: '参数不完整' };
  ensureDataFile();
  const existing = readDataInternal();
  const p = existing.profiles && existing.profiles[slug];
  if (!p) return { ok: false, message: '专属版本不存在或已删除' };
  if (!p.allowSelfTopup) return { ok: false, message: '此专属版本未开启「玩家自助加次数」' };
  const add = Math.max(1, Math.min(50, Math.floor(Number(p.selfTopupAmount) || 5)));
  const entry = ensureIpEntry(existing, ip);
  entry.count = Math.max(0, Math.min(99999, entry.count + add));
  entry.lastActive = Date.now();
  fs.writeFileSync(DATA_FILE, JSON.stringify(existing, null, 2), 'utf8');
  return { ok: true, remaining: entry.count, added: add };
}

// 专属页玩家直接覆盖当前 IP 的次数。仅 slug 校验 —— 设计上是"定制独有",
// 主播分发 URL 即视为信任范围。无次数上限以外的额外限制。
// 范围 0-99999(跟 setIpCount 一致)。
function profileSetCount(slug, ip, count) {
  if (!slug || !ip) return { ok: false, message: '参数不完整' };
  const v = Math.max(0, Math.min(99999, Math.floor(Number(count))));
  if (!Number.isFinite(v)) return { ok: false, message: '次数不合法' };
  ensureDataFile();
  const existing = readDataInternal();
  const p = existing.profiles && existing.profiles[slug];
  if (!p) return { ok: false, message: '专属版本不存在或已删除' };
  const entry = ensureIpEntry(existing, ip);
  entry.count = v;
  entry.lastActive = Date.now();
  fs.writeFileSync(DATA_FILE, JSON.stringify(existing, null, 2), 'utf8');
  return { ok: true, remaining: entry.count };
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
    const clientIp = getClientIp(req);

    // ===== 海龟汤 AI 主持人(同源代理到 qwen2API)=====
    if (pathname === '/api/soup-chat' && req.method === 'POST') {
      if (!QWEN_KEY) {
        return sendJson(res, 503, { ok: false, message: '服务端未配置 QWEN_KEY' });
      }
      const raw = await readBody(req);
      let p;
      try { p = JSON.parse(raw || '{}'); } catch (e) { return sendJson(res, 400, { ok: false, message: '请求格式错误' }); }
      if (!p.system || !p.user) {
        return sendJson(res, 400, { ok: false, message: '缺少 system 或 user' });
      }
      try {
        const text = await qwenChat(p.system, p.user, Number(p.maxTokens) || 200);
        return sendJson(res, 200, { ok: true, text });
      } catch (e) {
        return sendJson(res, 502, { ok: false, message: e.message });
      }
    }

    // ===== 公共数据读取(剥离 adminPassword + spinByIp,注入当前 IP 的 spinCount)=====
    if (pathname === '/api/data' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, data: readDataPublic(clientIp) });
    }

    // ===== 玩家页保存:仅允许 autoSpinNext / peopleCount =====
    if (pathname === '/api/data' && req.method === 'POST') {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      const saved = writePlayerSafe(payload.data || payload, clientIp);
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

    // ===== 玩家:主转盘启动消耗 1 次(按 IP)=====
    if (pathname === '/api/spin/start' && req.method === 'POST') {
      const result = consumeSpin(clientIp);
      return sendJson(res, result.ok ? 200 : 409, result);
    }

    // ===== 玩家:猜左右(按 IP)=====
    if (pathname === '/api/guess' && req.method === 'POST') {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      const result = applyGuess(clientIp, payload.guess);
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    // ===== Admin:IP 管理 =====
    if (pathname === '/api/admin/ips' && req.method === 'GET') {
      if (!isAuthorized(req)) {
        return sendJson(res, 401, { ok: false, message: '未授权,请先登录' });
      }
      return sendJson(res, 200, { ok: true, ...listIps() });
    }
    if (pathname === '/api/admin/ip/set' && req.method === 'POST') {
      if (!isAuthorized(req)) {
        return sendJson(res, 401, { ok: false, message: '未授权,请先登录' });
      }
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      const result = setIpCount(String(payload.ip || '').trim(), payload.count);
      return sendJson(res, result.ok ? 200 : 400, result);
    }
    if (pathname === '/api/admin/ip/add' && req.method === 'POST') {
      if (!isAuthorized(req)) {
        return sendJson(res, 401, { ok: false, message: '未授权,请先登录' });
      }
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      const result = addIpCount(String(payload.ip || '').trim(), payload.delta);
      return sendJson(res, result.ok ? 200 : 400, result);
    }
    if (pathname === '/api/admin/ip/reset' && req.method === 'POST') {
      if (!isAuthorized(req)) {
        return sendJson(res, 401, { ok: false, message: '未授权,请先登录' });
      }
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      const result = deleteIp(String(payload.ip || '').trim());
      return sendJson(res, result.ok ? 200 : 400, result);
    }
    if (pathname === '/api/admin/ip/reset-all' && req.method === 'POST') {
      if (!isAuthorized(req)) {
        return sendJson(res, 401, { ok: false, message: '未授权,请先登录' });
      }
      return sendJson(res, 200, deleteAllIps());
    }

    // ===== Admin: 专属定制版本管理 =====
    if (pathname === '/api/admin/profiles' && req.method === 'GET') {
      if (!isAuthorized(req)) {
        return sendJson(res, 401, { ok: false, message: '未授权,请先登录' });
      }
      return sendJson(res, 200, listProfiles());
    }
    if (pathname === '/api/admin/profile/create' && req.method === 'POST') {
      if (!isAuthorized(req)) {
        return sendJson(res, 401, { ok: false, message: '未授权,请先登录' });
      }
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      const result = createProfile(payload);
      return sendJson(res, result.ok ? 200 : 400, result);
    }
    if (pathname === '/api/admin/profile/update' && req.method === 'POST') {
      if (!isAuthorized(req)) {
        return sendJson(res, 401, { ok: false, message: '未授权,请先登录' });
      }
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      const result = updateProfile(payload);
      return sendJson(res, result.ok ? 200 : 400, result);
    }
    if (pathname === '/api/admin/profile/delete' && req.method === 'POST') {
      if (!isAuthorized(req)) {
        return sendJson(res, 401, { ok: false, message: '未授权,请先登录' });
      }
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      const result = deleteProfile(String(payload.slug || '').trim());
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    // ===== 玩家:专属版本自助加次数(无需鉴权,服务端校验 slug.allowSelfTopup)=====
    if (pathname === '/api/profile/topup' && req.method === 'POST') {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      const result = profileSelfTopup(String(payload.slug || '').trim(), clientIp);
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    // ===== 玩家:专属版本「设置次数」(覆盖当前 IP 次数,仅校验 slug 存在)=====
    // 设计:专属页是主播分发给特定玩家的,知道 slug 即视为信任范围内,无需密码
    if (pathname === '/api/profile/set-count' && req.method === 'POST') {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      const result = profileSetCount(
        String(payload.slug || '').trim(),
        clientIp,
        payload.count
      );
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    // ===== 玩家:查询单个专属页(无需鉴权,只返回必要公开字段)=====
    if (pathname === '/api/profile/get' && req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      const slug = String(url.searchParams.get('slug') || '').trim();
      const p = getProfilePublic(slug, clientIp);
      if (!p) return sendJson(res, 404, { ok: false, message: '专属页不存在或已删除' });
      return sendJson(res, 200, { ok: true, profile: p });
    }

    // ===== 玩家:领取专属页 initialCount(每 IP 仅一次)=====
    if (pathname === '/api/profile/claim' && req.method === 'POST') {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      const result = claimProfile(String(payload.slug || '').trim(), clientIp);
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    // ===== 管理员:重置某专属页的认领状态 =====
    if (pathname === '/api/admin/profile/reset-claims' && req.method === 'POST') {
      if (!isAuthorized(req)) {
        return sendJson(res, 401, { ok: false, message: '未授权,请先登录' });
      }
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      const result = resetProfileClaims(String(payload.slug || '').trim());
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
