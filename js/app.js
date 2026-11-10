import * as DB from './db.js';
import * as AI from './ai.js';
import * as OD from './onedrive.js';
import * as BD from './baidu.js';
import { donut, bars, palette } from './chart.js';
import * as I18N from './i18n.js';

/* 语言要在任何渲染之前定下来，否则首屏会先闪一下中文。
   先读 localStorage 的副本（和皮肤同样的套路），boot 拿到 IndexedDB 后再校准。 */
I18N.initLang(I18N.cachedLangPref());
document.title = I18N.isEN() ? 'Pocket Ledger' : '小账本';

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEK_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ---------------- 皮肤 ----------------
   只影响外观：颜色/字体/圆角/底栏样式都挂在 <html data-theme> 上，
   样式表里各主题块负责变量，logic 一律不感知皮肤。 */
const SKINS = [
  { k:'classic', name:'标准绿', desc:'原来的样子', bg:'#F3F5F4', line:'#E6EAE8', hero:'#0F6E56', fg:'#17201D', ac:'#E1F5EE', meta:'#0F6E56' },
  { k:'ink',     name:'墨韵',   desc:'纸白墨黑',   bg:'#FBFAF7', line:'#E6E1D4', hero:'#EFEBDF', fg:'#1A1A18', ac:'#B33A2B', meta:'#FBFAF7', darkBar:1 },
  { k:'aurora',  name:'幽光',   desc:'深色玻璃',   bg:'#0A0D13', line:'rgba(255,255,255,.12)', hero:'#5B4BD6', fg:'#EEF2F7', ac:'#35E0C5', meta:'#0A0D13' },
  { k:'pop',     name:'纸糖',   desc:'贴纸手账',   bg:'#FFF7EC', line:'#E8DCC8', hero:'#FFD84D', fg:'#17130F', ac:'#FF9EC4', meta:'#FFF7EC', darkBar:1 },
  { k:'term',    name:'仪表',   desc:'终端数据',   bg:'#070B11', line:'#18232F', hero:'#0F2A22', fg:'#C8D4E2', ac:'#3DF5A5', meta:'#070B11' },
  { k:'cel',     name:'青瓷',   desc:'宣纸釉色',   bg:'#F4F1E8', line:'#E9E3D2', hero:'#6E8B6B', fg:'#2C2A26', ac:'#C25B4A', meta:'#F4F1E8', darkBar:1 }
];
const SKIN_KEYS = SKINS.map(s => s.k);

function skinOf(k) {
  return SKINS.find(s => s.k === k) || SKINS[0];
}

/* 安卓桌面图标跟着皮肤走。
   原生侧用 activity-alias 实现（一个皮肤一个入口），这里只负责把皮肤名递过去。
   网页版没有 Capacitor，直接跳过；老版本 APK 没有这个插件，也不能炸。 */
function isNativeApp() {
  const cap = window.Capacitor;
  const yes = !!cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform();
  // 给 CSS 一个钩子：桌面图标联动这类只在 APK 里成立的文案按它显示
  if (yes) document.documentElement.classList.add('native');
  return yes;
}

