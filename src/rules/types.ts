/**
 * 规则集类型定义：对外暴露的 Rules 契约。
 */
import type { FlowCtx } from '@prisflow/proactiveai-plugin-types'
import type { WorldState } from '../ledger'

/**
 * 校验器与处理器接口。
 * 由 Flow 节点与 Views 层调用的处理器/计算函数集合。
 */
export interface Rules {
  publicState(w: WorldState): Record<string, unknown>
  fmtStatus(w: WorldState): string
  fmtRealm(w: WorldState): string
  cultivationCap(w: WorldState): number
  /** 慢变世界状态卡（world_setting 头部 slot 数据）。 */
  worldSetting(w: WorldState): string
  applyWorldBase(ctx: FlowCtx): string | null
  applyNpcPool(ctx: FlowCtx): string | null
  applyOrigins(ctx: FlowCtx): string | null
  applyTalents(ctx: FlowCtx): string | null
  applyCharacter(ctx: FlowCtx): string | null
  applyTurn(ctx: FlowCtx): string | null
  /** 大事件时间线落账（generate_major_events；校验 15-30 条/时间窗口/重名）。 */
  applyDecadalEvents(ctx: FlowCtx): string | null
  /** 战斗实写落账（game_battle；含提示选项反重复登记）。 */
  applyBattle(ctx: FlowCtx): string | null
  validateOpening(ctx: FlowCtx): string | null
  /** 寿命审查（时间推进后调用，寿元耗尽判死）。 */
  checkLife(w: WorldState): boolean
  parseOriginPool(w: WorldState): Record<string, unknown>[]
  parseTalentPool(w: WorldState): Record<string, unknown>[]
  calcBreakthroughRate(w: WorldState): { rate: number; talentBonus: number; base: number; breakBonus: number }
  applyBreakthrough(ctx: FlowCtx): string | null
}