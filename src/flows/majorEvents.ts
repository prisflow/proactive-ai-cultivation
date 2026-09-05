/**
 * @fileoverview 大事件生成管线模块
 * @description generate_major_events 流程：初始化 → LLM 生成 → 校验落库（rules.applyDecadalEvents）。
 * 大事件时间线的展示由头部 worldSetting 状态卡承担（prompts.set），本流程无需渲染节点。
 * 落账处理器 makeApplyDecadalEvents 归属 rules 集合（与其他 apply 一致）。
 */
import type { PluginSetupAPI } from '@prisflow/proactiveai-plugin-types'
import type { FlowCtx } from '@prisflow/proactiveai-plugin-types'
import type { Ledger, WorldState } from '../ledger'
import type { Rules } from '../rules'
import { initCtx } from './helpers'
import { DECADAL_EVENTS_SCHEMA } from './schemas'
import { MAJOR_EVENTS_SYSTEM } from '../prompts'

/**
 * 注册大事件生成流程
 * @param api - 插件注册 API
 * @param ledger - 世界账本
 * @param rules - 规则集（applyDecadalEvents 落账）
 * @description 注册 generate_major_events 流程：初始化 → LLM 生成 → 校验落库，无需渲染
 */
export function registerMajorEventsFlows(api: PluginSetupAPI, ledger: Ledger, rules: Rules): void {
  api.flow.register({
    name: 'generate_major_events',
    nodes: [
      // [static] 上下文初始化：加载 ledger.getWorld 到 ctx.state._w | 规则: initCtx(ledger)
      { type: 'static', fn: initCtx(ledger) },
      // [llm] 大事件生成：基于当前时间与已有大事件（name@at）生成未来五十年 15-30 条（防重名/时间锚定）；
      // 世界名/地域/宗门由头部 worldSetting 状态卡承担，不再局部注入 | prompt: MAJOR_EVENTS_SYSTEM | schema: DECADAL_EVENTS_SCHEMA | assign: decadalEvents
      {
        type: 'llm',
        system: MAJOR_EVENTS_SYSTEM,
        input: (ctx: FlowCtx) => {
          const w = ctx.state._w as WorldState
          const existing = w.majorEvents.map((e) => `${e.name}@${e.at}`)
          return `当前时间：第${w.stats.timeMonth}月\n已有大事件：${JSON.stringify(existing)}\n请生成未来五十年 15-30 条大事件，均匀分布在 50 年内（at 须 >${w.stats.timeMonth} 且 ≤${w.stats.timeMonth + 600}）。`
        },
        schema: DECADAL_EVENTS_SCHEMA,
        assign: 'decadalEvents',
      },
      // [static] 校验落库：decadalEvents 校验后写入 w.majorEvents 并 saveAll，失败直接阻断（调度器级兜底） | 读 decadalEvents | 规则: rules.applyDecadalEvents
      { type: 'static', fn: (ctx) => rules.applyDecadalEvents(ctx) ?? undefined },
    ],
    requireRender: false,
  })
}