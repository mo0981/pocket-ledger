/* 验证：环形图点扇区/图例展开明细、点圆心取消、明细跳流水、柱状图点柱切月、固定扣款跳转 */
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
const M0 = today.slice(0, 7);
const monthAt = delta => {
  const d = new Date(now.getFullYear(), now.getMonth() + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const M1 = monthAt(-1), M2 = monthAt(-2), M3 = monthAt(-3);

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

  /* 当月：餐饮 3 笔 60 元、交通 2 笔 20 元、购物 1 笔 20 元，另有美元 1 笔不计入
     前三个月各一笔「房租」，用来触发固定扣款 */
  await page.evaluate(async ({ today, M1, M2, M3 }) => {
    const open = () => new Promise((res, rej) => {
      const r = indexedDB.open('pocket_ledger');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const db = await open();
    const rows = [
      { id: 'c1', type: 'expense', cents: 3000, cat: '餐饮', acct: '微信', date: today, note: '食堂', ts: 9 },
      { id: 'c2', type: 'expense', cents: 2000, cat: '餐饮', acct: '微信', date: today, note: '咖啡', ts: 8 },
      { id: 'c3', type: 'expense', cents: 1000, cat: '餐饮', acct: '支付宝', date: today, note: '外卖', ts: 7 },
      { id: 't1', type: 'expense', cents: 1500, cat: '交通', acct: '微信', date: today, note: '地铁', ts: 6 },
      { id: 't2', type: 'expense', cents: 500, cat: '交通', acct: '微信', date: today, note: '打车', ts: 5 },
      { id: 's1', type: 'expense', cents: 2000, cat: '购物', acct: '支付宝', date: today, note: '超市', ts: 4 },
      { id: 'u1', type: 'expense', cents: 1200, cat: '餐饮', acct: '银行卡', cur: 'USD', date: today, note: 'blue bottle', ts: 3 },
      { id: 'r1', type: 'expense', cents: 2000, cat: '居住', acct: '银行卡', date: `${M1}-10`, note: '房租', ts: 3 },
      { id: 'r2', type: 'expense', cents: 2000, cat: '居住', acct: '银行卡', date: `${M2}-10`, note: '房租', ts: 2 },
      { id: 'r3', type: 'expense', cents: 2000, cat: '居住', acct: '银行卡', date: `${M3}-10`, note: '房租', ts: 1 }
    ];
    await new Promise((res, rej) => {
      const tx = db.transaction('tx', 'readwrite');
      const st = tx.objectStore('tx');
      rows.forEach(x => st.put(x));
      tx.oncomplete = res; tx.onerror = rej;
    });
  }, { today, M1, M2, M3 });

  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(700);

  const gotoStats = () => page.evaluate(() => document.querySelector('.tab[data-tab="stats"]').click());
  const pieState = () => page.evaluate(() => ({
    arcs: Array.from(document.querySelectorAll('#pie .pie-arc')).map(e => e.dataset.cat),
    legends: Array.from(document.querySelectorAll('#pie .legend-row')).map(e => e.dataset.cat),
    onArc: document.querySelector('#pie .pie-arc.on')?.dataset.cat || '',
    dimArcs: document.querySelectorAll('#pie .pie-arc.dim').length,
    onLegend: document.querySelector('#pie .legend-row.on')?.dataset.cat || '',
    texts: Array.from(document.querySelectorAll('#pie svg text')).map(e => e.textContent.trim()),
    detailHidden: document.getElementById('pie-detail').hidden,
    detailText: document.getElementById('pie-detail').innerText.replace(/\n/g, ' | ').trim(),
    detailRows: document.querySelectorAll('#pie-detail .tx-item').length,
    tipHidden: document.getElementById('pie-tip').hidden
  }));
  const clickCat = cat => page.evaluate(c => {
    const el = document.querySelector(`#pie .legend-row[data-cat="${c}"]`);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, cat);
  const toastText = () => page.evaluate(() => {
    const t = document.getElementById('toast');
    return t && !t.hidden ? t.textContent.trim() : '';
  });

  console.log('\n▸ 初始状态');
  await gotoStats();
  await sleep(350);
  let s = await pieState();
  ok('三个扇区都带分类标记', s.arcs.join(',') === '餐饮,交通,购物', s.arcs.join(','));
  ok('三行图例都可点', s.legends.length === 3 && s.legends.every(Boolean), s.legends.join(','));
  ok('中心初始是 100.00（美元那笔没混进来）', s.texts[1] === '100.00', s.texts.join(' / '));
  ok('明细默认收起', s.detailHidden === true);
  ok('有「点扇区或图例」提示', s.tipHidden === false);

  console.log('\n▸ 点图例展开餐饮明细');
  await clickCat('餐饮');
  await sleep(350);
  s = await pieState();
  ok('明细已展开', s.detailHidden === false);
  ok('明细列出 3 笔', s.detailRows === 3, String(s.detailRows));
  ok('头部显示 3 笔 · ¥60.00 · 占 60%', s.detailText.includes('3 笔') && s.detailText.includes('¥60.00') && s.detailText.includes('占 60%'), s.detailText.slice(0, 90));
  ok('中心文字换成分类名', s.texts[0] === '餐饮', s.texts.join(' / '));
  ok('中心金额换成 60.00', s.texts[1] === '60.00', s.texts.join(' / '));
  ok('中心多一行占比', s.texts[2] === '占 60%', s.texts.join(' / '));
  ok('选中扇区高亮', s.onArc === '餐饮', s.onArc);
  ok('另外两个扇区变淡', s.dimArcs === 2, String(s.dimArcs));
  ok('对应图例也高亮', s.onLegend === '餐饮', s.onLegend);
  ok('提示文字收起', s.tipHidden === true);
  await page.screenshot({ path: 'C:/Users/MO/WorkBuddy/2026-10-30-22-26-29/shots/stats-click.png' });

  console.log('\n▸ 再点一次取消 / 点圆心取消');
  await clickCat('餐饮');
  await sleep(300);
  ok('再点同一分类收起', (await pieState()).detailHidden === true);
  await page.evaluate(() => document.querySelector('#pie .pie-arc[data-cat="交通"]')
    .dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await sleep(300);
  s = await pieState();
  ok('直接点扇区也能选中', s.onArc === '交通' && s.detailHidden === false, s.onArc);
  ok('交通 2 笔 · ¥20.00', s.detailRows === 2 && s.detailText.includes('¥20.00'), s.detailText.slice(0, 70));
  await page.evaluate(() => document.querySelector('#pie .pie-hole')
    .dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await sleep(300);
  ok('点圆心取消选择', (await pieState()).detailHidden === true);

  console.log('\n▸ 键盘回车也能选');
  await page.evaluate(() => {
    const el = document.querySelector('#pie .legend-row[data-cat="购物"]');
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await sleep(300);
  ok('回车选中购物', (await pieState()).onArc === '购物', (await pieState()).onArc);

  console.log('\n▸ 明细里的流水可直接点开编辑');
  await page.evaluate(() => document.querySelector('#pie-detail .tx-item')
    .dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await sleep(350);
  const sheetOpen = await page.evaluate(() => !document.getElementById('sheet-mask').hidden);
  ok('点流水行打开编辑弹层', sheetOpen);
  if (sheetOpen) {
    const amt = await page.$eval('#f-amount', e => e.value);
    ok('金额预填 20', amt === '20', amt);
    await page.evaluate(() => document.getElementById('sheet-close').click());
    await sleep(250);
  }

  console.log('\n▸ ✕ 收起 + 跳到流水页');
  await page.evaluate(() => document.getElementById('pie-detail-close').click());
  await sleep(300);
  ok('✕ 能收起明细', (await pieState()).detailHidden === true);
  await clickCat('餐饮');
  await sleep(300);
  ok('明细提示另有 1 笔其它币种', (await pieState()).detailText.includes('另有 1 笔其它币种'),
    (await pieState()).detailText.slice(0, 80));
  await page.evaluate(() => document.getElementById('pie-detail-jump').click());
  await sleep(400);
  const listState = await page.evaluate(() => ({
    active: document.getElementById('view-list').classList.contains('active'),
    search: document.getElementById('search').value,
    rows: document.querySelectorAll('#list-body .tx-item').length,
    total: document.getElementById('list-total').textContent.trim()
  }));
  ok('已切到流水页', listState.active);
  ok('搜索框自动填上分类', listState.search === '餐饮', listState.search);
  ok('列出 4 笔（含一笔同分类的美元，流水页不按币种筛）', listState.rows === 4, String(listState.rows));
  ok('标题写明月份与笔数', listState.total.includes('共 4 笔'), listState.total);

  console.log('\n▸ 柱状图点柱切月并给出金额反馈');
  await gotoStats();
  await sleep(300);
  ok('从流水回来选中态仍保留', (await pieState()).detailHidden === false);
  await page.evaluate(mk => {
    document.querySelector(`#bars [data-mk="${mk}"]`)
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, M1);
  await sleep(400);
  /* 点柱子只是「查看」，不再直接改月份。
     以前点一下就切月，图整体位移一格，连点左侧会沿时间轴无限往回退。 */
  const barTip = await page.$eval('#bars-tip', e => e.textContent.replace(/\s+/g, ' ').trim());
  ok('点柱子给出月份和金额', barTip.includes('20.00') && barTip.includes('月'), barTip);
  ok('点柱子不再改月份', (await page.$eval('#stats-month', e => e.textContent.trim())) !==
    `${M1.slice(0, 4)}年${Number(M1.slice(5, 7))}月`);
  await page.evaluate(() => document.querySelector('#bars-tip [data-jump]').click());
  await sleep(500);
  ok('点「看这个月」才切月', (await page.$eval('#stats-month', e => e.textContent.trim())) ===
    `${M1.slice(0, 4)}年${Number(M1.slice(5, 7))}月`);
  ok('切月后明细自动收起', (await pieState()).detailHidden === true);
  const cols = await page.$$eval('#bars [data-mk]', els => els.map(e => e.dataset.mk));
  ok('十二根柱子都带月份标记', cols.length === 12, cols.join(','));

  console.log('\n▸ 固定扣款点行跳流水');
  const subName = await page.$eval('#subs-box .sub-row', e => e.dataset.sub);
  ok('识别到房租', subName === '房租', subName);
  await page.evaluate(() => document.querySelector('#subs-box .sub-row')
    .dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await sleep(400);
  const subJump = await page.evaluate(() => ({
    active: document.getElementById('view-list').classList.contains('active'),
    search: document.getElementById('search').value,
    rows: document.querySelectorAll('#list-body .tx-item').length
  }));
  ok('跳到流水并搜「房租」', subJump.active && subJump.search === '房租', JSON.stringify(subJump));
  ok('列出跨三个月的 3 笔', subJump.rows === 3, String(subJump.rows));

  console.log('\n▸ 布局与报错');
  await gotoStats();
  await sleep(300);
  // 此时停在 M1，分类只有「居住」，按实际存在的分类点
  await page.evaluate(() => {
    const el = document.querySelector('#pie .legend-row[data-cat]');
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await sleep(300);
  const layout = await page.evaluate(() => ({
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    detailW: Math.round(document.getElementById('pie-detail').getBoundingClientRect().width),
    cardW: Math.round(document.getElementById('pie-detail').closest('.card').getBoundingClientRect().width)
  }));
  ok('无横向溢出', layout.overflowX === 0, String(layout.overflowX));
  ok('明细宽度不超过卡片', layout.detailW <= layout.cardW, `${layout.detailW} / ${layout.cardW}`);
  ok('全程无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
