// deploy 后同步副本：D 盘查看副本（与 userData/plugins 的产物保持一致）
const fs = require('fs')

const src = 'C:/Users/31100/AppData/Roaming/proactive-ai-desktop/plugins/cultivation.js'
const targets = [
  'D:/proactive-ai-desktop/cultivation.js',
]

for (const t of targets) {
  fs.copyFileSync(src, t)
  console.log('synced ->', t)
}
