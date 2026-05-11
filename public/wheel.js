const WHEEL_SAMPLE_SIZE = 10;  // 真心话/大冒险大转盘每轮最多显示的题数;题库超过这个数会按权重无放回抽样

const state = {
  mode: 'main',
  angle: 0,
  spinning: false,
  dataHash: '',
  cacheKey: '',
  cacheImage: null,
  // 当前显示在大转盘上的抽样池(仅 truth/dare 用;main 直接读 state.data.main)
  wheelPool: { mode: '', items: [] },
  soundEnabled: localStorage.getItem('wheelSoundEnabled') !== '0',
  sound: {
    ctx: null,
    master: null,
    tickTimer: null,
    spinStartedAt: 0,
    spinDuration: 0
  },
  data: {
    main: [
      { label: '真心话', route: 'truth', icon: '💬', weight: 1 },
      { label: '大冒险', route: 'dare', icon: '⚡', weight: 1 }
    ],
    truth: [],
    dare: [],
    settings: { autoSpinNext: false, pageTitle: '真心话 · 大冒险', peopleCount: 3 },
    broadcast: { id: 0, text: '', createdAt: 0 }
  },
  lastBroadcastId: -1
};

const canvas = document.getElementById('wheel');
const ctx = canvas.getContext('2d', { alpha: true });
const spinBtn = document.getElementById('spinBtn');
const sideSpinBtn = document.getElementById('sideSpinBtn');
const soundToggle = document.getElementById('soundToggle');
const resultLine = document.getElementById('resultLine');
const resultTip = document.getElementById('resultTip');
const modeName = document.getElementById('modeName');
const autoSpinNext = document.getElementById('autoSpinNext');
const resultModal = document.getElementById('resultModal');
const modalKicker = document.getElementById('modalKicker');
const modalTitle = document.getElementById('modalTitle');
const modalText = document.getElementById('modalText');
const modalAgain = document.getElementById('modalAgain');
const modalBack = document.getElementById('modalBack');
const closeModal = document.getElementById('closeModal');
const peopleCountInput = document.getElementById('peopleCount');
const peopleMinus = document.getElementById('peopleMinus');
const peoplePlus = document.getElementById('peoplePlus');
const pickerGo = document.getElementById('pickerGo');
const pickerResult = document.getElementById('pickerResult');

// 转动次数 / 猜左右
const spinCountPill = document.getElementById('spinCountPill');
const spinCountValue = document.getElementById('spinCountValue');
const spinUnlimitedBadge = document.getElementById('spinUnlimitedBadge');
const guessBox = document.getElementById('guessBox');
const guessLeftBtn = document.getElementById('guessLeftBtn');
const guessRightBtn = document.getElementById('guessRightBtn');
const guessResult = document.getElementById('guessResult');

// 主界面转动次数(只读卡片)
const spinControlCard = document.getElementById('spinControlCard');
const spinControlNum = document.getElementById('spinControlNum');
const spinControlHint = document.getElementById('spinControlHint');

// 专属定制版本
const profileBadge = document.getElementById('profileBadge');
const profileBadgeName = document.getElementById('profileBadgeName');
const brandSubtitle = document.getElementById('brandSubtitle');
const spinSelfTopup = document.getElementById('spinSelfTopup');
const spinSelfTopupBtn = document.getElementById('spinSelfTopupBtn');
const spinSelfTopupAmount = document.getElementById('spinSelfTopupAmount');
const spinSelfTopupHint = document.getElementById('spinSelfTopupHint');

// 当前页面专属 slug(从 URL 解析)
const URL_PROFILE_MATCH = location.pathname.match(/^\/p\/([a-zA-Z0-9_-]{2,32})/);
const CURRENT_PROFILE_SLUG = URL_PROFILE_MATCH ? URL_PROFILE_MATCH[1] : null;

const palette = [
  ['#31f7ff', '#0ea5e9'], ['#ff3cf0', '#a855f7'], ['#ffd166', '#fb923c'],
  ['#34d399', '#10b981'], ['#f472b6', '#e11d48'], ['#a78bfa', '#6366f1'],
  ['#facc15', '#f97316'], ['#22d3ee', '#2563eb'], ['#fb7185', '#be123c'],
  ['#c084fc', '#7c3aed']
];

// ===== 转动次数显示 + 猜左右 =====
function updateSpinCountDisplay(info) {
  const remaining = Number(info?.remaining ?? state.data?.settings?.spinCount) || 0;
  const unlimited = !!(info?.unlimited ?? state.data?.settings?.spinUnlimited);
  // topbar 胶囊
  if (spinCountPill) {
    spinCountPill.hidden = false;
    if (spinCountValue) spinCountValue.textContent = unlimited ? '∞' : String(remaining);
    if (spinUnlimitedBadge) spinUnlimitedBadge.hidden = !unlimited;
    spinCountPill.classList.toggle('is-empty', !unlimited && remaining <= 0);
  }
  // 主界面只读卡片的大数字
  if (spinControlNum) {
    spinControlNum.textContent = unlimited ? '∞' : String(remaining);
    spinControlNum.classList.toggle('is-empty', !unlimited && remaining <= 0);
  }
  if (spinControlHint) {
    if (unlimited) {
      spinControlHint.textContent = '♾ 当前为无限转模式,主播已开启不限次数。';
    } else if (remaining <= 0) {
      spinControlHint.textContent = '⚠ 转动次数已用完,请联系主播补充次数。';
    } else {
      spinControlHint.textContent = '每次点 START 消耗 1 次。次数用完后请联系主播补充。';
    }
  }
  // 没次数 + 非无限 → 禁用 START
  const noSpinsLeft = !unlimited && remaining <= 0;
  const isMain = state.mode === 'main';
  if (spinBtn) {
    spinBtn.disabled = state.spinning || (isMain && noSpinsLeft);
    spinBtn.classList.toggle('is-disabled-empty', isMain && noSpinsLeft);
  }
  if (sideSpinBtn) {
    sideSpinBtn.disabled = state.spinning || (isMain && noSpinsLeft);
  }
  if (resultTip && isMain && noSpinsLeft && !state.spinning) {
    resultTip.textContent = '⚠ 转动次数已用完,请联系主播补充';
  }
}

