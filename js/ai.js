export const PROVIDERS = {
  // DeepSeek 的 deepseek-flash 已原生支持图片输入（vision），识图无需另配
  deepseek:    { label: 'DeepSeek',   base: 'https://api.deepseek.com/v1',                       model: 'deepseek-flash',           vision: 'deepseek-flash' },
  // Gemini 的 OpenAI 兼容层，同一个 Key 同时支持文字与识图，但需要能访问 Google
  gemini:      { label: 'Gemini',     base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.8-flash',  vision: 'gemini-3.8-flash' },
  openrouter:  { label: 'OpenRouter', base: 'https://openrouter.ai/api/v1',                      model: 'deepseek/deepseek-chat',   vision: 'openai/gpt-4o-mini' },
  siliconflow: { label: '硅基流动',    base: 'https://api.siliconflow.cn/v1',                     model: 'Qwen/Qwen2.5-7B-Instruct', vision: 'Qwen/Qwen2.5-VL-72B-Instruct' },
  dashscope:   { label: '通义千问',    base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',  model: 'qwen-plus',                vision: 'qwen-vl-max' },
  custom:      { label: '自定义',      base: '',                                                 model: '',                         vision: '' }
};

export const ACCOUNTS = ['微信', '支付宝', '银行卡', '现金'];

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function todayStr(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* 把用户过往的纠正习惯塞进提示词，模型会照着学 */
function rulesHint(rules) {
  if (!rules) return '';
  const rows = Object.entries(rules).slice(0, 40);
  if (!rows.length) return '';
  return rows.map(([k, v]) => `「${k}」→ ${v}`).join('；');
}

function commonTail(ctx) {
  const now = new Date();
  const hint = rulesHint(ctx.rules);
  const arr = [
    '',
    `今天日期：${todayStr(now)}（${WEEK[now.getDay()]}）`,
    `可用支出分类：${ctx.expenseCats.join('、')}`,
    `可用收入分类：${ctx.incomeCats.join('、')}`,
    `可用账户：${ACCOUNTS.join('、')}`,
    `默认币种：${ctx.defaultCur || 'CNY'}（图里没有任何币种线索时才用它）`
  ];
  if (hint) arr.push(`用户的历史归类习惯（优先遵循）：${hint}`);
  return arr.join('\n');
}

const CURRENCY_RULES = [
  '10. 每笔都必须带 currency 字段，值只能是：CNY、USD、EUR、JPY、HKD、GBP、KRW、SGD、AUD、CAD。',
  '    认符号：$ 或 US$ 或 USD 或「美元/美金」→ USD；¥ 或 ￥ 或 RMB 或「人民币/元」→ CNY；€ 或 EUR → EUR；£ 或 GBP → GBP；',
  '    JP¥ 或「日元/円」→ JPY；HK$ 或「港币/港元」→ HKD；S$ 或 SG$ → SGD；A$ → AUD；C$ → CAD；₩ 或「韩元」→ KRW。',
  '    注意 $ 和 ¥ 都有歧义：前面带 HK/US/S/A/C 前缀时按前缀算；单独的 $ 当 USD，单独的 ¥ 当 CNY。',
  '    金额只写数字，不要带符号、不要换算成人民币。'
];

function buildTextSystem(ctx) {
  const now = todayStr();
  return [
    '你是一个记账解析器。把用户的一句话转换成结构化收支流水，只输出 JSON。',
    commonTail(ctx),
    '',
    '输出格式：',
    `{"items":[{"type":"expense","amount":15,"currency":"USD","category":"餐饮","account":"微信","date":"${now}","note":"早餐"}]}`,
    '',
    '规则：',
    '1. 一句话可能包含多笔收支，必须全部拆开，逐条输出。',
    '2. amount 是纯数字（可含小数），不要带货币符号、不要做汇率换算。中文数字要转成阿拉伯数字：十五=15，三百五=350，两块五=2.5，「AA 每人 68」=68。',
    '3. type 只能是 expense（支出）、income（收入）、transfer（转账）三者之一。',
    '4. category 必须严格从上面给出的对应清单中选择。确实无法归类时用「其他」。',
    '5. account 从账户清单中选。用户没提就默认「微信」。转账时额外给出 toAccount。',
    '6. date 用 YYYY-MM-DD。「昨天」「前天」「上周三」都要换算成具体日期。',
    '7. note 是简短补充，不超过 12 个字，没有就填空字符串。',
    '8. 如果完全看不出金额，返回 {"items":[]}。',
    '9. 用户说了「花了 20 美元」「$12」「12 欧」这种，就要把 currency 填对，不要一律当人民币。',
    ...CURRENCY_RULES,
    '11. 只输出 JSON 本身，不要 markdown 代码块，不要任何解释。'
  ].join('\n');
}

function buildImageSystem(ctx) {
  const now = todayStr();
  return [
    '你是一个专业的账单识别器。用户上传的图片可能是：支付宝/微信的账单列表截图、支付成功页截图、购物小票、外卖订单、发票、收据、银行扣款短信截图、海外商户的小票。',
    '请把图片里所有真实交易提取成结构化流水，只输出 JSON。',
    commonTail(ctx),
    '',
    '输出格式：',
    `{"source":"alipay","items":[{"type":"expense","amount":32.5,"currency":"USD","category":"餐饮","account":"支付宝","date":"${now}","note":"望京小腰烧烤"}]}`,
    '',
    '识别规则：',
    '1. 一张图可能有多笔交易（尤其是账单列表截图），必须逐条全部提取，不要只取第一笔。',
    '2. amount 取「实际支付/实付/付款金额」，不要取原价、优惠前金额、余额、累计金额；金额只写数字，不要换算。',
    '3. 忽略：账户余额、优惠券、红包抵扣、积分、广告、活动文案、退款说明、页码、时间轴标题。',
    '4. note 填商户名或商品名，尽量具体（如「星巴克」「美团外卖」），不超过 12 个字。',
    '5. category 必须严格从分类清单里选。先判断这笔钱是干什么的，而不是商户名字面：便利店买饭→餐饮，便利店买纸巾→购物。',
    '6. account：支付宝截图→支付宝，微信截图→微信，银行卡短信→银行卡，小票现金→现金；判断不出就默认「微信」。',
    '7. date 取图片上显示的交易日；只显示「今天/昨天」就换算；实在没有就用今天。',
    '8. 收入（收款/退款到账/工资）判为 income，支出判为 expense，账户互转判为 transfer 并给出 toAccount。',
    '9. 如果图片根本不是账单（比如风景照、聊天记录），返回 {"source":"none","items":[]}。',
    ...CURRENCY_RULES,
    '11. 只输出 JSON 本身，不要 markdown 代码块，不要解释。'
  ].join('\n');
}

function extractJSON(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(s); } catch (e) { /* fall through */ }
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { /* fall through */ }
  }
  const a2 = s.indexOf('[');
  const b2 = s.lastIndexOf(']');
  if (a2 >= 0 && b2 > a2) {
    try { return { items: JSON.parse(s.slice(a2, b2 + 1)) }; } catch (e) { /* fall through */ }
  }
  return null;
}

const CUR_SET = ['CNY', 'USD', 'EUR', 'JPY', 'HKD', 'GBP', 'KRW', 'SGD', 'AUD', 'CAD'];
/* 模型可能把币种写成符号、中文或「USD 美元」这种混合形式，统一归一化 */
const CUR_ALIAS = {
  '¥': 'CNY', '￥': 'CNY', 'RMB': 'CNY', '人民币': 'CNY', '元': 'CNY', 'RMB¥': 'CNY',
  '$': 'USD', 'US$': 'USD', '美元': 'USD', '美金': 'USD', '刀': 'USD',
  'EUR': 'EUR', '€': 'EUR', '欧元': 'EUR',
  'JPY': 'JPY', 'JP¥': 'JPY', '円': 'JPY', '日元': 'JPY',
  'HKD': 'HKD', 'HK$': 'HKD', '港币': 'HKD', '港元': 'HKD',
  'GBP': 'GBP', '£': 'GBP', '英镑': 'GBP',
  'KRW': 'KRW', '₩': 'KRW', '韩元': 'KRW',
  'SGD': 'SGD', 'S$': 'SGD', 'SG$': 'SGD', '新加坡元': 'SGD', '新币': 'SGD',
  'AUD': 'AUD', 'A$': 'AUD', '澳元': 'AUD',
  'CAD': 'CAD', 'C$': 'CAD', '加元': 'CAD'
};

function normalizeCur(v, def) {
  const fallback = CUR_SET.includes(def) ? def : 'CNY';
  const s = String(v == null ? '' : v).trim();
  if (!s) return fallback;
  const up = s.toUpperCase();
  if (CUR_SET.includes(up)) return up;
  if (CUR_ALIAS[s]) return CUR_ALIAS[s];
  if (CUR_ALIAS[up]) return CUR_ALIAS[up];
  // 「USD 美元」「约 12 美元」这类混着写的
  for (const code of CUR_SET) if (up.includes(code)) return code;
  for (const [k, code] of Object.entries(CUR_ALIAS)) if (s.includes(k)) return code;
  return fallback;
}

function normalizeItem(item, ctx, fallbackAcct) {
  if (!item || typeof item !== 'object') return null;
  const rawAmt = typeof item.amount === 'string' ? item.amount.replace(/[^\d.\-]/g, '') : item.amount;
  const cents = Math.round(parseFloat(rawAmt) * 100);
  if (!isFinite(cents) || cents <= 0) return null;

  let type = String(item.type || 'expense').toLowerCase();
  if (!['expense', 'income', 'transfer'].includes(type)) type = 'expense';

  let cat = String(item.category || '').trim();
  if (type === 'transfer') {
    cat = '转账';
  } else {
    const pool = type === 'income' ? ctx.incomeCats : ctx.expenseCats;
    if (!pool.includes(cat)) {
      const hit = pool.find(c => c === cat) ||
                  pool.find(c => cat && (c.includes(cat) || cat.includes(c))) ||
                  null;
      cat = hit || '其他';
    }
  }

  const pickAcct = v => {
    const s = String(v || '').trim();
    if (ACCOUNTS.includes(s)) return s;
    const hit = ACCOUNTS.find(a => s && (a.includes(s) || s.includes(a)));
    return hit || fallbackAcct || '微信';
  };

  const acct = pickAcct(item.account);
  const out = {
    type,
    cents,
    cur: normalizeCur(item.currency || item.cur, ctx.defaultCur),
    cat,
    acct,
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(item.date)) ? String(item.date) : todayStr(),
    note: String(item.note || '').slice(0, 50)
  };
  if (type === 'transfer') {
    const to = pickAcct(item.toAccount);
    out.toAcct = to === acct ? '银行卡' : to;
  }
  return applyRule(out, ctx);
}