function syncAppIcon(k) {
  if (!isNativeApp()) return;
  const cap = window.Capacitor;
  try {
    const p = typeof cap.registerPlugin === 'function'
      ? cap.registerPlugin('AppIcon')
      : (cap.Plugins && cap.Plugins.AppIcon);
    const r = p && p.set && p.set({ skin: k });
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch (e) { /* 忽略：图标换不了不影响记账 */ }
}

/* 安卓状态栏图标深浅：浅色皮肤必须换成深色图标，不然时间电量全看不见。
   targetSdk 35 强制边到边，状态栏默认白图标，奶白背景上就是一片空白。 */
function syncStatusBar(s) {
  if (!isNativeApp()) return;
  const cap = window.Capacitor;
  try {
    const p = typeof cap.registerPlugin === 'function'
      ? cap.registerPlugin('Ui')
      : (cap.Plugins && cap.Plugins.Ui);
    const r = p && p.setStatusBar && p.setStatusBar({ dark: !!s.darkBar });
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch (e) { /* 老 APK 没这个插件，忽略 */ }
}

/* 真正落地：切 data-theme + 记住选择 + 同步浏览器/安卓状态栏色 */
function applyTheme(k) {
  const s = skinOf(k);
  document.documentElement.dataset.theme = s.k;
  try { localStorage.setItem('pl-theme', s.k); } catch (e) { /* 隐私模式忽略 */ }
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', s.meta);
  syncAppIcon(s.k);
  syncStatusBar(s);
}

function renderSkinPicker() {
  const grid = $('#skin-grid');
  if (!grid) return;
  const cur = skinOf(state.settings.theme).k;
  grid.innerHTML = SKINS.map(s => `
    <button type="button" class="skin-card${s.k === cur ? ' on' : ''}" data-skin="${s.k}"
            aria-pressed="${s.k === cur}">
      <span class="skin-thumb" style="--s-bg:${s.bg};--s-line:${s.line};--s-hero:${s.hero};--s-fg:${s.fg};--s-ac:${s.ac}">
        <i></i><i></i><i></i>
      </span>
      <span class="skin-name">${s.name}</span>
      <span class="skin-tick">✓</span>
    </button>`).join('');
  const hint = $('#skin-hint');
  if (hint) hint.textContent = skinOf(cur).desc;
}

async function pickSkin(k) {
  if (!SKIN_KEYS.includes(k) || (state.settings.theme || 'classic') === k) return;
  applyTheme(k);
  state.settings.theme = k;
  await DB.setSetting('theme', k);
  renderSkinPicker();
  toast(`已换成「${skinOf(k).name}」`);
}

const state = {
  txs: [],
  cats: { expense: [], income: [] },
  settings: {},
  rules: {},
  month: '',
  listMonth: '',   // 流水页的月份筛选，空字符串=全部
  statSel: '',     // 统计页环形图当前选中的分类，空=未选中
  tab: 'home',
  editing: null,
  pending: null,
  pendingThumbs: [],
  keepDup: false,
  barsScroll: null, // 柱状图横向滚动位置，null 表示还没滑过（默认贴最右）
  form: { type: 'expense', cat: '', acct: '微信', toAcct: '银行卡', date: '', note: '' }
};

/* ---------------- helpers ---------------- */

const pad = n => String(n).padStart(2, '0');
const todayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthOf = ds => ds.slice(0, 7);
const nowMonth = () => todayStr().slice(0, 7);

const yuan = c => (c / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* 币种表。符号刻意区分：¥ 和 $ 放在一起最容易看错，
   所以美元用 US$、日元用 JP¥、港币用 HK$，不和别的混。 */
const CURRENCIES = [
  { code: 'CNY', sym: '¥',   name: '人民币' },
  { code: 'USD', sym: 'US$', name: '美元' },
  { code: 'EUR', sym: '€',   name: '欧元' },
  { code: 'JPY', sym: 'JP¥', name: '日元' },
  { code: 'HKD', sym: 'HK$', name: '港币' },
  { code: 'GBP', sym: '£',   name: '英镑' },
  { code: 'KRW', sym: '₩',   name: '韩元' },
  { code: 'SGD', sym: 'S$',  name: '新加坡元' },
  { code: 'AUD', sym: 'A$',  name: '澳元' },
  { code: 'CAD', sym: 'C$',  name: '加元' }
];
const CUR = Object.fromEntries(CURRENCIES.map(c => [c.code, c]));
const CUR_CODES = CURRENCIES.map(c => c.code);
/* 老数据没有 cur 字段，一律当人民币；其他未知代码也回落人民币 */
const curOf = t => (t && CUR[t.cur]) ? t.cur : 'CNY';
const symOf = code => (CUR[code] || CUR.CNY).sym;
const nameOf = code => {
  const c = (CUR[code] || CUR.CNY);
  return I18N.isEN() ? I18N.translate(c.name) : c.name;
};
const money = (c, code = 'CNY') => symOf(code) + yuan(c);
const mainCur = () => (state.settings.mainCur && CUR[state.settings.mainCur]) ? state.settings.mainCur : 'CNY';

function monthLabel(mk) {
  const [y, m] = mk.split('-');
  return I18N.isEN() ? `${MON_EN[Number(m) - 1]} ${y}` : `${y}年${Number(m)}月`;
}

function dayLabel(ds) {
  const t0 = todayStr();
  if (ds === t0) return I18N.t('今天');
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (ds === todayStr(y)) return I18N.t('昨天');
  const d = new Date(ds + 'T00:00:00');
  if (I18N.isEN()) return `${WEEK_EN[d.getDay()]}, ${MON_EN[d.getMonth()]} ${d.getDate()}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}`;
}

function catInitial(name) {
  if (!name) return I18N.isEN() ? 'N' : '记';
  const shown = I18N.isEN() ? I18N.translate(name) : name;
  return shown.slice(0, 1).toUpperCase();
}

/* 展示用的分类/账户名：库里存的永远是中文，只有内置词汇有英文对照，
   用户自己起的名字查不到就原样显示，不会被乱翻。 */
const showName = s => (I18N.isEN() ? I18N.translate(s || '') : (s || ''));

let toastTimer = null;
function toast(msg, isErr = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast' + (isErr ? ' err' : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, isErr ? 4000 : 2200);
}

/* ---------------- load ---------------- */

async function loadAll() {
  await DB.seedCatsIfEmpty();
  const [txs, cats, settings, rules] = await Promise.all([
    DB.allTx(), DB.allCats(), DB.getAllSettings(), DB.getRules()
  ]);
  state.txs = txs;
  state.cats.expense = cats.filter(c => c.type === 'expense').sort((a, b) => a.order - b.order);
  state.cats.income = cats.filter(c => c.type === 'income').sort((a, b) => a.order - b.order);
  state.settings = settings;
  state.rules = rules || {};
  if (!state.month) state.month = nowMonth();
  await migrateModelNames();
}

/* 旧版存下的模型名已下线，静默迁移到当前名，避免用户看到 404 */
const RETIRED_MODELS = {
  'deepseek-chat': 'deepseek-flash',
  'deepseek-v4-flash': 'deepseek-flash',
  'deepseek-v4-flash-vision-exp': 'deepseek-flash'
};

async function migrateModelNames() {
  for (const k of ['apiModel', 'vModel']) {
    const cur = state.settings[k];
    if (cur && RETIRED_MODELS[cur]) {
      state.settings[k] = RETIRED_MODELS[cur];
      await DB.setSetting(k, RETIRED_MODELS[cur]);
    }
  }
}

async function getAIConfig() {
  const s = state.settings;
  return {
    base: s.apiBase || AI.PROVIDERS.deepseek.base,
    model: s.apiModel || AI.PROVIDERS.deepseek.model,
    key: s.apiKey || ''
  };
}

/* 识图配置：优先用独立配置，留空则回落到主配置 */
function getVisionConfig() {
  const s = state.settings;
  const vp = s.vProvider || 'follow';
  const mainPreset = AI.PROVIDERS[s.provider || 'deepseek'] || AI.PROVIDERS.deepseek;
  // 「跟随上方」时，若该服务商的视觉模型就在同一家，直接复用它的视觉模型名
  const preset = vp === 'custom' ? null
    : vp === 'follow' ? mainPreset
    : (AI.PROVIDERS[vp] || null);

  const base = (s.vBase || '').trim() || preset?.base || s.apiBase || AI.PROVIDERS.deepseek.base;
  let model = (s.vModel || '').trim() || preset?.vision || '';
  // 主模型本身就是多模态（如 DeepSeek 的 deepseek-flash），兜底直接用它
  if (!model && vp === 'follow') model = (s.apiModel || '').trim();
  const key = (s.vKey || '').trim() || s.apiKey || '';
  return { base, model, key, ready: !!(base && model && key) };
}

function aiCtx() {
  return {
    expenseCats: state.cats.expense.map(c => c.name),
    incomeCats: state.cats.income.map(c => c.name),
    rules: state.rules,
    defaultCur: mainCur()
  };
}

/* ---------------- tabs ---------------- */

/* 悬浮加号只在记账页出现；预览卡片展开时也收起来，免得压住行尾的删除按钮 */
function syncFab() {
  const fab = $('#fab-add');
  if (!fab) return;
  fab.hidden = state.tab !== 'home' || !!(state.pending && state.pending.length);
}

function switchTab(name) {
  state.tab = name;
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  syncFab();
  window.scrollTo(0, 0);
  if (name === 'home') renderHome();
  if (name === 'list') renderList();
  if (name === 'stats') renderStats();
  if (name === 'settings') renderSettings();
}

/* ---------------- 月份切换（首页 / 统计页共用） ---------------- */

function shiftMonth(mk, delta) {
  const [y, m] = mk.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/* 切月：首页金额和统计页跟着一起走；未来月份一律钳回当月 */
function setMonth(mk) {
  if (!mk || !/^\d{4}-\d{2}$/.test(mk)) return;
  const now = nowMonth();
  if (mk > now) mk = now;
  if (mk === state.month) return;
  state.month = mk;
  state.statSel = '';   // 换了月份，之前展开的分类明细不该跟着留下来
  renderHome();
  if (state.tab === 'stats') renderStats();
}

/* 原生月份选择器（临时插一个隐藏 input 借它的 showPicker） */
/* 月份选择：自绘面板。
   以前用 <input type="month"> + showPicker()，桌面 Chrome 能弹日历，
   但安卓 WebView 把 month 降级成普通文本框，showPicker() 弹不出任何东西，
   所以首页那个月份胶囊在真机上点了完全没反应。 */
let mpCb = null;
let mpYear = 0;
let mpCur = '';

function pickMonth(cur, cb) {
  mpCb = cb;
  mpCur = cur || nowMonth();
  mpYear = +mpCur.slice(0, 4);
  renderMonthPanel();
  $('#mp-mask').hidden = false;
}

function renderMonthPanel() {
  const maxMk = nowMonth();
  const nowYear = +maxMk.slice(0, 4);
  const has = new Set(state.txs.map(t => monthOf(t.date)));
  $('#mp-year').textContent = I18N.isEN() ? String(mpYear) : `${mpYear}年`;
  $('#mp-next').disabled = mpYear >= nowYear;   // 不许翻到未来
  $('#mp-prev').disabled = mpYear <= 2000;
  let html = '';
  for (let m = 1; m <= 12; m++) {
    const mk = `${mpYear}-${pad(m)}`;
    const future = mk > maxMk;
    const cls = ['mp-cell'];
    if (mk === mpCur) cls.push('on');
    if (future) cls.push('dis');
    if (has.has(mk)) cls.push('has');
    html += `<button class="${cls.join(' ')}" data-mk="${mk}"${future ? ' disabled' : ''}>${I18N.isEN() ? MON_EN[m - 1] : `${m}月`}</button>`;
  }
  $('#mp-grid').innerHTML = html;
}

function closeMonthPanel() {
  $('#mp-mask').hidden = true;
  mpCb = null;
}

/* ---------------- render: home ---------------- */

function monthTxs(mk) {
  return state.txs.filter(t => monthOf(t.date) === mk);
}

function totals(list) {
  let expense = 0, income = 0;
  for (const t of list) {
    if (t.type === 'expense') expense += t.cents;
    else if (t.type === 'income') income += t.cents;
  }
  return { expense, income, balance: income - expense };
}

/* ---------------- 预算 ---------------- */
/* 预算按月固定，只对主币种生效。存成
     { total:{USD:300000}, cats:{餐饮:{USD:80000}} }
   单位是分，和流水一致；按币种分开是因为不同币种加在一起没有意义。 */

function budgetData() {
  const b = state.settings.budget;
  const obj = o => (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
  if (!b || typeof b !== 'object') return { total: {}, cats: {} };
  const cats = {};
  for (const [k, v] of Object.entries(obj(b.cats))) {
    if (v && typeof v === 'object' && !Array.isArray(v)) cats[k] = v;
  }
  return { total: obj(b.total), cats };
}

/* 取某个币种下的额度，没设或非法一律当 0（=不限制） */
function budOf(map, cur) {
  const v = map && map[cur];
  return (typeof v === 'number' && isFinite(v) && v > 0) ? Math.round(v) : 0;
}
const budTotal = (cur = mainCur()) => budOf(budgetData().total, cur);
const budCat = (name, cur = mainCur()) => budOf(budgetData().cats[name], cur);

/* 某个月的预算执行情况（只算主币种的支出） */
function budgetStat(mk, cur = mainCur()) {
  const list = monthTxs(mk).filter(t => t.type === 'expense' && curOf(t) === cur);
  const spent = list.reduce((s, t) => s + t.cents, 0);
  const byCat = new Map();
  for (const t of list) byCat.set(t.cat, (byCat.get(t.cat) || 0) + t.cents);

  // 只跟现有分类走：分类被删掉后，它的旧预算不再出现在界面上
  const cats = [];
  for (const c of state.cats.expense) {
    const limit = budCat(c.name, cur);
    if (!limit) continue;
    cats.push({ name: c.name, limit, spent: byCat.get(c.name) || 0 });
  }
  cats.sort((a, b) => (b.spent / b.limit) - (a.spent / a.limit));

  const y = +mk.slice(0, 4), m = +mk.slice(5, 7);
  const dim = new Date(y, m, 0).getDate();
  const nowMk = nowMonth();
  const isNow = mk === nowMk;
  // 只对「本月」算日均：往月已经结束，未来月还没开始
  const left = isNow ? dim - new Date().getDate() + 1 : (mk > nowMk ? dim : 0);

  const limit = budTotal(cur);
  return {
    spent, limit, cats,
    rest: limit - spent,
    pct: limit ? spent / limit : 0,
    isNow,
    past: mk < nowMk,
    perDay: (isNow && left > 0 && limit) ? (limit - spent) / left : null
  };
}

/* 进度条：过 80% 转橙，超了转红（沿用 --expense 这个语义色，各皮肤自动跟随） */
function budBar(pct) {
  const clamped = Math.max(0, Math.min(1, pct));
  const cls = pct >= 1 ? ' over' : (pct >= 0.8 ? ' warn' : '');
  // 只花了 1% 时进度条会缩成一个点，看着像脏东西：给个最小可见宽度
  const w = clamped > 0 ? `max(6px,${(clamped * 100).toFixed(1)}%)` : '0';
  return `<div class="bud-bar${cls}"><i style="width:${w}"></i></div>`;
}

function renderBudgetHome() {
  const box = $('#home-budget');
  if (!box) return;
  const mc = mainCur();
  const st = budgetStat(state.month, mc);

  if (!st.limit) {
    box.innerHTML = `<button class="bud-empty" type="button" data-goto-budget="1">
      <span><b>设个本月预算</b><i>快超支时首页会直接提醒</i></span>
      <em>去设置 →</em>
    </button>`;
    return;
  }

  const over = st.rest < 0;
  const pctText = Math.round(st.pct * 100);
  const detail = st.cats.filter(c => c.spent > c.limit).slice(0, 3)
    .map(c => `${showName(c.name)}超 ${money(c.spent - c.limit, mc)}`).join(' · ');

  const right = over
    ? `已用 <b class="num">${pctText}%</b>`
    : (st.perDay != null
        ? `日均可用 <b class="num">${money(Math.max(0, Math.round(st.perDay)), mc)}</b>`
        : `已用 ${pctText}%`);

  box.innerHTML = `
    <div class="bud-top">
      <span class="bud-title">本月预算</span>
      <span class="bud-rest${over ? ' over' : ''}">${over
        ? '超支 ' + money(-st.rest, mc)
        : '还剩 ' + money(st.rest, mc)}</span>
    </div>
    ${budBar(st.pct)}
    <div class="bud-foot">
      <span><b class="num">${money(st.spent, mc)}</b> / ${money(st.limit, mc)}</span>
      <span>${right}</span>
    </div>
    ${detail ? `<div class="bud-alert">${esc(detail)}</div>` : ''}`;
}

function renderBudgetStats() {
  const box = $('#budget-box');
  if (!box) return;
  const head = $('#budget-head');
  const mc = mainCur();
  const st = budgetStat(state.month, mc);

  if (!st.limit && !st.cats.length) {
    if (head) head.textContent = '';
    box.innerHTML = `<div class="empty" style="padding:14px 0 6px"><b>还没设预算</b>去设置里填一个，这里就能看执行情况</div>`;
    return;
  }
  if (head) head.textContent = nameOf(mc);

  const rows = [];
  if (st.limit) {
    const over = st.rest < 0;
    rows.push(`<div class="bud-cat">
      <div class="bud-cat-top">
        <span class="bud-cat-name">总预算${over
          ? `<i class="bud-over-tag">超 ${Math.round((st.spent / st.limit - 1) * 100)}%</i>` : ''}</span>
        <span class="bud-cat-num${over ? ' over' : ''}">${money(st.spent, mc)} / ${money(st.limit, mc)}</span>
      </div>
      ${budBar(st.pct)}
    </div>`);
  }
  for (const c of st.cats) {
    const over = c.spent > c.limit;
    rows.push(`<div class="bud-cat">
      <div class="bud-cat-top">
        <span class="bud-cat-name">${esc(c.name)}${over
          ? `<i class="bud-over-tag">超 ${Math.round((c.spent / c.limit - 1) * 100)}%</i>` : ''}</span>
        <span class="bud-cat-num${over ? ' over' : ''}">${money(c.spent, mc)} / ${money(c.limit, mc)}</span>
      </div>
      ${budBar(c.spent / c.limit)}
    </div>`);
  }
  box.innerHTML = rows.join('');
}

/* 元 → 分；空/0/负数都当「不限制」 */
function parseYuan(str) {
  const s = String(str == null ? '' : str).replace(/[^\d.]/g, '');
  if (!s) return 0;
  const n = Number(s);
  if (!isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}
/* 分 → 输入框里的元，整数不显示 .00，避免一打开设置页全是 300.00 */
function yuanInput(cents) {
  if (!cents) return '';
  const v = cents / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function renderBudgetSettings() {
  const mc = mainCur();
  const b = budgetData();
  const total = $('#bud-total');
  if (total) total.value = yuanInput(b.total[mc]);
  const hint = $('#bud-hint');
  if (hint) hint.textContent = `${symOf(mc)} ${nameOf(mc)}`;
  const box = $('#bud-cats');
  if (!box) return;
  box.innerHTML = state.cats.expense.map(c => {
    const v = b.cats[c.name] && b.cats[c.name][mc];
    return `<label class="bud-row">
      <span>${esc(c.name)}</span>
      <input class="bud-input" type="number" inputmode="decimal" min="0" step="0.01"
             data-budcat="${esc(c.name)}" placeholder="不限" value="${yuanInput(v)}"
             autocomplete="off">
    </label>`;
  }).join('');
}

async function persistBudget(b) {
  state.settings.budget = b;
  await DB.setSetting('budget', b);
  renderBudgetHome();
  renderBudgetStats();
}

async function setBudgetTotal(str) {
  const cents = parseYuan(str);
  const cur = mainCur();
  const b = budgetData();
  const next = { total: { ...b.total }, cats: { ...b.cats } };
  if (cents) next.total[cur] = cents;
  else delete next.total[cur];
  await persistBudget(next);
}

async function setBudgetCat(name, str) {
  const cents = parseYuan(str);
  const cur = mainCur();
  const b = budgetData();
  const next = { total: { ...b.total }, cats: { ...b.cats } };
  const m = { ...(next.cats[name] || {}) };
  if (cents) m[cur] = cents;
  else delete m[cur];
  if (Object.keys(m).length) next.cats[name] = m;
  else delete next.cats[name];
  await persistBudget(next);
}


/* 同一个月里可能混着几种币，加起来是没有意义的，按币种分开算 */
function byCur(list) {
  const m = new Map();
  for (const t of list) {
    const c = curOf(t);
    if (!m.has(c)) m.set(c, []);
    m.get(c).push(t);
  }
  return m;
}

/* 「另有 US$ 120.00 · 2 笔」这种提示：主币种之外还有别的钱 */
function otherCurSummary(list, main) {
  const parts = [];
  const m = byCur(list.filter(t => curOf(t) !== main && t.type === 'expense'));
  for (const [c, arr] of m) {
    if (!arr.length) continue;
    const sum = arr.reduce((s, t) => s + t.cents, 0);
    parts.push(`${symOf(c)}${yuan(sum)} · ${arr.length} 笔`);
  }
  return parts.join('　');
}

/* 一组流水按币种汇总成文字：「US$12.00 + ¥30.00」 */
function sumTextByCur(items, type) {
  const m = new Map();
  items.forEach(it => {
    if (it.type !== type) return;
    const c = curOf(it);
    m.set(c, (m.get(c) || 0) + it.cents);
  });
  return Array.from(m).map(([c, v]) => symOf(c) + yuan(v)).join(' + ');
}

/* ---------------- 批量改币种 ---------------- */

/* 有流水的月份，最近的排前面 */
function monthsWithData() {
  return Array.from(new Set(state.txs.map(t => monthOf(t.date)))).sort().reverse();
}

function batchScopeList() {
  const sel = $('#batch-scope');
  const v = sel ? sel.value : '';
  return v === 'all' ? state.txs : state.txs.filter(t => monthOf(t.date) === v);
}

/* 币种改了，缓存的 AI 洞察数字就过期了。不传 months 就清掉全部 */
async function clearInsightCache(months) {
  const keys = months
    ? months.map(m => 'insight:' + m)
    : Object.keys(state.settings).filter(k => k.startsWith('insight:'));
  for (const k of keys) {
    if (state.settings[k] == null) continue;
    await DB.delSetting(k);
    delete state.settings[k];
  }
}

/* 主币种变了，同样让洞察作废 */
async function resetInsightBox() {
  const box = $('#insight-box');
  if (box) box.innerHTML = `<div class="insight-empty">点右上角「生成」，让 AI 读一遍这个月的账，说几句人话。一次大约几分钱。</div>`;
}

/* 上一次渲染的目标币种，用来判断要不要重置勾选框 */
let lastBatchTarget = '';

function renderBatchPanel() {
  const scopeSel = $('#batch-scope');
  const curSel = $('#batch-cur');
  if (!scopeSel || !curSel) return;

  const months = monthsWithData();
  const scopeNow = scopeSel.value || (months.includes(state.month) ? state.month : 'all');
  scopeSel.innerHTML = ['<option value="all">全部记录</option>']
    .concat(months.map(mk => `<option value="${mk}">${esc(monthLabel(mk) + (mk === nowMonth() ? '（本月）' : ''))}</option>`))
    .join('');
  // 选中的月份可能刚被删光/换掉，退回「全部」而不是卡在一个不存在的选项上
  scopeSel.value = (scopeNow === 'all' || months.includes(scopeNow)) ? scopeNow : 'all';

  const mc = mainCur();
  const prevTarget = curSel.value;
  curSel.innerHTML = CURRENCIES.map(c =>
    `<option value="${c.code}">${esc(showName(c.name))} ${esc(c.sym)}</option>`).join('');

  let target = prevTarget;
  if (!target || !CUR[target]) {
    // 默认挑「除主币种以外用得最多的那个」，没有就主币种换成另一种常见币
    const counts = new Map();
    state.txs.forEach(t => counts.set(curOf(t), (counts.get(curOf(t)) || 0) + 1));
    const alt = Array.from(counts.entries()).filter(([c]) => c !== mc).sort((a, b) => b[1] - a[1])[0];
    target = alt ? alt[0] : (mc === 'CNY' ? 'USD' : 'CNY');
  }
  curSel.value = target;

  updateBatchPreview();
}

function updateBatchPreview() {
  const target = $('#batch-cur') ? $('#batch-cur').value : '';
  if (!CUR[target]) return;

  const list = batchScopeList();
  const will = list.filter(t => curOf(t) !== target);
  const hint = $('#cur-batch-hint');
  const btn = $('#batch-apply');
  const mainRow = $('#batch-main-row');
  const mainBox = $('#batch-main');
  const mc = mainCur();

  // 换了目标币种就把勾选框重置回「勾上」；主币种已经一致时一行都不显示
  if (mainBox && target !== lastBatchTarget) {
    mainBox.checked = true;
    lastBatchTarget = target;
  }
  if (mainRow) {
    mainRow.hidden = mc === target;
    if (mc === target && mainBox) mainBox.checked = false;
  }

  if (btn) btn.disabled = !will.length;

  if (!list.length) {
    if (hint) { hint.textContent = '这块还没记账'; hint.className = 'hint'; }
    if (btn) btn.textContent = '没有可改的记录';
    return;
  }
  if (!will.length) {
    if (hint) { hint.textContent = `${list.length} 笔全是${nameOf(target)}`; hint.className = 'hint ok'; }
    if (btn) btn.textContent = '无需修改';
    return;
  }
  if (hint) {
    hint.textContent = `共 ${list.length} 笔 · 待改 ${will.length} 笔`;
    hint.className = 'hint';
  }
  if (btn) btn.textContent = `把这 ${will.length} 笔改成${nameOf(target)}`;
}

async function applyBatchCur() {
  const target = $('#batch-cur').value;
  if (!CUR[target]) return;
  const scope = $('#batch-scope').value;
  const will = batchScopeList().filter(t => curOf(t) !== target);
  if (!will.length) return;

  const scopeText = scope === 'all' ? '全部记录' : monthLabel(scope);
  const ok = confirm(I18N.translate(`把${scopeText}里的 ${will.length} 笔改成${nameOf(target)}？\n\n只改币种标签，金额数字不变（小账本不做汇率换算）。`));
  if (!ok) return;

  const btn = $('#batch-apply');
  btn.disabled = true;
  btn.textContent = '修改中';

  try {
    const rows = will.map(t => ({ ...t, cur: target }));
    await DB.putManyTx(rows);
    // 同步内存，避免重新读库才能看到变化
    const byId = new Map(rows.map(t => [t.id, t]));
    state.txs = state.txs.map(t => byId.get(t.id) || t);

    const alsoMain = $('#batch-main').checked && mainCur() !== target;
    if (alsoMain) {
      await DB.setSetting('mainCur', target);
      state.settings.mainCur = target;
      await clearInsightCache();   // 主币种动了，所有月份的洞察都该重算
      await resetInsightBox();
    } else {
      await clearInsightCache(rows.map(t => monthOf(t.date)));
      await resetInsightBox();
    }

    renderSettings();
    renderHome();
    renderStats();
    renderList();
    toast(`${will.length} 笔已改为${nameOf(target)}${alsoMain ? '，主币种一起切了' : ''}`);
  } catch (e) {
    btn.disabled = false;
    updateBatchPreview();
    toast('修改失败：' + (e && e.message ? e.message : e), true);
  }
}

function txRowHTML(t) {
  const cls = t.type === 'expense' ? 'exp' : t.type === 'income' ? 'inc' : 'trf';
  const sign = t.type === 'expense' ? '-' : t.type === 'income' ? '+' : '';
  const subParts = [];
  if (t.type === 'transfer') subParts.push(`${showName(t.acct)} → ${showName(t.toAcct)}`);
  else subParts.push(showName(t.acct));
  if (t.note) subParts.push(t.note);
  return `<div class="tx-item" data-id="${t.id}">
    <div class="tx-icon ${cls}">${esc(catInitial(t.cat))}</div>
    <div class="tx-main">
      <div class="tx-cat">${esc(showName(t.cat))}${t.src === 'ai' ? '<span class="badge-ai">AI</span>' : ''}</div>
      <div class="tx-sub" data-no-i18n>${esc(subParts.join(' · '))}</div>
    </div>
    <div class="tx-amt ${cls}">${sign}${symOf(curOf(t))}${yuan(t.cents)}</div>
  </div>`;
}

function renderHome() {
  $('#home-month').textContent = monthLabel(state.month);
  const mc = mainCur();
  const all = monthTxs(state.month);
  // 首页只汇总主币种，别的币种不往里加（加了就是错的）
  const list = all.filter(t => curOf(t) === mc);
  const { expense, income, balance } = totals(list);
  $('#home-expense').textContent = money(expense, mc);
  $('#home-income').textContent = money(income, mc);
  $('#home-balance').textContent = (balance < 0 ? '-' : '') + money(Math.abs(balance), mc);
  $('#home-count').textContent = list.length;

  const label = $('#home-label');
  if (label) label.textContent = mc === 'CNY' ? '本月支出' : `本月支出 · ${nameOf(mc)}`;
  const otherText = otherCurSummary(all, mc);
  const otherBox = $('#home-other');
  if (otherBox) {
    otherBox.hidden = !otherText;
    otherBox.textContent = otherText ? `另有 ${otherText}` : '';
  }

  const recent = all.slice(0, 8);
  const box = $('#recent-list');
  if (!recent.length) {
    box.innerHTML = `<div class="empty"><b>还没有记录</b>说一句话或点右下角 ＋ 开始</div>`;
  } else {
    box.innerHTML = `<div class="day-group">${recent.map(txRowHTML).join('')}</div>`;
  }
  renderBudgetHome();
}

/* ---------------- render: list ---------------- */

/* 胶囊上的月份写法：今年的省掉年份，往年的带上两位年份 */
function shortMonth(mk) {
  const y = mk.slice(0, 4), m = +mk.slice(5, 7);
  if (I18N.isEN()) {
    return y === String(new Date().getFullYear()) ? MON_EN[m - 1] : `${MON_EN[m - 1]} '${y.slice(2)}`;
  }
  return y === String(new Date().getFullYear()) ? `${m}月` : `${y.slice(2)}年${m}月`;
}

function renderListMonths() {
  const months = Array.from(new Set(state.txs.map(t => monthOf(t.date)))).sort().reverse();
  // 选中的月份已经一笔不剩（比如删光了）就退回「全部」
  if (state.listMonth && !months.includes(state.listMonth)) state.listMonth = '';
  const box = $('#list-months');
  box.innerHTML = [
    `<button class="chip${state.listMonth ? '' : ' on'}" data-lm="">全部</button>`,
    ...months.slice(0, 12).map(mk =>
      `<button class="chip${state.listMonth === mk ? ' on' : ''}" data-lm="${mk}">${shortMonth(mk)}</button>`)
  ].join('');
}

function renderList() {
  renderListMonths();

  const q = ($('#search').value || '').trim().toLowerCase();
  let list = state.txs;
  if (state.listMonth) list = list.filter(t => monthOf(t.date) === state.listMonth);
  if (q) {
    list = list.filter(t =>
      (t.note || '').toLowerCase().includes(q) ||
      (t.cat || '').toLowerCase().includes(q) ||
      (t.acct || '').toLowerCase().includes(q) ||
      /* 英文界面下顺手认一下英文分类名（显示是英文，存的还是中文） */
      I18N.translate(t.cat || '').toLowerCase().includes(q)
    );
  }
  const scope = state.listMonth ? monthLabel(state.listMonth) + ' · ' : '';
  $('#list-total').textContent = list.length ? `${scope}共 ${list.length} 笔` : (state.listMonth ? scope + '无记录' : '');

  const body = $('#list-body');
  if (!list.length) {
    let tip;
    if (q) tip = `<div class="empty"><b>没找到</b>换个关键词试试</div>`;
    else if (state.listMonth) tip = `<div class="empty"><b>${monthLabel(state.listMonth)}没有记录</b>点上面的「全部」看所有流水</div>`;
    else tip = `<div class="empty"><b>还没有流水</b>从记账页开始记第一笔</div>`;
    body.innerHTML = tip;
    return;
  }

  const groups = new Map();
  for (const t of list) {
    if (!groups.has(t.date)) groups.set(t.date, []);
    groups.get(t.date).push(t);
  }

  body.innerHTML = Array.from(groups.entries()).map(([date, items]) => {
    let e = 0, i = 0;
    items.forEach(t => {
      if (t.type === 'expense') e += t.cents;
      else if (t.type === 'income') i += t.cents;
    });
    const parts = [];
    if (e) parts.push(`支出 ${yuan(e)}`);
    if (i) parts.push(`收入 ${yuan(i)}`);
    return `<div class="day-group">
      <div class="day-head"><span>${esc(dayLabel(date))}</span><span class="day-sum">${parts.join(' · ')}</span></div>
      ${items.map(txRowHTML).join('')}
    </div>`;
  }).join('');
}

/* ---------------- render: stats ---------------- */

function renderStats() {
  const mc = mainCur();
  const allMonth = monthTxs(state.month);
  const list = allMonth.filter(t => t.type === 'expense' && curOf(t) === mc);
  const { expense } = totals(list);
  $('#stats-month').textContent = monthLabel(state.month);
  const nextBtn = $('#stats-next');
  if (nextBtn) nextBtn.disabled = state.month >= nowMonth();

  const byCat = new Map();
  for (const t of list) byCat.set(t.cat, (byCat.get(t.cat) || 0) + t.cents);
  const P = palette();
  const data = Array.from(byCat.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, value], i) => ({
      label, value, color: P[i % P.length], text: yuan(value)
    }));

  const mNum = +state.month.slice(5, 7);
  const centerLabel = mc === 'CNY' ? `${mNum}月支出` : `${mNum}月支出 · ${nameOf(mc)}`;
  // 选中的分类在新月份里可能已经没有数据了，先兜回未选中
  if (state.statSel && !byCat.has(state.statSel)) state.statSel = '';
  $('#pie').innerHTML = donut(data, centerLabel, yuan(expense), state.statSel);
  $('#pie-hint').textContent = data.length ? `${data.length} 类` : '';
  renderPieDetail(list, expense, mc);
  if (!data.length) { const t = $('#pie-tip'); if (t) t.hidden = true; }
  const otherText = otherCurSummary(allMonth, mc);
  const note = $('#pie-note');
  if (note) {
    note.hidden = !otherText;
    note.textContent = otherText ? `这个月另有 ${otherText}（未计入上图）` : '';
  }

  /* 近 12 个月：一屏露出 6 个，其余靠按住左右滑 */
  const months = [];
  const base = new Date(state.month + '-01T00:00:00');
  for (let i = 11; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    const mk = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const sum = monthTxs(mk)
      .filter(t => t.type === 'expense' && curOf(t) === mc)
      .reduce((s, t) => s + t.cents, 0);
    months.push({ label: I18N.isEN() ? MON_EN[d.getMonth()] : `${d.getMonth() + 1}月`, value: sum, mk, text: sum ? money(sum, mc) : '' });
  }
  $('#bars').innerHTML = bars(months, state.month);
  mountBars();

  renderInsight();
  renderSubs();
  renderBudgetStats();
}

/* 点柱子后，把这根柱子的金额显示在图下方，并给一个明确的切月按钮 */
function showBarTip(mk, val) {
  const tip = $('#bars-tip');
  if (!tip) return;
  // 给点中的柱子描个边，让人知道图里选的是哪根
  document.querySelectorAll('#bars .bar-col').forEach(g => {
    g.classList.toggle('sel', g.dataset.mk === mk);
  });
  const amt = val ? money(val, mainCur()) : '暂无支出';
  const isCur = mk === state.month;
  tip.innerHTML = `<button class="bars-jump" data-jump="${esc(mk)}">
    <b>${esc(monthLabel(mk))}</b>
    <span>${esc(amt)}</span>
    <em>${isCur ? '当前月份' : '看这个月 →'}</em>
  </button>`;
}

/* 柱状图：区分「按住滑动」和「点一下」 */
let barsFromX = 0;
let barsDragged = false;

/* 柱状图每次重渲染都重建 DOM，滚动位置要接回去，
   否则每切一次月就弹回最左边 */
function mountBars() {
  const sc = $('#bars-scroll');
  const tip = $('#bars-tip');
  if (tip) tip.textContent = '按住图表左右滑动，看更早的月份';
  if (!sc) return;
  sc.scrollLeft = state.barsScroll == null ? sc.scrollWidth : state.barsScroll;
  state.barsScroll = sc.scrollLeft;
  sc.addEventListener('scroll', () => { state.barsScroll = sc.scrollLeft; }, { passive: true });

  /* 手机上靠原生横向滚动，惯性和回弹都是系统的。
     桌面网页版用鼠标拖不动原生横向滚动，这里单独接管。 */
  let downX = 0;
  let downScroll = 0;
  let dragging = false;
  sc.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse') return;
    dragging = true;
    barsDragged = false;
    downX = e.clientX;
    downScroll = sc.scrollLeft;
    try { sc.setPointerCapture(e.pointerId); } catch (err) { /* 个别浏览器不支持 */ }
    sc.style.cursor = 'grabbing';
  });
  sc.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = e.clientX - downX;
    if (Math.abs(dx) > 4) barsDragged = true;
    sc.scrollLeft = downScroll - dx;
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    sc.style.cursor = 'grab';
    // 让紧随其后的 click 先跑完，再复位，否则拖完还会被当成点击
    setTimeout(() => { barsDragged = false; }, 0);
  };
  sc.addEventListener('pointerup', endDrag);
  sc.addEventListener('pointercancel', endDrag);
  sc.style.cursor = 'grab';
}

/* ---------------- 统计页：选中分类后的明细 ---------------- */

function renderPieDetail(list, expense, mc) {
  const box = $('#pie-detail');
  const tip = $('#pie-tip');
  if (!box) return;
  const sel = state.statSel;
  const hit = sel ? list.filter(t => t.cat === sel) : [];

  if (!hit.length) {
    box.hidden = true;
    box.innerHTML = '';
    if (tip) { tip.hidden = false; tip.textContent = '点扇区或图例，展开这个分类的明细'; }
    return;
  }

  const sum = hit.reduce((s, t) => s + t.cents, 0);
  const pct = expense ? Math.round(sum / expense * 100) : 0;
  const rows = hit.slice().sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts);
  // 环形图只统计主币种，同名分类里若有其它币种，明说一声免得和流水页数对不上
  const otherN = monthTxs(state.month).filter(t =>
    t.type === 'expense' && t.cat === sel && curOf(t) !== mc).length;
  const otherTip = otherN ? ` · 另有 ${otherN} 笔其它币种` : '';
  box.innerHTML = `
    <div class="pie-detail-head">
      <b>${esc(sel)}</b>
      <span class="pd-sub">${hit.length} 笔 · ${symOf(mc)}${yuan(sum)} · 占 ${pct}%${otherTip}</span>
      <button class="pd-close" id="pie-detail-close" aria-label="收起明细">✕</button>
    </div>
    <div class="pie-detail-list">${rows.map(txRowHTML).join('')}</div>
    <button class="link-btn pd-jump" id="pie-detail-jump">在流水里查看这个分类 ›</button>`;
  box.hidden = false;
  if (tip) tip.hidden = true;
}

/* 跳到流水页，并把月份和分类都预筛好 */
function jumpToList(cat, month) {
  $('#search').value = cat || '';
  state.listMonth = month || '';
  switchTab('list');
}

/* ---------------- render: settings ---------------- */

/* 地址栏用 textarea 以便整段显示，这里按内容自动撑高 */
function growField(el) {
  if (!el || el.tagName !== 'TEXTAREA') return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function renderOd() {
  const st = $('#od-status');
  if (!st) return;
  const on = OD.connected();
  const inp = $('#od-client');
  if (inp && document.activeElement !== inp && !inp.value) inp.value = state.settings.odClientId || '';
  st.textContent = on
    ? (OD.accountName() ? '已连接 · ' + OD.accountName() : '已连接')
    : '未连接';
  st.className = 'hint' + (on ? ' ok' : '');
  $('#od-btns-off').hidden = on;
  $('#od-btns-on').hidden = !on;
  $('#od-auto').checked = OD.autoEnabled();
  const redir = $('#od-redirect');
  if (redir) redir.textContent = OD.redirectUri();
  /* 说明区拆成「状态行 + 固定注册说明」两段，textContent 只动状态行，
   * 不然会把嵌在里面的 <b id="od-redirect"> 一起抹掉，下次渲染直接崩 */
  const reg = $('#od-register');
  if (reg) reg.hidden = on;
  const note = $('#od-note');
  if (note) {
    note.textContent = on
      ? (OD.lastBackupAt()
        ? `上次云备份 ${new Date(OD.lastBackupAt()).toLocaleString('zh-CN')}。备份存在 OneDrive 隐藏应用文件夹（Apps/小账本），App 只能访问这个文件夹。`
        : '还没云备份过。备份存在 OneDrive 隐藏应用文件夹（Apps/小账本），App 只能访问这个文件夹。')
      : '';
  }
}

function renderBaidu() {
  const st = $('#bd-status');
  if (!st) return;
  // 只有 App（Capacitor 原生通道）能用百度接口，网页版直接说明原因
  const inApp = !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp);
  $('#bd-web-note').hidden = inApp;
  $('#bd-body').hidden = !inApp;
  if (!inApp) { st.textContent = '仅限 App'; return; }

  const on = BD.connected();
  const cfg = BD.configured();
  st.textContent = on
    ? (BD.accountName() ? '已连接 · ' + BD.accountName() : '已连接')
    : (cfg ? '未连接' : '未配置');
  st.className = 'hint' + (on ? ' ok' : '');
  const set = (sel, val) => {
    const el = $(sel);
    if (el && document.activeElement !== el && !el.value) el.value = val;
  };
  set('#bd-appkey', state.settings.bdAppKey || '');
  set('#bd-secret', state.settings.bdSecretKey || '');
  set('#bd-appname', state.settings.bdAppName || '');
  $('#bd-btns-off').hidden = on;
  $('#bd-code-row').hidden = true;
  $('#bd-btns-on').hidden = !on;
  $('#bd-auto').checked = BD.autoEnabled();
  const bdRedir = $('#bd-redirect');
  if (bdRedir) bdRedir.textContent = `${location.origin}/`;
  const bdReg = $('#bd-register');
  if (bdReg) bdReg.hidden = on;
  const bdNote = $('#bd-note');
  if (bdNote) {
    bdNote.textContent = on
      ? (BD.lastBackupAt()
        ? `上次云备份 ${new Date(BD.lastBackupAt()).toLocaleString('zh-CN')}，云端路径 ${BD.cloudPath()}。`
        : `还没云备份过，云端路径 ${BD.cloudPath()}，同名自动覆盖。`)
      : '';
  }
}

/* ---------------- 语言 ---------------- */

const LANG_OPTS = [
  { k: 'auto', zh: '跟随系统', en: 'System' },
  { k: 'zh', zh: '中文', en: '中文' },
  { k: 'en', zh: 'English', en: 'English' }
];

function renderLangPicker() {
  const box = $('#lang-grid');
  if (!box) return;
  const p = I18N.langPref();
  box.innerHTML = LANG_OPTS.map(o => `
    <button type="button" class="lang-card${o.k === p ? ' on' : ''}" data-lang="${o.k}"
            aria-pressed="${o.k === p}">
      <span class="lang-name">${I18N.isEN() ? o.en : o.zh}</span>
      <span class="lang-tick">✓</span>
    </button>`).join('');
  const hint = $('#lang-hint');
  if (hint) hint.textContent = p === 'auto'
    ? (I18N.detectLang() === 'zh' ? '中文' : 'English')
    : (p === 'zh' ? '中文' : 'English');
}

async function setUiLang(p) {
  if (!I18N.LANGS.includes(p) || p === I18N.langPref()) return;
  I18N.setLang(p);
  state.settings.lang = p;
  await DB.setSetting('lang', p);
  document.title = I18N.isEN() ? 'Pocket Ledger' : '小账本';
  I18N.refresh();
  fillCurSelects(true);
  renderLangPicker();
  switchTab(state.tab);   // 整页重渲染：日期、月份、币种名才会换成新语言
  toast(p === 'en' ? 'Language: English' : (p === 'zh' ? '界面语言：中文' : '语言跟随系统'));
}

function renderSettings() {
  const s = state.settings;
  const mc = mainCur();
  renderSkinPicker();
  renderLangPicker();
  renderBudgetSettings();
  const curSel = $('#set-cur');
  if (curSel) curSel.value = mc;
  const mh = $('#maincur-hint');
  if (mh) mh.textContent = `${symOf(mc)} ${nameOf(mc)}`;
  renderBatchPanel();
  const pid = s.provider || 'deepseek';
  $('#set-provider').value = pid;
  $('#set-base').value = s.apiBase || AI.PROVIDERS[pid].base || '';
  $('#set-model').value = s.apiModel || AI.PROVIDERS[pid].model || '';
  $('#set-key').value = s.apiKey || '';
  growField($('#set-base'));
  $('#ai-status').textContent = s.apiKey ? '已配置' : '未配置';
  $('#ai-status').className = 'hint' + (s.apiKey ? ' ok' : '');

  $('#data-count').textContent = `${state.txs.length} 笔记录`;
  const last = s.lastBackupAt ? new Date(s.lastBackupAt) : null;
  if (last) {
    const days = Math.floor((Date.now() - last.getTime()) / 86400000);
    $('#backup-note').textContent = days > 6
      ? `上次备份 ${days} 天前，建议现在导出一份。数据只存在本机，清理浏览器数据会丢失。`
      : `上次备份 ${days === 0 ? '今天' : days + ' 天前'}。数据只存在本机。`;
    $('#backup-note').style.color = days > 6 ? '#C2410C' : '';
  }

  renderOd();
  renderBaidu();

  const chips = (list, type) => list.map(c =>
    `<span class="chip del" data-delcat="${c.id}" data-type="${type}">${esc(c.name)}</span>`
  ).join('');
  $('#cat-expense').innerHTML = chips(state.cats.expense, 'expense');
  $('#cat-income').innerHTML = chips(state.cats.income, 'income');

  // 识图配置
  const vp = s.vProvider || 'follow';
  $('#set-vprovider').value = vp;
  $('#set-vbase').value = s.vBase || '';
  growField($('#set-vbase'));
  $('#set-vmodel').value = s.vModel || AI.PROVIDERS[vp]?.vision || '';
  $('#set-vkey').value = s.vKey || '';
  const vcfg = getVisionConfig();
  const vEl = $('#vision-status');
  vEl.textContent = vcfg.ready ? '已配置' : '未配置';
  vEl.className = 'hint' + (vcfg.ready ? ' ok' : '');

  // 分类习惯
  const rk = Object.keys(state.rules || {});
  $('#rules-chips').innerHTML = rk.length
    ? rk.sort().map(k =>
        `<span class="chip del" data-delrule="${esc(k)}"><span data-no-i18n>${esc(k)}</span> → ${esc(showName(state.rules[k]))}</span>`
      ).join('')
    : '<span class="hint">还没有学习记录，改一次 AI 给的分类就会记下一条</span>';
}

/* ---------------- sheet ---------------- */

function formCats() {
  const list = state.form.type === 'income' ? state.cats.income : state.cats.expense;
  return list;
}

function renderFormChips() {
  const isTransfer = state.form.type === 'transfer';
  $('#cat-group-label').parentElement.hidden = isTransfer;

  $('#f-cats').innerHTML = formCats().map(c =>
    `<span class="chip ${state.form.cat === c.name ? 'on' : ''}" data-pickcat="${esc(c.name)}">${esc(c.name)}</span>`
  ).join('');

  const accts = AI.ACCOUNTS;
  $('#acct-group-label').textContent = isTransfer ? '转出账户' : '账户';
  $('#f-accts').innerHTML = accts.map(a =>
    `<span class="chip ${state.form.acct === a ? 'on' : ''}" data-pickacct="${esc(a)}">${esc(a)}</span>`
  ).join('');

  let toGroup = $('#to-acct-group');
  if (isTransfer) {
    if (!toGroup) {
      toGroup = document.createElement('div');
      toGroup.className = 'field-group';
      toGroup.id = 'to-acct-group';
      toGroup.innerHTML = '<div class="group-label">转入账户</div><div class="chips pick" id="f-to-accts"></div>';
      $('#f-accts').closest('.field-group').after(toGroup);
    }
    toGroup.hidden = false;
    $('#f-to-accts').innerHTML = accts.map(a =>
      `<span class="chip ${state.form.toAcct === a ? 'on' : ''}" data-pickto="${esc(a)}">${esc(a)}</span>`
    ).join('');
  } else if (toGroup) {
    toGroup.hidden = true;
  }
}

function openSheet(opts = {}) {
  const mode = opts.mode || 'new';
  state.editing = {
    mode,
    index: opts.index ?? null,
    id: opts.id ?? null,
    fromAI: !!opts.fromAI
  };

  if (mode === 'pending') {
    const item = state.pending[opts.index];
    state.form = {
      type: item.type, cat: item.cat, acct: item.acct,
      toAcct: item.toAcct || '银行卡', date: item.date, note: item.note || '',
      cur: curOf(item)
    };
    $('#f-amount').value = (item.cents / 100).toString();
  } else if (mode === 'edit') {
    const t = state.txs.find(x => x.id === opts.id);
    state.form = {
      type: t.type, cat: t.cat, acct: t.acct,
      toAcct: t.toAcct || '银行卡', date: t.date, note: t.note || '',
      cur: curOf(t)
    };
    $('#f-amount').value = (t.cents / 100).toString();
  } else if (opts.prefill) {
    const it = opts.prefill;
    state.form = {
      type: it.type, cat: it.cat, acct: it.acct,
      toAcct: it.toAcct || '银行卡',
      date: it.date || todayStr(), note: it.note || '',
      cur: curOf(it)
    };
    $('#f-amount').value = (it.cents / 100).toString();
  } else {
    const lastAcct = state.settings.lastAcct || '微信';
    const firstCat = state.cats.expense[0]?.name || '其他';
    state.form = {
      type: 'expense', cat: firstCat, acct: lastAcct,
      toAcct: '银行卡', date: todayStr(), note: '',
      cur: mainCur()
    };
    $('#f-amount').value = '';
  }

  state.editing.initCat = state.form.type === 'transfer' ? null : state.form.cat;

  $$('.seg-item').forEach(b => b.classList.toggle('active', b.dataset.type === state.form.type));
  $('#f-cur').value = state.form.cur || mainCur();
  $('#f-date').value = state.form.date;
  $('#f-note').value = state.form.note;
  $('#f-delete').hidden = mode !== 'edit';
  renderFormChips();

  $('#sheet-mask').hidden = false;
  document.body.style.overflow = 'hidden';
  if (mode === 'new') setTimeout(() => $('#f-amount').focus(), 220);
}

function closeSheet() {
  $('#sheet-mask').hidden = true;
  document.body.style.overflow = '';
  state.editing = null;
}

function sanitizeAmount(v) {
  let s = String(v).replace(/[^\d.]/g, '');
  const i = s.indexOf('.');
  if (i >= 0) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '').slice(0, 2);
  return s;
}

