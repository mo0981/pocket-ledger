/* 验证：DeepSeek 单一 Key 同时承担文字记账 + 图片识别 */
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

const MOCK_IMG = JSON.stringify({
  source: 'alipay',
  items: [
    { type: 'expense', amount: 38.5, category: '餐饮', account: '支付宝', date: `${M0}-29`, note: '美团外卖' },
    { type: 'expense', amount: 268, category: '购物', account: '支付宝', date: `${M0}-29`, note: '优衣库' }
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

/* 抓所有模型请求 */
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
  let parsed = {};
  try { parsed = JSON.parse(body); } catch (e) { parsed = {}; }
  const hasImage = body.includes('image_url');
  calls.push({ model: parsed.model, hasImage, body });

  const content = hasImage ? MOCK_IMG : JSON.stringify({
    items: [{ type: 'expense', amount: 15, category: '餐饮', account: '微信', date: `${M0}-30`, note: '早餐' }]
  });

  req.respond({
    status: 200,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] })
  });
});

await page.goto(URL, { waitUntil: 'networkidle0' });
await sleep(600);

/* 种一份「旧版」配置：模型名是已下线的 deepseek-chat，识图不单独配 */
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
  provider: 'deepseek',
  apiBase: 'https://api.deepseek.com/v1',
  apiModel: 'deepseek-chat',
  apiKey: 'sk-test-deepseek',
  vProvider: 'follow',
  vBase: '',
  vModel: '',
  vKey: ''
});

await page.reload({ waitUntil: 'networkidle0' });
await sleep(800);

console.log('\n=== 1. 旧模型名自动迁移 ===');
const migrated = await page.evaluate(async () => {
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('pocket_ledger');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const db = await open();
  const mem = await new Promise((res, rej) => {
    const tx = db.transaction('settings', 'readonly');
    const st = tx.objectStore('settings').get('apiModel');
    st.onsuccess = () => res(st.result?.v);
    st.onerror = () => rej(st.error);
  });
  return { mem };
});
ok('indexedDB 里的 deepseek-chat 已改写', migrated.mem === 'deepseek-flash', String(migrated.mem));

console.log('\n=== 2. 识图无需单独配置 ===');
await page.evaluate(() => {
  document.querySelector('[data-tab="settings"]').click();
});
await sleep(400);
const vstate = await page.evaluate(() => ({
  status: document.querySelector('#vision-status').textContent,
  model: document.querySelector('#set-model').value,
  vmodel: document.querySelector('#set-vmodel').value,
  vprovider: document.querySelector('#set-vprovider').value
}));
ok('设置页模型框显示 deepseek-flash', vstate.model === 'deepseek-flash', vstate.model);
ok('识图状态为「已配置」', vstate.status === '已配置', vstate.status);
ok('识图模型留空（跟随上方）', vstate.vmodel === '', JSON.stringify(vstate.vmodel));
ok('识图服务为「跟随上方」', vstate.vprovider === 'follow', vstate.vprovider);

console.log('\n=== 3. 测试识图真发一张图 ===');
calls.length = 0;
await page.click('#set-vtest');
await sleep(1800);
const visionCall = calls.find(c => c.hasImage);
ok('发出了带图片的请求', !!visionCall);
ok('模型是 deepseek-flash', visionCall?.model === 'deepseek-flash', String(visionCall?.model));
const m = visionCall?.body.match(/"url":"(data:image\/jpeg;base64,[^"]+)"/);
ok('图片是真实 JPEG data URL', !!m && m[1].length > 3000, m ? `${Math.round(m[1].length / 1024)} KB` : '未找到');
const afterToast = await page.evaluate(() => document.querySelector('#toast')?.textContent || '');
ok('提示识图可用', /识图|绿色/.test(afterToast), afterToast);
await page.screenshot({ path: OUT + 'v3-01-vision-test.png' });

console.log('\n=== 4. 图片记账走 DeepSeek ===');
calls.length = 0;
await page.evaluate(() => document.querySelector('[data-tab="home"]').click());
await sleep(300);
const fi = await page.$('#photo-file');
await fi.uploadFile('C:/Users/MO/WorkBuddy/2026-10-30-22-26-29/pocket-ledger/icons/icon-192.png');
await sleep(1600);
const imgCall = calls.find(c => c.hasImage);
ok('图片记账调用了视觉接口', !!imgCall);
ok('用的是同一个 Key 和模型', imgCall?.model === 'deepseek-flash', String(imgCall?.model));
const pv = await page.evaluate(() => {
  const box = document.querySelector('#ai-preview');
  if (!box || box.hidden) return null;
  return {
    rows: box.querySelectorAll('.pv-row').length,
    amounts: [...box.querySelectorAll('.pv-amt')].map(e => e.textContent.trim())
  };
});
ok('识别出 2 笔', pv?.rows === 2, String(pv?.rows));
ok('金额正确', JSON.stringify(pv?.amounts) === JSON.stringify(['-¥38.50', '-¥268.00']), (pv?.amounts || []).join(' '));
await page.screenshot({ path: OUT + 'v3-02-image-preview.png' });

console.log('\n=== 5. 文字记账仍正常 ===');
calls.length = 0;
await page.type('#ai-input', '早餐15');
await page.click('#ai-go');
await sleep(1600);
const tCall = calls[0];
ok('文字请求不带图片', tCall && !tCall.hasImage);
ok('文字模型同为 deepseek-flash', tCall?.model === 'deepseek-flash', String(tCall?.model));

console.log('\n=== 6. 无运行时报错 ===');
ok('零 JS 错误', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
await browser.close();
process.exit(fail ? 1 : 0);
