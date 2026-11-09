import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://localhost:5180/';
const OUT = 'C:/Users/MO/WorkBuddy/2026-10-30-22-26-29/shots/';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
}

const pad = n => String(n).padStart(2, '0');
const now = new Date();
const mk = (offset) => {
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const M0 = mk(0), M1 = mk(-1), M2 = mk(-2);

const seedTx = [];
let seq = 0;
const add = (o) => seedTx.push({ id: 'seed-' + (++seq), ts: Date.now() - seq * 1000, src: 'manual', ...o });

for (const [m, day] of [[M2, 5], [M1, 5], [M0, 5]]) {
  add({ type: 'expense', cents: 300000, cat: '居住', acct: '银行卡', date: `${m}-${pad(day)}`, note: '房租' });
}
add({ type: 'expense', cents: 3200, cat: '餐饮', acct: '微信', date: `${M0}-08`, note: '星巴克' });
add({ type: 'expense', cents: 4500, cat: '餐饮', acct: '微信', date: `${M0}-12`, note: '海底捞' });
add({ type: 'expense', cents: 600, cat: '交通', acct: '支付宝', date: `${M0}-12`, note: '地铁' });
add({ type: 'income', cents: 900000, cat: '工资', acct: '银行卡', date: `${M0}-10`, note: '九月工资' });
add({ type: 'expense', cents: 50000, cat: '购物', acct: '支付宝', date: `${M1}-20`, note: '耳机' });

const seedSettings = {
  provider: 'dashscope',
  apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiModel: 'qwen-plus',
  apiKey: 'sk-test-text',
  vProvider: 'dashscope',
  vBase: '',
  vModel: 'qwen-vl-max',
  vKey: 'sk-test-vision'
};

/* 三个模拟响应：文字记账 / 图片记账 / 洞察 */
const MOCK_TEXT = JSON.stringify({
  items: [
    { type: 'expense', amount: 15, category: '餐饮', account: '微信', date: `${M0}-30`, note: '早餐' },
    { type: 'expense', amount: 6, category: '交通', account: '支付宝', date: `${M0}-30`, note: '地铁' },
    { type: 'expense', amount: 32.5, category: '娱乐', account: '微信', date: `${M0}-30`, note: '电影票' }
  ]
});

const MOCK_IMG = JSON.stringify({
  source: 'alipay',
  items: [
    { type: 'expense', amount: 38.5, category: '餐饮', account: '支付宝', date: `${M0}-29`, note: '美团外卖' },
    { type: 'expense', amount: 12, category: '交通', account: '支付宝', date: `${M0}-29`, note: '滴滴出行' },
    { type: 'expense', amount: 268, category: '购物', account: '支付宝', date: `${M0}-29`, note: '优衣库' },
    { type: 'expense', amount: 9.9, category: '购物', account: '支付宝', date: `${M0}-29`, note: '便利店' }
  ]
});

const MOCK_INSIGHT = JSON.stringify({
  lines: [
    '本月支出 3,377 元，比上月多 2,877 元，主要是多了一笔 500 元的购物。',
    '居住占了 89%，单笔房租 3,000 元是最大支出，其余都很零散。',
    '餐饮 4 笔共 64 元，频次不高但单价波动大。',
    '记账天数 6 天，有 4 天没记，可能有遗漏。'
  ]
});

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

const errors = [];
page.on('pageerror', e => errors.push(String(e.message)));
page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });

/* 拦截所有大模型请求 */
const chatCalls = [];
await page.setRequestInterception(true);
page.on('request', async req => {
  const url = req.url();
  if (!url.includes('/chat/completions')) { req.continue(); return; }

  // 浏览器跨域预检
  if (req.method() === 'OPTIONS') {
    return req.respond({
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization,content-type'
      },
      body: ''
    });
  }

  let body = '';
  try { body = req.postData() || ''; } catch (e) { body = ''; }
  chatCalls.push(body.includes('image_url') ? 'vision' : body.includes('财务顾问') ? 'insight' : 'text');

  let content = MOCK_TEXT;
  if (body.includes('image_url')) content = MOCK_IMG;
  else if (body.includes('财务顾问')) content = MOCK_INSIGHT;
  else if (body.includes('测试助手')) content = '正常';

  req.respond({
    status: 200,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] })
  });
});