async function saveForm() {
  const raw = $('#f-amount').value.trim();
  const cents = Math.round(parseFloat(raw) * 100);
  if (!isFinite(cents) || cents <= 0) { toast('金额要大于 0'); $('#f-amount').focus(); return; }

  const ed = state.editing || { mode: 'new' };
  const f = state.form;
  f.date = $('#f-date').value || todayStr();
  f.note = $('#f-note').value.trim();
  f.cur = $('#f-cur').value || mainCur();

  if (f.type !== 'transfer' && !f.cat) { toast('选一个分类'); return; }
  if (f.type === 'transfer' && f.acct === f.toAcct) { toast('转出和转入不能是同一个账户'); return; }

  const base = {
    type: f.type,
    cents,
    cur: CUR[f.cur] ? f.cur : 'CNY',
    cat: f.type === 'transfer' ? '转账' : f.cat,
    acct: f.acct,
    date: f.date,
    note: f.note,
    ts: Date.now()
  };
  if (f.type === 'transfer') base.toAcct = f.toAcct;

  // 用户手动改了 AI 给的分类 → 记住这个商户，下次直接用
  if (ed.initCat && base.cat !== ed.initCat && base.type !== 'transfer') {
    await learnRule(base.note, base.cat, ed.initCat);
  }

  if (ed.mode === 'pending') {
    const prev = state.pending[ed.index] || {};
    state.pending[ed.index] = { ...base, src: 'ai', dup: prev.dup, img: prev.img };
    closeSheet();
    renderAIPreview();
    return;
  }

  if (ed.mode === 'edit') {
    const old = state.txs.find(x => x.id === ed.id);
    await DB.putTx({ ...base, id: ed.id, ts: old?.ts ?? Date.now(), src: old?.src || 'manual' });
  } else {
    await DB.putTx({ ...base, id: DB.uid(), src: ed.fromAI ? 'ai' : 'manual' });
  }

  await DB.setSetting('lastAcct', f.acct);
  state.settings.lastAcct = f.acct;

  closeSheet();
  await reloadTx();
  toast(ed.mode === 'edit' ? '已更新' : (ed.fromAI ? '已存为 AI 记录' : '记好了'));
}

