/**
 * 回合结算：叙事、大事件、修炼/突破/切主修、搜刮、好感、道侣、记忆（仅保留6条时序硬校验，其余交由 schema/评审）。
 */
import type { FlowCtx } from '@prisflow/proactiveai-plugin-types'
import {
  CULTIVATE_MONTHS, DUAL_MULT, REALM_ORDER,
  clampAffinity, affinityLabel,
  type Realm,
} from '../constants'
import type { Ledger, WorldState } from '../ledger'
import { advanceRealm, advanceTime, realmToCultivation } from './utils'
import { cultivationCap, fmtRealm } from './state'
import { calcBreakthroughRate } from './breakthrough'

export function makeApplyBreakthrough(ledger: Ledger): (ctx: FlowCtx) => string | null {
  return (ctx: FlowCtx): string | null => {
    const w = ctx.state._w as WorldState
    const calc = ctx.data.breakthroughCalc as { rate: number; talentBonus: number; base: number; success: boolean; isMajor?: boolean } | undefined
    const d = ctx.data.breakthrough as { text: string; extraCultivation?: number; nextRateBonus?: number } | undefined
    if (!calc || !d) return '突破数据缺失'
    const extraCultivation = typeof d.extraCultivation === 'number' && Number.isFinite(d.extraCultivation) ? Math.max(0, Math.floor(d.extraCultivation)) : 0
    const nextRateBonus = typeof d.nextRateBonus === 'number' && Number.isFinite(d.nextRateBonus) ? d.nextRateBonus : 0
    const cap = cultivationCap(w)
    // 突破丹/剧情加成（breakBonus）只在突破大境界时消耗；小层突破（isMajor=false）保留
    const consumeBonus = calc.isMajor !== false
    if (calc.success) {
      w.stats.cultivation = 0
      if (consumeBonus) w.stats.breakBonus = 0
      if (extraCultivation > 0) w.stats.cultivation = Math.min(extraCultivation, cap)
      advanceRealm(w)
    } else {
      w.stats.cultivation = 0
      if (consumeBonus) w.stats.breakBonus = 0
      if (extraCultivation > 0) w.stats.cultivation = Math.min(extraCultivation, cap)
    }
    if (nextRateBonus) w.stats.breakBonus = Math.max(0, nextRateBonus / 100)
    w.meta.turns += 1
    ledger.saveAll()
    return null
  }
}

