/* 验证：百度网盘云备份（授权码自动/手动两条路、上传三步、恢复、自动备份、刷新、过期处理）。
 * 百度接口通过伪造的 window.Capacitor.Plugins.CapacitorHttp 模拟（与 APK 原生通道同签名），
 * 授权页跳转由 puppeteer 拦截 302 回来。不需要真实凭据。 */
import puppeteer from 'puppeteer-core';
import crypto from 'node:crypto';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://localhost:5180/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const md5hex = s => crypto.createHash('md5').update(Buffer.from(s, 'utf8')).digest('hex');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}${x ? ' — ' + x : ''}`); }
  else { fail++; console.log(`  ❌ ${n}${x ? ' — ' + x : ''}`); }
};

const AK = 'testAppKey123', SK = 'testSecret456', APP = '小账本备份';

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
  page.on('dialog', d => d.accept());

  /* 页面加载前注入伪造的 Capacitor 原生 HTTP 通道 */
  await page.evaluateOnNewDocument((AK, SK) => {
    window.__bdCalls = [];
    window.Capacitor = { Plugins: { CapacitorHttp: {
      async request(opts) {
        opts.url = String(opts.url);
        opts.params = opts.params || {};
        window.__bdCalls.push(JSON.parse(JSON.stringify(opts)));
        const u = opts.url;
        const get = k => (opts.params[k] != null ? String(opts.params[k]) : '');
        // 授权/token
        if (u.includes('/oauth/2.0/token')) {
          tokenCallsInc();
          const grant = get('grant_type');
          if (grant === 'authorization_code' && get('code') === 'CODE123'
            && get('client_id') === AK && get('client_secret') === SK) {
            return { status: 200, data: { access_token: 'at-' + gTC(), refresh_token: 'rt-' + gTC(), expires_in: 2592000, scope: 'basic netdisk' } };
          }
          if (grant === 'refresh_token' && get('refresh_token').startsWith('rt-')
            && get('client_id') === AK && get('client_secret') === SK) {
            return { status: 200, data: { access_token: 'at-' + gTC(), refresh_token: 'rt-' + gTC(), expires_in: 2592000, scope: 'basic netdisk' } };
          }
          return { status: 200, data: { error: 'invalid_request', error_description: 'bad token request' } };
        }
        // 用户信息
        if (u.includes('/xpan/nas') && get('method') === 'uinfo') {
          if (get('access_token') === 'expired-test') return { status: 200, data: { errno: -6 } };
          return { status: 200, data: { errno: 0, baidu_name: 'mofans' } };
        }
        const at = get('access_token');
        const failIfExpired = () => { if (at === 'expired-test') return true; return false; };
        // 预上传
        if (u.includes('/xpan/file') && get('method') === 'precreate') {
          if (failIfExpired()) return { status: 200, data: { errno: -6 } };
          const form = new URLSearchParams(opts.data);
          window.__bdPre = { path: form.get('path'), size: form.get('size'), block: form.get('block_list'), rtype: form.get('rtype') };
          return { status: 200, data: { errno: 0, path: form.get('path'), uploadid: 'UPID-1', return_type: 2, block_list: [0] } };
        }
        // 分片上传
        if (u.includes('pcs/superfile2')) {
          if (failIfExpired()) return { status: 200, data: { errno: -6 } };
          const body = String(opts.data);
          const start = body.indexOf('\r\n\r\n') + 4;
          const end = body.lastIndexOf('\r\n--');
          const content = body.slice(start, end);
          window.localStorage.setItem('__bdCloud', content);
          window.localStorage.setItem('__bdParts', JSON.stringify({
            path: get('path'), uploadid: get('uploadid'), partseq: get('partseq'),
            boundary: (opts.headers['Content-Type'] || '').includes('multipart/form-data')
          }));
          return { status: 200, data: { errno: 0, md5: 'x' } };
        }
        // 创建文件
        if (u.includes('/xpan/file') && get('method') === 'create') {
          if (failIfExpired()) return { status: 200, data: { errno: -6 } };
          const form = new URLSearchParams(opts.data);
          window.__bdCreate = { path: form.get('path'), size: form.get('size'), block: form.get('block_list') };
          return { status: 200, data: { errno: 0, fs_id: 123456 } };
        }
        // 文件列表
        if (u.includes('/xpan/file') && get('method') === 'filelist') {
          const cloud = window.localStorage.getItem('__bdCloud');
          return { status: 200, data: { errno: 0, list: cloud ? [{ fs_id: 123456, path: get('dir') + 'backup.json', isdir: 0 }] : [] } };
        }
        // 文件详情 → dlink
        if (u.includes('/xpan/multimedia') && get('method') === 'filemetas') {
          return { status: 200, data: { errno: 0, list: [{ fs_id: 123456, dlink: 'https://d.pcs.baidu.com/rest/2.0/pcs/file?method=download&path=%2Fapps%2Fx%2Fbackup.json' }] } };
        }
        // dlink 下载
        if (u.includes('pcs/file') && u.includes('method=download')) {
          const ua = (opts.headers && opts.headers['User-Agent']) || '';
          if (ua !== 'pan.baidu.com') return { status: 403, data: { errno: 2 } };
          return { status: 200, data: window.localStorage.getItem('__bdCloud') || '' };
        }
        return { status: 404, data: { errno: 999 } };
        function tokenCallsInc() { window.__tc = (window.__tc || 0) + 1; }
        function gTC() { return window.__tc || 0; }
      }
    } } };
  }, AK, SK);

  /* 授权页跳转：302 带授权码回本站 */
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = req.url();
    if (u.includes('openapi.baidu.com/oauth/2.0/authorize')) {
      const q = new URLSearchParams(u.split('?')[1]);
      const good = q.get('response_type') === 'code' && q.get('client_id') === AK
        && q.get('scope') === 'basic,netdisk' && q.get('display') === 'mobile'
        && q.get('redirect_uri') === URL && q.get('state') === 'pocket-ledger';
      globalThis.__authParams = Object.fromEntries(q.entries());
      globalThis.__authGood = good;
      req.respond({
        status: 302,
        headers: { Location: `${URL}?code=CODE123&state=pocket-ledger` }
      });
      return;
    }
    req.continue();
  });

  const goto = async () => { await page.goto(URL, { waitUntil: 'networkidle0' }); await sleep(600); };
  /* boot 里的 token 交换是异步链，固定 sleep 会时快时慢，统一改成轮询 */
  const waitFor = async (fn, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try { if (await fn()) return true; } catch (e) { /* 页面跳转中 */ }
      await sleep(150);
    }
    return false;
  };
  const gotoSettings = async () => {
    await page.evaluate(() => document.querySelector('.tab[data-tab="settings"]').click());
    await sleep(300);
  };
  const bdState = () => page.evaluate(() => ({
    webNoteHidden: document.getElementById('bd-web-note').hidden,
    bodyShown: !document.getElementById('bd-body').hidden,
    status: document.getElementById('bd-status').textContent.trim(),
    offVisible: !document.getElementById('bd-btns-off').hidden,
    onVisible: !document.getElementById('bd-btns-on').hidden,
    autoChecked: document.getElementById('bd-auto').checked,
    redirect: document.getElementById('bd-redirect').textContent,
    note: document.getElementById('bd-note').textContent
  }));
  const calls = () => page.evaluate(() => window.__bdCalls);
  const tc = () => page.evaluate(() => window.__tc || 0);

  await goto();
  ok('页面无报错', errors.length === 0, errors[0]);

  console.log('\n▸ 设置页初始状态（App 环境）');
  await gotoSettings();
  let bd = await bdState();
  ok('网页版提示被隐藏（检测到原生通道）', bd.webNoteHidden);
  ok('百度卡片主体显示', bd.bodyShown);
  ok('状态为未配置', bd.status === '未配置', bd.status);
  ok('回调地址展示为当前站点', bd.redirect === URL, bd.redirect);

  console.log('\n▸ 填配置 → 打开授权页 → 自动带回授权码');
  await page.type('#bd-appkey', AK);
  await page.type('#bd-secret', SK);
  await page.type('#bd-appname', APP);
  await page.click('#bd-open-auth');
  let connToast = '';
  const connOk = await waitFor(async () => {
    const st = await bdState();
    connToast = await page.evaluate(() => {
      const t = document.getElementById('toast');
      return t && !t.hidden ? t.textContent : '';
    });
    return st.status.startsWith('已连接') || /失败/.test(connToast);
  });
  ok('授权 URL 参数齐全（拦截器已断言）', globalThis.__authGood === true, JSON.stringify(globalThis.__authParams || {}));
  if (!connOk || /失败/.test(connToast)) {
    console.log('DEBUG toast:', connToast, '| calls:', (await calls()).map(c => c.url.slice(0, 70)).join(' | '));
    console.log('DEBUG errors:', errors.slice(0, 5));
    console.log('DEBUG body:', await page.evaluate(() => document.body.innerText.slice(0, 120)));
    console.log('DEBUG els:', await page.evaluate(() =>
      ['bd-web-note', 'bd-body', 'bd-status', 'bd-btns-off', 'bd-btns-on', 'bd-auto', 'bd-redirect', 'bd-note', 'od-status']
        .map(id => `${id}:${!!document.getElementById(id)}`).join(' ')));
  }
  ok('等 boot 完成 token 交换', connOk && !/失败/.test(connToast), connToast);
  bd = await bdState();
  ok('URL 上的 code 已清掉', !(await page.url()).includes('code='), await page.url());
  ok('token 请求发出（authorization_code）', (await tc()) === 1, String(await tc()));
  const tokReq = (await calls()).find(c => c.url.includes('/oauth/2.0/token'));
  ok('换 token 带了 AK/SK/redirect_uri', tokReq && tokReq.params.client_id === AK
    && tokReq.params.client_secret === SK && tokReq.params.grant_type === 'authorization_code');
  ok('用 uinfo 验了 token 并拿到账号名', bd.status === '已连接 · mofans', bd.status);
  ok('切换到备份/恢复按钮组', bd.onVisible && !bd.offVisible);

  console.log('\n▸ 立即备份（precreate → superfile2 → create）');
  await gotoSettings();
  await page.click('#bd-backup');
  ok('等上传三步完成', await waitFor(async () => (await calls()).filter(c => c.params?.method === 'create').length === 1));
  const all = await calls();
  const pre = all.find(c => c.params?.method === 'precreate');
  const up = all.find(c => c.url.includes('superfile2'));
  const cre = all.find(c => c.params?.method === 'create');
  ok('三步接口都调用了', !!(pre && up && cre));
  const cloud = await page.evaluate(() => window.localStorage.getItem('__bdCloud'));
  const expectMd5 = cloud ? md5hex(cloud) : '';
  const preForm = pre ? new URLSearchParams(pre.data) : null;
  ok('预上传路径 = /apps/{应用名}/backup.json', preForm?.get('path') === `/apps/${APP}/backup.json`, preForm?.get('path'));
  ok('预上传 rtype=3（同名覆盖）', preForm?.get('rtype') === '3', preForm?.get('rtype'));
  ok('block_list 的 MD5 与文件内容一致（自带 MD5 实现校验通过）', preForm?.get('block_list') === JSON.stringify([expectMd5]),
    `${preForm?.get('block_list')} vs ${expectMd5}`);
  ok('content-md5 / slice-md5 都填了', !!preForm?.get('content-md5') && !!preForm?.get('slice-md5'));
  const parts = JSON.parse(await page.evaluate(() => window.localStorage.getItem('__bdParts')));
  ok('分片上传带 uploadid 和 partseq=0', parts.uploadid === 'UPID-1' && parts.partseq === '0');
  ok('分片用 multipart 编码', parts.boundary === true);
  ok('上传内容包含流水数据', cloud && cloud.includes('"transactions"'));
  const creForm = cre ? new URLSearchParams(cre.data) : null;
  ok('create 的 block_list 与预上传一致', creForm?.get('block_list') === JSON.stringify([expectMd5]));
  bd = await bdState();
  ok('卡片显示上次备份时间与云端路径', bd.note.includes('/apps/'), bd.note.slice(0, 60));

  console.log('\n▸ 恢复到本机（filelist → filemetas → dlink）');
  // 云端内容追加一笔，恢复后应出现在本机
  const cloudObj = JSON.parse(cloud);
  cloudObj.transactions.push({ id: 'bd-x', type: 'expense', cents: 9999, cat: '餐饮', acct: '微信', date: new Date().toISOString().slice(0, 10), note: '百度云端来的', ts: 888, cur: 'CNY' });
  await page.evaluate(s => window.localStorage.setItem('__bdCloud', s), JSON.stringify(cloudObj));
  await page.click('#bd-restore');
  ok('等恢复完成', await waitFor(async () => page.evaluate(async () => {
    const open = () => new Promise((res, rej) => { const r = indexedDB.open('pocket_ledger'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const db = await open();
    const t = await new Promise((res, rej) => { const r = db.transaction('tx').objectStore('tx').get('bd-x'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return !!(t && t.note === '百度云端来的');
  })));
  ok('云端那笔已恢复进本机', await page.evaluate(async () => {
    const open = () => new Promise((res, rej) => { const r = indexedDB.open('pocket_ledger'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const db = await open();
    const t = await new Promise((res, rej) => { const r = db.transaction('tx').objectStore('tx').get('bd-x'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return t && t.note === '百度云端来的';
  }));
  const dlCall = (await calls()).find(c => c.url.includes('method=download'));
  ok('dlink 下载带了 pan.baidu.com UA', dlCall?.headers?.['User-Agent'] === 'pan.baidu.com');

  console.log('\n▸ 每日自动备份');
  await gotoSettings();
  await page.evaluate(() => document.getElementById('bd-auto').click());
  await sleep(300);
  ok('自动备份勾选被记住', (await bdState()).autoChecked === true);
  await page.evaluate(async () => {
    const open = () => new Promise((res, rej) => { const r = indexedDB.open('pocket_ledger'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const db = await open();
    await new Promise((res, rej) => { const tx = db.transaction('settings', 'readwrite'); tx.objectStore('settings').put({ k: 'bdLast', v: Date.now() - 25 * 3600 * 1000 }); tx.oncomplete = res; tx.onerror = rej; });
  });
  await goto();
  ok('等自动备份三步', await waitFor(async () => {
    const a = await calls();
    return a.filter(c => c.params?.method === 'precreate').length === 1
      && a.filter(c => c.url.includes('superfile2')).length === 1
      && a.filter(c => c.params?.method === 'create').length === 1;
  }));
  const afterAuto = await calls();
  ok('隔天打开触发静默上传（一次完整三步）',
    afterAuto.filter(c => c.params?.method === 'precreate').length === 1
    && afterAuto.filter(c => c.url.includes('superfile2')).length === 1
    && afterAuto.filter(c => c.params?.method === 'create').length === 1,
    `${afterAuto.length} 次调用`);
  await goto();
  await sleep(1200);
  const fresh = await calls();
  ok('同一天再打开不会重复备份', fresh.length === 0, `${fresh.length} 次调用`);

  console.log('\n▸ token 过期自动刷新（refresh_token 一次性）');
  await page.evaluate(async () => {
    const open = () => new Promise((res, rej) => { const r = indexedDB.open('pocket_ledger'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const db = await open();
    await new Promise((res, rej) => {
      const tx = db.transaction('settings', 'readwrite');
      const st = tx.objectStore('settings');
      const req = st.get('bdTokens');
      req.onsuccess = () => {
        const row = req.result;
        if (row) st.put({ k: 'bdTokens', v: { ...row.v, expiresAt: Date.now() - 1000 } });
        res();
      };
      tx.oncomplete = res; tx.onerror = rej;
    });
  });
  await goto();
  await waitFor(async () => (await tc()) > 0 || (await calls()).length >= 0 && false || Date.now() > 0 ? false : false, 0);
  await sleep(800);
  const tcBefore = await tc();
  await gotoSettings();
  await page.click('#bd-backup');
  ok('等刷新+上传完成', await waitFor(async () => {
    const a = await calls();
    return a.some(c => c.params?.method === 'precreate') && (await tc()) === tcBefore + 1;
  }));
  ok('先走 refresh_token 换新', (await tc()) === tcBefore + 1, `${tcBefore} → ${await tc()}`);
  const refreshReq = (await calls()).filter(c => c.url.includes('/oauth/2.0/token')).pop();
  ok('刷新请求带新的 refresh_token', refreshReq?.params?.grant_type === 'refresh_token'
    && String(refreshReq?.params?.refresh_token).startsWith('rt-'));
  ok('刷新后上传成功', (await calls()).some(c => c.params?.method === 'precreate'));

  console.log('\n▸ token 失效（errno=-6）给出明确提示');
  await page.evaluate(async () => {
    const open = () => new Promise((res, rej) => { const r = indexedDB.open('pocket_ledger'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const db = await open();
    await new Promise((res, rej) => {
      const tx = db.transaction('settings', 'readwrite');
      const st = tx.objectStore('settings');
      const req = st.get('bdTokens');
      req.onsuccess = () => {
        const row = req.result;
        if (row) st.put({ k: 'bdTokens', v: { accessToken: 'expired-test', refreshToken: null, expiresAt: Date.now() + 86400000 } });
        res();
      };
      tx.oncomplete = res; tx.onerror = rej;
    });
  });
  await goto();
  await sleep(1000);
  await gotoSettings();
  await page.click('#bd-backup');
  await waitFor(async () => {
    const t = await page.evaluate(() => { const el = document.getElementById('toast'); return el && !el.hidden ? el.textContent : ''; });
    return /过期|重新连接/.test(t);
  });
  const toast1 = await page.evaluate(() => {
    const t = document.getElementById('toast');
    return t && !t.hidden ? t.textContent : '';
  });
  ok('提示重新连接而不是笼统报错', /过期|重新连接/.test(toast1), toast1);

  console.log('\n▸ 解除连接');
  await page.click('#bd-disconnect');
  ok('等状态刷新', await waitFor(async () => (await bdState()).status === '未连接'));
  bd = await bdState();
  ok('状态回到未连接', bd.status === '未连接', bd.status);
  ok('回到连接按钮组', bd.offVisible && !bd.onVisible);
  ok('网盘里的备份文件仍在（模拟存储未清）', !!(await page.evaluate(() => window.localStorage.getItem('__bdCloud'))));

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('设置页无横向溢出', overflow <= 0, String(overflow));
  ok('全程无页面报错', errors.length === 0, errors[0]);
} finally {
  await browser.close();
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
