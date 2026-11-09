import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://localhost:5180/';
const OUT = 'C:/Users/MO/WorkBuddy/2026-10-30-22-26-29/shots/';
fs.mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('·', ...a);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none']
});

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle0' });
await sleep(500);

log('viewport =', await page.evaluate(() => `${innerWidth}x${innerHeight}`));
log('文档宽度 =', await page.evaluate(() => document.documentElement.scrollWidth));
await page.screenshot({ path: OUT + '01-home-empty.png' });

/* ---- 打开记一笔 ---- */
const fabInfo = await page.evaluate(() => {
  const f = document.querySelector('#fab-add');
  const r = f.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), right: getComputedStyle(f).right, bottom: getComputedStyle(f).bottom };
});
log('FAB 位置 =', JSON.stringify(fabInfo));
log('前期错误 =', errors.length ? errors.join(' | ') : '（无）');

await page.click('#fab-add');
await sleep(450);
let sheetVisible = await page.evaluate(() => !document.querySelector('#sheet-mask').hidden);
if (!sheetVisible) {
  log('坐标点击无效，改用 DOM click');
  await page.evaluate(() => document.querySelector('#fab-add').click());
  await sleep(450);
  sheetVisible = await page.evaluate(() => !document.querySelector('#sheet-mask').hidden);
}
log('sheet 可见 =', sheetVisible);
log('错误 =', errors.length ? errors.join(' | ') : '（无）');
if (!sheetVisible) {
  console.log('ABORT: sheet 打不开');
  await browser.close();
  process.exit(1);
}
await page.screenshot({ path: OUT + '02-sheet.png' });

/* ---- 填一笔支出 ---- */
await page.type('#f-amount', '28.5');
await page.click('[data-pickcat="餐饮"]');
await page.click('#f-accts [data-pickacct="支付宝"]');
await page.type('#f-note', '午饭');
await sleep(200);
await page.screenshot({ path: OUT + '03-sheet-filled.png' });
await page.click('#f-save');
await sleep(500);

/* ---- 再记几笔 ---- */
const quick = [
  { amt: '6', cat: '交通', note: '地铁' },
  { amt: '128', cat: '购物', note: '洗发水' },
  { amt: '3200', cat: '居住', note: '房租' },
  { amt: '45', cat: '娱乐', note: '电影票' }
];
for (const q of quick) {
  await page.click('#fab-add');
  await sleep(320);
  await page.type('#f-amount', q.amt);
  await page.click(`[data-pickcat="${q.cat}"]`);
  await page.type('#f-note', q.note);
  await page.click('#f-save');
  await sleep(300);
}

/* ---- 记一笔收入 ---- */
await page.click('#fab-add');
await sleep(350);
await page.click('[data-type="income"]');
await sleep(150);
await page.type('#f-amount', '9000');
await page.click('[data-pickcat="工资"]');
await page.type('#f-note', '10月工资');
await page.click('#f-save');
await sleep(500);

log('首页流水条数 =', await page.evaluate(() => document.querySelectorAll('#recent-list .tx-item').length));
log('本月支出 =', await page.evaluate(() => document.querySelector('#home-expense').textContent));
log('本月收入 =', await page.evaluate(() => document.querySelector('#home-income').textContent));
log('结余 =', await page.evaluate(() => document.querySelector('#home-balance').textContent));
await page.screenshot({ path: OUT + '04-home-filled.png' });

/* ---- 流水页 ---- */
await page.click('[data-tab="list"]');
await sleep(400);
await page.screenshot({ path: OUT + '05-list.png' });
log('流水页条数 =', await page.evaluate(() => document.querySelectorAll('#list-body .tx-item').length));

/* ---- 搜索 ---- */
await page.type('#search', '地铁');
await sleep(300);
log('搜索"地铁"结果 =', await page.evaluate(() => document.querySelectorAll('#list-body .tx-item').length));
await page.evaluate(() => { document.querySelector('#search').value = ''; });
await page.evaluate(() => document.querySelector('#search').dispatchEvent(new Event('input')));
await sleep(200);

/* ---- 统计页 ---- */
await page.click('[data-tab="stats"]');
await sleep(400);
await page.screenshot({ path: OUT + '06-stats.png' });
log('环形图 SVG =', await page.evaluate(() => !!document.querySelector('#pie svg')));
log('柱图 SVG =', await page.evaluate(() => !!document.querySelector('#bars svg')));

/* ---- 设置页 ---- */
await page.click('[data-tab="settings"]');
await sleep(400);
await page.screenshot({ path: OUT + '07-settings.png', fullPage: true });

/* ---- 未配置 Key 时点解析 ---- */
await page.click('[data-tab="home"]');
await sleep(300);
await page.type('#ai-input', '早餐15 地铁6块');
await page.click('#ai-go');
await sleep(450);
const toastText = await page.evaluate(() => {
  const t = document.querySelector('#toast');
  return t.hidden ? '(无)' : t.textContent;
});
log('未配 Key 提示 =', toastText);
await page.screenshot({ path: OUT + '08-ai-nokey.png' });

/* ---- 转账类型 ---- */
await page.click('#fab-add');
await sleep(350);
await page.click('[data-type="transfer"]');
await sleep(250);
const hasToGroup = await page.evaluate(() => {
  const g = document.querySelector('#to-acct-group');
  return !!g && !g.hidden;
});
log('转账双账户组 =', hasToGroup);
await page.screenshot({ path: OUT + '09-transfer.png' });
await page.click('#sheet-close');
await sleep(300);

/* ---- 编辑既有流水 ---- */
await page.click('[data-tab="list"]');
await sleep(350);
const firstText = await page.evaluate(() => document.querySelector('#list-body .tx-item .tx-cat').textContent);
await page.click('#list-body .tx-item');
await sleep(400);
const editAmt = await page.evaluate(() => document.querySelector('#f-amount').value);
const canDelete = await page.evaluate(() => !document.querySelector('#f-delete').hidden);
log(`编辑首条「${firstText}」金额 =`, editAmt, '删除按钮 =', canDelete);
await page.screenshot({ path: OUT + '10-edit.png' });
await page.click('#sheet-close');

/* ---- 横向溢出检查 ---- */
const overflow = await page.evaluate(() => {
  const w = document.documentElement.clientWidth;
  const bad = [];
  document.querySelectorAll('body *').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.right > w + 1 || r.left < -1)) {
      bad.push(`${el.tagName}.${el.className || ''} right=${Math.round(r.right)}`);
    }
  });
  return { clientWidth: w, offenders: bad.slice(0, 6) };
});
log('横向溢出检查 =', JSON.stringify(overflow));

/* ---- 错误汇总 ---- */
log('---- 运行时错误 ----');
console.log(errors.length ? errors.join('\n') : '（无）');

await browser.close();
