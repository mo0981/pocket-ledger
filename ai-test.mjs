import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://localhost:5180/';
const OUT = 'C:/Users/MO/WorkBuddy/2026-10-30-22-26-29/shots/';
fs.mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('·', ...a);

const MULTI = {
  items: [
    { type: 'expense', amount: 15, category: '餐饮', account: '微信', date: '2026-10-30', note: '早餐' },
    { type: 'expense', amount: 6, category: '交通', account: '微信', date: '2026-10-30', note: '地铁' },
    { type: 'expense', amount: 32.5, category: '购物', account: '支付宝', date: '2026-10-29', note: '超市' }
  ]
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu']
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

const errors = [];
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));

let mode = 'multi';
await page.evaluateOnNewDocument(() => {
  window.__mockMode = 'multi';
  const orig = window.fetch;
  window.fetch = async (url, opts) => {
    if (!String(url).includes('/chat/completions')) return orig(url, opts);
    const single = {
      items: [{ type: 'expense', amount: 88, category: '娱乐', account: '微信', date: '2026-10-30', note: '电影' }]
    };
    const multi = {
      items: [
        { type: 'expense', amount: 15, category: '餐饮', account: '微信', date: '2026-10-30', note: '早餐' },
        { type: 'expense', amount: 6, category: '交通', account: '微信', date: '2026-10-30', note: '地铁' },
        { type: 'expense', amount: 32.5, category: '购物', account: '支付宝', date: '2026-10-29', note: '超市' }
      ]
    };
    const payload = window.__mockMode === 'single' ? single : multi;
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(payload) } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
});

await page.goto(URL, { waitUntil: 'networkidle0' });
await sleep(600);

/* 1. 配置 Key */
await page.click('[data-tab="settings"]');
await sleep(400);
await page.type('#set-key', 'sk-test-fake-key');
await page.click('#set-save');
await sleep(500);
log('Key 已保存，状态 =', await page.evaluate(() => document.querySelector('#ai-status').textContent));

/* 2. 多条解析 */
await page.click('[data-tab="home"]');
await sleep(400);
await page.type('#ai-input', '早餐15 地铁6块 昨天超市32.5');
await page.click('#ai-go');
await sleep(700);

const preview = await page.evaluate(() => {
  const box = document.querySelector('#ai-preview');
  return {
    visible: box && !box.hidden,
    rows: box ? box.querySelectorAll('.pv-row').length : 0,
    head: box ? box.querySelector('.pv-head')?.textContent : ''
  };
});
log('AI 预览 =', JSON.stringify(preview));
await page.screenshot({ path: OUT + '11-ai-preview.png' });

/* 3. 点预览中的一条进行编辑 */
await page.click('#ai-preview .pv-row');
await sleep(450);
const pendingAmt = await page.evaluate(() => document.querySelector('#f-amount').value);
log('点预览项打开表单，金额 =', pendingAmt);
await page.screenshot({ path: OUT + '12-ai-edit.png' });
await page.click('#sheet-close');
await sleep(300);

/* 4. 全部保存 */
await page.click('#pv-save');
await sleep(700);
const after = await page.evaluate(() => ({
  count: document.querySelectorAll('#recent-list .tx-item').length,
  expense: document.querySelector('#home-expense').textContent,
  aiBadges: document.querySelectorAll('#recent-list .badge-ai').length,
  previewHidden: document.querySelector('#ai-preview')?.hidden
}));
log('批量保存后 =', JSON.stringify(after));
await page.screenshot({ path: OUT + '13-ai-saved.png' });

/* 5. 单条分支 */
await page.evaluate(() => { window.__mockMode = 'single'; });
await page.type('#ai-input', '电影88');
await page.click('#ai-go');
await sleep(700);
const singleSheet = await page.evaluate(() => ({
  sheetOpen: !document.querySelector('#sheet-mask').hidden,
  amt: document.querySelector('#f-amount').value,
  note: document.querySelector('#f-note').value,
  cat: document.querySelector('#f-cats .chip.on')?.textContent
}));
log('单条直接弹表单 =', JSON.stringify(singleSheet));
await page.screenshot({ path: OUT + '14-ai-single.png' });
await page.click('#f-save');
await sleep(600);
log('单条保存后笔数 =', await page.evaluate(() => document.querySelectorAll('#recent-list .tx-item').length));

/* 6. 统计数据完整 */
await page.click('[data-tab="stats"]');
await sleep(500);
await page.screenshot({ path: OUT + '15-stats-final.png' });

/* 7. 导出功能 */
await page.click('[data-tab="settings"]');
await sleep(400);
const dl = await page.evaluate(() => {
  const rows = document.querySelectorAll('#cat-expense .chip').length;
  return { catChips: rows, dataCount: document.querySelector('#data-count').textContent };
});
log('设置页 =', JSON.stringify(dl));

log('---- 错误 ----');
console.log(errors.length ? errors.join('\n') : '（无）');

await browser.close();
