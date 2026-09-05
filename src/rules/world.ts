/**
 * 世界生成结算：世界骨架、NPC 池、出身池、天资池（已去硬校验，仅留转换映射）。
 */
import type { FlowCtx } from '@prisflow/proactiveai-plugin-types'
import {
  REALM_ORDER,
  clampAffinity,
  type Realm,
} from '../constants'
import type { Ledger, WorldState, CharacterEntry } from '../ledger'
import { realmToCultivation } from './utils'

/**
 * 解析出身池（直读 WorldState.originPool）。
 */
export function parseOriginPool(w: WorldState): Record<string, unknown>[] {
  return Array.isArray(w.originPool) ? w.originPool : []
}

/**
 * 解析天资池（直读 WorldState.talentPool）。
 */
export function parseTalentPool(w: WorldState): Record<string, unknown>[] {
  return Array.isArray(w.talentPool) ? w.talentPool : []
}

/**
 * 世界骨架结算：仅 world，不含大事件（大事件由 generate_major_events 单责）。
 */
export function makeApplyWorldBase(ledger: Ledger): (ctx: FlowCtx) => string | null {
  return (ctx: FlowCtx): string | null => {
    const w = ctx.state._w as WorldState
    const d = ctx.data.worldBase as { world?: Record<string, unknown> } | undefined
    const world = d?.world as Record<string, unknown> | undefined
    if (!world || typeof world.name !== 'string' || !world.name.trim()) return '世界骨架为空（world.name 缺失）'
    if (!Array.isArray(world.regions) || (world.regions as unknown[]).length === 0) return '世界骨架不全（regions 缺失）'
    if (!Array.isArray(world.sects) || (world.sects as unknown[]).length === 0) return '世界骨架不全（sects 缺失）'
    if (typeof world.law !== 'string' || !(world.law as string).trim()) return '世界骨架不全（law 缺失）'
    w.stats.world = world as unknown as WorldState['stats']['world']
    ledger.saveAll()
    return null
  }
}

/**
 * NPC 池结算：追加式（多次调用累计，供 generate_npcs 分批生成），去重映射。
 */
export function makeApplyNpcPool(ledger: Ledger): (ctx: FlowCtx) => string | null {
  return (ctx: FlowCtx): string | null => {
    const w = ctx.state._w as WorldState
    // generate_npcs 一次生成 3 批（npcBatch1..3），兼容旧 5 批读取
    const KEYS = ['npcBatch1', 'npcBatch2', 'npcBatch3', 'npcBatch4', 'npcBatch5']
    const all = KEYS.flatMap((k) => {
      const b = (ctx.data[k] as { [p: string]: Array<Record<string, unknown>> } | undefined)?.[k]
      return Array.isArray(b) ? b : []
    })
    if (all.length === 0) return '本批未生成 NPC（npcBatch 为空）'
    const seen = new Set(w.stats.characters.map((c) => c.name))
    const added: CharacterEntry[] = []
    for (const c of all) {
      const name = typeof c.name === 'string' ? c.name.trim() : ''
      if (!name || seen.has(name)) continue
      const realm = typeof c.realm === 'string' && (REALM_ORDER as readonly string[]).includes(c.realm) ? c.realm as Realm : '凡人'
      seen.add(name)
      const affinity = 0 // 世界人口初始一律陌生：好感只由互动（game_turn relationships）产生
      added.push({
        name,
        gender: typeof c.gender === 'string' && (c.gender === '男' || c.gender === '女') ? c.gender : '男',
        age: typeof c.age === 'number' && c.age > 0 ? Math.min(c.age, 500) : 20,
        identity: typeof c.identity === 'string' && c.identity ? c.identity as string : '村民',
        realm,
        location: typeof c.location === 'string' && c.location ? c.location as string : '未知',
        temperament: typeof c.temperament === 'string' ? c.temperament : '',
        affinity,
        relationship: '无',
        note: typeof c.note === 'string' ? c.note : '',
        cultivation: realmToCultivation(realm),
      })
    }
    w.stats.characters.push(...added)
    ledger.saveAll()
    return null
  }
}

/**
 * 出身池结算：仅落库，无硬校验。
 */
export function makeApplyOrigins(ledger: Ledger): (ctx: FlowCtx) => string | null {
  return (ctx: FlowCtx): string | null => {
    const w = ctx.state._w as WorldState
    const d = ctx.data.origins as { origins?: Array<Record<string, unknown>> } | undefined
    const origins = Array.isArray(d?.origins) ? d!.origins! : []
    if (origins.length < 2 || origins.length > 4) return '出身数量须 2-4 条'
    w.originPool = origins
    w.meta.initialized = true
    ledger.saveAll()
    return null
  }
}

/**
 * 天资池结算：仅落库，无硬校验。
 */
export function makeApplyTalents(ledger: Ledger): (ctx: FlowCtx) => string | null {
  return (ctx: FlowCtx): string | null => {
    const w = ctx.state._w as WorldState
    const d = ctx.data.talents as { talents?: Array<Record<string, unknown>> } | undefined
    const talents = Array.isArray(d?.talents) ? d!.talents! : []
    if (talents.length !== 9) return '天资数量须 9 条'
    w.talentPool = talents
    ledger.saveAll()
    return null
  }
}
