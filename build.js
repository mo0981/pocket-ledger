const fs = require('fs');
const path = require('path');

const root = __dirname;
const out = path.join(root, 'www');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const files = ['index.html', 'style.css', 'manifest.json', 'sw.js'];
for (const f of files) {
  fs.copyFileSync(path.join(root, f), path.join(out, f));
}

for (const dir of ['js', 'icons']) {
  fs.cpSync(path.join(root, dir), path.join(out, dir), { recursive: true });
}

const count = files.length + fs.readdirSync(path.join(out, 'js')).length + fs.readdirSync(path.join(out, 'icons')).length;
console.log(`✓ www/ 已生成，共 ${count} 个文件`);