console.log('\n=== 1. 首次加载 ===');
await page.goto(URL, { waitUntil: 'networkidle0' });
await sleep(700);

const title = await page.title();
ok('页面标题正确', title === '小账本', title);
ok('无启动报错', errors.length === 0, errors.join(' | '));

/* 写入种子数据 */
await page.evaluate(async ({ rows, settings }) => {
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('pocket_ledger');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const db = await open();
  await new Promise((res, rej) => {
    const tx = db.transaction('tx', 'readwrite');
    const st = tx.objectStore('tx');
    rows.forEach(x => st.put(x));
    tx.oncomplete = res; tx.onerror = rej;
  });
  await new Promise((res, rej) => {
    const tx = db.transaction('settings', 'readwrite');
    const st = tx.objectStore('settings');
    Object.entries(settings).forEach(([k, v]) => st.put({ k, v }));
    tx.oncomplete = res; tx.onerror = rej;
  });
}, { rows: seedTx, settings: seedSettings });

await page.reload({ waitUntil: 'networkidle0' });
await sleep(700);

console.log('\n=== 2. 首页（种子数据） ===');
const hero = await page.evaluate(() => ({
  expense: document.querySelector('#home-expense').textContent,
  income: document.querySelector('#home-income').textContent,
  month: document.querySelector('#home-month').textContent,
  photoBtn: !!document.querySelector('#ai-photo') && document.querySelector('#ai-photo').offsetParent !== null
}));
ok('本月支出 3083.00', hero.expense === '¥3,083.00', hero.expense);
ok('本月收入 9000.00', hero.income === '¥9,000.00', hero.income);
ok('相机按钮可见', hero.photoBtn);
await page.screenshot({ path: OUT + 'v2-01-home.png' });

console.log('\n=== 3. 图片记账 ===');
const fileInput = await page.$('#photo-file');
await fileInput.uploadFile('C:/Users/MO/WorkBuddy/2026-10-30-22-26-29/pocket-ledger/icons/icon-192.png');
await sleep(1500);

const preview = await page.evaluate(() => {
  const box = document.querySelector('#ai-preview');
  const toast = document.querySelector('#toast');
  if (!box || box.hidden) return { none: true, toast: toast.hidden ? '' : toast.textContent };
  return {
    rows: box.querySelectorAll('.pv-row').length,
    thumb: !!box.querySelector('.pv-thumb'),
    head: box.querySelector('.pv-head')?.textContent.trim(),
    amounts: Array.from(box.querySelectorAll('.pv-amt')).map(e => e.textContent.trim())
  };
});
ok('图片预览出现', !preview.none, preview.none ? '提示：' + preview.toast : preview.head);
ok('识别出 4 笔', preview.rows === 4, String(preview.rows));
ok('显示原图缩略图', preview?.thumb === true);
ok('金额正确', JSON.stringify(preview?.amounts) === JSON.stringify(['-¥38.50', '-¥12.00', '-¥268.00', '-¥9.90']), (preview?.amounts || []).join(' '));
await page.screenshot({ path: OUT + 'v2-02-image-preview.png' });

console.log('\n=== 3b. 预览里移除一笔 ===');
await page.click('#ai-preview .pv-row[data-pv="2"] .pv-del');
await sleep(350);
const afterDel = await page.evaluate(() => {
  const box = document.querySelector('#ai-preview');
  return {
    rows: box.querySelectorAll('.pv-row').length,
    sum: box.querySelector('.pv-total b')?.textContent.trim()
  };
});
ok('移除后剩 3 笔', afterDel.rows === 3, String(afterDel.rows));
ok('小计跟着变 60.40', afterDel.sum === '¥60.40', afterDel.sum);