async function reloadTx() {
  state.txs = await DB.allTx();
  if (state.tab === 'home') renderHome();
  if (state.tab === 'list') renderList();
  if (state.tab === 'stats') renderStats();
}

/* ---------------- AI ---------------- */

function renderAIPreview() {
  let box = $('#ai-preview');
  if (!box) {
    box = document.createElement('div');
    box.id = 'ai-preview';
    box.className = 'ai-preview';
    $('.ai-bar').after(box);
  }
  if (!state.pending || !state.pending.length) {
    box.hidden = true;
    box.innerHTML = '';
    state.pendingThumbs = [];
    state.keepDup = false;
    syncFab();
    return;
  }
  box.hidden = false;
  syncFab();

  const list = state.pending;
  const total = list.reduce((s, it) => s + (it.type === 'expense' ? it.cents : 0), 0);
  const dupCount = list.filter(it => it.dup).length;
  const keptCount = list.filter(it => !(it.dup && !state.keepDup)).length;

  /* 缩略图条：一张图也展示，让人确认读的是哪张 */
  let thumbs = '';
  if (state.pendingThumbs.length) {
    const show = state.pendingThumbs.slice(0, 6);
    const more = state.pendingThumbs.length - show.length;
    thumbs = `<div class="pv-thumbs">
      ${show.map(src => `<img class="pv-thumb" src="${src}" alt="账单原图">`).join('')}
      ${more > 0 ? `<div class="pv-thumb pv-more">+${more}</div>` : ''}
    </div>`;
  }
  const totalText = sumTextByCur(list, 'expense') || '0.00';
  const meta = `<div class="pv-total">${state.pendingThumbs.length ? state.pendingThumbs.length + ' 张图 · ' : ''}支出合计 <b>${totalText}</b></div>`;

  /* 按小票日期归纳 */
  const groups = new Map();
  list.forEach((it, i) => {
    if (!groups.has(it.date)) groups.set(it.date, []);
    groups.get(it.date).push({ it, i });
  });
  const days = Array.from(groups.keys()).sort((a, b) => b.localeCompare(a));

  const body = days.map(date => {
    const rows = groups.get(date);
    const items = rows.map(r => r.it);
    const eText = sumTextByCur(items, 'expense');
    const iText = sumTextByCur(items, 'income');
    const sum = [];
    if (eText) sum.push(`支出 ${eText}`);
    if (iText) sum.push(`收入 ${iText}`);
    return `<div class="pv-day">
      <div class="pv-day-head">
        <span class="pv-day-name">${esc(dayLabel(date))}</span>
        <span class="pv-day-sum">${rows.length} 笔${sum.length ? ' · ' + sum.join(' · ') : ''}</span>
      </div>
      ${rows.map(({ it, i }) => {
        const cls = it.type === 'expense' ? 'exp' : it.type === 'income' ? 'inc' : 'trf';
        const sign = it.type === 'expense' ? '-' : it.type === 'income' ? '+' : '';
        const skipped = it.dup && !state.keepDup;
        return `<div class="pv-row${skipped ? ' dup' : ''}" data-pv="${i}">
          <span class="pv-cat">${esc(it.cat)}${it.note ? ' · ' + esc(it.note) : ''}</span>
          ${it.dup ? `<span class="pv-tag">已存在</span>` : ''}
          <span class="pv-amt ${cls}">${sign}${symOf(curOf(it))}${yuan(it.cents)}</span>
          <button class="pv-del" data-delpv="${i}" aria-label="移除这一笔">✕</button>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');

  const dupTip = dupCount
    ? `<div class="pv-tip">
        其中 <b>${dupCount}</b> 笔同日期同金额的流水已经存在，默认不重复保存
        <button class="pv-link" data-pvkeep="1">${state.keepDup ? '改为跳过' : '仍然全部保留'}</button>
       </div>`
    : '';

  box.innerHTML = `
    ${thumbs}
    <div class="pv-head">识别到 ${list.length} 笔${days.length > 1 ? ` · 按小票日期分 ${days.length} 天` : ''}</div>
    ${meta}
    ${dupTip}
    ${body}
    <div class="pv-actions">
      <button class="btn ghost" id="pv-cancel">取消</button>
      <button class="btn primary" id="pv-save">保存 ${keptCount} 笔</button>
    </div>`;
}

/* 输入条右侧那颗按钮的定位：它是「提交」，不是「打开 AI 开关」。
   图片是选完即识别，语音是说完即提交，只有手动打字才需要按它（或回车）。
   所以文案用「发送」而不是「解析」，空输入时直接置灰，免得点了个寂寞。 */
const GO_LABEL = '发送';

function syncGoState() {
  const btn = $('#ai-go'), input = $('#ai-input');
  if (!btn || !input || btn.dataset.busy === '1') return;
  btn.disabled = !input.value.trim();
}

function setBusy(on, label) {
  const btn = $('#ai-go');
  btn.dataset.busy = on ? '1' : '0';
  btn.textContent = on ? (label || '解析中') : GO_LABEL;
  if (on) btn.disabled = true;
  else syncGoState();
}

async function handleAI() {
  const input = $('#ai-input');
  const text = input.value.trim();
  if (!text) { toast('说一句，或点相机上传账单截图'); input.focus(); return; }

  clearAnswer();

  // 先看是不是在问账（本地算，不花钱）
  if (AI.looksLikeQuery(text)) {
    const ans = answerQuery(AI.detectQuery(text, aiCtx()));
    if (ans) { renderAnswer(text, ans); input.value = ''; return; }
  }

  setBusy(true);
  try {
    const cfg = await getAIConfig();
    if (!cfg.key) throw new Error('还没配置 API Key，去「设置」里填一下');

    const items = await AI.parseExpenses(text, {
      ...aiCtx(),
      base: cfg.base,
      model: cfg.model,
      key: cfg.key
    });

    if (!items.length) { toast('没识别出金额，换个说法试试'); return; }

    if (items.length === 1) {
      state.pending = null;
      state.pendingThumbs = [];
      renderAIPreview();
      openSheet({ mode: 'new', prefill: items[0], fromAI: true });
    } else {
      state.pendingThumbs = [];
      state.pending = items;
      renderAIPreview();
    }
    input.value = '';
  } catch (e) {
    console.warn(e);
    toast(AI.explainError(e), true);
  } finally {
    setBusy(false);
  }
}

/* ---------------- 图片记账 ---------------- */

const BATCH_MAX = 12;

/* 同日期 + 同金额 + 同账户 + 同类型，视为同一笔 */
function isDupTx(it) {
  return state.txs.some(t =>
    t.date === it.date && t.cents === it.cents &&
    t.type === it.type && t.acct === it.acct
  );
}

async function handleImages(files) {
  const list = Array.from(files || []).filter(f => f && (!f.type || f.type.startsWith('image/')));
  if (!list.length) return;

  const vcfg = getVisionConfig();
  if (!vcfg.ready) {
    toast('还没配置识图模型，去「设置 → 图片记账」填一下', true);
    setTimeout(() => switchTab('settings'), 600);
    return;
  }

  const batch = list.slice(0, BATCH_MAX);
  if (list.length > BATCH_MAX) {
    toast(`一次最多 ${BATCH_MAX} 张，先处理前 ${BATCH_MAX} 张`, true);
  }

  const photoBtn = $('#ai-photo');
  photoBtn.disabled = true;
  clearAnswer();

  const got = [];
  const thumbs = [];
  const fails = [];

  for (let i = 0; i < batch.length; i++) {
    const many = batch.length > 1;
    setBusy(true, many ? `识图 ${i + 1}/${batch.length}` : '识图中');
    if (many) toast(`正在读第 ${i + 1}/${batch.length} 张…`);
    try {
      const { dataUrl } = await AI.compressImage(batch[i], 1600, 0.85);
      const items = await AI.parseImage(dataUrl, aiCtx(), vcfg);
      if (items.length) {
        thumbs.push(dataUrl);
        items.forEach(it => got.push({ ...it, img: i }));
      } else {
        fails.push(`第 ${i + 1} 张没找到账单`);
      }
    } catch (e) {
      console.warn(e);
      fails.push(`第 ${i + 1} 张：${AI.explainError(e)}`);
    }
  }

  photoBtn.disabled = false;
  setBusy(false);

  /* 进度提示到此结束，别让它继续挂着 */
  clearTimeout(toastTimer);
  $('#toast').hidden = true;

  if (!got.length) {
    toast(fails[0] || '这张图里没找到账单，换一张更清晰的截图', true);
    return;
  }

  /* 同一批里重复出现的、以及库里已有的，都标上 */
  const seen = new Set();
  got.forEach(it => {
    const key = `${it.date}|${it.cents}|${it.acct}|${it.type}`;
    it.dup = isDupTx(it) || seen.has(key);
    seen.add(key);
  });

  state.pending = (Array.isArray(state.pending) ? state.pending : []).concat(got);
  state.pendingThumbs = (state.pendingThumbs || []).concat(thumbs).slice(0, BATCH_MAX);
  state.keepDup = false;
  renderAIPreview();

  /* 重复项信息写在卡片里就够了，不再弹 toast 遮住内容 */
  if (fails.length) {
    toast(`${got.length} 笔已识别，但有 ${fails.length} 张失败：${fails[0]}`, true);
  }
}

/* 单个文件（粘贴、单选）走同一条链路 */
function handleImage(file) {
  return handleImages([file]);
}

/* ---------------- 自然语言查账 ---------------- */

const RANGE_LABEL = {
  today: '今天', yesterday: '昨天', this_week: '本周', last_week: '上周',
  last_month: '上月', this_year: '今年', all: '全部流水'
};

function mondayOf(d = new Date()) {
  const x = new Date(d);
  const w = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - w);
  return todayStr(x);
}

function rangeFilter(q) {
  if (q.month) return t => monthOf(t.date) === q.month;
  const today = todayStr();
  switch (q.range) {
    case 'today': return t => t.date === today;
    case 'yesterday': {
      const y = new Date(); y.setDate(y.getDate() - 1);
      const ys = todayStr(y);
      return t => t.date === ys;
    }
    case 'this_week': {
      const s = mondayOf();
      return t => t.date >= s && t.date <= today;
    }
    case 'last_week': {
      const s = mondayOf();
      const e = new Date(s + 'T00:00:00'); e.setDate(e.getDate() - 1);
      const es = todayStr(e);
      const ss = mondayOf(e);
      return t => t.date >= ss && t.date <= es;
    }
    case 'last_month': {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
      const mk = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      return t => monthOf(t.date) === mk;
    }
    case 'this_year': return t => t.date.startsWith(String(new Date().getFullYear()));
    case 'all': return () => true;
    default: return t => monthOf(t.date) === state.month;
  }
}

function answerQuery(q) {
  const inRange = rangeFilter(q);
  const scope = q.month ? monthLabel(q.month) : (RANGE_LABEL[q.range] || monthLabel(state.month));
  let all = state.txs.filter(inRange);
  if (q.cat) all = all.filter(t => t.cat === q.cat);
  if (q.acct) all = all.filter(t => t.acct === q.acct || t.toAcct === q.acct);

  // 不同币种不能相加，只算主币种；实在只剩别的币种就明说
  const mc = mainCur();
  const list = all.filter(t => curOf(t) === mc);
  const scopeText = scope + (q.cat ? ' · ' + q.cat : '') + (q.acct ? ' · ' + q.acct : '');

  if (!list.length) {
    const others = otherCurSummary(all, mc);
    if (others) return { main: '换个币种再看', sub: `${scopeText}只有 ${others}，不是当前主币种 ${symOf(mc)}` };
    return { main: '这笔账还没记', sub: `${scopeText}没有任何记录` };
  }

  if (q.metric === 'count') {
    const expN = list.filter(t => t.type === 'expense').length;
    return { main: `${list.length} 笔`, sub: `${scopeText}共 ${list.length} 笔，其中支出 ${expN} 笔` };
  }

  const exp = list.filter(t => t.type === 'expense');
  const sumExp = exp.reduce((s, t) => s + t.cents, 0);

  if (q.metric === 'top') {
    const top = [...list].sort((a, b) => b.cents - a.cents).slice(0, 3);
    return {
      main: money(top[0].cents, mc),
      sub: `最贵的一笔：${top[0].date.slice(5)} ${top[0].cat}${top[0].note ? ' · ' + top[0].note : ''}`,
      rows: top.map(t => ({ k: `${t.date.slice(5)} ${t.cat}${t.note ? ' · ' + t.note : ''}`, v: money(t.cents, mc) }))
    };
  }

  if (q.metric === 'avg') {
    if (!exp.length) return { main: '没有支出', sub: `${scopeText}只有收入记录` };
    return { main: money(Math.round(sumExp / exp.length), mc), sub: `${scopeText}共 ${exp.length} 笔支出，平均每笔` };
  }

  // sum
  if (q.cat || q.acct) {
    const monthExp = totals(monthTxs(state.month).filter(t => curOf(t) === mc)).expense;
    const pct = monthExp > 0 ? Math.round(sumExp / monthExp * 100) : 0;
    const rows = exp.slice(0, 3).map(t => ({
      k: `${t.date.slice(5)} ${t.note || t.cat}`,
      v: money(t.cents, mc)
    }));
    return {
      main: money(sumExp, mc),
      sub: `${scopeText}共 ${exp.length} 笔${q.cat ? `，占本月支出的 ${pct}%` : ''}`,
      rows
    };
  }

  const inc = list.filter(t => t.type === 'income').reduce((s, t) => s + t.cents, 0);
  const byCat = {};
  exp.forEach(t => { byCat[t.cat] = (byCat[t.cat] || 0) + t.cents; });
  const rows = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, v]) => ({ k, v: money(v, mc) }));
  return {
    main: money(sumExp, mc),
    sub: `${scopeText}支出 ${exp.length} 笔，收入 ${money(inc, mc)}，结余 ${money(inc - sumExp, mc)}`,
    rows
  };
}