/* 本地兜底：哪怕模型没听指令，也按用户习惯纠正一次 */
function applyRule(item, ctx) {
  const rules = ctx.rules || {};
  if (!item.note || item.type !== 'expense') return item;
  const note = item.note;
  for (const [kw, cat] of Object.entries(rules)) {
    if (kw && note.includes(kw)) {
      if (ctx.expenseCats.includes(cat)) item.cat = cat;
      break;
    }
  }
  return item;
}

/* 思考型模型（Gemini 3.x / GPT-5 等）会把思考 token 算进输出预算，
   预算给小了就会返回空内容，所以这里单独给它们更大的额度 */
const THINKING_MODEL = /gemini|gpt-5|gpt-6|\bo[34]\b|qwq|reason|thinking/i;

async function callOnce(cfg, messages, jsonMode, signal, maxTokens) {
  const url = `${String(cfg.base).replace(/\/+$/, '')}/chat/completions`;
  const body = {
    model: cfg.model,
    messages,
    temperature: 0.1,
    max_tokens: maxTokens
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.key}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    err.body = text.slice(0, 300);
    throw err;
  }
  const data = await res.json();
  const choice = data?.choices?.[0];
  let content = choice?.message?.content;

  // 少数兼容层会返回 [{type:'text',text:'...'}] 这样的分段结构
  if (Array.isArray(content)) {
    content = content.map(p => (typeof p === 'string' ? p : p?.text || '')).join('');
  }
  if (!content) {
    const err = new Error('模型返回为空');
    err.empty = true;
    err.finish = choice?.finish_reason;
    throw err;
  }
  return typeof content === 'string' ? content : JSON.stringify(content);
}