// ===== 专属定制版本 =====
// 专属页信息缓存(避免每次轮询都重新拉);失效时清掉
let currentProfile = null;
let profileLoadedForSlug = null;
let profileClaimAttempted = false; // 本次页面加载是否已尝试过 claim

async function applyProfile() {
  // 没 slug → 隐藏 badge / 自助加按钮
  if (!CURRENT_PROFILE_SLUG) {
    if (profileBadge) profileBadge.hidden = true;
    if (spinSelfTopup) spinSelfTopup.hidden = true;
    return;
  }
  // 已经拉过这个 slug 就直接用缓存
  if (profileLoadedForSlug === CURRENT_PROFILE_SLUG) {
    return applyProfileToUI(currentProfile);
  }
  // 异步拉单个 profile(服务端不再整体暴露 profiles 列表)
  try {
    const res = await fetch(`/api/profile/get?slug=${encodeURIComponent(CURRENT_PROFILE_SLUG)}`, { cache: 'no-store' });
    if (res.status === 404) {
      currentProfile = null;
    } else {
      const json = await res.json();
      currentProfile = json.ok ? json.profile : null;
    }
    profileLoadedForSlug = CURRENT_PROFILE_SLUG;
    applyProfileToUI(currentProfile);
    // 有效 profile 且尚未领取 → 自动 claim 一次 initialCount
    if (currentProfile && !currentProfile.alreadyClaimed && currentProfile.initialCount > 0 && !profileClaimAttempted) {
      profileClaimAttempted = true;
      claimProfileInitial();
    }
  } catch (err) {
    console.warn('profile fetch failed:', err);
    currentProfile = null;
    profileLoadedForSlug = CURRENT_PROFILE_SLUG;
    applyProfileToUI(null);
  }
}

// 自动领取专属页初始次数(每个 IP 一次,服务端校验)
async function claimProfileInitial() {
  try {
    const res = await fetch('/api/profile/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: CURRENT_PROFILE_SLUG })
    });
    const json = await res.json();
    if (!json.ok) return;
    if (json.added > 0) {
      // 同步本地次数 + UI
      if (state.data && state.data.settings) {
        state.data.settings.spinCount = json.remaining;
      }
      updateSpinCountDisplay({ remaining: json.remaining });
      // 缓存里也标记已领,避免本次会话再触发
      if (currentProfile) currentProfile.alreadyClaimed = true;
      showToast(`🎁 ${currentProfile.name} 专属:获得 ${json.added} 次抽奖!`);
    }
  } catch (err) {
    console.warn('profile claim failed:', err);
  }
}

function applyProfileToUI(p) {
  if (!p) {
    // slug 在 URL 里但服务器上不存在(被删了 / 瞎填的)
    if (profileBadge) {
      profileBadge.hidden = false;
      profileBadge.classList.add('is-invalid');
      if (profileBadgeName) profileBadgeName.textContent = '专属版本无效';
    }
    if (brandSubtitle) brandSubtitle.textContent = '⚠ 这个专属 URL 已失效,请联系主播获取新链接';
    if (spinSelfTopup) spinSelfTopup.hidden = true;
    return;
  }
  // 有效 profile
  if (profileBadge) {
    profileBadge.hidden = false;
    profileBadge.classList.remove('is-invalid');
    if (profileBadgeName) profileBadgeName.textContent = p.name;
  }
  // 顶部大标题改成「XX 专属」
  const pageTitle = document.getElementById('pageTitle');
  if (pageTitle) pageTitle.textContent = `${p.name} 专属`;
  document.title = `${p.name} 专属|炫酷转盘`;
  if (brandSubtitle) brandSubtitle.textContent = `🎁 ${p.name} 的专属定制版本 · 尽情享受`;
  // 自助加按钮
  if (spinSelfTopup) {
    if (p.allowSelfTopup) {
      spinSelfTopup.hidden = false;
      if (spinSelfTopupAmount) spinSelfTopupAmount.textContent = String(p.selfTopupAmount || 5);
      if (spinSelfTopupHint) spinSelfTopupHint.textContent = `主播为 ${p.name} 开放了自助加次数`;
    } else {
      spinSelfTopup.hidden = true;
    }
  }
}

