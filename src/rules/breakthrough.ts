/**
 * 突破率计算（唯一权威）：
 * - 小层突破（如练气 1→2 层，realmStage < 层数上限）：水到渠成，无需掷骰，率恒为 1
 * - 大层突破（如练气 9→筑基，realmStage = 层数上限）：BREAKTHROUGH_RATES 基础率 + 天资加成（吉+0.2/凶-0.1）+ 突破丹/剧情加成（breakBonus）
 * 所有展示（publicState/fmtStatus）与掷骰（makeApplyTurn/独立突破流程）统一走本函数，保证一致。
 */
import { BREAKTHROUGH_RATES, REALM_LAYERS } from '../constants'
import type { WorldState } from '../ledger'

export function calcBreakthroughRate(w: WorldState): { rate: number; talentBonus: number; base: number; breakBonus: number; isMajor: boolean } {
  const s = w.stats
  const maxStage = REALM_LAYERS[s.realm] ?? 1
  // 小层突破：未到层数上限，水到渠成
  if (s.realmStage < maxStage) {
    return { rate: 1, talentBonus: 0, base: 1, breakBonus: 0, isMajor: false }
  }
  // 大层突破：冲击下一大境界
  const base = BREAKTHROUGH_RATES[s.realm] ?? 0.1
  const breakBonus = s.breakBonus ?? 0
  const talents = s.talents || []
  let talentBonus = 0
  for (const t of talents) {
    if (t.quality === '吉') talentBonus += 0.2
    else if (t.quality === '凶') talentBonus -= 0.1
  }
  const rate = Math.min(1, Math.max(0, base + breakBonus + talentBonus))
  return { rate, talentBonus, base, breakBonus, isMajor: true }
}