async function callAPI(cfg, messages, jsonMode, signal) {
  const model = String(cfg.model || '');
  const first = THINKING_MODEL.test(model) ? 4096 : 1600;
  try {
    return await callOnce(cfg, messages, jsonMode, signal, first);
  } catch (e) {
    if (e.empty && first < 16000) {
      return callOnce(cfg, messages, jsonMode, signal, first * 3);
    }
    throw e;
  }
}

/* ---------------- 文字解析 ---------------- */

export async function parseExpenses(text, ctx) {
  const cfg = { base: ctx.base, key: ctx.key, model: ctx.model };
  if (!cfg.base || !cfg.key || !cfg.model) {
    throw new Error('还没配置 AI 服务，请到「设置」里填写接口地址、模型和 API Key');
  }

  const messages = [
    { role: 'system', content: buildTextSystem(ctx) },
    { role: 'user', content: text }
  ];

  let content;
  try {
    content = await callAPI(cfg, messages, true);
  } catch (e) {
    if (e.status === 400 || e.status === 422) {
      content = await callAPI(cfg, messages, false);
    } else {
      throw e;
    }
  }

  const parsed = extractJSON(content);
  if (!parsed) {
    const err = new Error('AI 返回的不是合法 JSON，换个说法再试，或手动记录');
    err.raw = content;
    throw err;
  }

  const list = Array.isArray(parsed) ? parsed : (parsed.items || []);
  if (!Array.isArray(list) || !list.length) return [];
  return list.map(i => normalizeItem(i, ctx)).filter(Boolean);
}