async function submitSelfTopup() {
  if (!CURRENT_PROFILE_SLUG) return;
  if (!spinSelfTopupBtn) return;
  spinSelfTopupBtn.disabled = true;
  const original = spinSelfTopupBtn.textContent;
  spinSelfTopupBtn.textContent = '处理中…';
  try {
    const res = await fetch('/api/profile/topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: CURRENT_PROFILE_SLUG })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.message || '加次数失败');
    // 同步显示
    if (state.data && state.data.settings) {
      state.data.settings.spinCount = json.remaining;
    }
    updateSpinCountDisplay({ remaining: json.remaining });
    showToast(`🪙 已加 ${json.added} 次,当前剩余 ${json.remaining}`);
  } catch (err) {
    showToast(err.message || '加次数失败');
  } finally {
    spinSelfTopupBtn.disabled = false;
    spinSelfTopupBtn.textContent = original;
  }
}

async function submitGuess(guess) {
  if (guessLeftBtn) guessLeftBtn.disabled = true;
  if (guessRightBtn) guessRightBtn.disabled = true;
  try {
    const res = await fetch('/api/guess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guess })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.message || '提交失败');
    // 同步剩余次数
    updateSpinCountDisplay(json);
    if (state.data && state.data.settings) {
      state.data.settings.spinCount = json.remaining;
      state.data.settings.spinUnlimited = json.unlimited;
    }
    if (guessResult) {
      guessResult.hidden = false;
      const arrow = json.answer === 'left' ? '⬅' : '➡';
      if (json.correct) {
        guessResult.className = 'guess-result is-correct';
        if (json.delta > 0) {
          guessResult.textContent = `🎉 猜对啦!正确答案是 ${arrow}  返还 +${json.delta} 次`;
        } else if (json.delta < 0) {
          guessResult.textContent = `🎉 猜对啦!正确答案是 ${arrow}  扣 ${Math.abs(json.delta)} 次,剩 ${json.remaining}`;
        } else {
          guessResult.textContent = `🎉 猜对啦!正确答案是 ${arrow}`;
        }
      } else {
        guessResult.className = 'guess-result is-wrong';
        guessResult.textContent = `😅 猜错了,正确答案是 ${arrow}  增加 +${json.delta} 次,剩 ${json.remaining}`;
      }
    }
  } catch (err) {
    if (guessResult) {
      guessResult.hidden = false;
      guessResult.className = 'guess-result is-wrong';
      guessResult.textContent = err.message || '提交失败';
    }
    if (guessLeftBtn) guessLeftBtn.disabled = false;
    if (guessRightBtn) guessRightBtn.disabled = false;
  }
}

async function loadServerData(silent = false) {
  if (state.spinning && silent) return;
  try {
    const data = await apiGetData();
    const normalized = {
      main: data.main && data.main.length ? data.main : state.data.main,
      truth: normalizeList(data.truth),
      dare: normalizeList(data.dare),
      settings: data.settings || state.data.settings,
      broadcast: data.broadcast || { id: 0, text: '', createdAt: 0 }
    };
    const nextHash = dataSignature(normalized);
    const changed = nextHash !== state.dataHash;

    state.data = normalized;
    state.dataHash = nextHash;
    autoSpinNext.checked = !!state.data.settings.autoSpinNext;

    // 检查 GM 飘屏:第一次加载时把当前 id 设为基准,避免历史消息重复弹出
    const bId = Number(state.data.broadcast?.id) || 0;
    if (state.lastBroadcastId === -1) {
      state.lastBroadcastId = bId;
    } else if (bId > state.lastBroadcastId) {
      state.lastBroadcastId = bId;
      const text = String(state.data.broadcast.text || '').trim();
      if (text) showGMBroadcast(text);
    }

    // 同步人数显示(只在用户没正在编辑时刷新,避免输入时跳数字)
    const serverCount = Number(state.data.settings.peopleCount);
    if (Number.isFinite(serverCount) && serverCount >= 1 && document.activeElement !== peopleCountInput) {
      peopleCountInput.value = serverCount;
    }

    if (state.data.settings.pageTitle) {
      document.getElementById('pageTitle').textContent = state.data.settings.pageTitle;
      document.title = state.data.settings.pageTitle + '|炫酷转盘';
    }

    // 更新转动次数胶囊显示
    updateSpinCountDisplay({
      remaining: Number(state.data.settings.spinCount) || 0,
      unlimited: !!state.data.settings.spinUnlimited
    });

    // 应用专属定制版本(banner + 自助加按钮)
    applyProfile();

    if (changed) {
      invalidateWheelCache();
      // 题库变了:如果当前在 truth/dare,重抽池子(可能有新题加入或权重调整);主转盘不受影响
      if (state.mode === 'truth' || state.mode === 'dare') {
        refreshWheelPool();
      }
    }
    resizeCanvasIfNeeded();
    drawWheel();
    if (!silent) showToast(changed ? '转盘数据已同步' : '数据没有变化');
  } catch (err) {
    if (!silent) showToast(err.message || '读取数据失败');
    resizeCanvasIfNeeded();
    drawWheel();
  }
}

function dataSignature(data) {
  return JSON.stringify({
    main: (data.main || []).map(m => ({ l: labelOf(m), w: itemWeight(m) })),
    truth: (data.truth || []).map(t => ({ t: itemText(t), w: itemWeight(t) })),
    dare: (data.dare || []).map(t => ({ t: itemText(t), w: itemWeight(t) })),
    settings: data.settings || {}
  });
}

function getSegments() {
  // 主转盘永远用完整 main 数据(就 2 项,不需要抽样)
  if (state.mode === 'main') {
    const list = state.data.main || [];
    return list.length ? list : ['暂无数据,请到导入控制台添加'];
  }
  // 真心话/大冒险:用抽样池;若 pool 未初始化或模式不匹配,临时回退到完整题库(下次 refresh 会修正)
  if (state.wheelPool.mode === state.mode && state.wheelPool.items.length) {
    return state.wheelPool.items;
  }
  const list = state.data[state.mode] || [];
  return list.length ? list : ['暂无数据,请到导入控制台添加'];
}

// 按权重无放回抽样 k 个;返回的元素保持在原数组中的相对顺序(视觉稳定)
function sampleByWeight(items, k) {
  if (!Array.isArray(items) || items.length === 0) return [];
  if (items.length <= k) return items.slice();
  const pool = items.map((item, idx) => ({ item, idx, w: itemWeight(item) }));
  const picked = [];
  for (let n = 0; n < k && pool.length; n++) {
    const total = pool.reduce((a, b) => a + (b.w > 0 ? b.w : 0.0001), 0);
    let r = Math.random() * total;
    let chosen = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].w > 0 ? pool[i].w : 0.0001;
      if (r < 0) { chosen = i; break; }
    }
    picked.push(pool[chosen]);
    pool.splice(chosen, 1);
  }
  picked.sort((a, b) => a.idx - b.idx);
  return picked.map(p => p.item);
}

