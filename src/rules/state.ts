/**
 * 状态展示层：境界/时间格式化与对外摘要。
 */
import {
  REALM_ORDER, REALM_LAYERS, CULTIVATION_CAP,
  affinityLabel,
  type Realm,
} from '../constants'
import type { WorldState } from '../ledger'
import { calcBreakthroughRate } from './breakthrough'

/**
 * 当前阶段：world-pending / origin-pending / playing / dead。
 */
export function stageOf(w: WorldState): string {
  if (w.meta.dead) return 'dead'
  if (!w.meta.initialized) return 'world-pending'
  if (!w.meta.created) return 'origin-pending'
  return 'playing'
}

/**
 * 格式化时间（x 年 y 月）。
 */
export function fmtTime(w: WorldState): string {
  const m = w.stats.timeMonth
  const y = Math.floor(m / 12)
  const mo = m % 12
  return y > 0 ? `${y} 年${mo > 0 ? ` ${mo} 月` : ''}` : `${m} 月`
}

/**
 * 当前境界层文本（练气三层 / 筑基中期）。
 */
export function fmtRealm(w: WorldState): string {
  const { realm, realmStage } = w.stats
  const layers = REALM_LAYERS[realm]
  if (layers <= 1) return realm
  if (realm === '练气') return `练气${realmStage}层`
  const STAGE_NAMES = ['初期', '中期', '后期']
  return `${realm}${STAGE_NAMES[Math.min(realmStage - 1, 2)]}`
}

/**
 * 当前层修为上限（凡人无功法不可修炼，修为池按练气基准计）。
 */
export function cultivationCap(w: WorldState): number {
  return w.stats.realm === '凡人' ? CULTIVATION_CAP['练气'] : CULTIVATION_CAP[w.stats.realm]
}

/**
 * 丹药作用人话标签（展示用）。
 */
function pillEffectLabel(effectType: string, power: number): string {
  switch (effectType) {
    case 'cultivation': return `修为+${power}`
    case 'breakthrough': return `突破+${power}%`
    case 'heal': return `回血+${power}`
    case 'lifespan': return `延寿+${power}年`
    default: return `${effectType}+${power}`
  }
}

/**
 * 供 LLM 节点与工具回喂的状态摘要（NPC 池只给摘要，完整档案按需查询）。
 */
export function publicState(w: WorldState): Record<string, unknown> {
  const s = w.stats
  const nearby = s.characters.filter((c) => c.location === s.location)
  const close = s.characters.filter((c) => c.affinity >= 50)
  const actives = w.majorEvents.filter((e) => e.status === 'active')
  const upcoming = w.majorEvents.filter((e) => e.status === 'pending' && e.at - s.timeMonth <= 12)
  return {
    stage: stageOf(w),
    meta: { turns: w.meta.turns, dead: w.meta.dead, deathCause: w.meta.deathCause },
    stats: {
      name: s.name || '',
      gender: s.gender || '',
      temperament: s.temperament || '',
      realm: fmtRealm(w),
      cultivation: s.cultivation,
      cap: cultivationCap(w),
      lifespan: s.lifespan,
      mainMethod: s.mainMethod || null,
      time: fmtTime(w),
      location: s.location,
      hp: s.hp,
      maxHp: s.maxHp,
      spiritStones: s.spiritStones,
      breakBonus: s.breakBonus ?? 0,
      breakRate: (() => {
        // 统一走 calcBreakthroughRate（BREAKTHROUGH_RATES 基础 + 天资 + breakBonus），与掷骰一致
        return Math.round(calcBreakthroughRate(w).rate * 100)
      })(),
    },
    methods: s.methods.map((m) => ({ ...m })),
    pills: s.pills.map((p) => ({ ...p })),
    characters: {
      total: s.characters.length,
      // 全量角色名册（快变：含境界/位置/好感——这些不放慢变卡，每轮输入给模型）
      roster: s.characters.map((c) => ({ name: c.name, identity: c.identity, realm: c.realm, location: c.location, affinity: c.affinity, affinityLabel: affinityLabel(c.affinity), relationship: c.relationship })),
      nearby: nearby.map((c) => ({ name: c.name, identity: c.identity, realm: c.realm, affinity: c.affinity, affinityLabel: affinityLabel(c.affinity), relationship: c.relationship })),
      close: close.map((c) => ({ name: c.name, affinity: c.affinity, affinityLabel: affinityLabel(c.affinity), relationship: c.relationship })),
    },
    majorEvents: {
      // 全量大事件（快变：含 status——不放慢变卡，每轮输入给模型）
      all: w.majorEvents.map((e) => ({ name: e.name, type: e.type, at: e.at, by: e.by, status: e.status, summary: e.summary })),
      active: actives.map((e) => ({ name: e.name, type: e.type, summary: e.summary, by: e.by })),
      upcoming: upcoming.map((e) => ({ name: e.name, type: e.type, at: e.at })),
    },
  }
}

