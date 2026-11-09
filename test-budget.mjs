/* 预算功能的回归测试
   覆盖：未设预算的引导、总预算与分类预算的录入、超支判定与标记、
   持久化、币种隔离、边界输入、备份导出导入、六套皮肤下的呈现。 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

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
const MK = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;

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
  await page.setBypassServiceWorker(true);
  page.on('dialog', d => d.accept());   // 导入会确认覆盖，headless 下要自动接受

  await page.goto(URL, { waitUntil: 'networkidle0' });
  await sleep(600);

  /* 一批美元流水：餐饮 49.50 / 购物 120 / 交通 15 / 工资 5000（收入） */
  await page.evaluate(async ({ mk }) => {
    const open = () => new Promise((res, rej) => {
      const r = indexedDB.open('pocket_ledger');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const db = await open();
    const rows = [
      ['餐饮', 1250, '午饭', 1], ['餐饮', 2800, '晚饭', 2], ['餐饮', 900, '早餐', 3],
      ['购物', 12000, '外套', 4], ['交通', 1500, '打车', 5], ['工资', 500000, '月薪', 6]
    ];
    const tx = db.transaction(['tx', 'settings'], 'readwrite');
    const st = tx.objectStore('tx');
    rows.forEach(([cat, cents, note, i]) => st.put({
      id: 't' + i, type: cat === '工资' ? 'income' : 'expense', cents, cat,
      acct: '银行卡', date: `${mk}-0${Math.min(i, 9)}`, note, ts: i, src: 'manual', cur: 'USD'
    }));
    tx.objectStore('settings').put({ k: 'mainCur', v: 'USD' });
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  }, { mk: MK });
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(800);

  const go = t => page.evaluate(n => document.querySelector(`.tab[data-tab="${n}"]`).click(), t);
  const txt = sel => page.$eval(sel, e => e.textContent.replace(/\s+/g, ' ').trim());
  const readBudget = () => page.evaluate(async () => {
    const open = () => new Promise((res, rej) => {
      const r = indexedDB.open('pocket_ledger');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const db = await open();
    const row = await new Promise((res, rej) => {
      const r = db.transaction('settings').objectStore('settings').get('budget');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return row ? row.v : null;
  });

  /* 直接改值 + 触发 input，再失焦落盘（等价于用户输入后点到别处） */
  async function fillBudget(sel, val) {
    await page.evaluate((s, v) => {
      const el = document.querySelector(s);
      if (!el) return;
      el.focus();
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, sel, val);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await sleep(700);
  }

  console.log('\n▸ 未设预算时');
  const empty = await txt('#home-budget');
  ok('首页给出设置预算的引导', empty.includes('设个本月预算'), empty);
  ok('引导行带跳转标记', await page.$eval('#home-budget', e => !!e.querySelector('[data-goto-budget]')));
  await go('stats');
  await sleep(600);
  ok('统计页空态提示', (await txt('#budget-box')).includes('还没设预算'));
  await go('settings');
  await sleep(500);
  ok('设置页总预算输入为空', (await page.$eval('#bud-total', e => e.value)) === '');
  const rowCount = await page.$$eval('#bud-cats .bud-row', els => els.length);
  ok('分类预算列出全部支出分类', rowCount === 10, String(rowCount));

  console.log('\n▸ 录入总预算');
  await fillBudget('#bud-total', '300');
  let b = await readBudget();
  ok('总预算写入 30000 分', b && b.total && b.total.USD === 30000, JSON.stringify(b));
  await go('home');
  await sleep(500);
  const h1 = await txt('#home-budget');
  ok('首页出现预算卡', h1.includes('本月预算'), h1);
  ok('剩余额度正确（300-184.50）', h1.includes('还剩 US$115.50'), h1);
  ok('已花 / 预算展示正确', h1.includes('US$184.50 / US$300.00'), h1);
  ok('算出日均可用', h1.includes('日均可用'), h1);
  const bar1 = await page.$eval('#home-budget .bud-bar i', e => e.style.width);
  // 宽度现在可能是 max(6px,61.5%) —— 极小占比时给最小可见宽度，这里只取百分比部分比对
  const pct1 = (bar1.match(/([\d.]+)%/) || [])[1];
  ok('进度条 61.5%', pct1 === '61.5', bar1);
  ok('未超支不标红', !(await page.$eval('#home-budget .bud-bar', e => e.classList.contains('over'))));
  await go('settings');
  await sleep(500);
  ok('回到设置页金额被回填', (await page.$eval('#bud-total', e => e.value)) === '300');

  console.log('\n▸ 录入分类预算');
  await fillBudget('[data-budcat="餐饮"]', '40');
  await fillBudget('[data-budcat="购物"]', '80');
  b = await readBudget();
  ok('餐饮预算 4000 分', b && b.cats && b.cats['餐饮'] && b.cats['餐饮'].USD === 4000,
    JSON.stringify(b && b.cats));
  ok('购物预算 8000 分', b && b.cats && b.cats['购物'] && b.cats['购物'].USD === 8000);
  ok('总预算未被分类输入覆盖', b && b.total.USD === 30000);

  await go('stats');
  await sleep(700);
  const srows = await page.$$eval('#budget-box .bud-cat', els => els.map(r => ({
    name: r.querySelector('.bud-cat-name').textContent.replace(/\s+/g, ' ').trim(),
    num: r.querySelector('.bud-cat-num').textContent.trim(),
    over: r.querySelector('.bud-cat-num').classList.contains('over'),
    cls: r.querySelector('.bud-bar').className
  })));
  ok('统计页三行：总预算 + 两个分类', srows.length === 3, JSON.stringify(srows.map(r => r.name)));
  ok('总预算行金额正确', srows[0].num === 'US$184.50 / US$300.00', srows[0].num);
  ok('购物超支标红', srows.some(r => r.name.startsWith('购物') && r.over));
  ok('购物超支幅度 50%', srows.some(r => r.name.includes('购物') && r.name.includes('超 50%')),
    srows.map(r => r.name).join('|'));
  ok('餐饮超支幅度 24%', srows.some(r => r.name.includes('餐饮') && r.name.includes('超 24%')));
  ok('超支行进度条拉满并标记 over',
    srows.filter(r => r.over).every(r => r.cls.includes('over')));

  await go('home');
  await sleep(500);
  const alert = await page.$eval('#home-budget', e => {
    const a = e.querySelector('.bud-alert');
    return a ? a.textContent.replace(/\s+/g, ' ').trim() : '';
  });
  ok('首页提示购物超支金额', alert.includes('购物超 US$40.00'), alert);
  ok('首页提示餐饮超支金额', alert.includes('餐饮超 US$9.50'), alert);

  console.log('\n▸ 持久化');
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(900);
  const h2 = await txt('#home-budget');
  ok('刷新后预算卡还在', h2.includes('本月预算') && h2.includes('US$115.50'), h2);
  await go('settings');
  await sleep(500);
  ok('刷新后设置页仍有分类预算',
    (await page.$eval('[data-budcat="餐饮"]', e => e.value)) === '40');

  console.log('\n▸ 总预算超支');
  await fillBudget('#bud-total', '100');
  await go('home');
  await sleep(500);
  const h3 = await txt('#home-budget');
  ok('显示超支而不是剩余', h3.includes('超支 US$84.50'), h3);
  ok('超支时进度条标记 over', await page.$eval('#home-budget .bud-bar', e => e.classList.contains('over')));
  ok('超支时改用已用百分比', /已用 \d+%/.test(h3), h3);
  await go('stats');
  await sleep(700);
  const overHead = await page.$$eval('#budget-box .bud-cat-name', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  ok('统计页总预算行标注超支幅度', overHead[0].includes('超 85%'), overHead[0]);

  console.log('\n▸ 边界输入');
  await go('settings');
  await sleep(400);
  await fillBudget('#bud-total', '12.5');
  b = await readBudget();
  ok('小数元换算成 1250 分', b && b.total.USD === 1250, JSON.stringify(b && b.total));
  await fillBudget('#bud-total', '0');
  b = await readBudget();
  ok('填 0 等于取消限制', b && !b.total.USD, JSON.stringify(b && b.total));
  await go('home');
  await sleep(400);
  ok('取消总预算后回到引导行', (await txt('#home-budget')).includes('设个本月预算'));

  await go('settings');
  await sleep(400);
  await fillBudget('[data-budcat="购物"]', '');
  b = await readBudget();
  ok('清空分类预算后从结构里移除', b && !b.cats['购物'], JSON.stringify(b && b.cats));
  await go('stats');
  await sleep(700);
  const left = await page.$$eval('#budget-box .bud-cat', els => els.length);
  ok('统计页只剩餐饮一行', left === 1, String(left));

  console.log('\n▸ 币种隔离');
  await go('settings');
  await sleep(400);
  await fillBudget('#bud-total', '300');   // 前面测「填 0 取消」时清掉了，先设回来
  await page.select('#set-cur', 'CNY');
  await sleep(800);
  ok('切到人民币后总预算为空', (await page.$eval('#bud-total', e => e.value)) === '');
  ok('切到人民币后分类预算为空', (await page.$eval('[data-budcat="餐饮"]', e => e.value)) === '');
  await go('home');
  await sleep(500);
  ok('人民币下首页是引导行', (await txt('#home-budget')).includes('设个本月预算'));

  // 加一笔人民币支出，不能算进美元预算
  await page.evaluate(async ({ mk }) => {
    const open = () => new Promise((res, rej) => {
      const r = indexedDB.open('pocket_ledger');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const db = await open();
    const tx = db.transaction('tx', 'readwrite');
    tx.objectStore('tx').put({
      id: 'cny1', type: 'expense', cents: 99900, cat: '餐饮', acct: '银行卡',
      date: `${mk}-08`, note: '人民币开销', ts: 99, src: 'manual'
    });
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  }, { mk: MK });

  await go('settings');
  await sleep(400);
  await page.select('#set-cur', 'USD');
  await sleep(800);
  ok('切回美元后预算恢复', (await page.$eval('[data-budcat="餐饮"]', e => e.value)) === '40');
  await go('home');
  await sleep(500);
  const h4 = await txt('#home-budget');
  ok('人民币支出没被算进美元已花', h4.includes('US$184.50 / US$300.00'), h4);

  console.log('\n▸ 备份导出 / 导入');
  await page.evaluate(() => {
    window.__blob = null;
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => { window.__blob = blob; return orig(blob); };
  });
  await go('settings');
  await sleep(400);
  await page.click('#export-btn');
  await sleep(800);
  const exported = await page.evaluate(async () => {
    if (!window.__blob) return null;
    return await window.__blob.text();
  });
  let payload = null;
  try { payload = JSON.parse(exported); } catch (e) { /* 留空 */ }
  ok('导出文件能被解析成 JSON', !!payload);
  ok('导出里带上了预算', !!(payload && payload.settings && payload.settings.budget),
    JSON.stringify(payload && payload.settings && payload.settings.budget));

  const importPath = 'C:/Users/MO/WorkBuddy/2026-10-30-22-26-29/pocket-ledger/_tmp-import.json';
  fs.writeFileSync(importPath, exported, 'utf8');

  // 先把预算清空，再从备份恢复
  await fillBudget('#bud-total', '0');
  await fillBudget('[data-budcat="餐饮"]', '');
  b = await readBudget();
  ok('清空后结构为空', b && !b.total.USD && !b.cats['餐饮'], JSON.stringify(b));

  const input = await page.$('#import-file');
  await input.uploadFile(importPath);
  await sleep(1600);
  b = await readBudget();
  ok('导入后总预算恢复', b && b.total.USD === 30000, JSON.stringify(b && b.total));
  ok('导入后分类预算恢复', b && b.cats['餐饮'] && b.cats['餐饮'].USD === 4000);
  await go('home');
  await sleep(600);
  ok('导入后首页立即生效', (await txt('#home-budget')).includes('US$115.50'));
  fs.unlinkSync(importPath);

  console.log('\n▸ 皮肤下的呈现');
  const skins = ['classic', 'ink', 'aurora', 'pop', 'term', 'cel'];
  const looks = [];
  for (const k of skins) {
    await go('settings');
    await sleep(300);
    await page.evaluate(kk => {
      const el = document.querySelector(`[data-skin="${kk}"]`);
      if (el) el.click();
    }, k);
    await sleep(450);
    await go('home');
    await sleep(400);
    looks.push(await page.evaluate(() => {
      const card = document.querySelector('#home-budget');
      const bar = card.querySelector('.bud-bar i');
      const alert = card.querySelector('.bud-alert');
      const cs = getComputedStyle(card);
      return {
        theme: document.documentElement.dataset.theme,
        bg: cs.backgroundColor,
        border: cs.borderTopWidth,
        barColor: getComputedStyle(bar).backgroundColor,
        alertColor: alert ? getComputedStyle(alert).color : '',
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        hasBar: !!bar
      };
    }));
  }
  ok('六套皮肤都渲染出进度条', looks.every(l => l.hasBar), JSON.stringify(looks.map(l => l.theme)));
  // 纸糖与标准绿都是白底（纸糖靠黑描边区分），所以看「至少 5 种底色 + 纸糖有描边」
  ok('六套皮肤底色至少 5 种', new Set(looks.map(l => l.bg)).size >= 5,
    JSON.stringify([...new Set(looks.map(l => l.bg))]));
  const pop = looks.find(l => l.theme === 'pop');
  ok('纸糖给预算卡加了黑描边', pop && parseFloat(pop.border) >= 2, pop && pop.border);
  const classic = looks.find(l => l.theme === 'classic');
  // 默认主题的 --card-border 是 1px transparent（占位不显色），所以比纸糖细就行
  ok('标准绿是无框的细边', classic && parseFloat(classic.border) < 2, classic && classic.border);
  const aurora = looks.find(l => l.theme === 'aurora');
  ok('深色皮肤下卡片是深色（不是白块）',
    aurora && aurora.bg !== 'rgb(255, 255, 255)', aurora && aurora.bg);
  const ink = looks.find(l => l.theme === 'ink');
  ok('墨韵的超支提示用朱红而非墨色',
    ink && ink.alertColor === 'rgb(179, 58, 43)', ink && ink.alertColor);
  ok('六套皮肤都没有横向溢出', looks.every(l => l.overflow <= 0),
    JSON.stringify(looks.map(l => l.overflow)));

  // 还原默认皮肤，避免影响后续手工使用
  await go('settings');
  await sleep(300);
  await page.evaluate(() => {
    const el = document.querySelector('[data-skin="classic"]');
    if (el) el.click();
  });
  await sleep(400);

  ok('全程无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
