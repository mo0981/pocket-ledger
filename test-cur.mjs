/* 验证：AI 识别币种、手动选币种、多币种不相加、主币种切换 */
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://localhost:5180/';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (n, c, x = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}${x ? ' — ' + x : ''}`); }
  else { fail++; console.log(`  ❌ ${n}${x ? ' — ' + x : ''}`); }
};

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

/* 一批两笔，分别是美元和新加坡元：直接走预览卡片 */
const REPLY_MULTI = JSON.stringify({
  items: [
    { type: 'expense', amount: 12.5, currency: 'USD', category: '餐饮', account: '银行卡', date: today, note: 'blue bottle' },
    { type: 'expense', amount: 8, currency: 'S$', category: '交通', account: '现金', date: today, note: 'MRT' }
  ]
});
/* 单笔：会直接弹「记一笔」，用来验证弹层里的币种预填 */
const REPLY_SINGLE = JSON.stringify({
  items: [{ type: 'expense', amount: 20, currency: '€', category: '餐饮', account: '现金', date: today, note: 'baguette' }]
});

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});

try {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  let call = 0;
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (req.method() === 'OPTIONS') {
      req.respond({ status: 204, headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization,content-type'
      } });
      return;
    }
    if (!req.url().includes('/chat/completions')) { req.continue(); return; }
    const body = call === 0 ? REPLY_MULTI : REPLY_SINGLE;
    call++;
    req.respond({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: body } }] })
    });
  });

  await page.goto(URL, { waitUntil: 'networkidle0' });
  await sleep(500);

  // 种一条人民币（故意不写 cur，模拟老数据）
  await page.evaluate(async ({ today }) => {
    const open = () => new Promise((res, rej) => {
      const r = indexedDB.open('pocket_ledger');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const db = await open();
    const rows = [
      { id: 'cny-1', type: 'expense', cents: 3000, cat: '餐饮', acct: '微信', date: today, note: '食堂', ts: 1, src: 'manual' }
    ];
    await new Promise((res, rej) => {
      const tx = db.transaction('tx', 'readwrite');
      const st = tx.objectStore('tx');
      rows.forEach(x => st.put(x));
      tx.oncomplete = res; tx.onerror = rej;
    });
    const cfg = {
      provider: 'deepseek', apiBase: 'https://api.deepseek.com/v1',
      apiModel: 'deepseek-flash', apiKey: 'sk-test', vProvider: 'follow',
      vBase: '', vModel: '', vKey: ''
    };
    await new Promise((res, rej) => {
      const tx = db.transaction('settings', 'readwrite');
      const st = tx.objectStore('settings');
      Object.entries(cfg).forEach(([k, v]) => st.put({ k, v }));
      tx.oncomplete = res; tx.onerror = rej;
    });
  }, { today });

  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(600);

  const homeExpense = () => page.$eval('#home-expense', e => e.textContent.trim());
  const homeOther = () => page.evaluate(() => {
    const el = document.getElementById('home-other');
    return el.hidden ? '' : el.textContent.trim();
  });

  console.log('\n▸ 老数据（没有 cur 字段）当人民币');
  ok('首页显示 ¥30.00', (await homeExpense()) === '¥30.00', await homeExpense());
  ok('没有其他币种提示', (await homeOther()) === '', await homeOther());

  console.log('\n▸ AI 一次识别两笔：美元 + 新币');
  await page.type('#ai-input', '在 blue bottle 花了 12.5 美元，坐地铁 8 新币');
  await page.click('#ai-go');
  await sleep(1000);

  const pvAmts = await page.$$eval('.pv-amt', els => els.map(e => e.textContent.trim()));
  ok('预览两行分别是 US$ / S$', pvAmts.join(',') === '-US$12.50,-S$8.00', pvAmts.join(' , '));
  const pvTotal = await page.$eval('.pv-total', e => e.textContent.trim());
  ok('合计按币种分开列', pvTotal.includes('US$12.50') && pvTotal.includes('S$8.00'), pvTotal);
  ok('合计里没有误加的人民币符号', !pvTotal.includes('¥'), pvTotal);

  await page.click('#pv-save');
  await sleep(800);
  ok('保存后首页人民币合计仍是 ¥30.00', (await homeExpense()) === '¥30.00', await homeExpense());
  ok('首页提示里有 US$12.50', (await homeOther()).includes('US$12.50'), await homeOther());
  ok('首页提示里有 S$8.00', (await homeOther()).includes('S$8.00'), await homeOther());

  console.log('\n▸ 流水页各显示各的符号');
  await page.evaluate(() => document.querySelector('.tab[data-tab="list"]').click());
  await sleep(400);
  const amts = await page.$$eval('#list-body .tx-amt', els => els.map(e => e.textContent.trim()));
  ok('三笔符号分别是 ¥ / US$ / S$',
    amts.includes('-¥30.00') && amts.includes('-US$12.50') && amts.includes('-S$8.00'), amts.join(' , '));

  console.log('\n▸ 切主币种到美元');
  await page.evaluate(() => document.querySelector('.tab[data-tab="settings"]').click());
  await sleep(300);
  await page.select('#set-cur', 'USD');
  await sleep(500);
  await page.evaluate(() => document.querySelector('.tab[data-tab="home"]').click());
  await sleep(400);
  ok('首页主金额变成 US$12.50', (await homeExpense()) === 'US$12.50', await homeExpense());
  ok('提示改成含 ¥30.00', (await homeOther()).includes('¥30.00'), await homeOther());
  const label = await page.$eval('#home-label', e => e.textContent.trim());
  ok('标签标明币种', label.includes('美元'), label);

  console.log('\n▸ 统计页只统计主币种');
  await page.evaluate(() => document.querySelector('.tab[data-tab="stats"]').click());
  await sleep(400);
  const center = await page.evaluate(() => {
    const t = document.querySelectorAll('#pie svg text');
    return t.length ? t[1].textContent.trim() : '';
  });
  ok('环形图中心 = 12.50（只算美元）', center === '12.50', center);
  const note = await page.evaluate(() => {
    const el = document.getElementById('pie-note');
    return el.hidden ? '' : el.textContent.trim();
  });
  ok('图下注明另有人民币', note.includes('¥30.00'), note);

  console.log('\n▸ 手动记账默认跟随主币种');
  await page.evaluate(() => document.querySelector('.tab[data-tab="home"]').click());
  await sleep(200);
  await page.click('#fab-add');
  await sleep(400);
  const curVal = await page.$eval('#f-cur', e => e.value);
  ok('记一笔的币种默认美元', curVal === 'USD', curVal);
  await page.evaluate(() => document.getElementById('sheet-close').click());
  await sleep(250);

  console.log('\n▸ 单笔识别直接弹「记一笔」，币种已预填');
  await page.type('#ai-input', '在巴黎买法棍 20 欧');
  await page.click('#ai-go');
  await sleep(1000);
  const sheetOpen = await page.evaluate(() => !document.getElementById('sheet-mask').hidden);
  ok('弹层已打开', sheetOpen);
  ok('币种预填 EUR', (await page.$eval('#f-cur', e => e.value)) === 'EUR');
  ok('金额预填 20', (await page.$eval('#f-amount', e => e.value)) === '20');
  await page.evaluate(() => document.getElementById('sheet-close').click());
  await sleep(300);

  await page.evaluate(() => document.querySelector('.tab[data-tab="home"]').click());
  await sleep(300);
  await page.screenshot({ path: 'C:/Users/MO/WorkBuddy/2026-10-30-22-26-29/shots/currency.png' });
  ok('全程无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
