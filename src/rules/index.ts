/**
 * 校验处理器聚合入口（避免保留 `from './rules'` 断言）。
 * 实现已按内聚度拆分到同目录各模块（state/world/character/turn 等）。
 */
import type { Ledger } from '../ledger'
import type { Rules } from './types'
import { cultivationCap, fmtRealm, fmtStatus, fmtTime, publicState, stageOf, worldSetting } from './state'
import { makeApplyWorldBase, makeApplyNpcPool, makeApplyOrigins, makeApplyTalents, parseOriginPool, parseTalentPool } from './world'
import { makeApplyCharacter } from './character'
import { calcBreakthroughRate } from './breakthrough'
import { makeApplyBreakthrough, makeApplyTurn } from './turn'
import { validateOpening, makeCheckLife } from './choice'
import { makeApplyBattle } from './confrontation'
import { makeApplyDecadalEvents } from './majorEvents'

// 兼容保留原样（views/flows 直接导入）
export { stageOf, fmtTime, fmtRealm, cultivationCap, publicState, fmtStatus, fmtAssets, worldSetting } from './state'
export type { Rules } from './types'
export { calcBreakthroughRate } from './breakthrough'
export { parseOriginPool, parseTalentPool } from './world'

/**
 * 处理器实例工厂（闭包注入 ledger，确保所有处理器同数据源）。
 */
export function createRules(ledger: Ledger): Rules {
  return {
    publicState,
    fmtStatus,
    fmtRealm,
    cultivationCap,
    worldSetting,
    applyWorldBase: makeApplyWorldBase(ledger),
    applyNpcPool: makeApplyNpcPool(ledger),
    applyOrigins: makeApplyOrigins(ledger),
    applyTalents: makeApplyTalents(ledger),
    applyCharacter: makeApplyCharacter(ledger),
    applyTurn: makeApplyTurn(ledger),
    applyDecadalEvents: makeApplyDecadalEvents(ledger),
    applyBattle: makeApplyBattle(ledger),
    validateOpening,
    checkLife: makeCheckLife(ledger),
    parseOriginPool,
    parseTalentPool,
    calcBreakthroughRate,
    applyBreakthrough: makeApplyBreakthrough(ledger),
  }
}