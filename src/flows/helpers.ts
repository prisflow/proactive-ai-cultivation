/**
 * @fileoverview 流程公共 helpers 模块
 * @description 提供所有流程共享的静态节点辅助函数，职责包括：
 * - 将 Ledger 中的世界状态加载到 FlowCtx（initCtx）
 * - 全量重置世界/角色状态（resetWorld / resetCharacter）
 * 本文件仅依赖 ledger，不含任何 LLM 或业务校验逻辑，供 game.ts / turn.ts / majorEvents.ts 等流程复用。
 */
import type { Ledger, WorldState } from '../ledger'
import { newWorld } from '../ledger'

/**
 * 创建 ctx 初始化静态节点函数
 * @param ledger - 世界账本，用于按 conversationId 取回 WorldState
 * @returns 静态节点函数 (ctx) => void，将 ledger.getWorld 结果写入 ctx.state._w，供后续所有节点消费
 * @description 每个 flow 的首节点必调，确保 ctx.state._w 已就绪；属于 static 节点，无 LLM 调用
 */
export function initCtx(ledger: Ledger) {
  return (ctx: { state: Record<string, unknown>; conversationId?: string }): string | void => {
    ctx.state._w = ledger.getWorld(ctx.conversationId ?? '')
  }
}

/**
 * 重新开局：重置世界状态（转世重修，全量清空）
 * @param ctx - 流程上下文，需包含 ctx.state._w
 * @description 将 meta/stats/majorEvents 全量重置为 newWorld 初始值，用于 create_world 流程的起点
 */
export function resetWorld(ctx: { state: Record<string, unknown> }): void {
  const w = ctx.state._w as WorldState
  const fresh = newWorld()
  w.meta.initialized = false
  w.meta.created = false
  w.meta.dead = false
  w.meta.deathCause = undefined
  w.meta.turns = 0
  w.stats = fresh.stats
  w.majorEvents = []
}

/**
 * 仅重置角色（保留世界/出身池/天资池/大事件/时间，不推时间）
 * @param ctx - 流程上下文，需包含 ctx.state._w
 * @description 用于 reset_character 流程：清空角色姓名/境界/修为/寿命/背包等角色维度，保留世界观与纪事 log，仅追加轮回提示
 */
export function resetCharacter(ctx: { state: Record<string, unknown> }): void {
  const w = ctx.state._w as WorldState
  w.meta.created = false
  w.meta.dead = false
  w.meta.deathCause = undefined
  w.meta.turns = 0
  w.stats.name = ''
  w.stats.gender = '男'
  w.stats.temperament = ''
  w.stats.realm = '凡人'
  w.stats.realmStage = 1
  w.stats.cultivation = 0
  w.stats.lifespan = 80
  w.stats.timeMonth = 0
  w.stats.npcGrowthMonths = 0
  w.stats.location = ''
  w.stats.hp = 100
  w.stats.maxHp = 100
  w.stats.spiritStones = 0
  w.stats.methods = []
  w.stats.mainMethod = null
  w.stats.talents = null
  w.stats.pills = []
  w.stats.breakBonus = 0
  }