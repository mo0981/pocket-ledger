// 把构建出来的 APK 归档到 release/ 和桌面/小账本/，不在桌面根目录留垃圾
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const gradle = fs.readFileSync(path.join(root, 'android/app/build.gradle'), 'utf8');
const vm = gradle.match(/versionName\s+"([^"]+)"/);
const vc = gradle.match(/versionCode\s+(\d+)/);
if (!vm) {
  console.error('✗ 读不到 versionName');
  process.exit(1);
}
const version = vm[1];
const versionCode = vc ? vc[1] : '?';

const src = path.join(root, 'android/app/build/outputs/apk/debug/app-debug.apk');
if (!fs.existsSync(src)) {
  console.error('✗ 找不到构建产物，先跑 assembleDebug');
  process.exit(1);
}

const name = `小账本-v${version}.apk`;
const dirs = [path.join(root, 'release')];

// 顺便镜像一份到桌面，方便直接装。但只在**已经存在**这个文件夹时才写：
// 别人克隆下来跑一次，不该在自己桌面凭空多出一个「小账本」文件夹，
// 更不该被这个脚本删掉旧包。
const desktopDir = path.join(process.env.USERPROFILE || process.env.HOME || root, 'Desktop', '小账本');
if (fs.existsSync(desktopDir)) dirs.push(desktopDir);

const buf = fs.readFileSync(src);
const md5 = crypto.createHash('md5').update(buf).digest('hex');

for (const d of dirs) {
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, name), buf);
}

// 顺手清掉同目录下的旧版本，只留最近 3 个
for (const d of dirs) {
  const old = fs.readdirSync(d)
    .filter(f => /^小账本-v.*\.apk$/.test(f) && f !== name)
    .map(f => ({ f, t: fs.statSync(path.join(d, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .slice(2);
  for (const o of old) fs.unlinkSync(path.join(d, o.f));
}

console.log(`✓ 已归档 ${name}  (versionCode ${versionCode}, ${buf.length} 字节)`);
console.log(`  MD5 ${md5}`);
for (const d of dirs) console.log(`  → ${d}`);