/* ---------------- 图片解析 ---------------- */

export async function parseImage(dataUrl, ctx, opts = {}) {
  const cfg = { base: opts.base, key: opts.key, model: opts.model };
  if (!cfg.base || !cfg.key || !cfg.model) {
    const err = new Error('还没配置识图模型，请到「设置 → 图片记账」里填写');
    err.needVision = true;
    throw err;
  }

  const messages = [
    { role: 'system', content: buildImageSystem(ctx) },
    {
      role: 'user',
      content: [
        { type: 'text', text: '识别这张图片里的全部账单，按约定格式输出 JSON。' },
        { type: 'image_url', image_url: { url: dataUrl } }
      ]
    }
  ];

  const content = await callAPI(cfg, messages, false);
  const parsed = extractJSON(content);
  if (!parsed) {
    const err = new Error('图片没解析出结构化数据，换一张更清晰的截图试试');
    err.raw = content;
    throw err;
  }

  const list = Array.isArray(parsed) ? parsed : (parsed.items || []);
  if (!Array.isArray(list) || !list.length) return [];
  return list.map(i => normalizeItem(i, ctx)).filter(Boolean);
}

/* 压缩到可控尺寸。注意：DeepSeek / 通义这类视觉模型对单张图片有 token 上限
   （DeepSeek 封顶约 1024 tokens），再大的图也不会更贵，所以这里放宽到 2400px，
   长截图里的小字才保得住。 */
export function compressImage(file, maxSide = 2400, quality = 0.86) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) {
      reject(new Error('不是图片文件'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const cx = cv.getContext('2d');
      cx.fillStyle = '#fff';
      cx.fillRect(0, 0, w, h);
      cx.drawImage(img, 0, 0, w, h);
      resolve({ dataUrl: cv.toDataURL('image/jpeg', quality), w, h });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
    img.src = url;
  });
}

/* ---------------- 自然语言查账 ---------------- */

