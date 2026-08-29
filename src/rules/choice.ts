/**
 * 选择与开场校验、寿命检查（已去硬校验，仅留映射）。 */
import type { FlowCtx } from '@prisflow/proactiveai-plugin-types'
import type { Ledger, WorldState } from '../ledger'

/**
 * 鎶夋嫨鏍￠獙锛堝凡鍘荤‖鏍￠獙锛屽缁堥€氳繃锛屼氦鐢?schema锛夈€? */
export function validateChoice(_ctx: FlowCtx): string | null {
  return null
}

/**
 * 开场剧情校验（已去硬校验，始终通过）。 */
export function validateOpening(_ctx: FlowCtx): string | null {
  return null
}

/**
 * 存储轻量分支预告到 pendingBranch（来源 = 说书人节点直接输出的 turn.options）。 */
export function makeStorePendingBranch(ledger: Ledger): (ctx: FlowCtx) => string | null {
  return (ctx: FlowCtx): string | null => {
    const w = ctx.state._w as WorldState
    const turn = ctx.data.turn as { options?: Array<{ text: string; risk: string; branches?: Array<{ id: string; title: string; kind: 'battle' | 'other'; prob: number; simpleDesc: string; requiresTechnique?: string }> }> } | undefined
    const options = turn?.options
    if (!options || !Array.isArray(options)) return null
    w.pendingBranch = {
      turnId: w.meta.turns,
      options: options.map((o) => ({
        text: String(o.text || ''),
        risk: String(o.risk || '无'),
        branches: (o.branches || []).map((b) => ({
          id: String(b.id || b.title || ''),
          title: String(b.title || ''),
          kind: (b.kind === 'battle' ? 'battle' : 'other') as 'battle' | 'other',
          prob: Number(b.prob) || 0.5,
          simpleDesc: String(b.simpleDesc || ''),
          requiresTechnique: typeof b.requiresTechnique === 'string' ? b.requiresTechnique : undefined,
        })),
      })),
    }
    ledger.saveAll()
    return null
  }
}

/**
 * 死亡检查（寿元耗尽）。 */
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
