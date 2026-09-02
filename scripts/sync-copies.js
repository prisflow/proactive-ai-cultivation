// deploy 后同步副本：
// 1. userData/plugins/cultivation.json 的 version 与 package.json 对齐（宿主展示元数据）
// 2. D 盘查看副本（与 userData/plugins 的产物保持一致）
const fs = require('fs')
const path = require('path')

const pluginsDir = 'C:/Users/31100/AppData/Roaming/proactive-ai-desktop/plugins'
const manifestPath = path.join(pluginsDir, 'cultivation.json')

// 同步 manifest version（bundle 内 plugin.version 的来源就是 package.json version）
if (fs.existsSync(manifestPath)) {
  const readJsonNoBom = (p) => JSON.parse(fs.readFileSync(p, 'utf-8').replace(/^\uFEFF/, '')) // package.json/manifest 均可能带 BOM
  const pkg = readJsonNoBom(path.join(__dirname, '../package.json'))
  const manifest = readJsonNoBom(manifestPath)
  if (manifest.version !== pkg.version) {
    manifest.version = pkg.version
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
    console.log('manifest version synced ->', pkg.version)
  }
}

// D 盘查看副本
const src = path.join(pluginsDir, 'cultivation.js')
const targets = [
  'D:/proactive-ai-desktop/cultivation.js',
]

for (const t of targets) {
  fs.copyFileSync(src, t)
  console.log('synced ->', t)
}