/* 双语测试：系统语言默认、手动切换、持久化、切完不残留中文。
   全程跑在 localhost:5180 上，先把 setLanguage 走一遍再刷新验证落库。 */
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://localhost:5180/';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars'],
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 1 }
});

const CJK = /[\u3400-\u9FFF]/;

async function open(langArg, locale) {
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': locale });
  await page.evaluateOnNewDocument(([l, sys]) => {
    try {
      if (l) localStorage.setItem('pl-lang', l);
      else localStorage.removeItem('pl-lang');
      Object.defineProperty(navigator, 'languages', { get: () => [sys, 'en'] });
      Object.defineProperty(navigator, 'language', { get: () => sys });
    } catch (e) {}
  }, [langArg, locale]);
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 500));
  return page;
}

const forceLang = async (page, l) => {
  await page.evaluate(async v => {
    const DB = await import('/js/db.js');
    await DB.setSetting('lang', v);
    try { localStorage.setItem('pl-lang', v); } catch (e) {}
  }, l);
  await page.reload({ waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 500));
};

const tabs = page => page.$$eval('.tab span', els => els.map(e => e.textContent.trim()));
const cjkIn = page => page.evaluate(reSrc => {
  const re = new RegExp(reSrc);
  const out = [];
  const active = document.querySelector('.view.active');
  if (!active) return out;
  const w = document.createTreeWalker(active, NodeFilter.SHOW_TEXT);
  let n = w.nextNode();
  while (n) {
    const el = n.parentElement;
    if (el && !el.closest('[data-no-i18n]') && !['SCRIPT', 'STYLE', 'TEXTAREA'].includes(el.tagName)) {
      const t = (n.nodeValue || '').trim();
      if (t && re.test(t)) out.push(t);
    }
    n = w.nextNode();
  }
  return out;
}, CJK.source);

/* 1. 系统是英文 + 没有手动选择 → 英文 */
{
  const p = await open(null, 'en-US');
  ok('系统英文时默认英文', (await tabs(p))[0] === 'Record', (await tabs(p)).join('/'));
  ok('html lang 跟着切', await p.evaluate(() => document.documentElement.lang) === 'en');
  await p.close();
}

/* 2. 系统是中文 + 没有手动选择 → 中文 */
{
  const p = await open(null, 'zh-CN');
  ok('系统中文时默认中文', (await tabs(p))[0] === '记账', (await tabs(p)).join('/'));
  await p.close();
}

/* 3. 系统是日文 → 英文（非中文一律英文） */
{
  const p = await open(null, 'ja-JP');
  ok('系统日文时回落英文', (await tabs(p))[0] === 'Record', (await tabs(p)).join('/'));
  await p.close();
}

/* 4. 手动切到英文 → 立即生效、写入 IndexedDB、刷新后保持 */
{
  const p = await open('zh', 'zh-CN');
  await forceLang(p, 'zh');
  await p.click('.tab[data-tab="settings"]');
  await new Promise(r => setTimeout(r, 400));
  const cards = await p.$$eval('.lang-card', els => els.map(e => e.dataset.lang));
  ok('设置页有语言选择器', cards.length === 3, cards.join(','));

  await p.click('.lang-card[data-lang="en"]');
  await new Promise(r => setTimeout(r, 600));
  ok('点英文后底栏立刻变英文', (await tabs(p))[0] === 'Record', (await tabs(p)).join('/'));

  const saved = await p.evaluate(async () => {
    const DB = await import('/js/db.js');
    return DB.getSetting('lang');
  });
  ok('语言选择写进了 IndexedDB', saved === 'en', String(saved));

  const left = await cjkIn(p);
  ok('设置页英文无残留中文', left.length === 0, left.slice(0, 3).join(' | '));

  await p.reload({ waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 500));
  ok('刷新后仍是英文', (await tabs(p))[0] === 'Record', (await tabs(p)).join('/'));

  /* 切回中文 */
  await p.click('.tab[data-tab="settings"]');
  await new Promise(r => setTimeout(r, 400));
  await p.click('.lang-card[data-lang="zh"]');
  await new Promise(r => setTimeout(r, 600));
  ok('切回中文立刻生效', (await tabs(p))[0] === '记账', (await tabs(p)).join('/'));
  await p.close();
}

/* 5. 英文下四个页面都不该有中文残留 */
{
  const p = await open('en', 'en-US');
  await forceLang(p, 'en');
  for (const [tab, name] of [['home', '记账'], ['list', '流水'], ['stats', '统计'], ['settings', '设置']]) {
    await p.click(`.tab[data-tab="${tab}"]`);
    await new Promise(r => setTimeout(r, 400));
    const left = await cjkIn(p);
    ok(`${name}页英文无残留`, left.length === 0, left.slice(0, 4).join(' | '));
  }
  /* 记账弹层 */
  await p.click('.tab[data-tab="home"]');
  await new Promise(r => setTimeout(r, 300));
  await p.click('#fab-add');
  await new Promise(r => setTimeout(r, 400));
  const sheetLeft = await p.evaluate(reSrc => {
    const re = new RegExp(reSrc);
    const sheet = document.querySelector('#sheet');
    const out = [];
    const w = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT);
    let n = w.nextNode();
    while (n) {
      const el = n.parentElement;
      if (el && !el.closest('[data-no-i18n]') && !['SCRIPT', 'STYLE', 'TEXTAREA'].includes(el.tagName)) {
        const t = (n.nodeValue || '').trim();
        if (t && re.test(t)) out.push(t);
      }
      n = w.nextNode();
    }
    return out;
  }, CJK.source);
  ok('记账弹层英文无残留', sheetLeft.length === 0, sheetLeft.slice(0, 4).join(' | '));
  await p.close();
}

const errors = [];
browser.on('targetcreated', () => {});
await browser.close();

console.log(`\n${fail === 0 ? '✅' : '❌'} 双语测试：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
