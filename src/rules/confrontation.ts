/**
 * 战斗应用：game_battle 的 LLM 实写结果落账（delta/死亡/回合数）。
 * （原风险分支匹配逻辑已随分支系统下线删除——战斗改由 LLM 按玩家意图路由到 game_battle 工具。）
 */
import type { FlowCtx } from '@prisflow/proactiveai-plugin-types'
import type { Ledger, WorldState } from '../ledger'

export function makeApplyBattle(ledger: Ledger): (ctx: FlowCtx) => string | null {
  return (ctx) => {
    const w = ctx.state._w as WorldState
    const d = ctx.data.battle as { text?: string; dead?: boolean; delta?: { spiritStones?: number; cultivation?: number; breakthroughDelta?: number; hpDelta?: number; pills?: Array<Record<string, unknown>>; methods?: Array<Record<string, unknown>> }; options?: Array<{ text?: unknown }> } | undefined
    const text = typeof d?.text === 'string' && d.text ? d.text : '战斗骤然爆发'
    const hpDelta = typeof d?.delta?.hpDelta === 'number' ? Math.round(d.delta.hpDelta) : 0
    w.stats.hp += hpDelta
    if (w.stats.hp > w.stats.maxHp) w.stats.hp = w.stats.maxHp
    if (w.stats.hp <= 0 || d?.dead === true) {
      w.stats.hp = 0
      w.meta.dead = true
      w.meta.deathCause = '战斗'
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
              techniques: techs.map((t) => ({ name: String(t.name || '术法'), description: String(t.description || ''), source: 'delta' })),
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