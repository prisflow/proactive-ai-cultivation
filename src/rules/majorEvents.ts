/**
 * 大事件落账：generate_major_events 的 LLM 实写结果校验后写入 w.majorEvents。
 * （从 flows/majorEvents.ts 迁入——apply 类处理器统一归 rules 集合。）
 */
import type { FlowCtx } from '@prisflow/proactiveai-plugin-types'
import type { Ledger, WorldState } from '../ledger'

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