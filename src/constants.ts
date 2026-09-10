/**
 * 修仙世界插件 —— 常量与规则表（v3 数值体系）。
 * 所有确定性的数值规则集中于此（工具裁决依据，LLM 无赋值权）。
 * 数值结构参考《觅长生》：境界阶梯 / 修为池 / 功法品阶效率 / 丹药效果 / 术法威力。
 * v3 变更：功法不再绑定境界、无五行；丹药无品阶、无限服；术法隶属功法（1 对多）；
 * 删除全部容量/长度上限（后续实测再考虑是否回收）；突破率按境界递减（筑基为“老祖”门槛）。
 */

/** 境界顺序（凡人 → 化神，此界之巅）。 */
export const REALM_ORDER = ['凡人', '练气', '筑基', '金丹', '元婴', '化神'] as const
export type Realm = (typeof REALM_ORDER)[number]

/** 各境界内的层数（练气 9 层、大境界 3 阶：初期/中期/后期，凡人单层）。 */
export const REALM_LAYERS: Record<Realm, number> = {
  凡人: 1, 练气: 9, 筑基: 3, 金丹: 3, 元婴: 3, 化神: 3
}

/** 每层修为上限（修为满后须显式突破，突破消耗当前层上限修为）。凡人不可修炼（0）。
 * 锚点：凡品功法 4/月 → 练气一层 25 月，百年可至筑基后期。
 * 满池：练气 900 / 筑基 1800 / 金丹 9000 / 元婴 45000 / 化神 180000。 */
export const CULTIVATION_CAP: Record<Realm, number> = {
  凡人: 0, 练气: 100, 筑基: 600, 金丹: 3000, 元婴: 15000, 化神: 60000,
}

/** 功法品阶 → 修炼效率（修为/月）。
 * 功法不绑定境界（任何境界都可修，只差速度），无五行属性。
 * 凡品 4/月 → 一辈子到练气中期；黄阶 → 一辈子到筑基；每档约 5-6 倍。 */
export const METHOD_GRADES: Record<string, number> = {
  凡品: 4, 黄阶: 24, 玄阶: 120, 地阶: 600, 天阶: 3000
}

/** 术法为纯叙事描述（隶属功法，1 对多；仅 name + description，无数值） */
export const TECHNIQUE_TYPES = ['attack', 'heal'] as const // @deprecated 仅占位，术法已改为描述
/** @deprecated 数值已废弃，保留占位 */
export const TECHNIQUE_POWER_MIN = 5
export const TECHNIQUE_POWER_MAX = 500
export const TECHNIQUE_COOLDOWN_MIN = 1
export const TECHNIQUE_COOLDOWN_MAX = 5

/** 境界战力基数（用于战斗伤害公式：伤害 = 威力 × (1 + 战力/100) + 随机波动）。 */
export const REALM_POWER: Record<Realm, number> = {
  凡人: 0, 练气: 10, 筑基: 30, 金丹: 80, 元婴: 200, 化神: 500,
}

/** 各境界寿元（年）。寿元耗尽 = 死亡结局。 */
export const LIFESPAN: Record<Realm, number> = {
  凡人: 80, 练气: 120, 筑基: 200, 金丹: 300, 元婴: 500, 化神: 800,
}

/** 突破成功率（按当前境界冲击下一境；突破丹按百分比加成，可叠加）。
 * 筑基为“老祖”级门槛，骤降至两成；越高越难。化神为尘世之巅，破无可破。 */
export const BREAKTHROUGH_RATES: Record<Realm, number> = {
  凡人: 0.8, 练气: 0.4, 筑基: 0.2, 金丹: 0.1, 元婴: 0.05, 化神: 0.01
}

/** 双修修为倍率（需道侣）。 */
export const DUAL_MULT = 1.5

/** 体力体系基数（HP = BATTLE_HP_BASE + REALM_POWER×20，建角/突破时更新）。 */
export const BATTLE_HP_BASE = 100

/** 修炼时长选项（月）。 */
export const CULTIVATE_MONTHS = [1, 3, 12] as const

/** NPC 池规模与每月修为成长（自成长：身份决定修炼速度）。 */
export const MIN_NPC_POOL = 15
export const MAX_NPC_POOL = 18
/** 每批 NPC 数量（世界人口分五批×3 生成，避免单次输出超长被截断）。 */
export const NPC_BATCH_MIN = 10
export const NPC_BATCH_MAX = 10
export const NPC_GROWTH: Record<string, number> = {
  凡人村民: 0, 村民: 2, 散修: 6, 宗门弟子: 12, 宗门长老: 30, 掌门: 60, 大能: 150,
}
export const NPC_GROWTH_DEFAULT = 4
export const NPC_GROWTH_TICK = 12

/** 大事件数量范围（×3）。 */
export const MIN_EVENTS = 3
export const MAX_EVENTS = 9

/** 好感度（0-100 数值，展示层映射为标签；道侣前置：≥AFFINITY_ROMANCE）。 */
export const AFFINITY_MAX = 100
export const AFFINITY_ROMANCE = 70
export const AFFINITY_BANDS: Array<{ min: number; max: number; label: string }> = [
  { min: 0, max: 9, label: '冷淡' },
  { min: 10, max: 29, label: '相识' },
  { min: 30, max: 49, label: '友好' },
  { min: 50, max: 69, label: '亲密' },
  { min: 70, max: 89, label: '爱慕' },
  { min: 90, max: 100, label: '挚爱' },
]
/** 数值好感 → 中文标签。 */
export function affinityLabel(v: number): string {
  const n = Math.max(0, Math.min(AFFINITY_MAX, Math.floor(Number.isFinite(v) ? v : 0)))
  for (const b of AFFINITY_BANDS) if (n >= b.min && n <= b.max) return b.label
  return '冷淡'
}
/** 钳制好感数值到 0-100 整数。 */
export function clampAffinity(v: number): number {
  return Math.max(0, Math.min(AFFINITY_MAX, Math.floor(Number.isFinite(v) ? v : 0)))
}

/** 记忆类型枚举。 */
export const MEMORY_TYPES = ['character', 'world', 'faction', 'contract', 'item', 'note'] as const
export type MemoryType = (typeof MEMORY_TYPES)[number]