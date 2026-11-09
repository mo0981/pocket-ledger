/**
 * 首页排版回归测试
 * 起因：预算卡被塞在 hero 和语音输入条中间，AI 条的 -16px 上拉直接把它俩压在一起；
 *      同时数字字距用的是固定 px（纸糖 -1.6px），套在 11.5px 小字上字叠字。
 * 这里守住四条底线：元素不重叠、间距够、小字数字不挤压、FAB 不盖最后一条。
 */
import fs from 'fs';
import puppeteer from 'puppeteer-core';

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};

const KEYS = ['classic', 'ink', 'aurora', 'pop', 'term', 'cel'];

const b = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage']
});
const ctx = await b.createBrowserContext();
const p = await ctx.newPage();
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', e => errs.push(String(e)));
await p.setBypassServiceWorker(true);
await p.goto('http://localhost:5180/', { waitUntil: 'networkidle0' });
await sleep(500);

const now = new Date(), mk = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
await p.evaluate(async ({ mk }) => {
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('pocket_ledger');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const db = await open();
  const tx = db.transaction(['tx', 'settings'], 'readwrite');
  const st = tx.objectStore('tx');
  [
    ['餐饮', 1250, 'Walmart 香蕉', 1], ['餐饮', 2800, 'Walmart 谷物麦片', 2],
    ['购物', 12000, '外套', 3], ['交通', 1500, '打车', 4], ['交通', 900, '地铁', 5]
  ].forEach(([cat, cents, note, i]) => st.put({
    id: 'l' + i, type: 'expense', cents, cat, acct: '银行卡',
    date: `${mk}-0${i + 1}`, note, ts: i, src: 'ai', cur: 'USD'
  }));
  const se = tx.objectStore('settings');
  se.put({ k: 'mainCur', v: 'USD' });
  se.put({ k: 'budget', v: { total: { USD: 50000 }, cats: { '餐饮': { USD: 8000 }, '购物': { USD: 20000 } } } });
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
}, { mk });
await p.reload({ waitUntil: 'networkidle0' });
await sleep(700);

console.log('\n▸ 各皮肤的首页节奏');
for (const k of KEYS) {
  await p.evaluate(kk => {
    document.documentElement.dataset.theme = kk;
    document.querySelector('.tab[data-tab="home"]').click();
    window.scrollTo(0, 0);
  }, k);
  await sleep(260);

  const g = await p.evaluate(() => {
    const box = s => { const el = document.querySelector(s);
      return el ? el.getBoundingClientRect() : null; };
    const bar = box('.ai-bar'), bud = box('.bud-card'), hero = box('.hero');
    const headEl = document.querySelector('.recent-head h2');
    const head = headEl ? headEl.getBoundingClientRect() : null;
    const items = document.querySelectorAll('#recent-list .tx-item');
    const last = items.length ? items[items.length - 1].getBoundingClientRect() : null;
    const fab = box('#fab-add');
    const foot = document.querySelector('.bud-foot');
    const fl = foot && foot.firstElementChild ? foot.firstElementChild.getBoundingClientRect() : null;
    const fr = foot && foot.lastElementChild ? foot.lastElementChild.getBoundingClientRect() : null;
    return {
      gapHeroBar: bar && hero ? +(bar.top - hero.bottom).toFixed(1) : null,
      gapBarBud: bud && bar ? +(bud.top - bar.bottom).toFixed(1) : null,
      gapBudHead: head && bud ? +(head.top - bud.bottom).toFixed(1) : null,
      lastBottom: last ? +last.bottom.toFixed(1) : null,
      fabTop: fab ? +fab.top.toFixed(1) : null,
      footH: foot ? +foot.getBoundingClientRect().height.toFixed(1) : null,
      overlap: fl && fr ? +(fl.right - fr.left).toFixed(1) : null,
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  ok(g.gapBarBud >= 14, `${k} AI 条与预算卡不贴身`, `间距 ${g.gapBarBud}px`);
  ok(g.gapBudHead >= 16, `${k} 预算卡与「最近流水」有呼吸`, `标题距卡片 ${g.gapBudHead}px`);
  ok(g.overlap !== null && g.overlap < 0, `${k} 预算卡底部两段文字不重叠`, `交叠 ${g.overlap}px`);
  ok(g.footH !== null && g.footH <= 22, `${k} 预算卡底部只占一行`, `高 ${g.footH}px`);
  ok(g.docOverflow <= 0, `${k} 无横向溢出`, `${g.docOverflow}px`);
}

console.log('\n▸ 滚到底时 FAB 不盖最后一条');
await p.evaluate(() => {
  document.documentElement.dataset.theme = 'pop';
  window.scrollTo(0, document.documentElement.scrollHeight);
});
await sleep(300);
const bottom = await p.evaluate(() => {
  const items = document.querySelectorAll('#recent-list .tx-item');
  const last = items[items.length - 1].getBoundingClientRect();
  const fab = document.querySelector('#fab-add').getBoundingClientRect();
  return { lastBottom: +last.bottom.toFixed(1), fabTop: +fab.top.toFixed(1) };
});
ok(bottom.lastBottom <= bottom.fabTop, '最后一条流水在 + 按钮上方',
  `卡片底 ${bottom.lastBottom} / 按钮顶 ${bottom.fabTop}`);

console.log('\n▸ 数字字距必须随字号缩放');
const css = fs.readFileSync('style.css', 'utf8');
const tracks = [...css.matchAll(/--num-track:([^;]+);/g)].map(m => m[1].trim());
ok(tracks.length === 6, '六套皮肤都定义了字距', `${tracks.length} 条`);
ok(tracks.every(v => v.endsWith('em')), '字距统一用 em（px 会把小字压成黑块）', tracks.join(' / '));

const appjs = fs.readFileSync('js/app.js', 'utf8');
const lightSkins = ['ink', 'pop', 'cel'];
ok(lightSkins.every(k => new RegExp(`k:'${k}'[^}]*darkBar:1`).test(appjs)),
  '三套浅色皮肤都标了深色状态栏图标');
ok(/function syncStatusBar/.test(appjs) && /syncStatusBar\(s\)/.test(appjs),
  'applyTheme 里调用了状态栏同步');

console.log('\n▸ 安卓端的配套改动');
const ui = fs.readFileSync('android/app/src/main/java/com/mo/pocketledger/UiPlugin.java', 'utf8');
ok(/CapacitorPlugin\(name = "Ui"\)/.test(ui), 'UiPlugin 插件名与前端一致');
ok(/setAppearanceLightStatusBars/.test(ui), '真的改了状态栏图标模式');
const main = fs.readFileSync('android/app/src/main/java/com/mo/pocketledger/MainActivity.java', 'utf8');
ok(/registerPlugin\(UiPlugin\.class\)/.test(main), 'MainActivity 注册了 UiPlugin');
ok(main.indexOf('registerPlugin(UiPlugin.class)') < main.indexOf('super.onCreate(savedInstanceState)'),
  '注册发生在 super.onCreate 之前');

console.log('\n▸ 控制台');
ok(errs.length === 0, '全程无 JS 报错', errs.join(' | ') || '无');

await b.close();
console.log(`\n${fail === 0 ? '✅' : '❌'} 排版测试：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