// 重新识别一次，恢复 4 笔继续后面的用例（先取消，否则会追加到现有预览里）
await page.evaluate(() => {
  const c = document.querySelector('#pv-cancel');
  if (c) c.click();
  document.querySelector('#photo-file').value = '';
});
await sleep(350);
const fileInput2 = await page.$('#photo-file');
await fileInput2.uploadFile('C:/Users/MO/WorkBuddy/2026-10-30-22-26-29/pocket-ledger/icons/icon-192.png');
await sleep(1500);
const restored = await page.evaluate(() => document.querySelector('#ai-preview').querySelectorAll('.pv-row').length);
ok('重新识别恢复 4 笔', restored === 4, String(restored));

console.log('\n=== 4. 分类习惯学习 ===');
await page.click('#ai-preview .pv-row[data-pv="3"]');
await sleep(450);
const sheetOpen = await page.evaluate(() => !document.querySelector('#sheet-mask').hidden);
ok('点开单笔编辑', sheetOpen);
const amountVal = await page.evaluate(() => document.querySelector('#f-amount').value);
ok('金额回填 9.9', amountVal === '9.9', amountVal);
await page.evaluate(() => {
  const chip = Array.from(document.querySelectorAll('#f-cats .chip')).find(c => c.dataset.pickcat === '餐饮');
  chip.click();
});
await page.click('#f-save');
await sleep(450);

const learned = await page.evaluate(async () => {
  const r = await new Promise((res, rej) => {
    const q = indexedDB.open('pocket_ledger');
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
  return new Promise((res, rej) => {
    const tx = r.transaction('settings').objectStore('settings').get('catRules');
    tx.onsuccess = () => res(tx.result?.v || {});
    tx.onerror = () => rej(tx.error);
  });
});
ok('记住了「便利店→餐饮」', learned['便利店'] === '餐饮', JSON.stringify(learned));

const previewAfter = await page.evaluate(() => {
  const box = document.querySelector('#ai-preview');
  return Array.from(box.querySelectorAll('.pv-cat')).map(e => e.textContent.trim());
});
ok('预览行已更新为餐饮', (previewAfter[3] || '').includes('餐饮'), previewAfter[3]);

console.log('\n=== 5. 批量入库 ===');
await page.click('#pv-save');
await sleep(900);
const afterSave = await page.evaluate(() => ({
  expense: document.querySelector('#home-expense').textContent,
  previewGone: document.querySelector('#ai-preview')?.hidden !== false
}));
// 3083.00 + 38.5 + 12 + 268 + 9.9 = 3411.40
ok('支出累加正确', afterSave.expense === '¥3,411.40', afterSave.expense);
ok('预览自动收起', afterSave.previewGone);

console.log('\n=== 6. 文字记账（多笔） ===');
await page.type('#ai-input', '今天早餐15 地铁6块 电影票32.5');
await page.click('#ai-go');
await sleep(1200);
const textPreview = await page.evaluate(() => {
  const box = document.querySelector('#ai-preview');
  return box && !box.hidden ? box.querySelectorAll('.pv-row').length : 0;
});
ok('文字解析出 3 笔', textPreview === 3, String(textPreview));
await page.click('#pv-save');
await sleep(800);

console.log('\n=== 7. 自然语言查账 ===');
const callsBefore = chatCalls.length;
await page.type('#ai-input', '这个月餐饮花了多少');
await page.click('#ai-go');
await sleep(600);
const answer = await page.evaluate(() => {
  const card = document.querySelector('#answer-card');
  if (!card) return null;
  return {
    main: card.querySelector('.answer-main')?.textContent.trim(),
    sub: card.querySelector('.answer-sub')?.textContent.trim(),
    rows: card.querySelectorAll('.answer-row').length
  };
});
// 餐饮：星巴克32 + 海底捞45 + 外卖38.5 + 便利店9.9(改成餐饮) + 早餐15 = 140.40
ok('查账卡片出现', !!answer, answer?.main);
ok('餐饮合计 140.40', answer?.main === '¥140.40', answer?.main);
ok('给出占比说明', (answer?.sub || '').includes('占本月支出'), answer?.sub);
ok('列出明细', (answer?.rows || 0) >= 2, String(answer?.rows));
await page.screenshot({ path: OUT + 'v2-03-query.png' });

ok('查账没有调用模型（本地算）', chatCalls.length === callsBefore, `请求数 ${callsBefore} → ${chatCalls.length}`);

await page.click('#answer-close');
await sleep(200);
ok('回答卡可关闭', await page.evaluate(() => !document.querySelector('#answer-card')));

console.log('\n=== 8. 统计页：固定扣款 + AI 洞察 ===');
await page.click('.tab[data-tab="stats"]');
await sleep(700);

const subs = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('#subs-box .sub-row'));
  return {
    count: rows.length,
    name: rows[0]?.querySelector('.sub-name')?.textContent.trim(),
    amt: rows[0]?.querySelector('.sub-amt')?.textContent.trim(),
    meta: rows[0]?.querySelector('.sub-meta')?.textContent.trim(),
    total: document.querySelector('#subs-box .sub-total')?.textContent.trim()
  };
});
ok('识别出 1 项固定扣款', subs.count === 1, String(subs.count));
ok('认出「房租」', subs.name === '房租', subs.name);
ok('月供 3000.00', subs.amt === '¥3,000.00', subs.amt);
ok('跨 3 个月', (subs.meta || '').includes('跨 3 个月'), subs.meta);