// 重抽当前大转盘的显示池;仅 truth/dare 模式有效。主转盘不需要(只有 2 项)
function refreshWheelPool() {
  if (state.mode !== 'truth' && state.mode !== 'dare') {
    state.wheelPool = { mode: '', items: [] };
    return;
  }
  const list = state.data[state.mode] || [];
  state.wheelPool = {
    mode: state.mode,
    items: sampleByWeight(list, WHEEL_SAMPLE_SIZE)
  };
  invalidateWheelCache();
}
function labelOf(item) {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') return item.label || item.text || '';
  return String(item || '');
}

// 按权重抽一个索引
function pickWeightedIndex(segments) {
  const weights = segments.map(itemWeight);
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return Math.floor(Math.random() * segments.length);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return segments.length - 1;
}

// 计算每个扇区的角度,返回 [{start, end, mid, weight}]
// 主转盘(main):扇区始终均分(视觉公平),但抽中概率仍按权重(pickWeightedIndex 决定 selectedIndex)
// 真心话/大冒险大转盘:扇区按权重,权重越大扇区越大(题目权重高的更显眼)
function computeArcs(segments) {
  const weights = segments.map(itemWeight);
  const useEqualAngles = state.mode === 'main';
  const total = useEqualAngles
    ? segments.length
    : (weights.reduce((a, b) => a + b, 0) || segments.length);
  const arcs = [];
  let acc = 0;
  for (let i = 0; i < segments.length; i++) {
    const portion = useEqualAngles
      ? (Math.PI * 2) / segments.length
      : (weights[i] / total) * Math.PI * 2;
    arcs.push({ start: acc, end: acc + portion, mid: acc + portion / 2, weight: weights[i] });
    acc += portion;
  }
  return arcs;
}

function invalidateWheelCache() {
  state.cacheKey = '';
  state.cacheImage = null;
}

function resizeCanvasIfNeeded() {
  const rect = canvas.getBoundingClientRect();
  const cssSize = Math.max(280, Math.round(rect.width || 700));
  const isSmall = window.innerWidth <= 560;
  // DPR 太高在小屏会卡,这里给上限
  const dpr = Math.min(window.devicePixelRatio || 1, isSmall ? 1.25 : 1.6);
  // 内部分辨率 = CSS 尺寸 × dpr,允许 320~1400 之间
  const nextSize = Math.max(320, Math.min(1400, Math.round(cssSize * dpr)));

  if (canvas.width !== nextSize || canvas.height !== nextSize) {
    canvas.width = nextSize;
    canvas.height = nextSize;
    invalidateWheelCache();
  }
}

function drawWheel() {
  const W = canvas.width;
  const H = canvas.height;
  const cx = W / 2;
  const cy = H / 2;
  const wheelImage = getCachedWheelImage();

  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(state.angle);
  ctx.drawImage(wheelImage, -W / 2, -H / 2, W, H);
  ctx.restore();
}

function getCachedWheelImage() {
  const segments = getSegments();
  const key = `${state.mode}|${canvas.width}|${state.dataHash}|${segments.length}`;
  if (state.cacheImage && state.cacheKey === key) return state.cacheImage;

  const W = canvas.width;
  const H = canvas.height;
  const off = document.createElement('canvas');
  off.width = W;
  off.height = H;
  const c = off.getContext('2d', { alpha: true });
  renderWheelBase(c, W, H, segments);

  state.cacheKey = key;
  state.cacheImage = off;
  return off;
}

