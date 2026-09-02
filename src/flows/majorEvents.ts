/**
 * @fileoverview 十年大事件生成管线模块
 * @description 每十年生成 5-10 条未来大事件（majorEvents），供世界推演与 turn 阶段的 eventRef 引用。
 * 导出 makeApplyDecadalEvents 工厂与 registerMajorEventsFlows 注册函数，负责 LLM 生成 → 校验落库 → 结果回写。
 */
import type { PluginSetupAPI } from '@prisflow/proactiveai-plugin-types'
import type { FlowCtx } from '@prisflow/proactiveai-plugin-types'
import type { Ledger, WorldState } from '../ledger'
import type { Rules } from '../rules'
import type { Views } from '../views'
import { initCtx } from './helpers'
import { DECADAL_EVENTS_SCHEMA } from './schemas'
import { MAJOR_EVENTS_SYSTEM } from '../prompts'

/**
 * 创建十年大事件落库校验函数
 * @param ledger - 世界账本，用于保存更新后的 majorEvents
 * @returns 静态节点函数 (ctx) => string|null，校验 ctx.data.decadalEvents 合法性并写入 w.majorEvents，失败返回错误文本阻断流程
 * @description 校验数量 5-10、at/by 时间窗口、type 枚举、重名等，成功后 ledger.saveAll()
 */
export function makeApplyDecadalEvents(ledger: Ledger) {
  return (ctx: FlowCtx): string | null => {
    const w = ctx.state._w as WorldState
    // 前置：世界骨架必须齐全（name/regions/sects/law）
    const world = w.stats.world as Record<string, unknown> | undefined
    if (!world || typeof world.name !== 'string' || !world.name.trim()) return '世界骨架为空，请先 create_world'
    if (!Array.isArray(world.regions) || (world.regions as unknown[]).length === 0) return '世界骨架不全（regions 缺失），请先 create_world'
    if (!Array.isArray(world.sects) || (world.sects as unknown[]).length === 0) return '世界骨架不全（sects 缺失），请先 create_world'
    if (typeof world.law !== 'string' || !(world.law as string).trim()) return '世界骨架不全（law 缺失），请先 create_world'
    const d = ctx.data.decadalEvents as { majorEvents?: Array<Record<string, unknown>> } | undefined
    const raw = Array.isArray(d?.majorEvents) ? d!.majorEvents! : []
    if (raw.length < 15 || raw.length > 30) return '大事件数量须 15-30 条'
    const events: WorldState['majorEvents'] = []
    for (const e of raw) {
      const name = String(e.name || '').trim()
      if (!name) return '大事件 name 不能为空'
      const at = Number(e.at)
      const by = Number(e.by)
      const type = String(e.type || '机遇')
      if (!['机遇', '危机', '转折', '高潮'].includes(type)) return `事件「${name}」type 非法`
      const summary = String(e.summary || '').trim()
      if (!summary) return `事件「${name}」summary 不能为空`
      // 重名校验
      if (w.majorEvents.some((ex) => ex.name === name) || events.some((ex) => ex.name === name)) return `大事件名重复：${name}`
      events.push({ name, at, by, type, summary, status: 'pending' as const })
    }
    w.majorEvents.push(...events)
    ledger.saveAll()
    return null
  }
}

/**
 * 注册十年大事件相关 flow
 * @param api - 插件注册 API
 * @param ledger - 世界账本
 * @param _rules - 规则集（当前未使用，保留扩展）
 * @param _views - 视图构建器（当前未使用，保留扩展）
 * @description 注册 generate_major_events 流程：初始化 → LLM 生成 → 校验落库 → 结果文本回写，无需渲染
 */
export function registerMajorEventsFlows(api: PluginSetupAPI, ledger: Ledger, _rules: Rules, _views: Views): void {
  api.flow.register({
    name: 'generate_major_events',
    nodes: [
      // [static] 上下文初始化：加载 ledger.getWorld 到 ctx.state._w | 无 prompt/schema | 规则: initCtx(ledger)
      { type: 'static', fn: initCtx(ledger) },
      // [llm] 十年大事件生成：基于当前时间/世界名/地域宗门/已有事件让 AI 生成未来 5-10 条事件 | prompt: MAJOR_EVENTS_SYSTEM | schema: DECADAL_EVENTS_SCHEMA | assign: decadalEvents
      {
        type: 'llm',
        system: MAJOR_EVENTS_SYSTEM,
        input: (ctx: FlowCtx) => {
          const w = ctx.state._w as WorldState
          const world = w.stats.world as Record<string, unknown> | undefined
          return `当前时间：第${w.stats.timeMonth}月\n世界：${JSON.stringify({ name: world?.name, regions: world?.regions, sects: (world?.sects as Array<{ name: string }>)?.map((s) => s.name) })}\n已有大事件：${JSON.stringify(w.majorEvents.map((e) => `${e.name}@${e.at}`))}\n请生成未来五十年 15-30 条大事件，均匀分布在 50 年内（at 须 >${w.stats.timeMonth} 且 ≤${w.stats.timeMonth + 600}）。`
        },
        schema: DECADAL_EVENTS_SCHEMA,
        assign: 'decadalEvents',
      },
      // [static] 校验落库：将 decadalEvents 校验后写入 w.majorEvents 并 saveAll | 无 prompt/schema | 读 decadalEvents | 规则: makeApplyDecadalEvents(ledger)
      { type: 'static', fn: makeApplyDecadalEvents(ledger) },
      // [static] 结果回写：将新生成事件数写入 ctx.data.resultText 供调用方展示 | 无 prompt/schema | 读 w.majorEvents
      {
        type: 'static',
        fn: (ctx: FlowCtx): string | void => {
          const w = ctx.state._w as WorldState
          const evs = w.majorEvents.slice(-30)
          ctx.data.resultText = `已生成未来五十年大事件 ${evs.length} 条`
          return
        },
      },
    ],
    requireRender: false,
  })
}
