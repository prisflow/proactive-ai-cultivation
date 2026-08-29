/**
 * 规则层公共工具：随机、钳制、境界换算与时间推进。
 */
import {
  REALM_ORDER, REALM_LAYERS, CULTIVATION_CAP,
  REALM_POWER, LIFESPAN, BATTLE_HP_BASE,
  NPC_GROWTH, NPC_GROWTH_DEFAULT, NPC_GROWTH_TICK,
  type Realm,
} from '../constants'
import type { WorldState } from '../ledger'

/**
 * 区间随机整数（闭区间）。
 */
export function rand(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

/**
 * @deprecated clampTech 已废弃，术法无数值仅描述，保留占位
 */
export function clampTech(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(Number.isFinite(v) ? v : min)))
}

/**
 * 按修为反查境界（NPC 自成长用）。
 */
export function realmForCultivation(cult: number): { realm: Realm; stage: number } {
  let c = cult
  for (let i = 1; i < REALM_ORDER.length; i++) {
    const realm = REALM_ORDER[i]
    const layers = REALM_LAYERS[realm]
    const cap = CULTIVATION_CAP[realm]
    const total = cap * layers
    if (c < total) return { realm, stage: Math.floor(c / Math.max(cap, 1)) + 1 }
    c -= total
  }
  // 修为溢出所有已知境界：满层此界之巅
  const last = REALM_ORDER[REALM_ORDER.length - 1]
  return { realm: last, stage: REALM_LAYERS[last] }
}

/**
 * 境界到初始修为的映射（取该境界中位）。
 */
export function realmToCultivation(realm: Realm): number {
  let total = 0
  for (let i = 0; i < REALM_ORDER.length; i++) {
    const r = REALM_ORDER[i]
    if (r === realm) return total + CULTIVATION_CAP[r] * Math.floor(REALM_LAYERS[r] / 2)
    total += CULTIVATION_CAP[r] * REALM_LAYERS[r]
  }
  return total
}



/**
 * 大事件时间线推进（激活/失败判定）。返回触发的消息数组。
 */
export function tickEvents(w: WorldState): string[] {
  const msgs: string[] = []
  for (const e of w.majorEvents) {
    if (e.status === 'pending' && w.stats.timeMonth >= e.at) {
      e.status = 'active'
      msgs.push(`[大事件开启] ${e.name}（${e.type}）：${e.summary}`)
    } else if (e.status === 'active' && w.stats.timeMonth > e.by) {
      e.status = 'failed'
      msgs.push(`[大事件失败] ${e.name} 未能在期限内解决，后果降临：${e.summary}`)
    }
  }
  return msgs
}

/**
 * NPC 自成长：每 NPC_GROWTH_TICK 月结算一次（修为增长 + 境界按表推进）。
 */
export function tickNPCGrowth(w: WorldState, months: number): void {
  const s = w.stats
  s.npcGrowthMonths += months
  while (s.npcGrowthMonths >= NPC_GROWTH_TICK) {
    s.npcGrowthMonths -= NPC_GROWTH_TICK
    for (const c of s.characters) {
      c.cultivation += (NPC_GROWTH[c.identity] ?? NPC_GROWTH_DEFAULT) * NPC_GROWTH_TICK
      const cur = realmForCultivation(c.cultivation)
      if (cur.realm !== c.realm || cur.stage !== 1 || c.cultivation >= 100) c.realm = cur.realm
    }
  }
}

/**
 * 时间流逝通用结算（+月）：大事件 tick、寿元、NPC 成长、回合数。返回事件消息。
 * 若寿元耗尽则标记死亡并追加日志。
 */
export function advanceTime(w: WorldState, months: number): string[] {
  const s = w.stats
  s.timeMonth += months
  const msgs = tickEvents(w)
  tickNPCGrowth(w, months)
  s.lifespan -= months / 12
  if (s.lifespan <= 0 && !w.meta.dead) {
    w.meta.dead = true
    w.meta.deathCause = '寿元耗尽'
  }
  return msgs
}

/**
 * 突破后的境界推进（成功后调用）。
 */
export function advanceRealm(w: WorldState): void {
  const s = w.stats
  s.realmStage += 1
  if (s.realmStage > REALM_LAYERS[s.realm]) {
    const idx = REALM_ORDER.indexOf(s.realm)
    if (idx < REALM_ORDER.length - 1) {
      s.realm = REALM_ORDER[idx + 1]
      s.realmStage = 1
    } else {
      s.realmStage = REALM_LAYERS[s.realm]
    }
  }
  s.maxHp = BATTLE_HP_BASE + REALM_POWER[s.realm] * 20
  s.hp = Math.min(s.maxHp, Math.max(s.hp, BATTLE_HP_BASE + REALM_POWER[s.realm] * 20))
  if (s.lifespan < LIFESPAN[s.realm]) s.lifespan = LIFESPAN[s.realm]
}
