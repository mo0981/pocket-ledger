/* 验证：换肤功能（设置页选择器 / data-theme 落地 / 持久化 / 图表配色 / 不破版） */
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://localhost:5180/';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (n, c, x = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}${x ? ' — ' + x : ''}`); }
  else { fail++; console.log(`  ❌ ${n}${x ? ' — ' + x : ''}`); }
};

const KEYS = ['classic', 'ink', 'aurora', 'pop', 'term', 'cel'];

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
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

  // 塞几笔本月的账，统计页才有环形图可验证
  const now = new Date();
  const mk = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  await page.evaluate(async ({ mk }) => {
    const open = () => new Promise((res, rej) => {
      const r = indexedDB.open('pocket_ledger');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const db = await open();
    const rows = [
      { id: 'k1', type: 'expense', cents: 320000, cat: '居住', acct: '支付宝', date: mk + '-03', note: '房租', ts: 1, src: 'manual' },
      { id: 'k2', type: 'expense', cents: 12800, cat: '购物', acct: '支付宝', date: mk + '-04', note: '洗发水', ts: 2, src: 'manual' },
      { id: 'k3', type: 'expense', cents: 4500, cat: '娱乐', acct: '支付宝', date: mk + '-04', note: '电影票', ts: 3, src: 'manual' }
    ];
    await new Promise((res, rej) => {
      const tx = db.transaction('tx', 'readwrite');
      const st = tx.objectStore('tx');
      rows.forEach(x => st.put(x));
      tx.oncomplete = res; tx.onerror = rej;
    });
  }, { mk });
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(600);

  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  const cssVar = n => page.evaluate(k =>
    getComputedStyle(document.documentElement).getPropertyValue(k).trim(), n);
  const goTab = t => page.evaluate(n => document.querySelector(`.tab[data-tab="${n}"]`).click(), t);
  const pick = k => page.evaluate(kk => document.querySelector(`[data-skin="${kk}"]`).click(), k);
  const cards = () => page.$$eval('[data-skin]', els => els.map(e => ({
    k: e.dataset.skin,
    on: e.classList.contains('on'),
    name: e.querySelector('.skin-name').textContent.trim()
  })));

  console.log('\n▸ 设置页外观区');
  await goTab('settings');
  await sleep(350);
  const c0 = await cards();
  ok('有 6 个皮肤选项', c0.length === 6, c0.map(c => c.name).join(' / '));
  ok('皮肤键齐全', KEYS.every(k => c0.some(c => c.k === k)));
  ok('默认选中「标准绿」', c0.find(c => c.on)?.k === 'classic');
  ok('每个选项都有缩略图', await page.$$eval('[data-skin] .skin-thumb', e => e.length) === 6);
  ok('缩略图带着四色变量', await page.$eval('[data-skin="ink"] .skin-thumb',
    e => e.getAttribute('style').includes('--s-bg')));
  ok('右上角提示当前风格', (await page.$eval('#skin-hint', e => e.textContent.trim())).length > 0);

  console.log('\n▸ 切到墨韵');
  const bgBefore = await cssVar('--bg');
  await pick('ink');
  await sleep(400);
  ok('html 上的 data-theme 变成 ink', (await theme()) === 'ink', await theme());
  ok('--bg 换成了纸白', (await cssVar('--bg')) === '#FBFAF7', await cssVar('--bg'));
  ok('--bg 确实变了', bgBefore !== (await cssVar('--bg')));
  ok('选中态跟着走到墨韵', (await cards()).find(c => c.on)?.k === 'ink');
  ok('其余选项没有残留选中态', (await cards()).filter(c => c.on).length === 1);
  ok('状态栏色同步成纸白', await page.$eval('meta[name="theme-color"]',
    e => e.getAttribute('content') === '#FBFAF7'));
  ok('body 背景真的变浅了', await page.evaluate(() =>
    getComputedStyle(document.body).backgroundColor === 'rgb(251, 250, 247)'));

  console.log('\n▸ 落库与本地副本');
  const inDb = await page.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('pocket_ledger');
    r.onsuccess = () => {
      const db = r.result;
      const q = db.transaction('settings').objectStore('settings').get('theme');
      q.onsuccess = () => res(q.result ? q.result.v : null);
      q.onerror = () => rej(q.error);
    };
    r.onerror = () => rej(r.error);
  }));
  ok('写入 IndexedDB settings.theme', inDb === 'ink', String(inDb));
  ok('同时写了 localStorage 副本', await page.evaluate(() => localStorage.getItem('pl-theme')) === 'ink');

  console.log('\n▸ 刷新后保持');
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(600);
  ok('刷新后仍是墨韵', (await theme()) === 'ink', await theme());
  ok('首屏 theme-color 也是纸白', await page.$eval('meta[name="theme-color"]',
    e => e.getAttribute('content') === '#FBFAF7'));

  console.log('\n▸ 六套逐个切换');
  await goTab('settings');
  await sleep(300);
  const seen = {};
  for (const k of KEYS) {
    await pick(k);
    await sleep(320);
    seen[k] = {
      t: await theme(),
      bg: await cssVar('--bg'),
      txt: await cssVar('--text')
    };
  }
  ok('六套 data-theme 全部落地', KEYS.every(k => seen[k].t === k),
    KEYS.map(k => seen[k].t).join(','));
  const bgs = new Set(Object.values(seen).map(v => v.bg));
  ok('六套背景色互不相同', bgs.size === 6, `${bgs.size} 种：${[...bgs].join(' ')}`);
  ok('深色主题文字是浅色', seen.aurora.txt.toUpperCase() === '#EEF2F7' && seen.term.txt.toUpperCase() === '#C8D4E2');
  await pick('pop');
  await sleep(320);
  // 发送按钮空输入时是禁用态（走卡片底），这里先塞一个字让它变成可点的实心块。
  // 用赋值 + input 事件，而不是 page.type —— 此时页面停在设置页，首页输入框不可见，打字打不进去。
  await page.evaluate(() => {
    const i = document.querySelector('#ai-input');
    i.value = '测试'; i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(200);
  ok('纸糖的实心块是黄底黑字',
    await page.evaluate(() => {
      const a = getComputedStyle(document.querySelector('.ai-go'));
      return a.backgroundColor === 'rgb(255, 216, 77)' && a.color === 'rgb(23, 19, 15)';
    }));
  await page.evaluate(() => {
    const i = document.querySelector('#ai-input');
    i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true }));
  });

  console.log('\n▸ 底栏图标跟随风格');
  await pick('ink'); await sleep(300);
  const inkIcon = await page.$eval('.tab svg', e => getComputedStyle(e).strokeWidth);
  await pick('pop'); await sleep(300);
  const popIcon = await page.$eval('.tab svg', e => getComputedStyle(e).strokeWidth);
  ok('墨韵图标线更细', parseFloat(inkIcon) < 1.4, inkIcon);
  ok('纸糖图标线更粗', parseFloat(popIcon) > 2.2, popIcon);
  ok('两者线宽不同', inkIcon !== popIcon, `${inkIcon} vs ${popIcon}`);

  console.log('\n▸ 图表配色跟着换');
  await pick('classic'); await sleep(300);
  await goTab('stats'); await sleep(450);
  const classicArc = await page.$eval('.pie-arc', e => e.getAttribute('stroke'));
  await goTab('settings'); await sleep(250);
  await pick('ink'); await sleep(300);
  await goTab('stats'); await sleep(450);
  const inkArc = await page.$eval('.pie-arc', e => e.getAttribute('stroke'));
  ok('经典绿首色是深绿', classicArc === '#0F6E56', classicArc);
  ok('墨韵首色换成墨黑', inkArc === '#1A1A18', inkArc);
  ok('两套饼图配色不同', classicArc !== inkArc);

  console.log('\n▸ 各套都不破版');
  const overflows = [];
  for (const k of KEYS) {
    await goTab('settings'); await sleep(200);
    await pick(k); await sleep(260);
    for (const tab of ['home', 'list', 'stats', 'settings']) {
      await goTab(tab); await sleep(260);
      const o = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (o > 0) overflows.push(`${k}/${tab}:${o}px`);
    }
  }
  ok('六套 × 四页均无横向溢出', overflows.length === 0, overflows.join(', ') || '全部 0');

  console.log('\n▸ 备份带上皮肤');
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[data-skin]')].find(e => e.dataset.skin === 'cel');
    b.click();
  });
  await sleep(350);
  const payloadTheme = await page.evaluate(() => {
    const s = document.querySelector('#skin-hint');
    return s.textContent.trim();
  });
  ok('切到青瓷后提示同步', payloadTheme === '宣纸釉色', payloadTheme);

  console.log('\n▸ 无报错');
  ok('控制台无 error', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log(`\n${fail === 0 ? '✅' : '❌'} 换肤测试：${pass} 通过 / ${fail} 失败`);
} finally {
  await browser.close();
}
process.exit(fail ? 1 : 0);
