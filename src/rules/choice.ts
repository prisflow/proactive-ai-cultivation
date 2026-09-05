/**
 * 开场校验（已去硬校验，始终通过——约束由 schema 承担）。
 * （原 validateChoice/makeStorePendingBranch 已随风险分支系统下线删除。）
 */
import type { FlowCtx } from '@prisflow/proactiveai-plugin-types'
import type { Ledger, WorldState } from '../ledger'

export function validateOpening(_ctx: FlowCtx): string | null {
  return null
}

export function makeCheckLife(ledger: Ledger): (w: WorldState) => boolean {
  return (w: WorldState): boolean => {
    if (w.stats.lifespan <= 0 && !w.meta.dead) {
      w.meta.dead = true
      w.meta.deathCause = '寿元耗尽'
      ledger.saveAll()
      return true
    }
    return false
  }
}
