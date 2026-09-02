/**
 * @fileoverview 主推进管线模块
 * @description 实现 game_turn 流程，已并入冲突分支抽检与战斗实写逻辑：
 * - 常规回合：TURN_SYSTEM 生成剧情 → 突破分支或常规落库 → 生成下轮选项
 * - 战斗分支：命中 pendingBranch.battle 时走 CONFRONTATION_BATTLE_SYSTEM 战斗推演
 * - 共同收尾：校验选项、存储分支、渲染主屏
 * 依赖 AFFINITY_DELTA_SCHEMA / DELTA_SCHEMA 等 schema 与多条 system prompt。
 */
import type { PluginSetupAPI } from '@prisflow/proactiveai-plugin-types'
import type { FlowCtx } from '@prisflow/proactiveai-plugin-types'
import type { Ledger, WorldState } from '../ledger'
import type { Rules } from '../rules'
import type { Views } from '../views'
import { initCtx } from './helpers'
import { TURN_SCHEMA, CHOICE_SCHEMA, BATTLE_SCHEMA, BREAKTHROUGH_SCHEMA } from './schemas'
import { TURN_SYSTEM, CHOICE_SYSTEM, CONFRONTATION_BATTLE_SYSTEM, BREAKTHROUGH_SYSTEM } from '../prompts'
import { consumePendingBranch } from '../rules/confrontation'

/**
 * 注册回合推进相关 flow
 * @param api - 插件注册 API
 * @param ledger - 世界账本
 * @param rules - 规则集，提供 publicState/calcBreakthroughRate/applyTurn 等方法
 * @param views - 视图构建器，提供 buildPlayScreen 主屏渲染
 * @description 注册 game_turn 流程：初始化 → 前置校验 → 分支抽检 → battle/日常双路径 → 渲染，是游戏主循环入口
 */