function clearAnswer() {
  const el = document.getElementById('answer-card');
  if (el) el.remove();
}

function renderAnswer(question, ans) {
  clearAnswer();
  const box = document.createElement('div');
  box.id = 'answer-card';
  box.className = 'answer-card';
  box.innerHTML = `
    <button class="answer-close" id="answer-close">✕</button>
    <div class="answer-q">${esc(question)}</div>
    <div class="answer-main">${esc(ans.main)}</div>
    <div class="answer-sub">${esc(ans.sub)}</div>
    ${ans.rows?.length ? `<div class="answer-list">${ans.rows.map(r =>
      `<div class="answer-row"><span>${esc(r.k)}</span><b>${esc(r.v)}</b></div>`).join('')}</div>` : ''}`;
  $('.ai-bar').after(box);
  box.querySelector('#answer-close').addEventListener('click', clearAnswer);
}

async function savePendingAll() {
  if (!state.pending?.length) return;
  const kept = state.pending.filter(it => !(it.dup && !state.keepDup));
  if (!kept.length) {
    toast('没有可保存的条目，它们都已经存在了');
    return;
  }
  const rows = kept.map(it => {
    const { img, dup, ...rest } = it;
    return { ...rest, id: DB.uid(), ts: Date.now(), src: 'ai' };
  });
  await DB.putManyTx(rows);
  const n = rows.length;
  const skipped = state.pending.length - n;
  state.pending = null;
  state.pendingThumbs = [];
  state.keepDup = false;
  renderAIPreview();

  /* 小票日期可能跨月：把界面切到最新一笔所在的月份，否则会说「保存了却看不见」 */
  const newest = rows.map(r => r.date).sort().pop();
  const mm = monthOf(newest);
  let jumped = false;
  if (mm && mm !== state.month) {
    state.month = mm;
    jumped = true;
  }

  await reloadTx();
  if (state.tab === 'home') renderHome();

  if (jumped) {
    toast(`已保存 ${n} 笔${skipped ? `，跳过 ${skipped} 笔重复` : ''}，切到 ${mm.replace('-', ' 年 ')} 月`);
  } else {
    toast(`已保存 ${n} 笔${skipped ? `，跳过 ${skipped} 笔重复` : ''}`);
  }
}

