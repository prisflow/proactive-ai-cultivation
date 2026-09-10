/**
 * 持久化层：按对话分键读写 SQLite 分层存档（经 PluginSetupAPI.storage）。
 * 结构（v7）：
 * - meta       元数据（初始化/建角/死亡/回合数）
 * - stats      动态状态（境界/层/修为/寿元/时间/资源/功法/丹药/NPC 池）
 * - majorEvents 大事件时间线（待触发/进行中/已解决/失败）
 * v7 变更：删 pendingBranch 风险分支预告（分支系统下线，改 LLM 判死 + 开放提示选项）。
 * v6 变更：删 story 剧情层（改由宿主 messages 10 条单源，避免二义性）。
 */
import type { PluginSetupAPI } from '@prisflow/proactiveai-plugin-types'
import type { Realm } from './constants'

export interface WorldMeta {
  initialized: boolean
  created: boolean
  dead: boolean
  deathCause?: string
  turns: number
}

/** 功法条目（引擎按 grade→efficiency 表裁决；术法隶属功法，1 对多）。 */
export interface CultivationMethod {
  name: string
  grade: string
  efficiency: number
  techniques: Technique[]
  source: string
}

/** 术法条目（隶属功法；纯叙事，无数值，仅描述）。 */
export interface Technique {
  name: string
  description: string
  source: string
}

/** 储物袋条目：物品名（可含数量，如 回春丹×2）+ 一句话简述。 */
export interface BagItem {
  name: string
  desc: string
}

export interface CharacterEntry {
  name: string
  gender: string
  age: number
  identity: string
  realm: Realm
  location: string
  temperament: string
  affinity: number
  relationship: string
  note: string
  cultivation: number
}

export interface WorldStats {
  realm: Realm
  /** 世界骨架（大陆/地域/宗门/城镇/法则/传闻），由世界生成段1写入。 */
  world: Record<string, unknown>
  /** 玩家名字（建角时由 AI 起名）。 */
  name: string
  /** 玩家性别（建角时由 AI 决定）。 */
  gender: string
  /** 玩家性格（建角时取自所选天资的预设）。 */
  temperament: string
  /** 层：练气 1-9；筑基/金丹/元婴/化神 1-3（初期/中期/后期）；凡人 1。 */
  realmStage: number
  cultivation: number
  /** 剩余寿元（年）。 */
  lifespan: number
  /** 游戏内时间（月）。 */
  timeMonth: number
  location: string
  hp: number
  maxHp: number
  spiritStones: number
  methods: CultivationMethod[]
  /** 主修功法名（修炼只按此功法效率结算，切换需 1 回合） */
  mainMethod: string | null
  /** 天资（抽中的 3 条吉凶词条，供剧情参考，不带数值） */
  talents: Array<{ name: string; description: string; temperament: string; quality: '吉' | '凶' }> | null
  /** 储物袋现状描述。 */
  /** 储物袋条目列表（全量覆盖式更新，无增删结算）。 */
  bag: BagItem[]
  characters: CharacterEntry[]
  /** NPC 自成长累计月数（达 tick 阈值结算一次）。 */
  npcGrowthMonths: number
  /** 突破丹累计加成（0-1，突破成功后清零）。 */
  breakBonus: number
}

export interface MajorEvent {
  name: string
  /** 触发月。 */
  at: number
  /** 截止月：未在期限内解决则事件失败（后果由叙事呈现）。 */
  by: number
  /** 节拍类型：机遇/危机/转折/高潮。 */
  type: string
  summary: string
  status: 'pending' | 'active' | 'resolved' | 'failed'
}

export interface WorldState {
  meta: WorldMeta
  stats: WorldStats
  majorEvents: MajorEvent[]
  originPool: Record<string, unknown>[]
  talentPool: Record<string, unknown>[]
  /** 慢变世界状态卡渲染文本（rules.worldSetting 产物，头部注入数据源）。 */
  worldSetting: string
}

/** 初始世界状态（新档）。 */
export function newWorld(): WorldState {
  return {
    meta: { initialized: false, created: false, dead: false, turns: 0 },
    stats: {
      realm: '凡人', realmStage: 1, cultivation: 0,
      world: {},
      name: '', gender: '男', temperament: '',
      lifespan: 80, timeMonth: 0, location: '', hp: 100, maxHp: 100,
      spiritStones: 0, methods: [], mainMethod: null, talents: null, bag: [],
      characters: [] as CharacterEntry[], npcGrowthMonths: 0, breakBonus: 0,
    },
    majorEvents: [],
    originPool: [],
    talentPool: [],
    worldSetting: '',
  }
}

export interface Ledger {
  /** 读取（或创建）某对话的世界状态。 */
  getWorld(cid: string): WorldState
  /** 持久化全部世界状态（按对话分键）。 */
  saveAll(): void
}

/** 创建持久化层（依赖 api.storage）。 */
export function createLedger(api: PluginSetupAPI): Ledger {
  const worlds = new Map<string, WorldState>()

  const saved = api.storage.get()
  if (saved && typeof saved === 'object') {
    for (const [cid, w] of Object.entries(saved)) worlds.set(cid, w as WorldState)
  }

  function saveAll(): void {
    const all: Record<string, WorldState> = {}
    for (const [cid, w] of worlds) all[cid] = w
    api.storage.set(all)
  }

  function getWorld(cid: string): WorldState {
    if (!cid) return newWorld()
    let w = worlds.get(cid)
    if (!w) {
      w = newWorld()
      worlds.set(cid, w)
    }
    return w
  }

  return { getWorld, saveAll }
}