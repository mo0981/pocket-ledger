/* 验证：批量改币种（范围、目标币种、主币种联动、幂等、洞察缓存作废） */
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
const pd = new Date(now.getFullYear(), now.getMonth() - 1, 1);
const M1 = `${pd.getFullYear()}-${pad(pd.getMonth() + 1)}`;
const D1 = `${M1}-10`;
const D2 = `${M1}-12`;

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

  let dialogs = 0;
  page.on('dialog', async d => { dialogs++; await d.accept(); });

  await page.goto(URL, { waitUntil: 'networkidle0' });
  await sleep(500);

  /* 种子：本月 3 笔人民币 + 1 笔美元，上月 2 笔人民币，外加一条假洞察缓存 */
  await page.evaluate(async ({ today, D1, D2, M0 }) => {
    const open = () => new Promise((res, rej) => {
      const r = indexedDB.open('pocket_ledger');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const db = await open();
    const rows = [
      { id: 'm0-a', type: 'expense', cents: 1000, cat: '餐饮', acct: '微信', date: today, note: '食堂', ts: 4 },
      { id: 'm0-b', type: 'expense', cents: 2000, cat: '交通', acct: '微信', date: today, note: '打车', ts: 3 },
      { id: 'm0-c', type: 'expense', cents: 3000, cat: '购物', acct: '支付宝', date: today, note: '超市', ts: 2 },
      { id: 'm0-d', type: 'expense', cents: 500, cat: '餐饮', acct: '银行卡', cur: 'USD', date: today, note: 'coffee', ts: 1 },
      { id: 'm1-a', type: 'expense', cents: 1500, cat: '餐饮', acct: '微信', date: D1, note: '火锅', ts: 5 },
      { id: 'm1-b', type: 'expense', cents: 2500, cat: '交通', acct: '微信', date: D2, note: '高铁', ts: 4 }
    ];
    await new Promise((res, rej) => {
      const tx = db.transaction('tx', 'readwrite');
      const st = tx.objectStore('tx');
      rows.forEach(x => st.put(x));
      tx.oncomplete = res; tx.onerror = rej;
    });
    const cfg = { mainCur: 'CNY' };
    cfg['insight:' + M0] = { at: Date.now(), lines: ['旧洞察：本月花了 ¥60.00'] };
    await new Promise((res, rej) => {
      const tx = db.transaction('settings', 'readwrite');
      const st = tx.objectStore('settings');
      Object.entries(cfg).forEach(([k, v]) => st.put({ k, v }));
      tx.oncomplete = res; tx.onerror = rej;
    });
  }, { today, D1, D2, M0 });

  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(700);

  const readTx = () => page.evaluate(async () => {
    const open = () => new Promise((res, rej) => {
      const r = indexedDB.open('pocket_ledger');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const db = await open();
    const rows = await new Promise((res, rej) => {
      const r = db.transaction('tx').objectStore('tx').getAll();
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return rows.map(r => ({ id: r.id, cents: r.cents, cur: r.cur || 'CNY' })).sort((a, b) => a.id.localeCompare(b.id));
  });
  const readSetting = k => page.evaluate(async key => {
    const open = () => new Promise((res, rej) => {
      const r = indexedDB.open('pocket_ledger');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const db = await open();
    const row = await new Promise((res, rej) => {
      const r = db.transaction('settings').objectStore('settings').get(key);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return row ? row.v : null;
  }, k);

  const gotoSet = async () => {
    await page.evaluate(() => document.querySelector('.tab[data-tab="settings"]').click());
    await sleep(300);
  };
  const cfg = () => page.evaluate(() => ({
    scope: document.getElementById('batch-scope').value,
    scopeText: document.getElementById('batch-scope').selectedOptions[0]?.textContent.trim() || '',
    scopeCount: document.querySelectorAll('#batch-scope option').length,
    cur: document.getElementById('batch-cur').value,
    hint: document.getElementById('cur-batch-hint').textContent.trim(),
    btn: document.getElementById('batch-apply').textContent.trim(),
    btnDisabled: document.getElementById('batch-apply').disabled,
    mainHidden: document.getElementById('batch-main-row').hidden,
    mainChecked: document.getElementById('batch-main').checked
  }));
  const homeExpense = () => page.$eval('#home-expense', e => e.textContent.trim());

  console.log('\n▸ 面板初始状态');
  await gotoSet();
  let c = await cfg();
  ok('范围默认本月', c.scope === M0, `${c.scope} / ${c.scopeText}`);
  ok('月份选项包含「本月」字样', c.scopeText.includes('本月'), c.scopeText);
  ok('有「全部记录」+ 本月 + 上月 3 个选项', c.scopeCount === 3, String(c.scopeCount));
  ok('目标币种默认美元', c.cur === 'USD', c.cur);
  ok('提示 4 笔里待改 3 笔', c.hint === '共 4 笔 · 待改 3 笔', c.hint);
  ok('按钮文案带笔数', c.btn === '把这 3 笔改成美元', c.btn);
  ok('按钮可用', c.btnDisabled === false);
  ok('主币种勾选框显示且默认勾上', c.mainHidden === false && c.mainChecked === true,
    `hidden=${c.mainHidden} checked=${c.mainChecked}`);

  console.log('\n▸ 切换目标币种会实时重算');
  await page.select('#batch-cur', 'EUR');
  await sleep(250);
  c = await cfg();
  ok('改成欧元后待改 4 笔', c.hint === '共 4 笔 · 待改 4 笔', c.hint);
  ok('按钮跟着变', c.btn === '把这 4 笔改成欧元', c.btn);
  await page.select('#batch-cur', 'USD');
  await sleep(250);

  console.log('\n▸ 执行转换（范围=本月，主币种一起切）');
  const before = await readTx();
  await page.click('#batch-apply');
  await sleep(900);
  ok('弹了确认框', dialogs >= 1, String(dialogs));
  const after = await readTx();
  const byId = Object.fromEntries(after.map(r => [r.id, r]));
  ok('本月 3 笔人民币变美元',
    ['m0-a', 'm0-b', 'm0-c'].every(id => byId[id].cur === 'USD'),
    ['m0-a', 'm0-b', 'm0-c'].map(id => byId[id].cur).join(','));
  ok('本来就美元的那笔没变', byId['m0-d'].cur === 'USD');
  ok('上月的 2 笔没被动', byId['m1-a'].cur === 'CNY' && byId['m1-b'].cur === 'CNY',
    `${byId['m1-a'].cur},${byId['m1-b'].cur}`);
  ok('金额一个分都没改', after.every(r => before.find(b => b.id === r.id).cents === r.cents));
  ok('记录数没变', after.length === 6, String(after.length));

  console.log('\n▸ 主币种与首页合计跟着走');
  ok('主币种已存成美元', (await readSetting('mainCur')) === 'USD', String(await readSetting('mainCur')));
  await page.evaluate(() => document.querySelector('.tab[data-tab="home"]').click());
  await sleep(400);
  ok('首页主金额 US$65.00（60 转 + 5 原有）', (await homeExpense()) === 'US$65.00', await homeExpense());
  const label = await page.$eval('#home-label', e => e.textContent.trim());
  ok('标签标出美元', label.includes('美元'), label);
  const other = await page.evaluate(() => {
    const el = document.getElementById('home-other');
    return el.hidden ? '' : el.textContent.trim();
  });
  ok('本月不再有「另有」提示', other === '', other);

  console.log('\n▸ 洞察缓存作废');
  ok('insight 缓存已删除', (await readSetting('insight:' + M0)) === null);
  await page.evaluate(() => document.querySelector('.tab[data-tab="stats"]').click());
  await sleep(400);
  const insight = await page.$eval('#insight-box', e => e.textContent.trim());
  ok('统计页洞察回到「点生成」提示', insight.includes('点右上角'), insight.slice(0, 24));

  console.log('\n▸ 幂等：再点一次什么都不改');
  await gotoSet();
  c = await cfg();
  ok('按钮变成「无需修改」并禁用', c.btn === '无需修改' && c.btnDisabled === true, `${c.btn} / ${c.btnDisabled}`);
  ok('提示说明全是美元', c.hint === '4 笔全是美元', c.hint);
  ok('主币种已是美元时勾选框隐藏', c.mainHidden === true);
  const dialogsBefore = dialogs;
  await page.evaluate(() => document.getElementById('batch-apply').click());
  await sleep(400);
  ok('禁用后点击不弹确认框', dialogs === dialogsBefore, `${dialogsBefore} → ${dialogs}`);

  console.log('\n▸ 换范围到上月');
  await page.select('#batch-scope', M1);
  await sleep(300);
  c = await cfg();
  ok('上月待改 2 笔', c.hint === '共 2 笔 · 待改 2 笔', c.hint);
  await page.click('#batch-apply');
  await sleep(800);
  const after2 = await readTx();
  const by2 = Object.fromEntries(after2.map(r => [r.id, r]));
  ok('上月两笔改成美元', by2['m1-a'].cur === 'USD' && by2['m1-b'].cur === 'USD',
    `${by2['m1-a'].cur},${by2['m1-b'].cur}`);
  ok('主币种仍是美元', (await readSetting('mainCur')) === 'USD');

  console.log('\n▸ 改回人民币（反向操作）');
  await page.select('#batch-scope', 'all');
  await sleep(200);
  await page.select('#batch-cur', 'CNY');
  await sleep(250);
  c = await cfg();
  ok('全部范围下待改 6 笔', c.hint === '共 6 笔 · 待改 6 笔', c.hint);
  await page.click('#batch-apply');
  await sleep(900);
  const after3 = await readTx();
  ok('6 笔全部回到人民币', after3.every(r => r.cur === 'CNY'), after3.map(r => r.cur).join(','));
  ok('主币种跟着切回人民币', (await readSetting('mainCur')) === 'CNY');

  await page.evaluate(() => document.querySelector('.tab[data-tab="home"]').click());
  await sleep(400);
  ok('首页主金额 ¥65.00（本月 4 笔全算进来）', (await homeExpense()) === '¥65.00', await homeExpense());
  const other2 = await page.evaluate(() => {
    const el = document.getElementById('home-other');
    return el.hidden ? '' : el.textContent.trim();
  });
  ok('已经不剩其他币种', other2 === '', other2);

  console.log('\n▸ 刷新后依旧生效（真写库了）');
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(700);
  ok('重载后本月仍是 ¥65.00', (await homeExpense()) === '¥65.00', await homeExpense());

  console.log('\n▸ 布局');
  await gotoSet();
  const layout = await page.evaluate(() => {
    const card = document.getElementById('batch-apply').closest('.card');
    const r = card.getBoundingClientRect();
    return {
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      cardTop: Math.round(r.top), cardW: Math.round(r.width),
      innerW: window.innerWidth
    };
  });
  ok('设置页无横向溢出', layout.overflowX === 0, String(layout.overflowX));
  ok('卡片宽度不超出视口', layout.cardW <= layout.innerW, `${layout.cardW} / ${layout.innerW}`);
  await page.evaluate(() => {
    const el = document.getElementById('batch-apply').closest('.card');
    el.scrollIntoView({ block: 'center' });
  });
  await sleep(400);
  await page.screenshot({ path: 'C:/Users/MO/WorkBuddy/2026-10-30-22-26-29/shots/batch-cur.png' });

  ok('全程无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
