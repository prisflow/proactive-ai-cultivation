/**
 * @fileoverview 流程公共 helpers 模块
 * @description 提供所有流程共享的静态节点辅助函数，职责包括：
 * - 将 Ledger 中的世界状态加载到 FlowCtx（initCtx）
 * - 全量重置世界/角色状态（resetWorld / resetCharacter）
 * - 纪元轮回的时间推进与归档准备（prepareEraRebirth）
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
 * @description 将 meta/stats/majorEvents/pendingBranch/story.log 全量重置为 newWorld 初始值，用于 create_world 流程的起点
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
  w.pendingBranch = null
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
  w.pendingBranch = null
  }

/**
 * 百年轮回准备：基于原世界演化（时间推进 + 保留纪元史 + 清档重建）
 * @param ctx - 流程上下文，需包含 ctx.state._w 与 ctx.data
 * @param years - 推演年数（至少 1 年，实际按月换算）
 * @param ledger - 账本实例（当前实现未直接使用，保留扩展）
 * @returns void | string，正常返回 void，异常可返回错误文本阻断流程
 * @description 供 era_rebirth 流程复用：累加 timeMonth、扣减 lifespan、归档上纪元世界摘要、保留 log 与时间，其余重置为 newWorld；纪元史由宿主记忆层维护
 */
export function prepareEraRebirth(ctx: { state: Record<string, unknown>; input?: unknown; data: Record<string, unknown> }, years: number, ledger: Ledger): string | void {
  const w = ctx.state._w as WorldState
  const months = Math.max(12, years * 12)
  // 1. 时间推演（复用 advanceTime 逻辑需通过 rules；此处仅累加时间与寿元，事件/NPC 演化由后续 LLM 基于旧世界文本推演）
  w.stats.timeMonth += months
  w.stats.lifespan -= months / 12
  if (w.stats.lifespan <= 0 && !w.meta.dead) {
    w.meta.dead = false
  }
  // 2. 归档上纪元
  const prevName = w.stats.name || '无名'
  const prevWorld = JSON.stringify(w.stats.world).slice(0, 800)
  // 3. 选择性重置：保留 timeMonth，重置角色系与当前事件/战斗，保留纪元史
  const fresh = newWorld()
  const keptTime = w.stats.timeMonth
  w.meta = { initialized: false, created: false, dead: false, turns: 0 }
  w.stats = { ...fresh.stats, timeMonth: keptTime }
  w.majorEvents = []
  // 4. 纪元史由宿主通用记忆层维护，不再写入插件 memory
  // 旧大事件归档
  ctx.data.eraPrevWorld = prevWorld
  ctx.data.eraYears = years
}