/* ---------------- 分类习惯 ---------------- */

async function learnRule(note, cat, prevCat) {
  const kw = String(note || '').trim().slice(0, 8);
  if (!kw || !cat || cat === prevCat || cat === '转账') return;
  try {
    state.rules = await DB.setRule(kw, cat);
  } catch (e) {
    console.warn('记忆分类失败', e);
  }
}

/* ---------------- 固定扣款识别（纯本地） ---------------- */

function detectSubs() {
  const map = new Map();
  for (const t of state.txs) {
    if (t.type !== 'expense') continue;
    const key = String(t.note || '').trim();
    if (key.length < 2) continue;
    // 同名的美元和人民币扣款是两码事，分开算
    const k = `${curOf(t)}|${key}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(t);
  }

  const out = [];
  for (const [k, items] of map) {
    if (items.length < 3) continue;
    const months = new Set(items.map(t => monthOf(t.date)));
    if (months.size < 3) continue;

    const amts = items.map(t => t.cents);
    const min = Math.min(...amts), max = Math.max(...amts);
    if (max / min > 1.2) continue;

    const perMonth = {};
    items.forEach(t => { const k2 = monthOf(t.date); perMonth[k2] = (perMonth[k2] || 0) + 1; });
    if (Object.values(perMonth).some(v => v > 2)) continue;

    const monthly = Math.round(items.reduce((s, t) => s + t.cents, 0) / months.size);
    out.push({
      name: k.slice(k.indexOf('|') + 1),
      cur: k.slice(0, k.indexOf('|')),
      monthly, count: items.length, months: months.size
    });
  }
  return out.sort((a, b) => b.monthly - a.monthly);
}

function renderSubs() {
  const box = $('#subs-box');
  const list = detectSubs();
  $('#sub-hint').textContent = list.length ? `${list.length} 项` : '';

  if (!list.length) {
    box.innerHTML = `<div class="insight-empty">还没发现规律扣款。同名项目连续记满 3 个月（房租、会员、话费）就会自动出现在这里。</div>`;
    return;
  }
  // 合计只在同币种内做，混币种就分币种列出来
  const byCurTotal = new Map();
  list.forEach(s => byCurTotal.set(s.cur, (byCurTotal.get(s.cur) || 0) + s.monthly));
  const totalText = Array.from(byCurTotal).map(([c, v]) => `${symOf(c)}${yuan(v)}`).join(' + ');
  const yearText = Array.from(byCurTotal).map(([c, v]) => `${symOf(c)}${yuan(v * 12)}`).join(' + ');

  box.innerHTML = list.map(s => `<div class="sub-row" data-sub="${esc(s.name)}" role="button" tabindex="0">
      <div class="sub-icon">${esc(s.name.slice(0, 1))}</div>
      <div class="sub-main">
        <div class="sub-name">${esc(s.name)}</div>
        <div class="sub-meta">跨 ${s.months} 个月出现 ${s.count} 次 · 点看明细</div>
      </div>
      <div class="sub-amt">${symOf(s.cur)}${yuan(s.monthly)}</div>
    </div>`).join('') +
    `<div class="sub-total">每月固定支出约 <b>${totalText}</b>，一年 <b>${yearText}</b></div>`;
}

/* ---------------- AI 月度洞察 ---------------- */

function renderInsight() {
  const box = $('#insight-box');
  const rec = state.settings['insight:' + state.month];
  if (rec?.lines?.length) {
    const t = new Date(rec.at);
    box.innerHTML = rec.lines.map(l => `<div class="insight-line">${esc(l)}</div>`).join('') +
      `<div class="insight-time">${t.getMonth() + 1}月${t.getDate()}日生成 · 点右上角可重新生成</div>`;
  } else {
    box.innerHTML = `<div class="insight-empty">点右上角「生成」，让 AI 读一遍这个月的账，说几句人话。一次大约几分钱。</div>`;
  }
}

function buildInsightPayload() {
  const mc = mainCur();
  // 只把主币种的账喂给模型，否则它会拿不同币种的数字直接相加
  const list = monthTxs(state.month).filter(t => curOf(t) === mc);
  const cur = totals(list);
  const [y, m] = state.month.split('-').map(Number);
  const pd = new Date(y, m - 2, 1);
  const prevMk = `${pd.getFullYear()}-${pad(pd.getMonth() + 1)}`;
  const prev = totals(monthTxs(prevMk).filter(t => curOf(t) === mc));

  const byCat = {};
  list.filter(t => t.type === 'expense').forEach(t => { byCat[t.cat] = (byCat[t.cat] || 0) + t.cents; });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => ({
    分类: k,
    金额: +(v / 100).toFixed(2),
    占本月支出百分比: cur.expense ? Math.round(v / cur.expense * 100) : 0
  }));

  const top = list.filter(t => t.type === 'expense')
    .sort((a, b) => b.cents - a.cents).slice(0, 5)
    .map(t => ({ 分类: t.cat, 备注: t.note || '', 金额: +(t.cents / 100).toFixed(2), 日期: t.date }));

  const subs = detectSubs().filter(s => s.cur === mc);

  return {
    月份: monthLabel(state.month),
    币种: `${nameOf(mc)}（${symOf(mc)}）`,
    本月支出: +(cur.expense / 100).toFixed(2),
    本月收入: +(cur.income / 100).toFixed(2),
    记账笔数: list.length,
    记账天数: new Set(list.map(t => t.date)).size,
    上月支出: +(prev.expense / 100).toFixed(2),
    分类构成: cats,
    大额支出: top,
    疑似固定扣款: subs.map(s => ({ 项目: s.name, 月均: +(s.monthly / 100).toFixed(2) }))
  };
}

async function generateInsight() {
  const btn = $('#insight-btn');
  const cfg = await getAIConfig();
  if (!cfg.key) { toast('先去设置里填 API Key', true); setTimeout(() => switchTab('settings'), 600); return; }

  const payload = buildInsightPayload();
  if (!payload.记账笔数) { toast('这个月还没有记录'); return; }

  btn.disabled = true;
  btn.textContent = '生成中';
  try {
    const lines = await AI.monthlyInsight(cfg, payload);
    const rec = { lines, at: Date.now() };
    await DB.setSetting('insight:' + state.month, rec);
    state.settings['insight:' + state.month] = rec;
    renderInsight();
    toast('生成了');
  } catch (e) {
    console.warn(e);
    toast(AI.explainError(e), true);
  } finally {
    btn.disabled = false;
    btn.textContent = '生成';
  }
}

/* ---------------- voice ---------------- */

function setupVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = $('#ai-mic');
  if (!SR) { mic.hidden = true; return; }
  mic.hidden = false;

  let rec = null, listening = false;
  mic.addEventListener('click', () => {
    if (listening) { rec.stop(); return; }
    rec = new SR();
    rec.lang = 'zh-CN';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onstart = () => { listening = true; mic.classList.add('on'); toast('听你说…'); };
    rec.onerror = e => {
      listening = false; mic.classList.remove('on');
      toast(e.error === 'not-allowed' ? '麦克风权限被拒绝' : '语音识别没成功，改用打字吧', true);
    };
    rec.onend = () => { listening = false; mic.classList.remove('on'); };
    rec.onresult = e => {
      const txt = e.results[0][0].transcript;
      $('#ai-input').value = txt;
      listening = false; mic.classList.remove('on');
      syncGoState();
      // 说话不是为了填输入框，是为了记这一笔：识别完直接提交，
      // 让「说一句」真的等于「记一笔」，不用再补一下按钮
      setTimeout(() => { if ($('#ai-input').value.trim()) handleAI(); }, 120);
    };
    try { rec.start(); } catch (err) { toast('语音启动失败', true); }
  });
}

/* ---------------- data io ---------------- */

function buildBackupPayload() {
  return {
    app: 'pocket-ledger',
    version: 2,
    exportedAt: new Date().toISOString(),
    transactions: state.txs,
    categories: [...state.cats.expense, ...state.cats.income],
    rules: state.rules,
    settings: {
      provider: state.settings.provider,
      apiBase: state.settings.apiBase,
      apiModel: state.settings.apiModel,
      vProvider: state.settings.vProvider,
      vBase: state.settings.vBase,
      vModel: state.settings.vModel,
      mainCur: state.settings.mainCur || 'CNY',
      theme: state.settings.theme || 'classic',
      budget: state.settings.budget || null
    }
  };
}

function backupFileName() {
  return `小账本-${todayStr()}.json`;
}

/* 手动导出：下载 JSON 文件到本地 */
async function exportData() {
  const blob = new Blob([JSON.stringify(buildBackupPayload(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFileName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  await DB.setSetting('lastBackupAt', Date.now());
  state.settings.lastBackupAt = Date.now();
  renderSettings();
  toast('已导出备份');
}

/* 分享备份文件：走系统分享面板（Android 可直接选 OneDrive 应用），不支持时回落下载 */
async function shareBackup() {
  const json = JSON.stringify(buildBackupPayload(), null, 2);
  const file = new File([json], backupFileName(), { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: '小账本备份' });
      toast('已分享');
    } catch (e) {
      if (e.name !== 'AbortError') toast('分享失败：' + e.message, true);
    }
  } else {
    toast('当前环境不支持分享文件，已改为下载');
    await exportData();
  }
}

async function importData(file) {
  try {
    const payload = JSON.parse(await file.text());
    await applyImportPayload(payload);
  } catch (e) {
    if (e && e.cancelled) return;
    console.warn(e);
    toast('文件解析失败，确认是小账本导出的 JSON', true);
  }
}

/* 导入/恢复共用：文件导入和 OneDrive 恢复都走这里。
 * 抛 { cancelled: true } 表示用户在确认框点了取消。 */
async function applyImportPayload(payload) {
  const rows = payload.transactions || payload.tx || [];
  if (!Array.isArray(rows) || !rows.length) { toast('这个文件里没有流水数据', true); return; }
  if (!confirm(I18N.translate(`导入 ${rows.length} 笔记录？相同 ID 的记录会被覆盖，不会重复。`))) {
    throw { cancelled: true };
  }

  // 老备份没有 cur 字段，补成人民币，免得后面各处兜底
  const clean = rows.filter(r => r && r.id && r.cents > 0)
    .map(r => ({ ...r, cur: CUR[r.cur] ? r.cur : 'CNY' }));
  await DB.putManyTx(clean);

  if (payload.settings) {
    for (const k of ['provider', 'apiBase', 'apiModel', 'vProvider', 'vBase', 'vModel', 'mainCur', 'theme', 'budget']) {
      if (payload.settings[k] != null) await DB.setSetting(k, payload.settings[k]);
    }
  }
  if (payload.rules && typeof payload.rules === 'object') {
    await DB.setSetting('catRules', payload.rules);
  }

  await loadAll();
  applyTheme(state.settings.theme || 'classic');
  await reloadTx();
  renderSettings();
  toast(`导入 ${clean.length} 笔`);
}

/* ---------------- events ---------------- */

function bindEvents() {
  $$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

  // 换肤：选项是动态渲染的，用事件委托接住
  const skinGrid = $('#skin-grid');
  if (skinGrid) {
    skinGrid.addEventListener('click', e => {
      const card = e.target.closest('[data-skin]');
      if (card) pickSkin(card.dataset.skin);
    });
  }
  // 语言：同样走委托
  const langGrid = $('#lang-grid');
  if (langGrid) {
    langGrid.addEventListener('click', e => {
      const card = e.target.closest('[data-lang]');
      if (card) setUiLang(card.dataset.lang);
    });
  }
  $$('[data-jump]').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.jump)));

  /* 预算：边输入边存，但防抖 500ms，免得每敲一位就写一次库。
     失焦时立刻落盘，避免「输完直接退出」丢掉最后一位。 */
  let budTimer = null;
  const laterBudget = fn => {
    clearTimeout(budTimer);
    budTimer = setTimeout(fn, 500);
  };
  const budTotalEl = $('#bud-total');
  if (budTotalEl) {
    budTotalEl.addEventListener('input', () => laterBudget(() => setBudgetTotal(budTotalEl.value)));
    budTotalEl.addEventListener('blur', () => {
      clearTimeout(budTimer);
      setBudgetTotal(budTotalEl.value);
    });
  }
  const budCatsEl = $('#bud-cats');
  if (budCatsEl) {
    budCatsEl.addEventListener('input', e => {
      const inp = e.target.closest('[data-budcat]');
      if (!inp) return;
      laterBudget(() => setBudgetCat(inp.dataset.budcat, inp.value));
    });
    // blur 不冒泡，必须用捕获
    budCatsEl.addEventListener('blur', e => {
      const inp = e.target.closest && e.target.closest('[data-budcat]');
      if (!inp) return;
      clearTimeout(budTimer);
      setBudgetCat(inp.dataset.budcat, inp.value);
    }, true);
  }
  const homeBud = $('#home-budget');
  if (homeBud) {
    homeBud.addEventListener('click', e => {
      if (!e.target.closest('[data-goto-budget]')) return;
      switchTab('settings');
      setTimeout(() => {
        const card = $('#budget-set-card');
        if (card) card.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 140);
    });
  }

  $('#home-month-btn').addEventListener('click', () => {
    pickMonth(state.month, setMonth);
  });

  /* 月份选择面板：翻年、选月、关掉 */
  $('#mp-prev').addEventListener('click', () => { mpYear--; renderMonthPanel(); });
  $('#mp-next').addEventListener('click', () => { mpYear++; renderMonthPanel(); });
  $('#mp-close').addEventListener('click', closeMonthPanel);
  $('#mp-mask').addEventListener('click', e => { if (e.target.id === 'mp-mask') closeMonthPanel(); });
  $('#mp-grid').addEventListener('click', e => {
    const cell = e.target.closest('[data-mk]');
    if (!cell || cell.disabled) return;
    const mk = cell.dataset.mk;
    const cb = mpCb;
    closeMonthPanel();
    if (cb) cb(mk);
  });

  // 统计页：前后月 + 点月份弹选择器 + 点柱状图跳月
  $('#stats-prev').addEventListener('click', () => setMonth(shiftMonth(state.month, -1)));
  $('#stats-next').addEventListener('click', () => setMonth(shiftMonth(state.month, 1)));
  $('#stats-month').addEventListener('click', () => pickMonth(state.month, setMonth));
  // 环形图：点扇区 / 图例展开明细，再点一次或点圆心收起
  $('#pie').addEventListener('click', e => {
    const hit = e.target.closest('[data-cat]');
    if (!hit) {
      // 点到圆心或空白处就是取消选择
      if (e.target.closest('#pie svg') && state.statSel) {
        state.statSel = '';
        renderStats();
      }
      return;
    }
    const cat = hit.dataset.cat;
    state.statSel = state.statSel === cat ? '' : cat;
    renderStats();
  });
  $('#pie').addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const hit = e.target.closest('[data-cat]');
    if (!hit) return;
    e.preventDefault();
    hit.click();
  });

  $('#pie-detail').addEventListener('click', e => {
    if (e.target.closest('#pie-detail-close')) {
      state.statSel = '';
      renderStats();
      return;
    }
    if (e.target.closest('#pie-detail-jump')) {
      jumpToList(state.statSel, state.month);
    }
  });

  /* 点柱子只「查看」，不再直接把月份改掉。
     原来点一下就把 state.month 换掉，图整体位移一格，
     手指连点左侧等于沿时间轴一路往回退，能一直退到 2016 年。
     要切月请点下方冒出来的「看这个月」。 */
  const barsBox = $('#bars');
  barsBox.addEventListener('touchstart', e => {
    barsFromX = e.touches[0].clientX;
    barsDragged = false;
  }, { passive: true });
  barsBox.addEventListener('touchmove', e => {
    if (Math.abs(e.touches[0].clientX - barsFromX) > 6) barsDragged = true;
  }, { passive: true });
  barsBox.addEventListener('click', e => {
    const col = e.target.closest('[data-mk]');
    if (!col || !col.dataset.mk) return;
    if (barsDragged) { barsDragged = false; return; }  // 刚滑完，不当成点击
    showBarTip(col.dataset.mk, Number(col.dataset.val || 0));
  });
  barsBox.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const col = e.target.closest('[data-mk]');
    if (!col) return;
    e.preventDefault();
    showBarTip(col.dataset.mk, Number(col.dataset.val || 0));
  });

  /* 柱状图下方那行：先显示这只柱子的金额，再给一个明确的切月入口 */
  $('#bars-tip').addEventListener('click', e => {
    const btn = e.target.closest('[data-jump]');
    if (!btn) return;
    const mk = btn.dataset.jump;
    if (mk === state.month) { toast(`${monthLabel(mk)} · 当前月份`); return; }
    setMonth(mk);
    toast(`已切到 ${monthLabel(mk)}`);
  });

  // 固定扣款：点某一项，去流水页看这笔钱都花在哪几个月
  $('#subs-box').addEventListener('click', e => {
    const row = e.target.closest('[data-sub]');
    if (row && row.dataset.sub) jumpToList(row.dataset.sub, '');
  });

  $('#ai-go').addEventListener('click', handleAI);
  $('#ai-input').addEventListener('keydown', e => { if (e.key === 'Enter') handleAI(); });
  $('#ai-input').addEventListener('input', syncGoState);
  syncGoState();

  $('#ai-photo').addEventListener('click', () => $('#photo-file').click());
  $('#photo-file').addEventListener('change', e => {
    const files = Array.from(e.target.files || []);
    if (files.length) handleImages(files);
    e.target.value = '';
  });
  // 电脑上直接 Ctrl+V 粘截图
  document.addEventListener('paste', e => {
    const items = Array.from(e.clipboardData?.items || []);
    const img = items.find(i => i.type && i.type.startsWith('image/'));
    if (img) {
      const file = img.getAsFile();
      if (file) { e.preventDefault(); handleImage(file); }
    }
  });

  $('#fab-add').addEventListener('click', () => openSheet({ mode: 'new' }));
  $('#sheet-close').addEventListener('click', closeSheet);
  $('#sheet-mask').addEventListener('click', e => { if (e.target.id === 'sheet-mask') closeSheet(); });

  $('#f-amount').addEventListener('input', e => { e.target.value = sanitizeAmount(e.target.value); });

  $$('.seg-item').forEach(b => b.addEventListener('click', () => {
    state.form.type = b.dataset.type;
    if (state.form.type !== 'transfer') {
      const pool = formCats();
      if (!pool.some(c => c.name === state.form.cat)) state.form.cat = pool[0]?.name || '';
    }
    $$('.seg-item').forEach(x => x.classList.toggle('active', x === b));
    renderFormChips();
  }));

  $('#f-cats').addEventListener('click', e => {
    const el = e.target.closest('[data-pickcat]');
    if (!el) return;
    state.form.cat = el.dataset.pickcat;
    $$('#f-cats .chip').forEach(c => c.classList.toggle('on', c === el));
  });

  $('#f-accts').addEventListener('click', e => {
    const el = e.target.closest('[data-pickacct]');
    if (!el) return;
    state.form.acct = el.dataset.pickacct;
    $$('#f-accts .chip').forEach(c => c.classList.toggle('on', c === el));
  });

  document.addEventListener('click', e => {
    const to = e.target.closest('[data-pickto]');
    if (to) {
      state.form.toAcct = to.dataset.pickto;
      $$('#f-to-accts .chip').forEach(c => c.classList.toggle('on', c === to));
    }
  });

  $('#f-save').addEventListener('click', saveForm);
  $('#f-delete').addEventListener('click', async () => {
    if (!state.editing?.id) return;
    if (!confirm(I18N.translate('删除这一笔？'))) return;
    await DB.delTx(state.editing.id);
    closeSheet();
    await reloadTx();
    toast('已删除');
  });

  document.addEventListener('click', e => {
    const keep = e.target.closest('[data-pvkeep]');
    if (keep) {
      state.keepDup = !state.keepDup;
      renderAIPreview();
      return;
    }
    const delpv = e.target.closest('[data-delpv]');
    if (delpv) {
      const i = Number(delpv.dataset.delpv);
      if (state.pending && state.pending[i]) {
        state.pending.splice(i, 1);
        if (!state.pending.length) state.pending = null;
        renderAIPreview();
        toast('已移除这一笔');
      }
      return;
    }
    const row = e.target.closest('.tx-item');
    if (row && !e.target.closest('[data-pv]')) {
      openSheet({ mode: 'edit', id: row.dataset.id });
    }
    const pv = e.target.closest('[data-pv]');
    if (pv) {
      openSheet({ mode: 'pending', index: Number(pv.dataset.pv) });
    }
  });

  document.addEventListener('click', e => {
    if (e.target.id === 'pv-save') savePendingAll();
    if (e.target.id === 'pv-cancel') { state.pending = null; renderAIPreview(); }
  });

  $('#search').addEventListener('input', renderList);
  $('#list-months').addEventListener('click', e => {
    const chip = e.target.closest('[data-lm]');
    if (!chip) return;
    state.listMonth = chip.dataset.lm || '';
    renderList();
    window.scrollTo(0, 0);
  });
  $('#insight-btn').addEventListener('click', generateInsight);

  $('#set-provider').addEventListener('change', e => {
    const p = AI.PROVIDERS[e.target.value];
    $('#set-base').value = p.base;
    growField($('#set-base'));
    $('#set-model').value = p.model;
  });

  ['#set-base', '#set-vbase'].forEach(sel => {
    $(sel).addEventListener('input', e => growField(e.target));
  });

  $('#set-cur').addEventListener('change', async e => {
    const v = CUR[e.target.value] ? e.target.value : 'CNY';
    await DB.setSetting('mainCur', v);
    state.settings.mainCur = v;
    await clearInsightCache();   // 主币种变了，缓存的洞察数字就对不上了
    await resetInsightBox();
    renderSettings();
    renderHome();
    renderStats();
    toast(`主币种已切到${nameOf(v)}，合计改按 ${symOf(v)} 计`);
  });

  ['#batch-scope', '#batch-cur'].forEach(sel => {
    $(sel).addEventListener('change', updateBatchPreview);
  });
  $('#batch-main').addEventListener('change', updateBatchPreview);
  $('#batch-apply').addEventListener('click', applyBatchCur);

  $('#set-save').addEventListener('click', async () => {
    const cfg = {
      provider: $('#set-provider').value,
      apiBase: $('#set-base').value.trim().replace(/\/+$/, ''),
      apiModel: $('#set-model').value.trim(),
      apiKey: $('#set-key').value.trim()
    };
    for (const [k, v] of Object.entries(cfg)) await DB.setSetting(k, v);
    Object.assign(state.settings, cfg);
    renderSettings();
    toast('已保存');
  });

  $('#set-test').addEventListener('click', async () => {
    const btn = $('#set-test');
    btn.disabled = true; btn.textContent = '测试中';
    try {
      const reply = await AI.testConnection({
        base: $('#set-base').value.trim().replace(/\/+$/, ''),
        model: $('#set-model').value.trim(),
        key: $('#set-key').value.trim()
      });
      setStatus('连接正常', 'ok');
      toast(`连接成功：${reply}`);
    } catch (e) {
      setStatus('连接失败', 'bad');
      toast(AI.explainError(e), true);
      console.warn(e);
    } finally {
      btn.disabled = false; btn.textContent = '测试连接';
    }
  });

  $('#set-vprovider').addEventListener('change', e => {
    const v = e.target.value;
    if (v === 'follow') {
      $('#set-vbase').value = '';
      growField($('#set-vbase'));
      $('#set-vmodel').value = '';
      return;
    }
    if (v === 'custom') {
      $('#set-vmodel').value = '';
      return;
    }
    const p = AI.PROVIDERS[v];
    if (!p) return;
    $('#set-vbase').value = p.base;
    growField($('#set-vbase'));
    $('#set-vmodel').value = p.vision || '';
  });

  $('#set-vsave').addEventListener('click', async () => {
    const cfg = {
      vProvider: $('#set-vprovider').value,
      vBase: $('#set-vbase').value.trim().replace(/\/+$/, ''),
      vModel: $('#set-vmodel').value.trim(),
      vKey: $('#set-vkey').value.trim()
    };
    for (const [k, v] of Object.entries(cfg)) await DB.setSetting(k, v);
    Object.assign(state.settings, cfg);
    renderSettings();
    toast(cfg.vModel ? '识图配置已保存' : '已保存，但识图模型是空的');
  });

  $('#set-vtest').addEventListener('click', async () => {
    const btn = $('#set-vtest');
    btn.disabled = true; btn.textContent = '测试中';

    // 用表单当前值临时算一遍配置，和真正保存后的解析规则完全一致
    const keep = state.settings;
    state.settings = {
      ...keep,
      provider: $('#set-provider').value,
      apiBase: $('#set-base').value.trim() || keep.apiBase,
      apiModel: $('#set-model').value.trim() || keep.apiModel,
      apiKey: $('#set-key').value.trim() || keep.apiKey,
      vProvider: $('#set-vprovider').value,
      vBase: $('#set-vbase').value.trim(),
      vModel: $('#set-vmodel').value.trim(),
      vKey: $('#set-vkey').value.trim()
    };
    let cfg;
    try { cfg = getVisionConfig(); } finally { state.settings = keep; }

    try {
      const reply = await AI.testVision(cfg);
      const el = $('#vision-status');
      el.textContent = '识图正常';
      el.className = 'hint ok';
      toast(`识图可用：${reply}`);
    } catch (e) {
      const el = $('#vision-status');
      el.textContent = '识图失败';
      el.className = 'hint bad';
      toast(AI.explainError(e), true);
      console.warn(e);
    } finally {
      btn.disabled = false; btn.textContent = '测试识图';
    }
  });

  function setStatus(text, cls) {
    const el = $('#ai-status');
    el.textContent = text;
    el.className = 'hint ' + cls;
  }

  $('#export-btn').addEventListener('click', exportData);
  $('#import-btn').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', e => {
    const f = e.target.files?.[0];
    if (f) importData(f);
    e.target.value = '';
  });
  $('#od-share-btn').addEventListener('click', shareBackup);

  // OneDrive 云备份
  $('#od-connect').addEventListener('click', async () => {
    const id = $('#od-client').value.trim();
    if (!id) { toast('先粘贴 Azure 的应用程序(客户端) ID'); return; }
    await OD.setClientId(id);
    await OD.loadSettings();
    try {
      await OD.connect(); // 整页跳去微软登录，回来后走 boot 的回调
    } catch (e) {
      toast(e.message, true);
    }
  });
  $('#od-backup').addEventListener('click', async () => {
    const btn = $('#od-backup');
    btn.disabled = true;
    btn.textContent = '备份中…';
    try {
      const r = await OD.uploadBackup(JSON.stringify(buildBackupPayload()));
      renderSettings();
      toast(`已备份 ${r.name}`);
    } catch (e) {
      toast(e.message, true);
      renderSettings();
    } finally {
      btn.disabled = false;
      btn.textContent = '立即备份';
    }
  });
  $('#od-restore').addEventListener('click', async () => {
    try {
      const text = await OD.downloadBackup();
      if (text == null) { toast('云端还没有备份，先点「立即备份」', true); return; }
      await applyImportPayload(JSON.parse(text));
    } catch (e) {
      if (e && e.cancelled) return;
      toast(e.message || '恢复失败', true);
    }
  });
  $('#od-disconnect').addEventListener('click', async () => {
    if (!confirm(I18N.translate('解除连接？只清掉本机的登录凭证和云端备份的访问授权，云端备份文件本身保留。'))) return;
    await OD.disconnect();
    renderSettings();
    toast('已解除连接');
  });
  $('#od-auto').addEventListener('change', async e => {
    await OD.setAuto(e.target.checked);
    toast(e.target.checked ? '已开启每日自动备份' : '已关闭自动备份');
  });

  // 百度网盘备份（仅 App 可用）
  $('#bd-open-auth').addEventListener('click', async () => {
    try {
      await saveBdConfig();
      await BD.connect(); // 跳百度授权页；回调地址配成本站时自动带回授权码
    } catch (e) {
      toast(e.message, true);
    }
  });
  $('#bd-use-code').addEventListener('click', async () => {
    const row = $('#bd-code-row');
    if (row.hidden) {
      row.hidden = false;
      $('#bd-code').focus();
      toast('在百度授权页登录后，把带回来的 code 粘贴进来');
      return;
    }
    const code = $('#bd-code').value.trim();
    if (!code) { toast('先粘贴授权码'); return; }
    try {
      await saveBdConfig();
      await BD.exchangeCode(code);
      renderSettings();
      toast(`已连接百度网盘${BD.accountName() ? '：' + BD.accountName() : ''}`);
    } catch (e) {
      toast(e.message, true);
    }
  });
  $('#bd-code').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('#bd-use-code').click();
  });
  $('#bd-backup').addEventListener('click', async () => {
    const btn = $('#bd-backup');
    btn.disabled = true;
    btn.textContent = '备份中…';
    try {
      const r = await BD.uploadBackup(JSON.stringify(buildBackupPayload()));
      renderSettings();
      toast(`已备份到 ${r.path}`);
    } catch (e) {
      toast(e.message, true);
      renderSettings();
    } finally {
      btn.disabled = false;
      btn.textContent = '立即备份';
    }
  });
  $('#bd-restore').addEventListener('click', async () => {
    try {
      const text = await BD.downloadBackup();
      if (text == null) { toast('云端还没有备份，先点「立即备份」', true); return; }
      await applyImportPayload(JSON.parse(text));
    } catch (e) {
      if (e && e.cancelled) return;
      toast(e.message || '恢复失败', true);
    }
  });
  $('#bd-disconnect').addEventListener('click', async () => {
    if (!confirm(I18N.translate('解除连接？只清掉本机保存的登录凭证，网盘里的备份文件保留。'))) return;
    await BD.disconnect();
    renderSettings();
    toast('已解除连接');
  });
  $('#bd-auto').addEventListener('change', async e => {
    await BD.setAuto(e.target.checked);
    toast(e.target.checked ? '已开启每日自动备份' : '已关闭自动备份');
  });

  document.addEventListener('click', async e => {
    const dr = e.target.closest('[data-delrule]');
    if (dr) {
      state.rules = await DB.delRule(dr.dataset.delrule);
      renderSettings();
      toast('已忘掉这条习惯');
      return;
    }
    const del = e.target.closest('[data-delcat]');
    if (del) {
      const name = del.textContent.trim();
      if (!confirm(I18N.translate(`删除分类「${name}」？已记录的流水不受影响。`))) return;
      await DB.delCat(del.dataset.delcat);
      await loadAll();
      renderSettings();
      toast('已删除');
      return;
    }
    const add = e.target.closest('[data-addcat]');
    if (add) {
      const type = add.dataset.addcat;
      const inp = $(`#new-cat-${type}`);
      const name = inp.value.trim();
      if (!name) { toast('输入分类名'); return; }
      const list = type === 'income' ? state.cats.income : state.cats.expense;
      if (list.some(c => c.name === name)) { toast('这个分类已经有了'); return; }
      await DB.putCat({ id: `${type}:${name}:${DB.uid().slice(0, 4)}`, name, type, order: list.length });
      inp.value = '';
      await loadAll();
      renderSettings();
      toast('已添加');
    }
  });
}

