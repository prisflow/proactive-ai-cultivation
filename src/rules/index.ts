/**
 * 校验与结算层聚合入口：对外保持 `from './rules'` 不变。
 * 具体实现已按内聚度拆至同级子模块（state/world/character/turn 等）。
 */
import type { Ledger } from '../ledger'
import type { Rules } from './types'
import { cultivationCap, fmtRealm, fmtStatus, fmtTime, publicState, stageOf, worldSetting } from './state'
import { makeApplyWorldBase, makeApplyNpcPool, makeApplyOrigins, makeApplyTalents, parseOriginPool, parseTalentPool } from './world'
import { makeApplyCharacter } from './character'
import { calcBreakthroughRate } from './breakthrough'
import { makeApplyBreakthrough, makeApplyTurn } from './turn'
import { makeCheckLife, validateChoice, validateOpening, makeStorePendingBranch } from './choice'
import { makeApplyConfrontationBattle } from './confrontation'

// 对外保持原有命名导出（供 views/flows 直接导入）
export { stageOf, fmtTime, fmtRealm, cultivationCap, publicState, fmtStatus, worldSetting } from './state'
export type { Rules } from './types'
export { parseOriginPool, parseTalentPool } from './world'

/**
 * 创建规则实例（薄壳节点调用的纯函数集合）。
 * 内部通过工厂闭包注入 ledger，确保所有结算均能落盘。
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
    applyConfrontationBattle: makeApplyConfrontationBattle(ledger),
    validateChoice,
    validateOpening,
    storePendingBranch: makeStorePendingBranch(ledger),
    checkLife: makeCheckLife(ledger),
    parseOriginPool,
    parseTalentPool,
    calcBreakthroughRate,
    applyBreakthrough: makeApplyBreakthrough(ledger),
  }
}
