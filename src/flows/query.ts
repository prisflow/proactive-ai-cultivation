/**
 * 查询管线：game_query（纯静态 LLM 查询，不推时间，不渲染，按插件上下文流式文本回答）。
 */
import type { PluginSetupAPI } from '@prisflow/proactiveai-plugin-types'
import type { FlowCtx } from '@prisflow/proactiveai-plugin-types'
import type { Ledger, WorldState } from '../ledger'
import type { Rules } from '../rules'
import { initCtx } from './helpers'
import { QUERY_SYSTEM } from '../prompts'
import { QUERY_SCHEMA } from './schemas'

/**
 * 注册查询相关 flow
 * @param api - 插件注册 API
 * @param ledger - 世界账本
 * @param rules - 规则集
 */
export function registerQueryFlows(api: PluginSetupAPI, ledger: Ledger, rules: Rules): void {
  api.flow.register({
    name: 'game_query',
    nodes: [
      // [static] 上下文初始化：加载 ledger 到 ctx.state._w
      { type: 'static', fn: initCtx(ledger) },
      // [llm] 档案查询：基于全量状态回答纯问题，不推时间 | prompt: QUERY_SYSTEM | schema: answer | assign: query
      {
        type: 'llm',
        system: QUERY_SYSTEM,
        input: (ctx: FlowCtx) => {
          const w = ctx.state._w as WorldState
          const focus = (ctx.input as { focus?: string; text?: string })?.focus || (ctx.input as { text?: string })?.text || ''
          return `问题：${focus}\n\n当前全量状态：\n${JSON.stringify(rules.publicState(w))}`
        },
        schema: QUERY_SCHEMA,
        assign: 'query',
      },
      // [static] 结果回写：将 LLM 的 answer 写入 ctx.data.queryAnswer 供 tool 透传
      {
        type: 'static',
        fn: (ctx: FlowCtx): string | void => {
          const d = ctx.data.query as { answer?: string } | undefined
          if (!d || typeof d.answer !== 'string' || !d.answer.trim()) return '查询回答为空'
          ctx.data.queryAnswer = d.answer.trim()
          return undefined
        },
      },
    ],
    requireRender: false,
  })
}