async function saveBdConfig() {
  await BD.setConfig($('#bd-appkey').value, $('#bd-secret').value, $('#bd-appname').value);
  await BD.loadSettings();
}

/* ---------------- boot ---------------- */

/* 币种下拉：弹层里只放符号（省地方），设置页放「US$ 美元」全称 */
function fillCurSelects(force) {
  const shortOpts = CURRENCIES.map(c => `<option value="${c.code}">${c.sym}</option>`).join('');
  const fullOpts = CURRENCIES.map(c =>
    `<option value="${c.code}">${c.sym} ${I18N.isEN() ? I18N.translate(c.name) : c.name}</option>`).join('');
  const f = $('#f-cur');
  if (f && (force || !f.options.length)) {
    const keep = f.value;
    f.innerHTML = shortOpts;
    if (keep) f.value = keep;
  }
  const s = $('#set-cur');
  if (s && (force || !s.options.length)) {
    const keep = s.value;
    s.innerHTML = fullOpts;
    if (keep) s.value = keep;
  }
}

async function boot() {
  await loadAll();
  /* 语言三级优先：用户在设置里的选择 → localStorage 副本 → 系统语言。
     放在任何 render 之前，首屏就是最终语言。 */
  I18N.initLang(state.settings.lang || I18N.cachedLangPref());
  document.title = I18N.isEN() ? 'Pocket Ledger' : '小账本';
  I18N.refresh();
  applyTheme(state.settings.theme || 'classic');
  // 网页版没有原生桥，只有 APK 里才会真的换桌面图标。
  // 桥注入偶尔慢半拍，补一次（原生侧状态没变会直接返回，不会闪）。
  setTimeout(() => syncAppIcon(state.settings.theme || 'classic'), 1500);
  fillCurSelects();
  bindEvents();
  setupVoice();
  renderHome();

  // OneDrive 授权回调：URL 带着 ?code= 回来，换完 token 把 URL 清干净
  await OD.loadSettings();
  const cb = await OD.handleRedirect();
  if (cb) {
    toast(cb.ok ? `已连接 OneDrive${OD.accountName() ? '：' + OD.accountName() : ''}` : `OneDrive 连接失败：${cb.msg}`, !cb.ok);
    renderSettings();
  }
  // 百度授权回调（回调地址配成本站时走自动路）
  await BD.loadSettings();
  const bdCb = await BD.handleRedirect();
  if (bdCb) {
    toast(bdCb.ok ? `已连接百度网盘${BD.accountName() ? '：' + BD.accountName() : ''}` : `百度连接失败：${bdCb.msg}`, !bdCb.ok);
    renderSettings();
  }
  // 每天一次的静默自动备份（OneDrive 和百度各自独立判断，互不影响）
  try {
    if (await OD.maybeAutoBackup(() => JSON.stringify(buildBackupPayload()))) {
      toast('已自动备份到 OneDrive');
    }
  } catch (e) { /* 静默失败，不打扰 */ }
  try {
    if (await BD.maybeAutoBackup(() => JSON.stringify(buildBackupPayload()))) {
      toast('已自动备份到百度网盘');
    }
  } catch (e) { /* 静默失败，不打扰 */ }

  if ('serviceWorker' in navigator && !window.Capacitor) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot().catch(e => {
  console.error(e);
  document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif">启动失败：' + esc(e.message) + '</div>';
});