const QUERY_HINT = /多少|几笔|几次|几天|总共|一共|合计|统计|查一下|查查|看看|排行|占比|平均|最贵|最多|最高|哪笔|哪几|花在|花了/;

/* 带货币单位/符号的句子一律当记账，别被「花了」误判成查账 */
const AMOUNT_HINT = /[0-9０-９]\s*(?:元|块|块钱|rmb|RMB|美元|美金|刀|dollars?|USD|欧元|EUR|英镑|GBP|日元|円|JPY|港币|港元|HKD|新币|新加坡元|SGD|澳元|AUD|加元|CAD|韩元|KRW|￥|¥|\$|€|£|₩)/i;

export function looksLikeQuery(text) {
  const s = String(text || '');
  if (!QUERY_HINT.test(s)) return false;
  // 「早餐15块」「12.5 美元」这类明确金额的表达，仍然当记账
  if (AMOUNT_HINT.test(s)) return false;
  return true;
}

const RANGE_WORDS = [
  { key: 'today',      re: /今天|今日/ },
  { key: 'yesterday',  re: /昨天|昨日/ },
  { key: 'this_week',  re: /这周|本周|这一周/ },
  { key: 'last_week',  re: /上周|上个星期/ },
  { key: 'last_month', re: /上个月|上月/ },
  { key: 'this_year',  re: /今年|本年度/ },
  { key: 'all',        re: /全部|所有|总共以来|历史/ }
];

export function detectQuery(text, ctx) {
  const s = String(text || '');
  let range = 'this_month';
  for (const r of RANGE_WORDS) { if (r.re.test(s)) { range = r.key; break; } }

  const m = s.match(/(\d{1,2})\s*月/);
  let month = null;
  if (m && range === 'this_month') {
    const mm = Number(m[1]);
    if (mm >= 1 && mm <= 12) {
      const y = new Date().getFullYear();
      month = `${y}-${String(mm).padStart(2, '0')}`;
    }
  }

  const cats = [...(ctx.expenseCats || []), ...(ctx.incomeCats || [])];
  const cat = cats.find(c => c && c !== '其他' && s.includes(c)) || null;
  const acct = ACCOUNTS.find(a => s.includes(a)) || null;
  const metric = /几笔|几次|多少笔/.test(s) ? 'count'
    : /最贵|最多|最高/.test(s) ? 'top'
    : /平均/.test(s) ? 'avg'
    : 'sum';

  return { range, month, cat, acct, metric, raw: s };
}

/* ---------------- 月度洞察 ---------------- */

export async function monthlyInsight(cfg, payload) {
  if (!cfg.base || !cfg.key || !cfg.model) throw new Error('还没配置 AI 服务');
  const messages = [
    {
      role: 'system',
      content: [
        '你是一个温和、克制的个人财务顾问。根据用户这个月的记账数据，给出 3 到 4 条简短洞察。',
        '要求：',
        '1. 每条一句话，不超过 40 个字，必须引用具体数字。',
        '2. 只讲数据里能看到的事实和可能的因果关系，不要编造数据里没有的信息。',
        '3. 指出值得注意的变化（同比、环比、异常大额、频次过高），但不要说教、不要喊口号、不要用感叹号。',
        '4. 如果数据太少无法判断，就诚实说明「这个月记录还少，看不出趋势」。',
        '5. 直接输出 JSON：{"lines":["...","..."]}，不要 markdown，不要解释。'
      ].join('\n')
    },
    { role: 'user', content: JSON.stringify(payload) }
  ];
  const content = await callAPI(cfg, messages, true).catch(async e => {
    if (e.status === 400 || e.status === 422) return callAPI(cfg, messages, false);
    throw e;
  });
  const parsed = extractJSON(content);
  const lines = parsed?.lines;
  if (!Array.isArray(lines) || !lines.length) throw new Error('洞察生成失败，稍后再试');
  return lines.map(l => String(l).slice(0, 90)).slice(0, 5);
}

/* ---------------- 连接测试 ---------------- */

