/* 验证两个真机 bug 的修复：
   1) 首页月份胶囊点不动 —— 原来是 <input type="month"> + showPicker()，
      安卓 WebView 把 month 降级成文本框，弹不出日历。现在改成自绘面板。
   2) 柱状图连点左侧会沿时间轴无限往回退 —— 原来点一下柱子就改 state.month，
      图整体位移一格，连点等于一路退到 2016 年。现在点柱只查看，滑动负责翻时间轴。 */
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
const M0 = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
const monthAt = delta => {
  const d = new Date(now.getFullYear(), now.getMonth() + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

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

  // 造跨年数据，最近 12 个月里几个有支出
  await page.evaluate(async () => {
    const open = () => new Promise((res, rej) => {
      const r = indexedDB.open('pocket_ledger');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const db = await open();
    const rows = [
      ['2025-12', 3200, '餐饮'], ['2025-12', 8800, '购物'],
      ['2026-01', 4500, '交通'],
      ['2026-03', 12000, '居住'], ['2026-03', 2600, '餐饮'],
      ['2026-06', 6400, '购物'],
      ['2026-09', 5200, '餐饮'],
      ['2026-10', 2850, '餐饮'], ['2026-10', 4500, '娱乐']
    ];
    const tx = db.transaction('tx', 'readwrite');
    const st = tx.objectStore('tx');
    rows.forEach(([date, cents, cat], i) => st.put({
      id: 'n' + i, type: 'expense', cents, cat, acct: '银行卡', date,
      note: cat, ts: i + 1, src: 'manual', cur: 'USD'
    }));
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
    db.transaction('settings', 'readwrite').objectStore('settings')
      .put({ k: 'mainCur', v: 'USD' });
    // 记录日期也补几笔，方便验证面板上的圆点
    const tx2 = db.transaction('tx', 'readwrite').objectStore('tx');
    const t2 = new Date();
    tx2.put({
      id: 'ncur', type: 'expense', cents: 647, cat: '餐饮', acct: '银行卡',
      date: `${t2.getFullYear()}-${String(t2.getMonth() + 1).padStart(2, '0')}-01`,
      note: '本月', ts: 99, src: 'manual', cur: 'USD'
    });
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(800);

  /* ---------------- bug 1：月份选择面板 ---------------- */
  console.log('\n▸ 首页月份胶囊');
  ok('页面里已没有 input[type=month]（安卓不支持的根源）',
    await page.evaluate(() => document.querySelectorAll('input[type="month"]').length === 0));
  ok('面板初始是关闭的',
    await page.$eval('#mp-mask', e => e.hidden));

  await page.click('#home-month-btn');
  await sleep(400);
  ok('点胶囊能打开面板', !(await page.$eval('#mp-mask', e => e.hidden)));
  ok('年份标题是今年',
    (await page.$eval('#mp-year', e => e.textContent.trim())) === `${now.getFullYear()}年`);
  ok('铺满 12 个月', (await page.$$eval('.mp-cell', els => els.length)) === 12);
  ok('当前月份高亮',
    (await page.$$eval('.mp-cell.on', els => els.map(e => e.dataset.mk))).join() === M0);
  ok('当前年不能再往后翻',
    await page.$eval('#mp-next', e => e.disabled));

  const futureCells = await page.$$eval('.mp-cell', els =>
    els.filter(e => e.disabled).map(e => e.dataset.mk));
  ok('未来月份被禁用', futureCells.every(mk => mk > M0), futureCells.join(','));

  const dotted = await page.$$eval('.mp-cell.has', els => els.map(e => e.dataset.mk));
  ok('有流水的月份带圆点', dotted.length > 0 && dotted.includes('2026-09'), dotted.join(','));

  const sep = monthAt(-2);
  await page.evaluate(mk => document.querySelector(`.mp-cell[data-mk="${mk}"]`).click(), sep);
  await sleep(500);
  ok('选月份后面板自动关闭', await page.$eval('#mp-mask', e => e.hidden));
  ok('首页月份跟着变',
    (await page.$eval('#home-month', e => e.textContent.trim())) ===
    `${sep.slice(0, 4)}年${Number(sep.slice(5, 7))}月`);

  // 翻到上一年，选 12 月
  await page.click('#home-month-btn');
  await sleep(300);
  await page.click('#mp-prev');
  await sleep(250);
  ok('能翻到上一年',
    (await page.$eval('#mp-year', e => e.textContent.trim())) === `${now.getFullYear() - 1}年`);
  ok('上一年 12 月可选',
    !(await page.$eval(`.mp-cell[data-mk="${now.getFullYear() - 1}-12"]`, e => e.disabled)));
  await page.evaluate(y => document.querySelector(`.mp-cell[data-mk="${y}-12"]`).click(),
    now.getFullYear() - 1);
  await sleep(450);
  ok('能选到去年 12 月',
    (await page.$eval('#home-month', e => e.textContent.trim())) === `${now.getFullYear() - 1}年12月`);

  // 关闭按钮
  await page.click('#home-month-btn');
  await sleep(300);
  await page.click('#mp-close');
  await sleep(250);
  ok('✕ 能关掉面板', await page.$eval('#mp-mask', e => e.hidden));
  ok('关掉后月份没被改',
    (await page.$eval('#home-month', e => e.textContent.trim())) === `${now.getFullYear() - 1}年12月`);

  // 点遮罩关闭
  await page.click('#home-month-btn');
  await sleep(300);
  await page.evaluate(() => {
    const m = document.querySelector('#mp-mask');
    m.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await sleep(250);
  ok('点遮罩能关掉面板', await page.$eval('#mp-mask', e => e.hidden));

  // 统计页的月份按钮同样走这个面板
  await page.evaluate(() => document.querySelector('.tab[data-tab="stats"]').click());
  await sleep(600);
  await page.click('#stats-month');
  await sleep(350);
  ok('统计页点月份也打开同一个面板',
    !(await page.$eval('#mp-mask', e => e.hidden)));
  await page.click('#mp-close');
  await sleep(250);

  /* ---------------- bug 2：柱状图滑动 ---------------- */
  console.log('\n▸ 柱状图滑动');
  // 回到本月，让数据落在可视范围
  await page.evaluate(() => {
    const cells = document.querySelectorAll('.mp-cell');
  });
  const bars = await page.evaluate(() => {
    const sc = document.querySelector('#bars-scroll');
    return {
      exists: !!sc,
      cols: document.querySelectorAll('#bars .bar-col').length,
      scrollW: sc ? Math.round(sc.scrollWidth) : 0,
      clientW: sc ? Math.round(sc.clientWidth) : 0,
      max: sc ? Math.round(sc.scrollWidth - sc.clientWidth) : 0
    };
  });
  ok('柱状图有独立滚动容器', bars.exists);
  ok('渲染 12 个月', bars.cols === 12, `${bars.cols} 根`);
  ok('内容宽于一屏，可滑动', bars.scrollW > bars.clientW + 10,
    `${bars.scrollW} > ${bars.clientW}`);

  await page.evaluate(() => document.querySelector('#bars').scrollIntoView({ block: 'center' }));
  await sleep(400);

  const startLeft = await page.$eval('#bars-scroll', e => Math.round(e.scrollLeft));
  ok('默认停在最右（最近的月份）', Math.abs(startLeft - bars.max) <= 2,
    `${startLeft} / max ${bars.max}`);

  // 鼠标按住往右拖 -> 看更早的月份
  const pt = await page.evaluate(() => {
    const r = document.querySelector('#bars-scroll').getBoundingClientRect();
    return { x: r.left + 24, y: r.top + r.height / 2 };
  });
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  for (let i = 1; i <= 9; i++) { await page.mouse.move(pt.x + i * 16, pt.y); await sleep(18); }
  await page.mouse.up();
  await sleep(400);
  const afterDrag = await page.$eval('#bars-scroll', e => Math.round(e.scrollLeft));
  ok('按住拖动可以左右滑', afterDrag < startLeft - 60, `${startLeft} → ${afterDrag}`);

  // 拖动不算点击
  ok('拖完不会误当成点柱子',
    await page.$eval('#bars-tip', e => !e.innerHTML.includes('bars-jump')));

  // 点柱子：不改月份，只出提示
  const monthBefore = await page.$eval('#stats-month', e => e.textContent.trim());
  await page.evaluate(() => {
    const cols = [...document.querySelectorAll('#bars .bar-col')];
    const vis = cols.find(c => {
      const r = c.getBoundingClientRect();
      const sc = document.querySelector('#bars-scroll').getBoundingClientRect();
      return Number(c.dataset.val) > 0 && r.left > sc.left + 24 && r.right < sc.right - 24;
    });
    (vis || cols[0]).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await sleep(400);
  ok('点柱子不再改月份',
    (await page.$eval('#stats-month', e => e.textContent.trim())) === monthBefore);
  ok('点柱子给出金额和切月入口',
    await page.$eval('#bars-tip', e => e.innerHTML.includes('data-jump')));
  ok('被点中的柱子有选中态',
    (await page.$$eval('#bars .bar-col.sel', els => els.length)) === 1);

  // 连点左侧（原来会一路退到 2016 年）
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => {
      const cols = [...document.querySelectorAll('#bars .bar-col')];
      (cols[2] || cols[0]).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await sleep(90);
  }
  ok('连点左侧 8 次，月份纹丝不动',
    (await page.$eval('#stats-month', e => e.textContent.trim())) === monthBefore, monthBefore);

  // 点「看这个月」才真的切
  const jumpMk = await page.$eval('#bars-tip [data-jump]', e => e.dataset.jump);
  await page.evaluate(() => document.querySelector('#bars-tip [data-jump]').click());
  await sleep(600);
  const wantLabel = `${jumpMk.slice(0, 4)}年${Number(jumpMk.slice(5, 7))}月`;
  ok('点「看这个月」才切月',
    (await page.$eval('#stats-month', e => e.textContent.trim())) === wantLabel, wantLabel);
  ok('首页月份同步过去',
    (await page.$eval('#home-month', e => e.textContent.trim())) === wantLabel);

  // 重渲染后滚动位置保留
  await page.evaluate(() => document.querySelector('#bars').scrollIntoView({ block: 'center' }));
  await sleep(300);
  await page.evaluate(() => document.querySelector('#bars-scroll').scrollLeft = 100);
  await sleep(300);
  await page.evaluate(() => document.querySelector('.tab[data-tab="home"]').click());
  await sleep(300);
  await page.evaluate(() => document.querySelector('.tab[data-tab="stats"]').click());
  await sleep(600);
  const keptLeft = await page.$eval('#bars-scroll', e => Math.round(e.scrollLeft));
  ok('来回切页后滚动位置还在', Math.abs(keptLeft - 100) <= 3, String(keptLeft));

  // 五个界面宽度都不该被撑破
  for (const t of ['home', 'list', 'stats', 'settings']) {
    await page.evaluate(k => document.querySelector(`.tab[data-tab="${k}"]`).click(), t);
    await sleep(350);
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(`${t} 页无横向溢出`, over <= 0, `溢出 ${over}px`);
  }

  ok('全程无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
