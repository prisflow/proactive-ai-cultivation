/**
 * 分支抽检：轻量分支预告的匹配与纯概率抽样（已去硬校验，仅留映射）。
 */
import type { WorldState, PendingBranch } from '../ledger'

export function matchBranchInput(inputText: string, pending: PendingBranch | null): { optionIndex: number; branchIndex: number } | null {
  if (!pending || !pending.options.length) return null
  const t = (inputText || '').trim()
  if (!t) return null
  for (let oi = 0; oi < pending.options.length; oi++) {
    const opt = pending.options[oi]
    const hitOption = t.includes(opt.text) || t.includes(`选项${oi + 1}`) || t.includes(`选${oi + 1}`) || t === opt.text
    if (!opt.branches || opt.branches.length === 0) {
      if (hitOption) return { optionIndex: oi, branchIndex: -1 }
      continue
    }
    for (let bi = 0; bi < opt.branches.length; bi++) {
      const b = opt.branches[bi]
      if (t.includes(b.title) || t.includes(b.id) || t.includes(b.simpleDesc.slice(0, 8))) {
        return { optionIndex: oi, branchIndex: bi }
      }
    }
    if (hitOption) return { optionIndex: oi, branchIndex: -2 }
  }
  for (let oi = 0; oi < pending.options.length; oi++) {
    const opt = pending.options[oi]
    if (!opt.branches) continue
    for (let bi = 0; bi < opt.branches.length; bi++) {
      if (t === opt.branches[bi].title) return { optionIndex: oi, branchIndex: bi }
    }
  }
  return null
}

export function pickBranch(branches: Array<{ prob: number }>): number {
  const sum = branches.reduce((a, b) => a + Math.max(0, b.prob), 0)
  if (sum <= 0) return Math.floor(Math.random() * branches.length)
  let r = Math.random() * sum
  for (let i = 0; i < branches.length; i++) {
    const w = Math.max(0, branches[i].prob)
    if (r < w) return i
    r -= w
  }
  return branches.length - 1
}

export function resolvePendingBranchPick(inputText: string, w: WorldState): { kind: 'battle' | 'other'; title: string; simpleDesc: string } | null {
  const pending = w.pendingBranch
  if (!pending) return null
  const match = matchBranchInput(inputText, pending)
  if (!match) return null
  const opt = pending.options[match.optionIndex]
  if (!opt.branches || opt.branches.length === 0) return null
  const pickedIdx = pickBranch(opt.branches)
  const picked = opt.branches[pickedIdx]
  return { kind: picked.kind, title: picked.title, simpleDesc: picked.simpleDesc }
}

export function consumePendingBranch(inputText: string, w: WorldState): { kind: 'battle' | 'other'; title: string; simpleDesc: string } | null {
  const pending = w.pendingBranch
  if (!pending) return null
  const match = matchBranchInput(inputText, pending)
  w.pendingBranch = null
  if (!match) return null
  const opt = pending.options[match.optionIndex]
  if (!opt.branches || opt.branches.length === 0) return null
  const pickedIdx = pickBranch(opt.branches)
  const picked = opt.branches[pickedIdx]
  return { kind: picked.kind, title: picked.title, simpleDesc: picked.simpleDesc }
}

export function validateBranchChoice(_choice: { options?: unknown[] } | undefined): string | null {
  return null
}

export function makeApplyConfrontationBattle(ledger: import('../ledger').Ledger): (ctx: import('@prisflow/proactiveai-plugin-types').FlowCtx) => string | null {
  return (ctx) => {
    const w = ctx.state._w as WorldState
    const d = ctx.data.battleConfrontation as { text?: string; dead?: boolean; delta?: { spiritStones?: number; cultivation?: number; breakthroughDelta?: number; hpDelta?: number; pills?: Array<Record<string, unknown>>; methods?: Array<Record<string, unknown>> } } | undefined
    const text = typeof d?.text === 'string' && d.text ? d.text : '战斗结束。'
    const hpFromDelta = typeof d?.delta?.hpDelta === 'number' ? Math.round(d.delta.hpDelta) : undefined
    const hpDelta = hpFromDelta ?? 0
    w.stats.hp += hpDelta
    if (w.stats.hp > w.stats.maxHp) w.stats.hp = w.stats.maxHp
    if (w.stats.hp <= 0 || d?.dead === true) {
      w.stats.hp = 0
      w.meta.dead = true
      w.meta.deathCause = '战死'
      ledger.saveAll()
      return null
    }
    if (w.stats.hp < 0) w.stats.hp = 0
    const delta = d?.delta
    if (delta) {
      if (typeof delta.spiritStones === 'number' && delta.spiritStones !== 0) {
        const v = Math.floor(delta.spiritStones)
        if (!(v < 0 && w.stats.spiritStones + v < 0)) {
          w.stats.spiritStones += v
        }
      }
      if (typeof delta.cultivation === 'number' && delta.cultivation !== 0) {
        const v = Math.floor(delta.cultivation)
        w.stats.cultivation += v
        if (w.stats.cultivation < 0) w.stats.cultivation = 0
      }
      if (typeof delta.breakthroughDelta === 'number' && delta.breakthroughDelta !== 0) {
        w.stats.breakBonus = (w.stats.breakBonus ?? 0) + delta.breakthroughDelta / 100
      }
      if (Array.isArray(delta.pills)) {
        for (const p of delta.pills) {
          const amt = Math.floor(Number((p as Record<string, unknown>).amount) || 0)
          if (amt > 0) {
            const eff = String((p as Record<string, unknown>).effectType || 'heal')
            const realm = String((p as Record<string, unknown>).realm || '凡人')
            const existing = w.stats.pills.find((pp) => pp.name === (p as Record<string, unknown>).name && pp.effectType === eff && (pp.realm as string) === realm)
            if (existing) existing.amount += amt
            else w.stats.pills.push({ name: String((p as Record<string, unknown>).name), effectType: eff as never, realm: realm as never, power: Number((p as Record<string, unknown>).power) || 10, amount: amt, source: 'delta' } as never)
          }
        }
      }
      if (Array.isArray(delta.methods)) {
        for (const m of delta.methods) {
          const action = String((m as Record<string, unknown>).action || 'learn')
          if (action === 'learn') {
            if (w.stats.methods.some((mm) => mm.name === (m as Record<string, unknown>).name)) continue
            const grade = typeof (m as Record<string, unknown>).grade === 'string' ? String((m as Record<string, unknown>).grade) : '凡品'
            const techs = ((m as Record<string, unknown>).techniques as Array<Record<string, unknown>> | undefined) || []
            w.stats.methods.push({
              name: String((m as Record<string, unknown>).name),
              grade,
              efficiency: 4,
              techniques: techs.map((t) => ({ name: String(t.name || '无名'), description: String(t.description || ''), source: 'delta' })),
              source: 'delta',
            } as never)
          }
        }
      }
    }
    w.meta.turns += 1
    ledger.saveAll()
    return null
  }
}
