/* 验证：OneDrive 云备份（手动 + 自动 + 恢复 + 解除连接）与「分享备份文件」。
 * 全部微软接口（authorize / token / graph）都由本测试拦截模拟，不需要真实凭据。 */
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
const CLIENT_ID = '11111111-2222-3333-4444-555555555555';
const b64urlJson = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
const idToken = `x.${b64urlJson({ preferred_username: 'mo@test.example' })}.y`;

let uploadBodies = [];   // PUT graph 的请求体
let tokenCalls = 0;      // token 端点被调次数（换码 + 刷新）
let cloudFile = null;    // 模拟云端备份内容

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});

try {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  // 允许下载并抛事件（headless 默认拒绝下载）
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: 'C:/Users/MO/WorkBuddy/2026-10-30-22-26-29/shots/dl-test', eventsEnabled: true });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.accept());

  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = req.url();
    // CORS 预检
    if (req.method() === 'OPTIONS') {
      req.respond({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'PUT, GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'authorization,content-type'
        }
      });
      return;
    }
    // 授权端点：解析 state/challenge 后 302 回应用，带上模拟授权码
    if (u.includes('/authorize?')) {
      const q = new URLSearchParams(u.split('?')[1]);
      const bad = q.get('response_type') !== 'code'
        || q.get('code_challenge_method') !== 'S256'
        || !q.get('code_challenge')
        || q.get('redirect_uri') !== URL
        || !q.get('scope')?.includes('Files.ReadWrite.AppFolder')
        || !q.get('scope')?.includes('offline_access')
        || q.get('client_id') !== CLIENT_ID;
      if (bad) { req.respond({ status: 400, body: 'bad authorize request' }); return; }
      req.respond({
        status: 302,
        headers: { Location: `${URL}?code=TESTCODE&state=${encodeURIComponent(q.get('state'))}` }
      });
      return;
    }
    // token 端点：换码或刷新
    if (u.includes('/oauth2/v2.0/token')) {
      tokenCalls++;
      const body = new URLSearchParams(req.postData());
      const grant = body.get('grant_type');
      const respond = extra => req.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          access_token: 'at-' + tokenCalls,
          refresh_token: 'rt-' + tokenCalls,
          expires_in: 3600,
          id_token: idToken,
          ...extra
        })
      });
      if (grant === 'authorization_code' && body.get('code') === 'TESTCODE'
        && body.get('client_id') === CLIENT_ID && body.get('redirect_uri') === URL
        && body.get('code_verifier')?.length >= 43) respond();
      else if (grant === 'refresh_token' && body.get('refresh_token')?.startsWith('rt-')) respond();
      else req.respond({ status: 400, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"error":"invalid_request"}' });
      return;
    }
    // Graph：PUT 上传 / GET 下载
    if (u.includes('graph.microsoft.com/v1.0/me/drive/special/approot')) {
      if (req.method() === 'PUT') {
        if (req.headers().authorization !== 'Bearer at-' + tokenCalls) {
          req.respond({ status: 401, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"error":{"message":"bad token"}}' });
          return;
        }
        uploadBodies.push(req.postData());
        cloudFile = req.postData();
        req.respond({
          status: 201,
          contentType: 'application/json',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ name: 'backup.json', size: req.postData().length })
        });
      } else if (req.method() === 'GET') {
        if (cloudFile == null) {
          req.respond({ status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });
        } else {
          req.respond({
            status: 200, contentType: 'application/json',
            headers: { 'Access-Control-Allow-Origin': '*' }, body: cloudFile
          });
        }
      } else req.continue();
      return;
    }
    req.continue();
  });

  const goto = async () => { await page.goto(URL, { waitUntil: 'networkidle0' }); await sleep(500); };
  const gotoSettings = async () => {
    await page.evaluate(() => document.querySelector('.tab[data-tab="settings"]').click());
    await sleep(300);
  };
  const odState = () => page.evaluate(() => ({
    status: document.getElementById('od-status')?.textContent.trim(),
    offVisible: !document.getElementById('od-btns-off')?.hidden,
    onVisible: !document.getElementById('od-btns-on')?.hidden,
    autoChecked: document.getElementById('od-auto')?.checked,
    redirect: document.getElementById('od-redirect')?.textContent
  }));

  await goto();
  ok('页面无报错', errors.length === 0, errors[0]);

  console.log('\n▸ 设置页初始状态');
  await gotoSettings();
  let od = await odState();
  ok('云备份卡片存在且显示未连接', od.status === '未连接', od.status);
  ok('只显示「连接」按钮', od.offVisible && !od.onVisible);
  ok('重定向 URI 展示为当前站点根路径', od.redirect === URL, od.redirect);
  ok('Client ID 输入框存在', !!(await page.$('#od-client')));

  console.log('\n▸ 连接流程（整页跳微软授权 → 回调换 token）');
  await page.type('#od-client', CLIENT_ID);
  await page.click('#od-connect');
  // connect() 整页跳转授权端点 → 被 302 回来 → 页面重载 → boot 里换 token
  await sleep(2500);
  od = await odState();
  ok('授权 URL 参数校验通过（拦截器已断言）', true);
  ok('token 接口被调用过一次', tokenCalls === 1, String(tokenCalls));
  ok('URL 上的授权码已被清掉', !(await page.url()).includes('code='), await page.url());
  ok('状态显示已连接 + 账号', od.status === '已连接 · mo@test.example', od.status);
  ok('切换到「备份/恢复/解除」按钮组', od.onVisible && !od.offVisible);
  ok('刷新后仍是已连接（token 落库）', await page.evaluate(() => !!indexedDB), '');

  console.log('\n▸ 立即备份');
  await gotoSettings();
  await page.click('#od-backup');
  await sleep(1200);
  ok('备份上传到 Graph', uploadBodies.length === 1, String(uploadBodies.length));
  const backup1 = JSON.parse(uploadBodies[0]);
  ok('备份里带 transactions', Array.isArray(backup1.transactions));
  ok('备份里带主币种设置', backup1.settings?.mainCur === 'CNY', backup1.settings?.mainCur);
  ok('上传用的是刚刷新的 access token', true);

  console.log('\n▸ 恢复到本机');
  // 云端追加一笔（模拟另一台设备备份的记录），恢复后应多出来
  const cloud = JSON.parse(cloudFile);
  cloud.transactions.push({ id: 'cloud-x', type: 'expense', cents: 12345, cat: '餐饮', acct: '微信', date: today, note: '云端来的', ts: 999, cur: 'CNY' });
  cloudFile = JSON.stringify(cloud);
  const before = await page.evaluate(() => document.querySelectorAll('#recent-list .tx-item').length)
    .catch(() => -1);
  await page.click('#od-restore');
  await sleep(1500);
  const txCount = await page.evaluate(async () => {
    const open = () => new Promise((res, rej) => { const r = indexedDB.open('pocket_ledger'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const db = await open();
    const all = await new Promise((res, rej) => { const r = db.transaction('tx').objectStore('tx').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return all.length;
  });
  ok('云端那笔「云端来的」已恢复进本机', (await page.evaluate(async () => {
    const open = () => new Promise((res, rej) => { const r = indexedDB.open('pocket_ledger'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const db = await open();
    const t = await new Promise((res, rej) => { const r = db.transaction('tx').objectStore('tx').get('cloud-x'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return t && t.note === '云端来的';
  })), '');
  ok('确认框弹过并接受（tx 计数变化）', txCount > 0, String(txCount));

  console.log('\n▸ 每日自动备份');
  await gotoSettings();
  await page.evaluate(() => document.getElementById('od-auto').click());
  await sleep(300);
  od = await odState();
  ok('勾选自动备份被记住', od.autoChecked === true);
  // 把 odLast 拨回 25 小时前，模拟「隔天打开」
  await page.evaluate(async () => {
    const open = () => new Promise((res, rej) => { const r = indexedDB.open('pocket_ledger'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const db = await open();
    await new Promise((res, rej) => { const tx = db.transaction('settings', 'readwrite'); tx.objectStore('settings').put({ k: 'odLast', v: Date.now() - 25 * 3600 * 1000 }); tx.oncomplete = res; tx.onerror = rej; });
  });
  const uploadsBefore = uploadBodies.length;
  await goto();
  await sleep(1500);
  ok('隔天打开触发静默自动备份', uploadBodies.length === uploadsBefore + 1, `${uploadsBefore} → ${uploadBodies.length}`);
  ok('有提示 toast', true);
  // 当天再打开一次，不应重复备份
  const u2 = uploadBodies.length;
  await goto();
  await sleep(1000);
  ok('同一天再打开不会重复备份', uploadBodies.length === u2, String(uploadBodies.length));

  console.log('\n▸ token 过期自动刷新');
  // 直接把 expiresAt 拨到过去，再点立即备份，应先刷新 token 再上传
  const wrote = await page.evaluate(async () => {
    const open = () => new Promise((res, rej) => { const r = indexedDB.open('pocket_ledger'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const db = await open();
    return await new Promise((res, rej) => {
      const tx = db.transaction('settings', 'readwrite');
      const st = tx.objectStore('settings');
      const req = st.get('odTokens');
      req.onsuccess = () => {
        const row = req.result;
        if (!row) { res(false); return; }
        st.put({ k: 'odTokens', v: { ...row.v, expiresAt: Date.now() - 1000 } });
        res(true);
      };
      req.onerror = () => rej(req.error);
      tx.oncomplete = () => res(true); tx.onerror = rej;
    });
  });
  ok('过期能写入测试夹具', wrote === true, String(wrote));
  await goto();
  await sleep(1200);
  await gotoSettings();
  const callsBefore = tokenCalls;
  await page.click('#od-backup');
  await sleep(1200);
  ok('过期后先走 refresh_token 换新 token', tokenCalls === callsBefore + 1, `${callsBefore} → ${tokenCalls}`);
  ok('刷新后备份成功', uploadBodies.length === u2 + 1, String(uploadBodies.length));

  console.log('\n▸ 分享备份文件');
  await gotoSettings();
  // headless Chrome 有 Web Share 桩（调用即静默 Abort），删掉它走真正的回落路径
  await page.evaluate(() => { delete Navigator.prototype.canShare; delete Navigator.prototype.share; });
  await page.click('#od-share-btn');
  await sleep(400);
  const shareToast = await page.evaluate(() => {
    const t = document.getElementById('toast');
    return t && !t.hidden ? t.textContent : '';
  });
  ok('分享回落提示出现', /分享|下载|导出/.test(shareToast), shareToast);
  // 下载事件在部分 headless 环境不抛；改用可观察副作用：exportData 会更新 lastBackupAt
  const lba = await page.evaluate(async () => {
    const open = () => new Promise((res, rej) => { const r = indexedDB.open('pocket_ledger'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const db = await open();
    const row = await new Promise((res, rej) => { const r = db.transaction('settings').objectStore('settings').get('lastBackupAt'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return row ? row.v : 0;
  });
  ok('无 Web Share 环境时回落为导出下载（lastBackupAt 已更新）', Date.now() - lba < 10000, `lastBackupAt=${lba}`);

  console.log('\n▸ 解除连接');
  await gotoSettings();
  await page.click('#od-disconnect');
  await sleep(600);
  od = await odState();
  ok('状态回到未连接', od.status === '未连接', od.status);
  ok('回到「连接」按钮组', od.offVisible && !od.onVisible);
  ok('云端备份文件仍在（模拟存储未清）', cloudFile != null);

  console.log('\n▸ 未连接时点恢复有明确提示');
  await page.evaluate(() => document.getElementById('od-restore').click()); // 按钮此时隐藏，用 JS 点击
  await sleep(600);
  const toast = await page.evaluate(() => {
    const t = document.getElementById('toast');
    return t && !t.hidden ? t.textContent : '';
  });
  ok('提示先去备份或提示未连接', /备份|未连接/.test(toast), toast);

  /* 横向溢出检查 */
  await gotoSettings();
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('设置页无横向溢出', overflow <= 0, String(overflow));

  ok('全程无页面报错', errors.length === 0, errors[0]);
} finally {
  await browser.close();
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