await page.click('#insight-btn');
await sleep(1200);
const insight = await page.evaluate(() => ({
  lines: Array.from(document.querySelectorAll('#insight-box .insight-line')).map(e => e.textContent.trim()),
  time: document.querySelector('#insight-box .insight-time')?.textContent.trim()
}));
ok('生成 4 条洞察', insight.lines.length === 4, String(insight.lines.length));
ok('洞察带具体数字', (insight.lines[0] || '').includes('3,377'), insight.lines[0]);
ok('显示生成时间', !!insight.time, insight.time);
await page.screenshot({ path: OUT + 'v2-04-stats.png' });

console.log('\n=== 9. 设置页：识图配置 + 习惯清单 ===');
await page.click('.tab[data-tab="settings"]');
await sleep(600);
const settings = await page.evaluate(() => ({
  vModel: document.querySelector('#set-vmodel').value,
  vStatus: document.querySelector('#vision-status').textContent,
  vStatusCls: document.querySelector('#vision-status').className,
  rules: Array.from(document.querySelectorAll('#rules-chips .chip')).map(e => e.textContent.trim())
}));
ok('识图模型回显 qwen-vl-max', settings.vModel === 'qwen-vl-max', settings.vModel);
ok('识图状态为已配置', settings.vStatus === '已配置' && settings.vStatusCls.includes('ok'), settings.vStatus);
ok('习惯清单有「便利店 → 餐饮」', settings.rules.some(r => r.includes('便利店') && r.includes('餐饮')), settings.rules.join(' / '));
await page.screenshot({ path: OUT + 'v2-05-settings.png', fullPage: true });

console.log('\n=== 10. 布局与错误 ===');
const layout = await page.evaluate(() => ({
  scrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth
}));
ok('没有横向溢出', layout.scrollW <= layout.clientW + 1, `${layout.scrollW} / ${layout.clientW}`);
ok('全程无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n──────────── 通过 ${pass} 项，失败 ${fail} 项 ────────────\n`);
process.exit(fail ? 1 : 0);
