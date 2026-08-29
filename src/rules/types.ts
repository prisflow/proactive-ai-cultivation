/**
 * 规则层类型定义：对外暴露的 Rules 契约。
 */
import type { FlowCtx } from '@proactive-ai/plugin-types'
import type { WorldState } from '../ledger'

/**
 * 校验与结算层对外接口。
 * 供 Flow 节点与 Views 调用的纯函数/结算函数集合。
 */
export interface Rules {
  publicState(w: WorldState): Record<string, unknown>
  fmtStatus(w: WorldState): string
  fmtRealm(w: WorldState): string
  cultivationCap(w: WorldState): number
  /** 慢变世界状态卡（world_setting 记忆 slot 内容）。 */
  worldSetting(w: WorldState): string
  applyWorldBase(ctx: FlowCtx): string | null
  applyNpcPool(ctx: FlowCtx): string | null
  applyOrigins(ctx: FlowCtx): string | null
  applyTalents(ctx: FlowCtx): string | null
  applyCharacter(ctx: FlowCtx): string | null
  applyTurn(ctx: FlowCtx): string | null
  /** 冲突战斗实写结算（并入 game_turn，死了必死） */
  applyConfrontationBattle(ctx: FlowCtx): string | null
  validateChoice(ctx: FlowCtx): string | null
  validateOpening(ctx: FlowCtx): string | null
  /** 存储轻量分支预告到 pendingBranch（校验通过后调用） */
  storePendingBranch(ctx: FlowCtx): string | null
  /** 死亡检查（时间推进类结算后调用）：寿元耗尽判定。 */
  checkLife(w: WorldState): boolean
  parseOriginPool(w: WorldState): Record<string, unknown>[]
  parseTalentPool(w: WorldState): Record<string, unknown>[]
  calcBreakthroughRate(w: WorldState): { rate: number; talentBonus: number; base: number; breakBonus: number }
  applyBreakthrough(ctx: FlowCtx): string | null
}
