// 局域网传输服务：手机连同一个 WiFi，浏览器访问即可下载 APK
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 8088;
const ROOT = __dirname;

/* 自动挑最新的 小账本-*.apk，避免改了版本还发旧包 */
function latestApk() {
  const files = fs.readdirSync(ROOT)
    .filter(f => /^小账本-v.*\.apk$/i.test(f))
    .map(f => ({ f, t: fs.statSync(path.join(ROOT, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return files[0] ? files[0].f : null;
}

const server = http.createServer((req, res) => {
  const FILE = latestApk();
  if (!FILE) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('没有找到 APK');
  }
  const full = path.join(ROOT, FILE);
  const stat = fs.statSync(full);
  const size = stat.size;

  // 支持断点续传
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m && m[1] ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? parseInt(m[2], 10) : size - 1;
    res.writeHead(206, {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(FILE)}`
    });
    return fs.createReadStream(full, { start, end }).pipe(res);
  }

  res.writeHead(200, {
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Length': size,
    'Accept-Ranges': 'bytes',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(FILE)}`
  });
  fs.createReadStream(full).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const n of nets[name] || []) {
      if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
    }
  }
  const f = latestApk();
  const mb = (fs.statSync(path.join(ROOT, f)).size / 1048576).toFixed(1);
  console.log(`已启动，文件: ${f} (${mb} MB)`);
  console.log('手机浏览器访问以下任一地址：');
  ips.forEach(ip => console.log(`  http://${ip}:${PORT}/`));
});
