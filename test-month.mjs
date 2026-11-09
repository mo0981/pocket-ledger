/* 验证：统计页可以切换月份（前后月 / 月份选择 / 点柱状图跳月），首页金额同步 */
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
const mLabel = mk => `${mk.slice(0, 4)}年${+mk.slice(5, 7)}月`;
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

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

  /* 种数据：上月两笔、上上月一笔、当月一笔 */
  await page.evaluate(async ({ m1, m2, today }) => {
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
      { id: 'cur-a', type: 'expense', cents: 1500, cat: '餐饮', acct: '微信', date: today, note: '早饭', ts: 4, src: 'manual' }
    ];
    await new Promise((res, rej) => {
      const tx = db.transaction('tx', 'readwrite');
      const st = tx.objectStore('tx');
      rows.forEach(x => st.put(x));
      tx.oncomplete = res; tx.onerror = rej;
    });
  }, { m1: M1, m2: M2, today });

  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(600);

  const gotoStats = () => page.evaluate(() => {
    document.querySelector('.tab[data-tab="stats"]').click();
  });
  const statsMonth = () => page.$eval('#stats-month', el => el.textContent.trim());
  const pieCenter = () => page.evaluate(() => {
    const t = document.querySelectorAll('#pie svg text');
    return t.length ? t[1].textContent.trim() : '';
  });
  const legendNames = () => page.evaluate(() =>
    Array.from(document.querySelectorAll('.legend-name')).map(e => e.textContent.trim()));
  const homeExpense = () => page.$eval('#home-expense', el => el.textContent.trim());

  console.log('\n▸ 进入统计页（当月）');
  await gotoStats();
  await sleep(300);
  ok('统计页月份 = 当月', (await statsMonth()) === mLabel(CUR), await statsMonth());
  ok('环形图中心 = 当月支出 15.00', (await pieCenter()) === '15.00', await pieCenter());
  ok('当月只有 1 个分类', (await legendNames()).length === 1, (await legendNames()).join(','));
  ok('下个月按钮禁用（不能看未来）', await page.$eval('#stats-next', b => b.disabled));
  ok('上个月按钮可用', await page.$eval('#stats-prev', b => !b.disabled));

  console.log('\n▸ 点「上个月」');
  await page.click('#stats-prev');
  await sleep(300);
  ok('月份切到上月', (await statsMonth()) === mLabel(M1), await statsMonth());
  ok('上月支出 80.00', (await pieCenter()) === '80.00', await pieCenter());
  const g1 = await legendNames();
  ok('上月两类：餐饮 + 交通', g1.length === 2 && g1.includes('餐饮') && g1.includes('交通'), g1.join(','));
  ok('首页金额同步到上月', (await homeExpense()) === '¥80.00', await homeExpense());

  console.log('\n▸ 再点一次「上个月」');
  await page.click('#stats-prev');
  await sleep(300);
  ok('月份切到上上月', (await statsMonth()) === mLabel(M2), await statsMonth());
  ok('上上月支出 20.00', (await pieCenter()) === '20.00', await pieCenter());
  ok('下个月按钮恢复可用', await page.$eval('#stats-next', b => !b.disabled));

  console.log('\n▸ 点「下个月」回上月');
  await page.click('#stats-next');
  await sleep(300);
  ok('回到上月', (await statsMonth()) === mLabel(M1), await statsMonth());

  console.log('\n▸ 点柱状图（只查看，不切月）');
  const cols = await page.$$eval('#bars [data-mk]', els => els.map(e => e.dataset.mk));
  ok('十二根柱子都带月份标记', cols.length === 12, cols.join(','));
  ok('柱子月份覆盖到上月', cols.includes(M1), cols.join(','));
  await page.evaluate(mk => {
    const el = document.querySelector(`#bars [data-mk="${mk}"]`);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, M2);
  await sleep(300);
  // 点柱子不再直接改月份：否则连点左侧会沿时间轴一路往回退
  ok('点柱子本身不切月', (await statsMonth()) === mLabel(M1), await statsMonth());
  await page.evaluate(() => document.querySelector('#bars-tip [data-jump]').click());
  await sleep(400);
  ok('点「看这个月」切到上上月', (await statsMonth()) === mLabel(M2), await statsMonth());
  ok('当前月柱子高亮', await page.evaluate(() => {
    const gs = document.querySelectorAll('#bars .bar-col');
    const last = gs[gs.length - 1];
    if (!last) return false;
    // 柱子颜色现在跟皮肤走（fill="var(--brand)"），按当前主题实际解析出来的色比
    const bar = last.querySelectorAll('rect')[1];
    if (!bar) return false;
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim();
    const probe = document.createElement('div');
    probe.style.color = raw;
    document.body.appendChild(probe);
    const want = getComputedStyle(probe).color;
    probe.remove();
    return getComputedStyle(bar).fill === want;
  }));

  console.log('\n▸ 点月份标签（自绘选择面板）');
  // 旧实现用 input[type=month] + showPicker()，安卓 WebView 弹不出日历，
  // 所以改成自绘面板；这里断言面板能打开而不是原生控件被调用。
  const panel = await page.evaluate(() => {
    document.getElementById('stats-month').click();
    const mask = document.querySelector('#mp-mask');
    const open = !mask.hidden;
    const cells = document.querySelectorAll('.mp-cell').length;
    const nativeInputs = document.querySelectorAll('input[type="month"]').length;
    document.querySelector('#mp-close').click();
    return { open, cells, nativeInputs };
  });
  ok('点月份弹出选择面板', panel.open);
  ok('面板里铺满 12 个月', panel.cells === 12, String(panel.cells));
  ok('不再依赖 input[type=month]', panel.nativeInputs === 0);

  console.log('\n▸ 首页金额跟随月份');
  await page.evaluate(() => document.querySelector('.tab[data-tab="home"]').click());
  await sleep(250);
  ok('首页金额 = 上上月 20.00', (await homeExpense()) === '¥20.00', await homeExpense());

  await page.evaluate(() => document.querySelector('.tab[data-tab="stats"]').click());
  await sleep(200);
  await page.click('#stats-next');
  await sleep(300);
  await page.evaluate(() => document.querySelector('.tab[data-tab="home"]').click());
  await sleep(250);
  ok('点下个月后首页金额 = 80.00', (await homeExpense()) === '¥80.00', await homeExpense());

  await page.evaluate(() => document.querySelector('.tab[data-tab="stats"]').click());
  await sleep(200);
  await page.screenshot({ path: 'C:/Users/MO/WorkBuddy/2026-10-30-22-26-29/shots/stats-month.png' });

  ok('全程无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
