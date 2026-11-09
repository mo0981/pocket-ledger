/* 验证：多张图片批量导入 + 按小票日期归纳 + 重复项处理 */
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://localhost:5180/';
const OUT = 'C:/Users/MO/WorkBuddy/2026-10-30-22-26-29/shots/';
const TMP = 'C:/Users/MO/WorkBuddy/2026-10-30-22-26-29/shots/_tmp';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (n, c, x = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}${x ? ' — ' + x : ''}`); }
  else { fail++; console.log(`  ❌ ${n}${x ? ' — ' + x : ''}`); }
};

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const prev = new Date(now); prev.setDate(1); prev.setMonth(prev.getMonth() - 1);
const P = `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}`;
/* 三组日期都放在「上月」，且保证 月末 > 25 > 15 的排序在任何月份都成立。
   不用真正的「昨天」：月初跑测试时昨天属于当月，「保存后跳到票据月份」的断言会失效。 */
const lastPrevDay = new Date(prev.getFullYear(), prev.getMonth() + 1, 0).getDate();
const YDAY = `${P}-${pad(lastPrevDay)}`;
const D30 = `${P}-25`;
const D28 = `${P}-15`;
const lbl = ds => `${+ds.slice(5, 7)}月${+ds.slice(8, 10)}日`;

/* 三张"图"各自返回不同内容，第三张故意与库里的旧账重复 */
const REPLY = [
  JSON.stringify({ source: 'wechat', items: [
    { type: 'expense', amount: 32.5, category: '餐饮', account: '微信', date: YDAY, note: '兰州拉面' },
    { type: 'expense', amount: 18, category: '交通', account: '微信', date: YDAY, note: '地铁' }
  ] }),
  JSON.stringify({ source: 'alipay', items: [
    { type: 'expense', amount: 128, category: '购物', account: '支付宝', date: D30, note: '优衣库' },
    { type: 'expense', amount: 25, category: '餐饮', account: '微信', date: D30, note: '沙县小吃' }
  ] }),
  JSON.stringify({ source: 'wechat', items: [
    { type: 'expense', amount: 12, category: '餐饮', account: '微信', date: D28, note: '早餐' }
  ] })
];

/* 准备三个临时图片文件 */
fs.mkdirSync(TMP, { recursive: true });
const srcPng = 'C:/Users/MO/WorkBuddy/2026-10-30-22-26-29/pocket-ledger/icons/icon-192.png';
const files = [1, 2, 3].map(i => {
  const p = path.join(TMP, `receipt-${i}.png`);
  fs.copyFileSync(srcPng, p);
  return p;
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

let visionCall = 0;
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
  if (!req.url().includes('/chat/completions')) { req.continue(); return; }

  const idx = Math.min(visionCall, REPLY.length - 1);
  visionCall++;

  req.respond({
    status: 200,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: REPLY[idx] } }] })
  });
});

await page.goto(URL, { waitUntil: 'networkidle0' });
await sleep(600);

/* 种数据：一条 10-28 的旧账（用来触发重复判断）+ AI 配置 */
await page.evaluate(async ({ d28 }) => {
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('pocket_ledger');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const db = await open();
  const rows = [{
    id: 'seed-1', type: 'expense', cents: 1200, cat: '餐饮', acct: '微信',
    date: d28, note: '早餐', ts: Date.now(), src: 'manual'
  }];
  await new Promise((res, rej) => {
    const tx = db.transaction('tx', 'readwrite');
    const st = tx.objectStore('tx');
    rows.forEach(x => st.put(x));
    tx.oncomplete = res; tx.onerror = rej;
  });
  const settings = {
    provider: 'deepseek', apiBase: 'https://api.deepseek.com/v1',
    apiModel: 'deepseek-flash', apiKey: 'sk-test', vProvider: 'follow',
    vBase: '', vModel: '', vKey: ''
  };
  await new Promise((res, rej) => {
    const tx = db.transaction('settings', 'readwrite');
    const st = tx.objectStore('settings');
    Object.entries(settings).forEach(([k, v]) => st.put({ k, v }));
    tx.oncomplete = res; tx.onerror = rej;
  });
}, { d28: D28 });

await page.reload({ waitUntil: 'networkidle0' });
await sleep(700);

console.log('\n=== 1. 上传前状态 ===');
const before = await page.evaluate(() => ({
  month: document.querySelector('#home-month')?.textContent || '',
  hero: document.querySelector('#home-expense')?.textContent || ''
}));
ok('初始为空账本', before.hero.includes('0.00') || before.hero === '', before.hero);

console.log('\n=== 2. 一次选三张图 ===');
const input = await page.$('#photo-file');
const multiple = await page.evaluate(() => document.querySelector('#photo-file').multiple);
ok('文件框支持多选', multiple === true, String(multiple));
await input.uploadFile(...files);

/* 等三张都识别完（顺序调用，每张一次请求） */
for (let i = 0; i < 60 && visionCall < 3; i++) await sleep(200);
await sleep(600);
ok('三张图各发了一次识图请求', visionCall === 3, `实际 ${visionCall} 次`);

const pv = await page.evaluate(() => {
  const box = document.querySelector('#ai-preview');
  if (!box || box.hidden) return null;
  const groups = Array.from(box.querySelectorAll('.pv-day')).map(g => ({
    name: g.querySelector('.pv-day-name')?.textContent.trim(),
    sum: g.querySelector('.pv-day-sum')?.textContent.trim(),
    rows: g.querySelectorAll('.pv-row').length
  }));
  return {
    head: box.querySelector('.pv-head')?.textContent.trim(),
    total: box.querySelector('.pv-total')?.textContent.trim(),
    thumbs: box.querySelectorAll('.pv-thumb').length,
    groups,
    rows: box.querySelectorAll('.pv-row').length,
    dups: box.querySelectorAll('.pv-tag').length,
    tip: box.querySelector('.pv-tip')?.textContent.replace(/\s+/g, ' ').trim() || '',
    saveLabel: document.querySelector('#pv-save')?.textContent.trim()
  };
});

ok('预览出现', !!pv, pv ? pv.head : '未出现');
ok('三张图的缩略图都在', pv?.thumbs === 3, String(pv?.thumbs));
ok('共识别 5 笔', pv?.rows === 5, String(pv?.rows));
ok('按日期分成 3 组', pv?.groups.length === 3, JSON.stringify(pv?.groups.map(g => g.name)));
ok('最新的日期排在最前', new RegExp(`昨天|${lbl(YDAY)}`).test(pv?.groups[0]?.name || ''), pv?.groups[0]?.name);
ok('最新那天两笔合计 50.50', /50\.50/.test(pv?.groups[0]?.sum || ''), pv?.groups[0]?.sum);
ok('第二组是 25 号', new RegExp(lbl(D30)).test(pv?.groups[1]?.name || ''), pv?.groups[1]?.name);
ok('第三组是 15 号', new RegExp(lbl(D28)).test(pv?.groups[2]?.name || ''), pv?.groups[2]?.name);
ok('顶部写明跨了 3 天', /3 天/.test(pv?.head || ''), pv?.head);
ok('支出合计 215.50', /215\.50/.test(pv?.total || ''), pv?.total);
ok('标出 1 笔重复', pv?.dups === 1, String(pv?.dups));
ok('重复提示出现', /默认不重复保存/.test(pv?.tip || ''), pv?.tip);
ok('默认只保存 4 笔', /保存 4 笔/.test(pv?.saveLabel || ''), pv?.saveLabel);

await page.screenshot({ path: OUT + 'v5-01-batch-preview.png', fullPage: false });

console.log('\n=== 3. 切换「仍然全部保留」 ===');
await page.click('[data-pvkeep]');
await sleep(300);
const keepOn = await page.evaluate(() => ({
  label: document.querySelector('#pv-save')?.textContent.trim(),
  dimmed: document.querySelectorAll('.pv-row.dup').length,
  tip: document.querySelector('.pv-tip')?.textContent.replace(/\s+/g, ' ').trim()
}));
ok('改为保存 5 笔', /保存 5 笔/.test(keepOn.label || ''), keepOn.label);
ok('重复项不再置灰', keepOn.dimmed === 0, String(keepOn.dimmed));
ok('提示切换为「改为跳过」', /改为跳过/.test(keepOn.tip || ''), keepOn.tip);

await page.click('[data-pvkeep]');
await sleep(250);
const backOff = await page.evaluate(() => document.querySelector('#pv-save')?.textContent.trim());
ok('再点一次回到跳过重复', /保存 4 笔/.test(backOff || ''), backOff);

console.log('\n=== 4. 保存并归档到小票所在月份 ===');
const monthBefore = await page.evaluate(() => document.querySelector('#home-month')?.textContent.trim());
await page.click('#pv-save');
await sleep(900);

const after = await page.evaluate(() => {
  const hero = document.querySelector('#home-expense')?.textContent.trim();
  const dayHeads = Array.from(document.querySelectorAll('.day-head span:first-child')).map(e => e.textContent.trim());
  return {
    month: document.querySelector('#home-month')?.textContent.trim(),
    hero,
    dayHeads,
    previewGone: document.querySelector('#ai-preview')?.hidden !== false,
    toast: document.querySelector('#toast')?.textContent.trim() || ''
  };
});
ok('预览已关闭', after.previewGone, String(after.previewGone));
ok('界面切到 10 月', /10月/.test(after.month || ''), `${monthBefore} → ${after.month}`);
ok('本月支出 215.50', /215\.50/.test(after.hero || ''), after.hero);
ok('提示里写了月份切换', /切到/.test(after.toast || ''), after.toast);

/* 流水页按日期分组 */
await page.evaluate(() => document.querySelector('[data-tab="list"]').click());
await sleep(400);
const listGroups = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.day-head span:first-child')).map(e => e.textContent.trim()));
ok('流水页按日期分 3 组', listGroups.length === 3, JSON.stringify(listGroups));
ok('提示里写明跳过 1 笔', /跳过 1 笔/.test(after.toast || ''), after.toast);

const stored = await page.evaluate(async () => {
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('pocket_ledger');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const db = await open();
  const rows = await new Promise((res, rej) => {
    const tx = db.transaction('tx', 'readonly');
    const rq = tx.objectStore('tx').getAll();
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  return {
    n: rows.length,
    dates: Array.from(new Set(rows.map(r => r.date))).sort(),
    dirty: rows.filter(r => r.img !== undefined || r.dup !== undefined).length
  };
});
ok('库里共 5 条（1 条种子 + 4 条新）', stored.n === 5, String(stored.n));
ok('日期分布正确', JSON.stringify(stored.dates) === JSON.stringify([D28, D30, YDAY].sort()), JSON.stringify(stored.dates));
ok('没有把临时字段写进库', stored.dirty === 0, String(stored.dirty));

console.log('\n=== 5. 布局检查 ===');
const layout = await page.evaluate(() => ({
  scrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth
}));
ok('无横向溢出', layout.scrollW <= layout.clientW + 1, `${layout.scrollW}/${layout.clientW}`);
const realErrors = errors.filter(e => !/Failed to load resource/.test(e));
ok('零 JS 报错', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));

await page.screenshot({ path: OUT + 'v5-02-after-save.png' });

console.log(`\n结果：${pass} 通过，${fail} 失败`);
await browser.close();
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
