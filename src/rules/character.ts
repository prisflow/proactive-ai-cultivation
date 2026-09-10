/**
 * 建角结算：AI 选定出身+抽3天资后落位（出身独占资源，天资纯词条 9抽3）。
 */
import type { FlowCtx } from '@prisflow/proactiveai-plugin-types'
import {
  METHOD_GRADES,
  BATTLE_HP_BASE, REALM_POWER, LIFESPAN, clampAffinity,
} from '../constants'
import type { Ledger, WorldState } from '../ledger'
import { parseOriginPool, parseTalentPool } from './world'
import { cultivationCap } from './state'

export function makeApplyCharacter(ledger: Ledger): (ctx: FlowCtx) => string | null {
  return (ctx: FlowCtx): string | null => {
    const w = ctx.state._w as WorldState
    const d = ctx.data.charCreate as { origin: string; talents: string[]; name: string; gender: string; temperament: string } | undefined
    if (!d || !d.origin || !d.talents?.length || !d.name) return '建角信息为空（origin/talents/name 缺失）'
    const originName = typeof d?.origin === 'string' ? d.origin.trim() : ''
    const talentNames = Array.isArray(d?.talents) ? d!.talents.map((s) => String(s).trim()).filter(Boolean).slice(0, 3) : []
    const name = typeof d?.name === 'string' && d.name.trim() ? d.name.trim() : '无名'
    const gender = d?.gender === '女' ? '女' : '男'
    const temperament = typeof d?.temperament === 'string' && d.temperament.trim() ? d.temperament.trim() : '平和'
    const origins = parseOriginPool(w)
    const talents = parseTalentPool(w)
    const origin = origins.find((o) => (o as Record<string, unknown>).name === originName) as Record<string, unknown> | undefined
      || origins[0] as Record<string, unknown> | undefined
    const pickedTalents: Array<Record<string, unknown>> = []
    for (const tn of talentNames) {
      const hit = talents.find((t) => (t as Record<string, unknown>).name === tn) as Record<string, unknown> | undefined
      if (hit && !pickedTalents.some((p) => p.name === hit.name)) pickedTalents.push(hit)
    }
    for (const t of talents) {
      if (pickedTalents.length >= 3) break
      if (!pickedTalents.some((p) => p.name === (t as Record<string, unknown>).name)) pickedTalents.push(t as Record<string, unknown>)
    }
    const finalTalents = pickedTalents.slice(0, 3)
    const s = w.stats
    s.name = name
    s.gender = gender
    s.temperament = temperament
    // 开局境界：出身可定（凡人=尘世；练气=宗门/世家出身），练气开局给对应修为
    const originRealm = typeof origin?.realm === 'string' && (origin.realm === '凡人' || origin.realm === '练气') ? origin.realm as '凡人' | '练气' : '凡人'
    s.realm = originRealm; s.realmStage = 1
    s.cultivation = originRealm === '练气' ? Math.min(20, cultivationCap(w)) : 0
    s.hp = BATTLE_HP_BASE + (REALM_POWER[s.realm] ?? 0) * 20
    s.maxHp = s.hp
    s.lifespan = LIFESPAN[s.realm] ?? 80
    s.location = typeof origin?.location === 'string' && origin.location ? origin.location as string : '未知'
    s.spiritStones = 0
    s.methods = []; s.bag = []
    const pushStarter = (starter: Record<string, unknown> | undefined, source: string): void => {
      if (!starter) return
      const stones = typeof starter.spiritStones === 'number' ? starter.spiritStones : 0
      s.spiritStones += stones
      for (const it of (starter.methods as Array<Record<string, unknown>>) || []) {
        if (s.methods.some((m) => m.name === it.name)) continue
        const grade = typeof it.grade === 'string' && METHOD_GRADES[it.grade as string] ? it.grade as string : '凡品'
        s.methods.push({
          name: String(it.name || '无名功法'),
          grade,
          efficiency: METHOD_GRADES[grade] ?? 4,
          techniques: ((it.techniques as Array<Record<string, unknown>>) || []).map((t) => ({
            name: String(t.name || '无名术法'),
            description: String(t.description || ''),
            source,
          })),
          source,
        })
      }
      // 初始储物袋：叙事侧给出的条目直接采用
      if (Array.isArray(starter.bag)) s.bag = starter.bag.map((it) => ({ name: String(it.name ?? ''), desc: String(it.desc ?? '') }))
    }
    pushStarter(origin?.starter as Record<string, unknown> | undefined, '出身')
    s.mainMethod = s.methods[0]?.name ?? null
    s.talents = finalTalents.map((t) => ({
      name: String(t.name || ''),
      description: String(t.description || ''),
      temperament: String(t.temperament || ''),
      quality: (t.quality as '吉' | '凶') || '吉',
    }))
    if (origin?.npcs) {
      for (const [n, lv] of Object.entries(origin.npcs as Record<string, number>)) {
        const c = s.characters.find((c) => c.name === n)
        if (c) c.affinity = clampAffinity(Number(lv))
      }
    }
    w.meta.created = true
    w.meta.turns = 0
    ledger.saveAll()
    return null
  }
}
