/* 验证 Gemini 接入：模型名、思考预算、空响应重试、地区限制报错 */
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://localhost:5180/';
const OUT = 'C:/Users/MO/WorkBuddy/2026-10-30-22-26-29/shots/';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (n, c, x = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}${x ? ' — ' + x : ''}`); }
  else { fail++; console.log(`  ❌ ${n}${x ? ' — ' + x : ''}`); }
};

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const M0 = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;

const MOCK_TEXT = JSON.stringify({
  items: [{ type: 'expense', amount: 15, category: '餐饮', account: '微信', date: `${M0}-31`, note: '早餐' }]
});
const MOCK_IMG = JSON.stringify({
  source: 'alipay',
  items: [
    { type: 'expense', amount: 38.5, category: '餐饮', account: '支付宝', date: `${M0}-30`, note: '美团外卖' },
    { type: 'expense', amount: 268, category: '购物', account: '支付宝', date: `${M0}-30`, note: '优衣库' }
  ]
});

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

let mode = 'normal';      // normal | emptyOnce | region
let tmpFailures = 0;
const calls = [];

await page.setRequestInterception(true);
page.on('request', async req => {
  if (req.method() === 'OPTIONS') {
    req.respond({
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization,content-type'
      }
    });
    return;
  }
  const url = req.url();
  if (!url.includes('/chat/completions')) { req.continue(); return; }

  let body = '';
  try { body = req.postData() || ''; } catch (e) { body = ''; }
  let p = {};
  try { p = JSON.parse(body); } catch (e) { p = {}; }
  calls.push({
    url,
    model: p.model,
    maxTokens: p.max_tokens,
    json: p.response_format?.type,
    hasImage: body.includes('image_url'),
    auth: (req.headers()['authorization'] || '').slice(0, 20)
  });

  const reply = (status, obj) => req.respond({
    status,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(obj)
  });

  if (mode === 'region') {
    return reply(400, {
      error: {
        code: 400,
        message: 'User location is not supported for the API use.',
        status: 'FAILED_PRECONDITION'
      }
    });
  }

  if (mode === 'emptyOnce' && tmpFailures === 0) {
    tmpFailures++;
    return reply(200, {
      choices: [{ index: 0, finish_reason: 'length', message: { role: 'assistant', content: '' } }]
    });
  }

  reply(200, {
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: body.includes('image_url') ? MOCK_IMG : MOCK_TEXT } }]
  });
});


/* 每次交互前把面板和预览都收掉，否则遮罩会挡住 AI 输入栏 */
async function resetUI() {
  await page.evaluate(() => {
    const close = document.querySelector('#sheet-close');
    if (close && !document.querySelector('#sheet-mask').hidden) close.click();
    const pv = document.querySelector('#pv-cancel');
    if (pv) pv.click();
    const pvHead = document.querySelector('#ai-preview');
    if (pvHead) pvHead.hidden = true;
    document.querySelector('#ai-input').value = '';
    const t = document.querySelector('#toast');
    if (t) t.hidden = true;
  });
  await sleep(350);
}

await page.goto(URL, { waitUntil: 'networkidle0' });
await sleep(600);

/* 种 Gemini 配置 */
await page.evaluate(async settings => {
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('pocket_ledger');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const db = await open();
  await new Promise((res, rej) => {
    const tx = db.transaction('settings', 'readwrite');
    const st = tx.objectStore('settings');
    Object.entries(settings).forEach(([k, v]) => st.put({ k, v }));
    tx.oncomplete = res; tx.onerror = rej;
  });
}, {
  provider: 'gemini',
  apiBase: 'https://generativelanguage.googleapis.com/v1beta/openai',
  apiModel: 'gemini-3.8-flash',
  apiKey: 'AIzaSyTEST-KEY-0000',
  vProvider: 'follow',
  vBase: '',
  vModel: '',
  vKey: ''
});

await page.reload({ waitUntil: 'networkidle0' });
await sleep(800);
await page.evaluate(() => document.querySelector('[data-tab="settings"]').click());
await sleep(400);

console.log('\n=== 1. 设置页回显 ===');
const form = await page.evaluate(() => ({
  provider: document.querySelector('#set-provider').value,
  base: document.querySelector('#set-base').value,
  model: document.querySelector('#set-model').value,
  vstatus: document.querySelector('#vision-status').textContent
}));
ok('服务商选中 gemini', form.provider === 'gemini', form.provider);
ok('地址为 OpenAI 兼容层', form.base === 'https://generativelanguage.googleapis.com/v1beta/openai', form.base);
ok('模型为 gemini-3.8-flash', form.model === 'gemini-3.8-flash', form.model);
ok('识图免配置即「已配置」', form.vstatus === '已配置', form.vstatus);
await page.screenshot({ path: OUT + 'v4-01-gemini-settings.png' });

console.log('\n=== 2. 文字记账 ===');
await resetUI();
calls.length = 0;
await page.evaluate(() => document.querySelector('[data-tab="home"]').click());
await sleep(300);
await page.type('#ai-input', '早餐15');
await page.click('#ai-go');
await sleep(1500);
const t = calls[0];
ok('请求打到 Gemini 兼容层', /generativelanguage\.googleapis\.com\/v1beta\/openai\/chat\/completions$/.test(t?.url || ''), t?.url);
ok('Bearer 带上 Key', /^Bearer AIzaSy/.test(t?.auth || ''), t?.auth + '…');
ok('思考模型预算给到 4096', t?.maxTokens === 4096, String(t?.maxTokens));
ok('开启 JSON 模式', t?.json === 'json_object', String(t?.json));
ok('未误带图片', !t?.hasImage);

console.log('\n=== 3. 空响应自动重试 ===');
await resetUI();
mode = 'emptyOnce';
tmpFailures = 0;
calls.length = 0;
await page.type('#ai-input', '地铁6块');
await page.click('#ai-go');
await sleep(2500);
ok('第一次返回空后发起了重试', calls.length === 2, `共 ${calls.length} 次`);
ok('重试把预算放大 3 倍', calls[1]?.maxTokens === 12288, String(calls[1]?.maxTokens));
const afterRetry = await page.evaluate(() => {
  const box = document.querySelector('#ai-preview');
  const pv = box && !box.hidden ? box.querySelectorAll('.pv-row').length : null;
  const sheet = !document.querySelector('#sheet-mask').hidden;
  const amt = document.querySelector('#f-amount')?.value;
  return { pv, sheet, amt };
});
ok('重试后成功拿到结果', afterRetry.sheet === true || afterRetry.pv > 0, JSON.stringify(afterRetry));
mode = 'normal';

console.log('\n=== 4. 图片记账 ===');
await resetUI();
calls.length = 0;
const fi = await page.$('#photo-file');
await fi.uploadFile('C:/Users/MO/WorkBuddy/2026-10-30-22-26-29/pocket-ledger/icons/icon-192.png');
await sleep(1800);
const i = calls.find(c => c.hasImage);
ok('图片走同一个模型', i?.model === 'gemini-3.8-flash', String(i?.model));
ok('图片预算同样是 4096', i?.maxTokens === 4096, String(i?.maxTokens));
const imgPv = await page.evaluate(() => {
  const box = document.querySelector('#ai-preview');
  if (!box || box.hidden) return null;
  return {
    rows: box.querySelectorAll('.pv-row').length,
    amounts: [...box.querySelectorAll('.pv-amt')].map(e => e.textContent.trim())
  };
});
ok('识别出 2 笔', imgPv?.rows === 2, String(imgPv?.rows));
ok('金额正确', JSON.stringify(imgPv?.amounts) === JSON.stringify(['-¥38.50', '-¥268.00']), (imgPv?.amounts || []).join(' '));

console.log('\n=== 5. 地区限制的报错要说人话 ===');
await resetUI();
mode = 'region';
await page.type('#ai-input', '早餐15');
await page.click('#ai-go');
await sleep(1500);
const toastText = await page.evaluate(() => document.querySelector('#toast')?.textContent || '');
ok('提示里点明地区不支持', /地区不支持/.test(toastText), toastText);
ok('并给出解决办法（代理）', /代理|中转/.test(toastText), toastText);
await page.screenshot({ path: OUT + 'v4-02-gemini-region.png' });

console.log('\n=== 6. 无运行时报错 ===');
// 本用例故意让服务端返回 400，浏览器会记一条资源加载失败，这类噪音要滤掉
const realErrors = errors.filter(e => !/Failed to load resource/.test(e));
ok('零 JS 错误（滤掉故意的 400 网络噪音）', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
await browser.close();
process.exit(fail ? 1 : 0);
