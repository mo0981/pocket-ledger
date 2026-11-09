/* 验证：流水页按月筛选（胶囊切换 / 与搜索叠加 / 全部 / 空月份兜底） */
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
const mkOf = off => {
  const d = new Date(now.getFullYear(), now.getMonth() + off, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const CUR = mkOf(0), M1 = mkOf(-1), M2 = mkOf(-2);

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

  await page.goto(URL, { waitUntil: 'networkidle0' });
  await sleep(500);

  await page.evaluate(async ({ m1, m2, cur }) => {
    const open = () => new Promise((res, rej) => {
      const r = indexedDB.open('pocket_ledger');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const db = await open();
    const rows = [
      { id: 'm1-a', type: 'expense', cents: 5000, cat: '餐饮', acct: '微信', date: m1 + '-15', note: '火锅', ts: 1, src: 'manual' },
      { id: 'm1-b', type: 'expense', cents: 3000, cat: '交通', acct: '支付宝', date: m1 + '-16', note: '打车', ts: 2, src: 'manual' },
      { id: 'm2-a', type: 'expense', cents: 2000, cat: '购物', acct: '微信', date: m2 + '-10', note: 'T恤', ts: 3, src: 'manual' },
      { id: 'cur-a', type: 'expense', cents: 1500, cat: '餐饮', acct: '微信', date: cur + '-01', note: '早饭', ts: 4, src: 'manual' }
    ];
    await new Promise((res, rej) => {
      const tx = db.transaction('tx', 'readwrite');
      const st = tx.objectStore('tx');
      rows.forEach(x => st.put(x));
      tx.oncomplete = res; tx.onerror = rej;
    });
  }, { m1: M1, m2: M2, cur: CUR });

  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(600);

  const gotoList = () => page.evaluate(() => document.querySelector('.tab[data-tab="list"]').click());
  const chips = () => page.$$eval('#list-months .chip', els =>
    els.map(e => ({ text: e.textContent.trim(), lm: e.dataset.lm, on: e.classList.contains('on') })));
  const rows = () => page.$$eval('#list-body .tx-item', els => els.length);
  const total = () => page.$eval('#list-total', e => e.textContent.trim());

  console.log('\n▸ 进入流水页');
  await gotoList();
  await sleep(300);
  const c0 = await chips();
  ok('有「全部」胶囊', c0[0].text === '全部' && c0[0].lm === '');
  ok('胶囊数 = 全部 + 3 个月', c0.length === 4, c0.map(c => c.text).join(' / '));
  ok('默认选中「全部」', c0[0].on);
  ok('默认显示全部 4 笔', (await rows()) === 4);
  ok('合计文案无月份前缀', (await total()) === '共 4 笔', await total());

  console.log('\n▸ 点「上个月」胶囊');
  const target = c0.find(c => c.lm === M1);
  await page.evaluate(lm => {
    document.querySelector(`#list-months [data-lm="${lm}"]`).click();
  }, M1);
  await sleep(300);
  ok('该胶囊高亮', (await chips()).find(c => c.lm === M1).on);
  ok('只剩上月 2 笔', (await rows()) === 2, `${await rows()} 笔`);
  ok('合计文案带月份', (await total()).includes('共 2 笔') && (await total()).includes('年'), await total());
  const dates = await page.$$eval('#list-body .day-head span:first-child', els => els.map(e => e.textContent.trim()));
  ok('只显示上月日期分组', dates.length === 2, dates.join(','));

  console.log('\n▸ 月份 + 搜索叠加');
  await page.type('#search', '火锅');
  await sleep(300);
  ok('上月里搜「火锅」剩 1 笔', (await rows()) === 1, `${await rows()} 笔`);

  await page.evaluate(() => { document.querySelector('#search').value = ''; });
  await page.evaluate(() => document.querySelector('#search').dispatchEvent(new Event('input')));
  await sleep(200);

  console.log('\n▸ 换到上上月');
  await page.evaluate(lm => {
    document.querySelector(`#list-months [data-lm="${lm}"]`).click();
  }, M2);
  await sleep(300);
  ok('上上月 1 笔', (await rows()) === 1, `${await rows()} 笔`);

  console.log('\n▸ 点回「全部」');
  await page.evaluate(() => document.querySelector('#list-months [data-lm=""]').click());
  await sleep(300);
  ok('恢复 4 笔', (await rows()) === 4, `${await rows()} 笔`);
  ok('「全部」重新高亮', (await chips())[0].on);

  console.log('\n▸ 某月数据被删光后胶囊自动收敛');
  await page.evaluate(async ({ m2 }) => {
    const open = () => new Promise((res, rej) => {
      const r = indexedDB.open('pocket_ledger');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const db = await open();
    await new Promise((res, rej) => {
      const tx = db.transaction('tx', 'readwrite');
      tx.objectStore('tx').delete('m2-a');
      tx.oncomplete = res; tx.onerror = rej;
    });
  }, { m2: M2 });
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(500);
  await gotoList();
  await sleep(300);
  const c1 = await chips();
  ok('已清空的月份胶囊消失', !c1.some(c => c.lm === M2), c1.map(c => c.text).join(' / '));
  ok('只剩全部 + 2 个月', c1.length === 3, c1.map(c => c.text).join(' / '));
  ok('总笔数变 3', (await rows()) === 3, `${await rows()} 笔`);

  console.log('\n▸ 切 tab 后筛选保持');
  await page.evaluate(lm => {
    document.querySelector(`#list-months [data-lm="${lm}"]`).click();
  }, M1);
  await sleep(250);
  await page.evaluate(() => document.querySelector('.tab[data-tab="home"]').click());
  await sleep(200);
  await gotoList();
  await sleep(300);
  ok('回到流水页仍保持上月筛选', (await chips()).some(c => c.on && c.lm === M1),
    (await chips()).filter(c => c.on).map(c => c.text).join(','));

  await page.screenshot({ path: 'C:/Users/MO/WorkBuddy/2026-10-30-22-26-29/shots/list-month.png' });

  const overflow = await page.evaluate(() => {
    const iw = window.innerWidth;
    return Array.from(document.querySelectorAll('#view-list *')).filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.right > iw + 1 && !el.closest('.month-chips');
    }).length;
  });
  ok('流水页无横向溢出', overflow === 0, `${overflow} 个元素越界`);
  ok('全程无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
