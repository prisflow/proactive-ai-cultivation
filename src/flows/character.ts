/**
 * @fileoverview 建角子链模块
 * @description AI 一次性确定出身/天资/名字/性别 → 校验落位 → 生成开场剧情 → 渲染首屏。
 * 全部由 AI 决定，供 create_character / reset_character / era_rebirth 等上层 flow 协作复用。
 * 本文件导出 characterCreationNodes 工厂，返回可复用的 FlowNode[] 子链。
 */
import type { FlowNode } from '@proactive-ai/plugin-types'
import type { FlowCtx } from '@proactive-ai/plugin-types'
import type { Rules } from '../rules'
import type { Views } from '../views'
import { CHAR_CREATE_SYSTEM, OPENING_SYSTEM } from '../prompts'
import { CHAR_CREATE_SCHEMA, OPENING_SCHEMA } from './schemas'

/**
 * 生成建角子链节点数组
 * @param rules - 规则集，提供 parseOriginPool/parseTalentPool/applyCharacter/validateOpening 等方法
 * @param views - 视图构建器，提供 buildFirstScreen 首屏渲染
 * @returns FlowNode[] 建角完整链路：LLM 选角 → 静态落库 → LLM 开场 → 校验 → 渲染
 * @description 被 game.ts 的多个 flow 复用（create_character / reset_character / era_rebirth 末段），确保建角逻辑单一来源
 */
export function characterCreationNodes(rules: Rules, views: Views): FlowNode[] {
  return [
    // [llm] 建角抉择：根据世界名+出身池+天资池让 AI 选定 origin/talents/name/gender/temperament | prompt: CHAR_CREATE_SYSTEM | schema: {origin, talents[3], name, gender, temperament} | assign: charCreate
    {
      type: 'llm',
      system: CHAR_CREATE_SYSTEM,
      input: (ctx: FlowCtx) => {
        const w = ctx.state._w as { stats: { world?: { name?: string } } }
        return `玩家初输：${(ctx.input as { text?: string })?.text || ''}\n世界：${w.stats.world?.name || ''}\n\n出身池：\n${JSON.stringify(rules.parseOriginPool(ctx.state._w as never))}\n\n天资池（9条吉凶 6:3，需抽 3）：\n${JSON.stringify(rules.parseTalentPool(ctx.state._w as never))}`
      },
      schema: CHAR_CREATE_SCHEMA,
      assign: 'charCreate',
    },
    // [static] 落库校验：校验 charCreate 合法性并写入 WorldState（出身/天资/姓名/性别/初始属性） | 无 prompt/schema | 读 charCreate | 规则: rules.applyCharacter
    { type: 'static', fn: rules.applyCharacter },
    // [llm] 开场剧情生成：基于已落库的 publicState 生成开场文本与 2-4 个初始选项 | prompt: OPENING_SYSTEM | schema: {text, options[{text, risk}]} | assign: opening
    {
      type: 'llm',
      system: OPENING_SYSTEM,
      input: (ctx: FlowCtx) => {
        const w = ctx.state._w as never
        return `当前状态：\n${JSON.stringify(rules.publicState(w))}`
      },
      schema: OPENING_SCHEMA,
      assign: 'opening',
    },
    // [static] 开场校验：校验 opening 文本与选项数/风险等级合法性，写 log 并持久化 | 无 prompt/schema | 读 opening | 规则: rules.validateOpening
    { type: 'static', fn: rules.validateOpening },
    // [render] 首屏渲染：调用 views.buildFirstScreen 将开场剧情与选项渲染为首屏 | 无 prompt/schema/assign | 依赖 opening 已校验
    { type: 'render', build: views.buildFirstScreen },
  ]
}