function renderWheelBase(c, W, H, segments) {
  const cx = W / 2;
  const cy = H / 2;
  const r = W * 0.43;
  const count = Math.max(1, segments.length);
  const arcs = computeArcs(segments);
  const largeList = count > 24;
  const hugeList = count > 72;

  c.clearRect(0, 0, W, H);
  c.save();
  c.translate(cx, cy);

  for (let i = 0; i < count; i++) {
    const { start, end, mid } = arcs[i] || { start: 0, end: Math.PI * 2, mid: Math.PI };
    const arcSize = end - start;
    const colors = palette[i % palette.length];
    const grad = c.createRadialGradient(0, 0, r * .1, 0, 0, r);
    grad.addColorStop(0, brighten(colors[0], 24));
    grad.addColorStop(.72, colors[0]);
    grad.addColorStop(1, colors[1]);

    c.beginPath();
    c.moveTo(0, 0);
    c.arc(0, 0, r, start, end);
    c.closePath();
    c.fillStyle = grad;
    c.fill();
    c.strokeStyle = largeList ? 'rgba(255,255,255,.26)' : 'rgba(255,255,255,.62)';
    c.lineWidth = hugeList ? .7 : largeList ? 1.1 : 3;
    c.stroke();

    if (!hugeList) {
      c.save();
      c.rotate(mid);
      // 当 mid 让 X 轴方向"朝下、朝左、朝左上"时翻转,确保字头始终朝外
      // canvas 顺时针旋转:mid ∈ [π/2, 3π/2) 时翻转
      // 包含下边界 π/2 让 1:1 平分时下方扇区字正立;不含上边界让上方扇区字也正立
      const flipped = mid >= Math.PI / 2 && mid < Math.PI * 1.5;
      if (flipped) {
        c.rotate(Math.PI);
        c.textAlign = 'left';
      } else {
        c.textAlign = 'right';
      }
      c.textBaseline = 'middle';
      if (largeList) drawIndexInSlice(c, i + 1, r, count, flipped);
      else drawTextInSlice(c, labelOf(segments[i]), r, count, arcSize, flipped);
      c.restore();
    }
  }

  if (hugeList) {
    c.save();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `900 ${Math.max(18, W * .028)}px system-ui`;
    c.fillStyle = 'rgba(255,255,255,.88)';
    c.shadowColor = 'rgba(0,0,0,.45)';
    c.shadowBlur = 8;
    c.fillText(`${count} 条题目`, 0, -r * .30);
    c.font = `700 ${Math.max(13, W * .018)}px system-ui`;
    c.fillText('完整结果会在弹窗显示', 0, -r * .22);
    c.restore();
  }

  c.beginPath();
  c.arc(0, 0, r * .18, 0, Math.PI * 2);
  c.fillStyle = 'rgba(255,255,255,.18)';
  c.fill();
  c.lineWidth = Math.max(3, W * .006);
  c.strokeStyle = 'rgba(255,255,255,.58)';
  c.stroke();

  c.beginPath();
  c.arc(0, 0, r + 8, 0, Math.PI * 2);
  c.strokeStyle = 'rgba(255,255,255,.35)';
  c.lineWidth = Math.max(6, W * .011);
  c.stroke();

  c.beginPath();
  c.arc(0, 0, r + 22, 0, Math.PI * 2);
  c.strokeStyle = 'rgba(49,247,255,.25)';
  c.lineWidth = Math.max(1, W * .002);
  c.stroke();

  c.restore();
}

function drawIndexInSlice(c, number, r, count, flipped) {
  const size = count > 50 ? 13 : count > 36 ? 15 : 18;
  c.font = `900 ${size}px system-ui`;
  c.shadowColor = 'rgba(0,0,0,.35)';
  c.shadowBlur = 5;
  c.fillStyle = 'rgba(255,255,255,.94)';
  // 翻转后坐标系反向,文字位置取负值
  const x = flipped ? -r * .86 : r * .86;
  c.fillText(`#${number}`, x, 0);
  c.shadowBlur = 0;
}

function drawTextInSlice(c, text, r, count, arcSize, flipped) {
  // 默认按 count 估算扇区角度
  const baseArc = arcSize || (Math.PI * 2 / Math.max(1, count));
  const arcDeg = (baseArc * 180) / Math.PI;
  // 字号根据扇区角度 + 半径自适应:大扇区可以大,小扇区要变小避免溢出
  // 字号 = r × 系数,这样手机/桌面都按比例缩放
  let factor, lineFactor, maxChars;
  if (arcDeg >= 120) { factor = 0.16; lineFactor = 0.18; maxChars = 8; }
  else if (arcDeg >= 60) { factor = 0.12; lineFactor = 0.13; maxChars = 9; }
  else if (arcDeg >= 30) { factor = 0.08; lineFactor = 0.09; maxChars = 9; }
  else if (arcDeg >= 18) { factor = 0.065; lineFactor = 0.075; maxChars = 8; }
  else if (arcDeg >= 12) { factor = 0.052; lineFactor = 0.062; maxChars = 7; }
  else { factor = 0.045; lineFactor = 0.055; maxChars = 6; }
  const fontSize = Math.max(11, r * factor);
  const lineHeight = Math.max(13, r * lineFactor);
  const maxLines = arcDeg >= 60 ? 3 : 2;
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  const lines = wrapByChars(clean, maxChars).slice(0, maxLines);
  // 翻转后文字外缘在 x 负向
  const x = flipped ? -r * .82 : r * .82;
  const y0 = -((lines.length - 1) * lineHeight) / 2;
  c.shadowColor = 'rgba(0,0,0,.30)';
  c.shadowBlur = 4;
  c.font = `900 ${fontSize}px system-ui`;
  c.fillStyle = '#fff';
  lines.forEach((line, idx) => c.fillText(line, x, y0 + idx * lineHeight));
  c.shadowBlur = 0;
}

function wrapByChars(text, size) {
  if (text.length <= size) return [text];
  const arr = [];
  for (let i = 0; i < text.length; i += size) arr.push(text.slice(i, i + size));
  if (arr.length > 2 && arr[1]) arr[1] = arr[1].slice(0, Math.max(0, size - 1)) + '…';
  return arr;
}