export function registerTurnFlows(api: PluginSetupAPI, ledger: Ledger, rules: Rules, views: Views): void {
  api.flow.register({
    name: 'game_turn',
    nodes: [
      // [static] 上下文初始化：加载 ledger 世界到 ctx.state._w | 规则: initCtx(ledger)
      { type: 'static', fn: initCtx(ledger) },
      // [static] 前置校验：检查 meta.created/meta.dead，未建角或已死亡则阻断流程 | 无 prompt/schema | 读 w.meta
      {
        type: 'static',
        fn: (ctx: FlowCtx): string | void => {
          const w = ctx.state._w as WorldState
          if (!w.meta.created) return '角色未创建，请先创建角色'
          if (w.meta.dead) return '已身死道消，请重开'
          return
        },
      },
      // [static] 分支抽检：解析玩家输入匹配 pendingBranch，命中则写入 branchPick 并 saveAll | 无 prompt/schema | 读 ctx.input.text | 规则: consumePendingBranch | 写 ctx.data.branchPick
      {
        type: 'static',
        fn: (ctx: FlowCtx): string | void => {
          const w = ctx.state._w as WorldState
          const inputText = (ctx.input as { text?: string })?.text || ''
          const pick = consumePendingBranch(inputText, w)
          if (pick) {
            ;(ctx.data as Record<string, unknown>).branchPick = pick
            ledger.saveAll()
          }
          return
        },
      },
      // [condition] 战斗分支分流：当 branchPick.kind === 'battle' 时走战斗路径，否则走常规回合路径
      {
        type: 'condition',
        when: (ctx: FlowCtx) => (ctx.data as Record<string, unknown>).branchPick !== undefined && ((ctx.data as Record<string, unknown>).branchPick as { kind: string }).kind === 'battle',
        then: [
          // [llm] 战斗推演：根据分支标题/描述+玩家输入+全量状态客观推演战斗 | prompt: CONFRONTATION_BATTLE_SYSTEM | schema: {text, dead, delta: DELTA_SCHEMA} | assign: battleConfrontation
          {
            type: 'llm',
            system: CONFRONTATION_BATTLE_SYSTEM,
            input: (ctx: FlowCtx) => {
              const w = ctx.state._w as never
              const pick = (ctx.data as Record<string, unknown>).branchPick as { title: string; simpleDesc: string } | undefined
              return `玩家选择分支：${pick?.title || ''}（${pick?.simpleDesc || ''}）\n玩家输入：${(ctx.input as { text?: string })?.text || ''}\n\n当前全量状态：\n${JSON.stringify(rules.publicState(w))}\n请客观推演战斗并给出结果。`
            },
            schema: BATTLE_SCHEMA,
            assign: 'battleConfrontation',
          },
          { type: 'static', fn: rules.applyConfrontationBattle },
          // [condition] 存活才生成选项：未死亡时才继续生成下轮选项
          {
            type: 'condition',
            when: (ctx: FlowCtx) => (ctx.state._w as { meta: { dead: boolean } }).meta.dead !== true,
            then: [
              // [llm] 战后选项生成：基于战斗文本与当前状态生成 4 个带风险与分支的选项 | prompt: CHOICE_SYSTEM | schema: {options[4]{text, risk, branches[2-3]}} | assign: choice
              {
                type: 'llm',
                system: CHOICE_SYSTEM,
                input: (ctx: FlowCtx) => {
                  const w = ctx.state._w as never
                  const battleText = (ctx.data.battleConfrontation as { text?: string } | undefined)?.text || ''
                  return `本回合剧情：${battleText}\n当前状态：\n${JSON.stringify(rules.publicState(w))}`
                },
                schema: CHOICE_SCHEMA,
                assign: 'choice',
              },
              // [static] 选项校验：检查 choice 选项数/风险/分支合法性 | 读 choice | 规则: rules.validateChoice
              { type: 'static', fn: rules.validateChoice },
              // [static] 分支存储：将 choice 中的 branches 抽检存储为 pendingBranch | 读 choice | 规则: rules.storePendingBranch
              { type: 'static', fn: rules.storePendingBranch },
            ],
          },
          // [render] 主屏渲染：战斗路径终点渲染游戏主屏 | 依赖 battleConfrontation / choice
          { type: 'render', build: views.buildPlayScreen },
        ],
        else: [
          // [llm] 常规回合推演：根据玩家行动+分支 other 提示+全量状态生成剧情 | prompt: TURN_SYSTEM | schema: {text, kind, eventRef, delta, relationships, romance, cultivate, switchMain, breakthrough, timeCost} | assign: turn
          {
            type: 'llm',
            system: TURN_SYSTEM,
            input: (ctx: FlowCtx) => {
              const w = ctx.state._w as never
              const pick = (ctx.data as Record<string, unknown>).branchPick as { title: string; simpleDesc: string } | undefined
              const branchHint = pick ? `（本次为分支抽检命中 other：${pick.title} - ${pick.simpleDesc}，请据此展开完整剧情）` : ''
              return `玩家行动：${(ctx.input as { text?: string })?.text || '（无）'}${branchHint}\n\n当前状态：\n${JSON.stringify(rules.publicState(w))}`
            },
            schema: TURN_SCHEMA,
            assign: 'turn',
          },
          // [condition] 突破分流：当 turn.breakthrough === true 时走突破子链，否则走常规落库
          {
            type: 'condition',
            when: (ctx: FlowCtx) => !!(ctx.data.turn as { breakthrough?: boolean } | undefined)?.breakthrough,
            then: [
              // [static] 突破率计算：调用 calcBreakthroughRate 掷骰决定 success，检查修为是否达 cap | 无 prompt/schema | 读 turn | 写 breakthroughCalc | 规则: rules.calcBreakthroughRate + cultivationCap
              {
                type: 'static',
                fn: (ctx: FlowCtx): string | void => {
                  const w = ctx.state._w as WorldState
                  const calc = rules.calcBreakthroughRate(w)
                  const { rate, talentBonus, base, breakBonus } = calc
                  const success = Math.random() < rate
                  ;(ctx.data as Record<string, unknown>).breakthroughCalc = { rate, talentBonus, base, breakBonus, success, isMajor: (calc as { isMajor?: boolean }).isMajor }
                  const cap = rules.cultivationCap(w)
                  if (w.stats.cultivation < cap) return `修为不足：${w.stats.cultivation}/${cap}，请先修炼`
                  return
                },
              },
              // [llm] 突破文案生成：基于当前状态与突破计算结果生成突破文本 | prompt: BREAKTHROUGH_SYSTEM | schema: {text, extraCultivation, nextRateBonus} | assign: breakthrough
              {
                type: 'llm',
                system: BREAKTHROUGH_SYSTEM,
                input: (ctx: FlowCtx) => {
                  const w = ctx.state._w as WorldState
                  const calc = ctx.data.breakthroughCalc as { rate: number; talentBonus: number; success: boolean } | undefined
                  return `当前状态：\n${JSON.stringify(rules.publicState(w))}\n突破计算：成功=${calc?.success} 率=${calc ? Math.round(calc.rate*100) : '?'}% 天资加成=${calc?.talentBonus ?? 0}\n请据此写突破短文案并给出 extraCultivation/nextRateBonus。`
                },
                schema: BREAKTHROUGH_SCHEMA,
                assign: 'breakthrough',
              },
              // [static] 突破落库：应用突破结果（境界/修为/加成）并写 log | 读 breakthrough/breakthroughCalc | 规则: rules.applyBreakthrough
              { type: 'static', fn: rules.applyBreakthrough },
            ],
            else: [
              // [static] 常规落库：应用 turn 的 delta/关系/修炼/时间等 | 读 turn | 规则: rules.applyTurn
              { type: 'static', fn: rules.applyTurn }],
          },
          // [condition] 存活才存分支抽检：死亡时无下轮选项，不存 pendingBranch
          {
            type: 'condition',
            when: (ctx: FlowCtx) => (ctx.state._w as { meta: { dead: boolean } }).meta.dead !== true,
            then: [
              // [static] 分支存储：将 turn.options 中的分支存储为 pendingBranch（选项已由说书人节点直接输出）| 读 turn.options | 规则: rules.storePendingBranch
              { type: 'static', fn: rules.storePendingBranch },
            ],
          },
          // [render] 主屏渲染：常规路径终点渲染游戏主屏 | 依赖 turn（含 options）
          { type: 'render', build: views.buildPlayScreen },
        ],
      },
    ],
    requireRender: true,
  })
}