export function makeApplyTurn(ledger: Ledger): (ctx: FlowCtx) => string | null {
  return (ctx: FlowCtx): string | null => {
    const w = ctx.state._w as WorldState
    if (!w.meta.created) return '角色未创建，请先创建角色'
    const d = ctx.data.turn as {
      text: string
      kind: string
      eventRef?: { name: string; progress: string; resolved?: boolean }
      relationships?: Array<{ npc: string; delta: number; reason: string }>
      romance?: { npc: string; action: '互动' | '表白' }
      cultivate?: { months: number; mode?: string; partner?: string }
      switchMain?: { method: string }
      breakthrough?: boolean
      location?: string
      npcMoves?: Array<{ npc: string; location: string; reason?: string }>
      npcChanges?: Array<{ npc: string; realm: string; reason: string }>
      timeCost?: number
    } | undefined
    if (!d) return null
    const text = typeof d.text === 'string' ? d.text : ''
    const kind = typeof d.kind === 'string' ? d.kind : '日常'
    if (kind !== '日常' && !d.eventRef) return `节拍（${kind}）必须绑定进行中的大事件——请先让大事件推进（eventRef），或本回合改为日常推进`
    const turnMonthsForCheck = typeof d.timeCost === 'number' ? d.timeCost : d.cultivate?.months ?? 0
    if (d.eventRef) {
      const ev = w.majorEvents.find((e) => e.name === d.eventRef!.name)
      if (!ev) return `eventRef.name 必须是已注册的大事件：${w.majorEvents.map((e) => e.name).join('、') || '（暂无）'}`
      if (ev.status === 'failed') return `「${ev.name}」已失败，无法推进（后果已降临）`
      if (ev.status === 'pending') {
        if (w.stats.timeMonth + turnMonthsForCheck >= ev.at) { } else return `「${ev.name}」尚未触发（第 ${ev.at} 月开启，当前第 ${w.stats.timeMonth + turnMonthsForCheck} 月）`
      }
      if (ev.status === 'resolved') return `「${ev.name}」已解决，请勿重复推进`
      if (d.eventRef.resolved === true) {
        if (ev.type !== '高潮') return `「${ev.name}」是大事件（${ev.type}），只有高潮类事件才可声明 resolved`
      }
    }
    const s = w.stats
    let turnMonths = typeof d.timeCost === 'number' ? Math.max(0, Math.floor(d.timeCost)) : d.cultivate?.months ?? 0
    let turnGain = 0
    let turnDual: string | undefined
    let switchDone = false
    let breakthroughDone = false
    let breakthroughSuccess: boolean | undefined
    let breakthroughRate: number | undefined
    if (d.cultivate) {
      const method = s.methods.find((m) => m.name === s.mainMethod)
      if (method) {
        const months = (CULTIVATE_MONTHS as readonly number[]).includes(d.cultivate.months) ? d.cultivate.months : 1
        let mult = 1
        if (d.cultivate.mode === 'dual') {
          const c = s.characters.find((c) => c.name === d.cultivate!.partner)
          if (c && c.relationship === '道侣') mult = DUAL_MULT
          else if (c) mult = DUAL_MULT
        }
        const rawGain = Math.round((method.efficiency || 4) * mult * months)
        const cap = cultivationCap(w)
        const before = s.cultivation
        s.cultivation = Math.min(s.cultivation + rawGain, cap)
        turnGain = s.cultivation - before
        turnMonths = months
        turnDual = d.cultivate.mode === 'dual' ? d.cultivate.partner : undefined
      }
    }
    if (d.switchMain) {
      const method = s.methods.find((m) => m.name === d.switchMain!.method)
      if (method && s.mainMethod !== d.switchMain!.method) {
        turnMonths = 1
        s.mainMethod = d.switchMain!.method
        switchDone = true
      }
    }
    if (d.breakthrough) {
      const cap = cultivationCap(w)
      if (s.cultivation >= cap) {
        // 统一走 calcBreakthroughRate（BREAKTHROUGH_RATES 基础 + 天资 + breakBonus），与展示一致
        const { rate } = calcBreakthroughRate(w)
        breakthroughRate = rate
        const roll = Math.random()
        breakthroughDone = true
        breakthroughSuccess = roll < rate
      }
    }
    const eventMsgs = advanceTime(w, turnMonths)
    w.meta.turns += 1
    if (d.eventRef) {
      const ev = w.majorEvents.find((e) => e.name === d.eventRef!.name)
      if (ev) {
        if (d.eventRef.resolved === true) {
          ev.status = 'resolved'
        } else if (typeof d.eventRef.progress === 'string' && d.eventRef.progress) {
        }
      }
    }
    if ((d as unknown as { delta?: Record<string, unknown> }).delta) {
      const delta = (d as unknown as { delta: { spiritStones?: number; cultivation?: number; breakthroughDelta?: number; hpDelta?: number; pills?: Array<Record<string, unknown>>; methods?: Array<Record<string, unknown>> } }).delta
      if (typeof delta.spiritStones === 'number' && delta.spiritStones !== 0) {
        const v = Math.floor(delta.spiritStones)
        if (v < 0 && w.stats.spiritStones + v < 0) return `灵石不足：需 ${-v}，现 ${w.stats.spiritStones}`
        w.stats.spiritStones += v
      }
      if (typeof delta.cultivation === 'number' && delta.cultivation !== 0) {
        const v = Math.floor(delta.cultivation)
        w.stats.cultivation += v
        if (w.stats.cultivation < 0) w.stats.cultivation = 0
      }
      if (typeof delta.breakthroughDelta === 'number' && delta.breakthroughDelta !== 0) {
        w.stats.breakBonus = (w.stats.breakBonus ?? 0) + delta.breakthroughDelta / 100
      }
      if (typeof delta.hpDelta === 'number' && delta.hpDelta !== 0) {
        w.stats.hp += Math.floor(delta.hpDelta)
        if (w.stats.hp > w.stats.maxHp) w.stats.hp = w.stats.maxHp
        if (w.stats.hp < 0) w.stats.hp = 0
        if (w.stats.hp <= 0) {
          w.meta.dead = true
          w.meta.deathCause = '重伤不治'
        }
      }
      if (Array.isArray(delta.pills)) {
        for (const p of delta.pills) {
          const amt = Math.floor(Number(p.amount) || 1)
          if (amt === 0) continue
          if (amt > 0) {
            const eff = String(p.effectType || 'heal')
            const realm = String(p.realm || '凡人')
            const existing = w.stats.pills.find((pp) => pp.name === p.name && pp.effectType === eff && (pp.realm as string) === realm)
            if (existing) existing.amount += amt
            else w.stats.pills.push({ name: String(p.name), effectType: eff as any, realm: realm as any, power: Number(p.power) || 10, amount: amt, source: 'delta' } as any)
          } else {
            const pill = w.stats.pills.find((pp) => pp.name === p.name)
            if (!pill || pill.amount < -amt) return `丹药「${p.name}」不足（需 ${-amt}，现 ${pill?.amount ?? 0}）`
          }
        }
        for (const p of delta.pills) {
          const amt = Math.floor(Number(p.amount) || 0)
          if (amt >= 0) continue
          const consume = -amt
          const pill = w.stats.pills.find((pp) => pp.name === p.name)!
          const pillRealmIdx = REALM_ORDER.indexOf(((p.realm as string) || pill.realm) as Realm)
          const curRealmIdx = REALM_ORDER.indexOf(s.realm)
          let powerMult = 1
          if (pillRealmIdx >= 0 && curRealmIdx >= 0) {
            const diff = Math.abs(pillRealmIdx - curRealmIdx)
            if (diff > 2) powerMult = 0
            else if (diff === 2) powerMult = 0.5
          }
          const effPower = Math.round((Number((p as Record<string, unknown>).power) || Number(pill.power) || 10) * powerMult)
          const effType = String((p as Record<string, unknown>).effectType || pill.effectType)
          if (effType === 'cultivation') {
            s.cultivation += effPower * consume
          } else if (effType === 'breakthrough') {
            s.breakBonus = (s.breakBonus ?? 0) + (effPower * consume) / 100
          } else if (effType === 'heal') {
            const healed = Math.min(s.maxHp - s.hp, effPower * consume)
            s.hp += healed
          } else if (effType === 'lifespan') {
            s.lifespan += effPower * consume
          }
          pill.amount += amt
          if (pill.amount <= 0) w.stats.pills.splice(w.stats.pills.indexOf(pill), 1)
        }
      }
      if (Array.isArray(delta.methods)) {
        for (const m of delta.methods) {
          const action = String(m.action || 'learn')
          if (action === 'learn') {
            if (w.stats.methods.some((mm) => mm.name === m.name)) continue
            const grade = typeof m.grade === 'string' && (m.grade in { '凡品': 1, '黄阶': 1, '玄阶': 1, '地阶': 1, '天阶': 1 }) ? m.grade as string : '凡品'
            w.stats.methods.push({
              name: String(m.name),
              grade,
              efficiency: ({ '凡品': 4, '黄阶': 24, '玄阶': 120, '地阶': 600, '天阶': 3000 } as Record<string, number>)[grade] ?? 4,
              techniques: ((m.techniques as Array<Record<string, unknown>>) || []).map((t) => ({
                name: String((t as Record<string, unknown>).name || '无名'),
                description: String((t as Record<string, unknown>).description || ''),
                source: 'delta',
              })),
              source: 'delta',
            })
          } else if (action === 'forget') {
            const idx = w.stats.methods.findIndex((mm) => mm.name === m.name)
            if (idx >= 0) {
              w.stats.methods.splice(idx, 1)
              if (w.stats.mainMethod === m.name) w.stats.mainMethod = w.stats.methods[0]?.name ?? null
            }
          } else if (action === 'teach') {
          }
        }
      }
    }
    if (Array.isArray(d.relationships)) {
      for (const r of d.relationships) {
        const c = s.characters.find((c) => c.name === r.npc)
        if (!c) continue
        const delta = Number(r.delta)
        if (!Number.isFinite(delta)) continue
        c.affinity = clampAffinity(c.affinity + delta)
      }
    }
    if (d.romance) {
      const c = s.characters.find((c) => c.name === d.romance!.npc)
      if (c) {
        if (d.romance.action === '表白') {
          c.relationship = '道侣'
          c.affinity = clampAffinity(100)
        } else {
        }
      }
    }
    // 位置跟随剧情走：玩家移动 + NPC 移动（快变信息，不入慢变世界状态卡）
    if (typeof d.location === 'string' && d.location.trim()) {
      s.location = d.location.trim()
    }
    if (Array.isArray(d.npcMoves)) {
      for (const m of d.npcMoves) {
        const npc = s.characters.find((c) => c.name === m.npc)
        if (npc && typeof m.location === 'string' && m.location.trim()) {
          npc.location = m.location.trim()
        }
      }
    }
    // NPC 境界变化（剧情驱动，有原因）
    if (Array.isArray(d.npcChanges)) {
      for (const ch of d.npcChanges) {
        const npc = s.characters.find((c) => c.name === ch.npc)
        if (npc && (REALM_ORDER as readonly string[]).includes(ch.realm)) {
          npc.realm = ch.realm as Realm
          npc.cultivation = realmToCultivation(ch.realm as Realm)
        }
      }
    }
    // 修为统一封顶：不超过当前层上限（防止 149/100 溢出——修为满即触发突破，未突破则维持上限）
    const cap = cultivationCap(w)
    if (s.cultivation > cap) s.cultivation = cap
    if (s.cultivation < 0) s.cultivation = 0
    ledger.saveAll()
    return null
  }
}