function brighten(hex, amount) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, (num >> 16) + amount);
  const g = Math.min(255, ((num >> 8) & 255) + amount);
  const b = Math.min(255, (num & 255) + amount);
  return '#' + (b | (g << 8) | (r << 16)).toString(16).padStart(6, '0');
}

function updateSoundToggle() {
  if (!soundToggle) return;
  soundToggle.textContent = state.soundEnabled ? '🔊 转轮音效:开' : '🔇 转轮音效:关';
  soundToggle.classList.toggle('active', state.soundEnabled);
}

function toggleSound() {
  state.soundEnabled = !state.soundEnabled;
  localStorage.setItem('wheelSoundEnabled', state.soundEnabled ? '1' : '0');
  updateSoundToggle();
  if (state.soundEnabled) {
    ensureAudio();
    playTone(720, 0.035, 0.08, 'sine');
    setTimeout(() => playTone(920, 0.035, 0.07, 'sine'), 70);
    showToast('转轮音效已开启');
  } else {
    stopSpinSound(false);
    showToast('转轮音效已关闭');
  }
}
function ensureAudio() {
  if (!state.soundEnabled) return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!state.sound.ctx) {
    const ctx = new AudioCtx();
    const master = ctx.createGain();
    master.gain.value = 0.28;
    master.connect(ctx.destination);
    state.sound.ctx = ctx;
    state.sound.master = master;
  }
  if (state.sound.ctx.state === 'suspended') state.sound.ctx.resume();
  return state.sound.ctx;
}

function playTone(freq = 620, duration = 0.045, volume = 0.12, type = 'triangle', delay = 0) {
  if (!state.soundEnabled) return;
  const ctx = ensureAudio();
  if (!ctx || !state.sound.master) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), t + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain);
  gain.connect(state.sound.master);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

function startSpinSound(duration) {
  if (!state.soundEnabled) return;
  ensureAudio();
  stopSpinSound(false);
  state.sound.spinStartedAt = performance.now();
  state.sound.spinDuration = duration;

  const tickLoop = () => {
    if (!state.spinning || !state.soundEnabled) return;
    const elapsed = performance.now() - state.sound.spinStartedAt;
    const progress = Math.min(1, elapsed / Math.max(1, state.sound.spinDuration));
    const pitch = 980 - progress * 420 + Math.random() * 35;
    const volume = 0.10 - progress * 0.035;
    playTone(pitch, 0.026, Math.max(0.035, volume), 'square');
    const nextDelay = 30 + progress * 115;
    state.sound.tickTimer = setTimeout(tickLoop, nextDelay);
  };

  tickLoop();
}

function stopSpinSound(playWin = true) {
  if (state.sound.tickTimer) {
    clearTimeout(state.sound.tickTimer);
    state.sound.tickTimer = null;
  }
  if (playWin && state.soundEnabled) playFinishSound();
}

function playFinishSound() {
  if (!state.soundEnabled) return;
  ensureAudio();
  playTone(523.25, 0.09, 0.13, 'sine', 0);
  playTone(659.25, 0.10, 0.13, 'sine', 0.09);
  playTone(783.99, 0.16, 0.15, 'triangle', 0.19);
}

async function spin() {
  if (state.spinning) return;
  closeResultModal(false);

  // 先看当前模式的题库是否为空
  const initialList = state.mode === 'main'
    ? (state.data.main || [])
    : (state.data[state.mode] || []);
  if (!initialList.length) {
    showToast('这个转盘还没有数据,请到导入控制台添加。');
    return;
  }

  // 主转盘启动:消耗 1 次(服务端原子扣减)。其它模式(直接进真心话/大冒险大转盘)不扣
  if (state.mode === 'main') {
    try {
      const res = await fetch('/api/spin/start', { method: 'POST', cache: 'no-store' });
      const json = await res.json();
      if (!json.ok) {
        showToast(json.message || '转动次数已用完,请联系主播');
        updateSpinCountDisplay(json);
        return;
      }
      updateSpinCountDisplay(json);
    } catch (err) {
      // 网络挂了仍允许继续(避免完全卡死)
      console.warn('spin/start failed, allow continue:', err);
    }
  }

  // 真心话/大冒险:每次转动前重新抽一组 10 道作为转盘内容(题库 ≤10 时全部用)
  if (state.mode === 'truth' || state.mode === 'dare') {
    refreshWheelPool();
    drawWheel();  // 让玩家立刻看到新扇区,再开始转动
  }

  // 取当前转盘上实际的 segments(可能是抽样后的 10 道)
  const segments = getSegments();

  state.spinning = true;
  spinBtn.disabled = true;
  sideSpinBtn.disabled = true;
  resultLine.textContent = '转盘启动中…';
  resultTip.textContent = '题目很多时,转盘显示编号;完整题目会全屏弹出';

  const arcs = computeArcs(segments);
  const selectedIndex = pickWeightedIndex(segments);
  const center = arcs[selectedIndex].mid;
  const current = normalizeAngle(state.angle);
  let target = -Math.PI / 2 - center;
  target = normalizeAngle(target);
  let delta = target - current;
  if (delta < 0) delta += Math.PI * 2;

  const extraTurns = (state.mode === 'main' ? 6 : 5) * Math.PI * 2 + Math.floor(Math.random() * 3) * Math.PI * 2;
  const startAngle = state.angle;
  const endAngle = state.angle + delta + extraTurns;
  const duration = state.mode === 'main' ? 3600 + Math.random() * 450 : 3900 + Math.random() * 520;
  const startTime = performance.now();
  startSpinSound(duration);

  function animate(now) {
    const t = Math.min(1, (now - startTime) / duration);
    const eased = easeOutQuart(t);
    state.angle = startAngle + (endAngle - startAngle) * eased;
    drawWheel();
    if (t < 1) requestAnimationFrame(animate);
    else {
      state.angle = normalizeAngle(endAngle);
      drawWheel();
      finishSpin(segments[selectedIndex], selectedIndex);
    }
  }
  requestAnimationFrame(animate);
}

