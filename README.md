# proactive-ai-cultivation

ProactiveAI 修仙世界插件：flow 驱动的文字修仙玩法。

- 宣发站：[proactiveai.prisflow.com](https://proactiveai.prisflow.com)
- 实现详解博客：[一张插件，让 AI 变身游戏：修仙插件是如何实现的](https://proactiveai.prisflow.com/blog/plugin-ecosystem-cultivation)
- 宿主项目：[prisflow/proactive-ai-desktop](https://github.com/prisflow/proactive-ai-desktop)

## Roadmap

- **0.7.0**：flow 节点原生自我评审——LLM 节点支持 reviewPrompt（评审提示词属性）与 maxRetries（重试次数）配置，替代当前手搭的评审/重试分支管线（v0.6.0 已全部移除手搭评审链与合规重试分支，失败走调度器级兜底）

## 这是什么

一个 ProactiveAI 桌面版的官方示例插件。用插件 API 注册了一个完整「修仙世界」子上下文：AI 旁白叙事、静态规则节点结算境界/修为/生命、UI 消息渲染状态栏与选项卡片。

插件以 **zip 包**分发（`plugin.json` 元数据 + 单文件入口），在宿主应用「设置 → 插件 → 导入插件」中选择 zip 即可安装，安装后自动加载。

## 开发

```bash
pnpm install        # 安装依赖（含 @prisflow/proactiveai-plugin-types 类型契约）
pnpm build          # esbuild 打包为单文件 CJS -> dist/cultivation.js
pnpm deploy         # 本地部署：打包到宿主 userData/plugins/cultivation.js 并同步副本
```

## 插件结构

```
src/
├── index.ts        # 插件入口：注册上下文 + 工具 + Flow
├── tools.ts        # 8 个工具注册（create_world / game_turn 等）
├── flows/          # Flow 图定义（llm/static/render 节点）
├── rules/          # 静态规则：境界/功法/丹药/战斗/世界
├── ledger.ts       # 插件状态账本（SQLite plugin_data）
├── views.ts        # UI 消息（PlayerStatus/StorySummary/ChoiceCardList）
├── prompts.ts      # 提示词组装
└── constants.ts    # 世界设定常量
```

## 打 zip 分发

构建后把 `plugin.json` 与 `dist/cultivation.js` 打进一个 zip：

```
cultivation.zip
├── plugin.json      # id/name/version/entry 等元数据
└── cultivation.js   # 单文件入口（CJS）
```

## 许可证

MIT
