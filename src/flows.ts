/**
 * @fileoverview 图定义聚合入口（对外保持 `from './flows'` 不变）
 * @description 统一暴露 registerFlows 作为插件初始化时的唯一注册入口，内部按内聚度拆至 ./flows 子目录：
 * - game.ts：世界创建/角色创建/纪元轮回等初始化管线
 * - turn.ts：主推进 game_turn 管线（含冲突分支与突破）
 * - majorEvents.ts：十年大事件生成管线
 * 调用方（src/index.ts）只需 import { registerFlows } 即可完成全部 flow 注册。
 */
import type { PluginSetupAPI } from '@prisflow/proactiveai-plugin-types'
import type { Ledger } from './ledger'
import type { Rules } from './rules'
import type { Views } from './views'
import { registerGameFlows } from './flows/game'
import { registerTurnFlows } from './flows/turn'
import { registerMajorEventsFlows } from './flows/majorEvents'
import { registerQueryFlows } from './flows/query'

/**
 * 注册全部流程到宿主 flow 引擎
 * @param api - 插件注册 API，提供 api.flow.register
 * @param ledger - 世界账本，用于状态读写与持久化
 * @param rules - 规则集，提供校验与落库方法
 * @param views - 视图构建器，提供首屏/主屏渲染函数
 * @description 依次调用 game / turn / majorEvents / query 四个子模块的注册函数，完成 create_world、create_character、game_turn、game_query 等全部 flow 的挂载
 */
export function registerFlows(api: PluginSetupAPI, ledger: Ledger, rules: Rules, views: Views): void {
  registerGameFlows(api, ledger, rules, views)
  registerTurnFlows(api, ledger, rules, views)
  registerMajorEventsFlows(api, ledger, rules)
  registerQueryFlows(api, ledger, rules)
}

/**
 * 兼容导出：子模块需要 worldGenNodes 时可从 game 导入
 * @description 将 ./flows/game 的 worldGenNodes 工厂重新导出，保持 `from './flows'` 的兼容引用路径
 */
export { worldGenNodes } from './flows/game'