export async function testConnection(cfg) {
  if (!cfg.base || !cfg.key || !cfg.model) throw new Error('接口地址、模型、Key 都要填');
  const messages = [
    { role: 'system', content: '你是一个测试助手。' },
    { role: 'user', content: '只回复两个字：正常' }
  ];
  const content = await callAPI(cfg, messages, false);
  return content.trim().slice(0, 40);
}

/* 画一张真实尺寸的测试图。1×1 像素的图有些视觉模型会判为无效，
   这里用 320×160 的纯色图 + 文字，既能验证接口通，也能验证模型真的"看见"了 */
function probeImage() {
  try {
    const cv = document.createElement('canvas');
    cv.width = 320; cv.height = 160;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#0F6E56';
    cx.fillRect(0, 0, 320, 160);
    cx.fillStyle = '#FFFFFF';
    cx.font = 'bold 64px sans-serif';
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';
    cx.fillText('测试', 160, 80);
    return cv.toDataURL('image/jpeg', 0.9);
  } catch (e) {
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  }
}

export async function testVision(cfg) {
  if (!cfg.base || !cfg.key || !cfg.model) {
    throw new Error('识图模型的地址、模型、Key 都要填。用 DeepSeek 的话模型填 deepseek-flash');
  }
  const messages = [
    { role: 'user', content: [
      { type: 'text', text: '这张图的主色调是什么？只回答一个颜色词。' },
      { type: 'image_url', image_url: { url: probeImage() } }
    ] }
  ];
  const content = await callAPI(cfg, messages, false);
  return content.trim().slice(0, 40);
}

export function explainError(e) {
  if (!e) return '未知错误';
  if (e.name === 'AbortError') return '请求超时，检查网络';
  const msg = String(e.message || '');
  const body = String(e.body || '');
  const all = msg + ' ' + body;

  // 地区限制最常见，放在最前面，否则会被笼统的 400/403 掩盖
  if (/location is not supported|not available in your (country|region)|unsupported region/i.test(all)) {
    return 'Gemini 提示所在地区不支持。它不接受中国大陆的直连，需要自备代理，或在「接口地址」里换成你自己的中转地址';
  }
  if (/API key not valid|API_KEY_INVALID|invalid api key/i.test(all)) {
    return 'API Key 无效。Gemini 的 Key 从 aistudio.google.com 拿，形如 AIza...';
  }
  if (/model.*(not found|is not supported|does not exist)|no such model/i.test(all)) {
    return '模型名不对。Gemini 现在用 gemini-3.8-flash（gemini-3.7-flash 已于 2026-10-08 下线）';
  }
  if (e.empty) {
    return `模型返回空内容（finish_reason: ${e.finish || '未知'}）。思考型模型可能把预算耗在思考上，再点一次通常就好了`;
  }
  if (/does not support image/i.test(all)) {
    return '这个模型不接受图片。DeepSeek 请用 deepseek-flash；Gemini 请用 gemini-3.8-flash；通义请用 qwen-vl-max';
  }
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('Load failed')) {
    return '连接失败：网络不通或该服务商不允许浏览器直连。Gemini 在境内无法直连，需要代理';
  }
  if (e.status === 400) return '请求被拒绝：可能是模型不支持图片，或图片格式/大小不合规。DeepSeek 请确认模型名是 deepseek-flash';
  if (e.status === 401) return 'API Key 无效或已过期';
  if (e.status === 402) return '账户余额不足';
  if (e.status === 403) return '没有访问权限。Gemini 在境内还可能返回 403（地区限制），需要代理';
  if (e.status === 404) {
    return '接口地址或模型名不对。DeepSeek 现在是 deepseek-flash；Gemini 是 gemini-3.8-flash';
  }
  if (e.status === 413) return '图片太大，压缩后再试';
  if (e.status === 422) return '参数不被接受，检查模型名是否拼错';
  if (e.status === 429) return '请求太频繁或额度用尽，稍后再试';
  if (e.status >= 500) return '服务端错误，稍后重试';
  return msg || '解析失败';
}