function finishSpin(selected, selectedIndex) {
  state.spinning = false;
  // 不直接 enable,交给 updateSpinCountDisplay 根据剩余次数判断
  stopSpinSound(true);
  burstConfetti();
  // 重新评估按钮 disabled 状态(可能转完最后一次,变为禁用)
  updateSpinCountDisplay({});

  if (state.mode === 'main') {
    const route = selected.route;
    resultLine.textContent = `抽中:${selected.icon || ''} ${selected.label}`;
    resultTip.textContent = `正在进入【${selected.label}】大转盘…`;
    showToast(`抽中 ${selected.label},即将跳转到对应大转盘`);
    setTimeout(() => {
      setMode(route);
      if (autoSpinNext.checked) setTimeout(spin, 420);
    }, 900);
  } else {
    const text = labelOf(selected);
    const isTruth = state.mode === 'truth';
    resultLine.textContent = isTruth ? '💬 真心话题目' : '⚡ 大冒险任务';
    resultTip.textContent = `已抽中第 ${selectedIndex + 1} 条,完整内容已弹出`;
    showResultModal({
      kicker: isTruth ? '💬 真心话' : '⚡ 大冒险',
      title: `第 ${selectedIndex + 1} 条`,
      text,
      showGuess: !isTruth // 大冒险才显示猜左右
    });
  }
}

function showResultModal({ kicker, title, text, showGuess }) {
  modalKicker.textContent = kicker;
  modalTitle.textContent = title;
  modalText.textContent = text;
  // 猜左右块:仅大冒险且 admin 启用时显示
  const guessEnabled = !!state.data?.settings?.guessEnabled;
  if (guessBox) {
    if (showGuess && guessEnabled) {
      guessBox.hidden = false;
      if (guessLeftBtn) guessLeftBtn.disabled = false;
      if (guessRightBtn) guessRightBtn.disabled = false;
      if (guessResult) {
        guessResult.hidden = true;
        guessResult.textContent = '';
        guessResult.className = 'guess-result';
      }
    } else {
      guessBox.hidden = true;
    }
  }
  resultModal.classList.add('show');
  resultModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  setTimeout(() => modalAgain.focus(), 80);
}

function closeResultModal(updateAttr = true) {
  if (!resultModal) return;
  resultModal.classList.remove('show');
  document.body.classList.remove('modal-open');
  if (updateAttr) resultModal.setAttribute('aria-hidden', 'true');
}

function normalizeAngle(angle) {
  const two = Math.PI * 2;
  return ((angle % two) + two) % two;
}
function easeOutQuart(t) { return 1 - Math.pow(1 - t, 4); }

function setMode(mode) {
  if (!['main', 'truth', 'dare'].includes(mode) || state.spinning) return;
  closeResultModal(false);
  state.mode = mode;
  state.angle = 0;
  refreshWheelPool();  // truth/dare 模式切入时抽一组 10 道作为转盘内容
  invalidateWheelCache();
  const names = { main: '主转盘', truth: '真心话转盘', dare: '大冒险转盘' };
  modeName.textContent = names[mode];
  document.querySelectorAll('[data-mode]').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
  resultLine.textContent = mode === 'main' ? '点击 START 开始' : `已进入:${names[mode]}`;
  resultTip.textContent = mode === 'main'
    ? '主转盘会决定进入"真心话"还是"大冒险"'
    : '点击 START 抽取当前大转盘内容;完整题目会全屏弹窗显示';
  resizeCanvasIfNeeded();
  drawWheel();
  // 切换模式时重新评估 START 禁用状态(只有主转盘模式才会被次数 disabled)
  updateSpinCountDisplay({});
}

async function saveSettings() {
  try {
    state.data.settings = { ...(state.data.settings || {}), autoSpinNext: autoSpinNext.checked };
    await apiSaveData(state.data);
    showToast('设置已保存');
  } catch (err) {
    showToast(err.message || '保存设置失败');
  }
}

// === 随机点名 ===
let pickerSaveTimer = null;
function getPeopleCount() {
  const n = Math.floor(Number(peopleCountInput.value));
  return Math.max(1, Math.min(50, Number.isFinite(n) ? n : 3));
}

function setPeopleCount(n) {
  const v = Math.max(1, Math.min(50, Math.floor(Number(n) || 1)));
  peopleCountInput.value = v;
  schedulePeopleSave();
}

// 改了人数后延迟 600ms 同步到服务器,避免连点 +/- 时频繁请求
function schedulePeopleSave() {
  clearTimeout(pickerSaveTimer);
  pickerSaveTimer = setTimeout(async () => {
    try {
      const n = getPeopleCount();
      state.data.settings = { ...(state.data.settings || {}), peopleCount: n };
      await apiSaveData(state.data);
    } catch (err) {
      // 静默失败,人数仍然可用
    }
  }, 600);
}