/**
 * 慢变世界状态卡（world_setting 记忆 slot）：只含真正慢变的事实——
 * 世界骨架、大事件时间线（不带状态）。不含任何会变化的内容：
 * NPC 名册/境界/位置、大事件状态、玩家状态——这些是快变信息，放每轮 game_turn 的输入（publicState），
 * 保证稳定前缀的缓存命中（前缀任何变化都会导致其后全部 miss）。
 */
export function worldSetting(w: WorldState): string {
  const world = w.stats.world as
    | { name?: string; regions?: string[]; sects?: Array<{ name: string; stance: string; location: string }>; towns?: Array<{ name: string }>; law?: string; rumor?: string }
    | undefined
  const lines: string[] = []
  if (world?.name) lines.push(`世界：${world.name}`)
  if (world?.regions?.length) lines.push(`地域：${world.regions.join('、')}`)
  if (world?.sects?.length) lines.push(`宗门：${world.sects.map((s) => `${s.name}（${s.stance}·${s.location}）`).join('、')}`)
  if (world?.towns?.length) lines.push(`城镇：${world.towns.map((t) => t.name).join('、')}`)
  if (world?.law) lines.push(`法则：${world.law}`)
  if (world?.rumor) lines.push(`传闻：${world.rumor}`)
  const events = w.majorEvents
  if (events.length) {
    // 大事件只留名+类型+时间窗，不带 status（status 会变 pending→active→failed，变化刷新前缀破坏缓存）
    lines.push(`大事件时间线：${events.map((e) => `${e.name}（${e.type}·第${e.at}月→第${e.by}月）`).join('；')}`)
  }
  return lines.join('\n')
}

/**
 * 人读状态条（首屏/Play 顶部）。
 */
export function fmtStatus(w: WorldState): string {
  const main = w.stats.methods.find((m) => m.name === w.stats.mainMethod)
  const methodsStr = w.stats.methods.length
    ? w.stats.methods.map((m) => `${m.name}[${m.grade}]${m.name === w.stats.mainMethod ? '★主修' : ''}（${m.techniques.map((t) => `${t.name}：${t.description}`).join('；')}）`).join('、')
    : '无'
  const pillsStr = w.stats.pills.length
    ? w.stats.pills.map((p) => `${p.name}×${p.amount}[${p.realm}·${pillEffectLabel(p.effectType, p.power)}]`).join('、')
    : '无'
  const talentsStr = w.stats.talents?.length ? w.stats.talents.map((t) => `${t.name}「${t.description}」`).join('、') : '无'
  const breakRate = (() => {
    // 统一走 calcBreakthroughRate（BREAKTHROUGH_RATES 基础 + 天资 + breakBonus），与掷骰一致
    return Math.round(calcBreakthroughRate(w).rate * 100)
  })()
  return `${w.stats.name ? `名字「${w.stats.name}」` : ''}${w.stats.temperament ? `·${w.stats.temperament}` : ''} | 境界：${fmtRealm(w)} | 修为：${w.stats.cultivation}/${cultivationCap(w)} | 寿元：${Math.floor(w.stats.lifespan)}年 | 时间：${fmtTime(w)}\n灵石：${w.stats.spiritStones} | 体力：${w.stats.hp}/${w.stats.maxHp} | 地点：${w.stats.location}\n主修：${w.stats.mainMethod ? `${w.stats.mainMethod}${main ? `[${main.grade}]` : ''}` : '无'}\n天资：${talentsStr}\n突破率：${breakRate}%${w.stats.breakBonus ? `（剧情加成+${Math.round(w.stats.breakBonus*100)}%）` : ''}\n功法：${methodsStr}\n丹药：${pillsStr}`
}
