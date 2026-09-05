/**
 * 回合推进流程模块：三个独立工具的 flow 注册。
 * - game_turn：日常推进（叙事 + delta 结算 + LLM 判死 + 开放提示选项）
 * - game_battle：战斗遭遇（战斗实写 + 死亡判定 + delta + 开放提示选项）
 * - game_breakthrough：冲击突破（系统判定成败 + 突破叙事 + 开放提示选项）
 *
 * 选项统一规则（HINT_OPTIONS_SCHEMA）：0-3 条、仅大事件预告/NPC 关系衍生两类，
 * 选项只是灵感提示，鼓励玩家自由描述行动；未结束的大事件预告允许重复出现（合理提醒）。
 */
import type { PluginSetupAPI } from '@prisflow/proactiveai-plugin-types'
import type { FlowCtx } from '@prisflow/proactiveai-plugin-types'
import type { Ledger, WorldState } from '../ledger'
import type { Rules } from '../rules'
import type { Views } from '../views'
import { initCtx } from './helpers'
import { TURN_SCHEMA, BATTLE_SCHEMA, BREAKTHROUGH_SCHEMA } from './schemas'
import { TURN_SYSTEM, BATTLE_SYSTEM, BREAKTHROUGH_SYSTEM } from '../prompts'

/** 前置校验：未建角/已死亡的统一拦截。 */
function frontCheck(ctx: FlowCtx): string | void {
  const w = ctx.state._w as WorldState
  if (!w.meta.created) return '角色未创建，请先创建角色'
  if (w.meta.dead) return '角色已死亡，本轮空转'
  return
}

export function registerTurnFlows(api: PluginSetupAPI, ledger: Ledger, rules: Rules, views: Views): void {
  // ---------- game_turn：日常推进 ----------
  api.flow.register({
    name: 'game_turn',
    nodes: [
      { type: 'static', fn: initCtx(ledger) },
      { type: 'static', fn: frontCheck },
      {
        type: 'llm',
        system: TURN_SYSTEM,
        input: (ctx: FlowCtx) => {
          const w = ctx.state._w as never
          return `玩家行动：${(ctx.input as { text?: string })?.text || '（无）'}\n\n当前状态：\n${JSON.stringify(rules.publicState(w))}`
        },
        schema: TURN_SCHEMA,
        assign: 'turn',
      },
      { type: 'static', fn: (ctx) => rules.applyTurn(ctx) ?? undefined },
      { type: 'render', build: views.buildPlayScreen },
    ],
    requireRender: true,
  })

  // ---------- game_battle：战斗遭遇 ----------
  api.flow.register({
    name: 'game_battle',
    nodes: [
      { type: 'static', fn: initCtx(ledger) },
      { type: 'static', fn: frontCheck },
      {
        type: 'llm',
        system: BATTLE_SYSTEM,
        input: (ctx: FlowCtx) => {
          const w = ctx.state._w as never
          return `玩家行动：${(ctx.input as { text?: string })?.text || '（无）'}\n\n当前全量状态：\n${JSON.stringify(rules.publicState(w))}\n\n请客观推演这场战斗。`
        },
        schema: BATTLE_SCHEMA,
        assign: 'battle',
      },
      { type: 'static', fn: (ctx) => rules.applyBattle(ctx) ?? undefined },
      { type: 'render', build: views.buildPlayScreen },
    ],
    requireRender: true,
  })

  // ---------- game_breakthrough：冲击突破 ----------
  api.flow.register({
    name: 'game_breakthrough',
    nodes: [
      { type: 'static', fn: initCtx(ledger) },
      { type: 'static', fn: frontCheck },
      // [static] 突破判定：calcBreakthroughRate 算成功率并掷骰 success（唯一权威）；修为未满则 fail-fast
      {
        type: 'static',
        fn: (ctx: FlowCtx): string | void => {
          const w = ctx.state._w as WorldState
          const calc = rules.calcBreakthroughRate(w)
          const { rate, talentBonus, base, breakBonus } = calc
          const success = Math.random() < rate
          ;(ctx.data as Record<string, unknown>).breakthroughCalc = { rate, talentBonus, base, breakBonus, success, isMajor: (calc as { isMajor?: boolean }).isMajor }
          const cap = rules.cultivationCap(w)
          if (w.stats.cultivation < cap) return `修为未满：${w.stats.cultivation}/${cap}，尚不宜突破`
          return
        },
      },
      {
        type: 'llm',
        system: BREAKTHROUGH_SYSTEM,
        input: (ctx: FlowCtx) => {
          const w = ctx.state._w as never
          const calc = ctx.data.breakthroughCalc as { rate: number; talentBonus: number; success: boolean } | undefined
          return `当前状态：\n${JSON.stringify(rules.publicState(w))}\n突破计算：成功=${calc?.success} 率=${calc ? Math.round(calc.rate * 100) : '?'}% 天资加成=${calc?.talentBonus ?? 0}\n据此写突破叙事（含 extraCultivation/nextRateBonus）。`
        },
        schema: BREAKTHROUGH_SCHEMA,
        assign: 'breakthrough',
      },
      { type: 'static', fn: (ctx) => rules.applyBreakthrough(ctx) ?? undefined },
      { type: 'render', build: views.buildPlayScreen },
    ],
    requireRender: true,
  })
}