function pickRandomPerson() {
  const n = getPeopleCount();
  if (n < 1) return;
  // 简单的"滚动停下"动画:700ms 内快速换 #数字,然后定格
  pickerResult.classList.add('picking');
  const start = performance.now();
  const duration = 700;
  const final = Math.floor(Math.random() * n) + 1;
  let lastShown = -1;
  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    if (t < 1) {
      // 越接近结束,跳变频率越低
      const interval = 40 + t * 80;
      const elapsed = now - start;
      const slot = Math.floor(elapsed / interval);
      if (slot !== lastShown) {
        lastShown = slot;
        const fake = Math.floor(Math.random() * n) + 1;
        pickerResult.innerHTML = `<span class="picker-num">#${fake}</span>`;
      }
      requestAnimationFrame(tick);
    } else {
      pickerResult.classList.remove('picking');
      pickerResult.classList.add('done');
      pickerResult.innerHTML = `<span class="picker-num final">#${final}</span><span class="picker-tip">由 #${final} 来回答</span>`;
      // 闪一下后移除 done 类
      setTimeout(() => pickerResult.classList.remove('done'), 1400);
      // 轻轻提示音
      if (state.soundEnabled) {
        ensureAudio();
        playTone(660, 0.08, 0.13, 'sine', 0);
        playTone(880, 0.10, 0.13, 'sine', 0.08);
      }
    }
  }
  requestAnimationFrame(tick);
}

function burstConfetti() {
  const colors = ['#31f7ff', '#ff3cf0', '#ffd166', '#34d399', '#a78bfa', '#fb7185'];
  const count = window.innerWidth <= 560 ? 30 : 46;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'confetti';
    el.style.left = Math.random() * 100 + 'vw';
    el.style.background = colors[i % colors.length];
    el.style.setProperty('--x', (Math.random() * 220 - 110) + 'px');
    el.style.animationDelay = Math.random() * .16 + 's';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1900);
  }
}

// === GM 飘屏:全屏显示 3 秒后自动消失 ===
let gmBroadcastTimer = null;
function showGMBroadcast(text) {
  const el = document.getElementById('gmBroadcast');
  const textEl = document.getElementById('gmBroadcastText');
  if (!el || !textEl) return;

  // 重置:正在显示则强制收起,再触发新一次,这样动画能正常重播
  el.classList.remove('show');
  // 强制重排,让 CSS 动画能重新触发
  void el.offsetWidth;

  textEl.textContent = text;
  el.setAttribute('aria-hidden', 'false');
  el.classList.add('show');

  // 飘屏出现时给一个轻提示音
  if (state.soundEnabled) {
    try {
      ensureAudio();
      playTone(523, 0.10, 0.18, 'sine', 0);
      playTone(784, 0.10, 0.20, 'sine', 0.10);
      playTone(1047, 0.14, 0.18, 'sine', 0.20);
    } catch (_) {}
  }

  clearTimeout(gmBroadcastTimer);
  gmBroadcastTimer = setTimeout(() => {
    el.classList.remove('show');
    el.setAttribute('aria-hidden', 'true');
  }, 3000);
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resizeCanvasIfNeeded();
    drawWheel();
  }, 120);
});

document.querySelectorAll('[data-mode]').forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.mode)));
spinBtn.addEventListener('click', spin);
sideSpinBtn.addEventListener('click', spin);
autoSpinNext.addEventListener('change', saveSettings);
document.getElementById('refreshBtn').addEventListener('click', () => loadServerData(false));
if (soundToggle) soundToggle.addEventListener('click', toggleSound);
updateSoundToggle();

// 猜左右按钮
if (guessLeftBtn) guessLeftBtn.addEventListener('click', () => submitGuess('left'));
if (guessRightBtn) guessRightBtn.addEventListener('click', () => submitGuess('right'));

// 专属版本:自助加次数
if (spinSelfTopupBtn) spinSelfTopupBtn.addEventListener('click', submitSelfTopup);
closeModal.addEventListener('click', () => closeResultModal());
resultModal.addEventListener('click', (event) => {
  if (event.target && event.target.hasAttribute('data-close-modal')) closeResultModal();
});
modalAgain.addEventListener('click', () => {
  closeResultModal();
  setTimeout(spin, 180);
});
modalBack.addEventListener('click', () => {
  closeResultModal();
  setMode('main');
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeResultModal();
});

// 点名功能事件
peopleMinus.addEventListener('click', () => setPeopleCount(getPeopleCount() - 1));
peoplePlus.addEventListener('click', () => setPeopleCount(getPeopleCount() + 1));
peopleCountInput.addEventListener('input', () => {
  // 输入时实时校验范围,但不立即触发保存
  const v = Number(peopleCountInput.value);
  if (Number.isFinite(v) && v >= 1 && v <= 50) {
    schedulePeopleSave();
  }
});
peopleCountInput.addEventListener('blur', () => {
  // 失焦时把不合法的值修正
  setPeopleCount(getPeopleCount());
});
pickerGo.addEventListener('click', pickRandomPerson);

makeParticles();
resizeCanvasIfNeeded();
loadServerData(true);
setInterval(() => loadServerData(true), 8000);