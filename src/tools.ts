/**
 * 工具协议层：LLM 可见的操作入口（记忆由宿主通用层单源，不在此维护）。
 * - create_world/create_character/reset_character/era_rebirth/generate_major_events  世界/角色管线
 * - game_turn               主推演（收 delta 含服丹/战斗/修炼/好感）
 * - game_query              纯静态查询（状态摘要 + NPC 档案查询）
 * transformPrompt 为唯一转换点：UI 工具从 result.state 渲染树自做完整文本化（ui），
 * 执行结果文本走 text，失败走 success.error，无结果则全空（副作用完成）。
 */
import type { PluginSetupAPI } from '@prisflow/proactiveai-plugin-types'
import type { NonSilentToolDef, ToolResult, ToolPromptResult, ToolCallMeta, FlowResult } from '@prisflow/proactiveai-plugin-types'
import type { Ledger } from './ledger'
import type { Rules } from './rules'

/** 渲染树 → LLM 可读文本（transformPrompt 的 ui 产物）。 */
function formatUiTree(state: unknown): string {
  const n = state as { component: string; props?: Record<string, unknown>; children?: unknown[] } | undefined
  if (!n || typeof n !== 'object' || typeof n.component !== 'string') return ''
  const fmt = (chs: unknown[] | undefined): string => {
    if (!chs?.length) return ''
    return chs.map((c) => {
      const x = c as { component: string; props?: Record<string, unknown>; children?: unknown[] }
      const propsStr = x.props
        ? Object.entries(x.props)
            .filter(([k]) => k !== 'className')
            .map(([k, v]) => `${k}=${v}`)
            .join(' ')
        : ''
      const childStr = x.children?.length ? ` [${fmt(x.children)}]` : ''
      return `${x.component}(${propsStr})${childStr}`
    }).join(', ')
  }
  const childrenText = fmt(n.children)
  return `[UI:${n.component}]${childrenText ? ` ${childrenText}` : ''}`
}

/** UI 工具的统一成功产出：执行结果文本（text）+ 完整文本化 UI（ui）+ 下一步建议（instruction）。 */
function uiPrompt(toolName: string, text: string, state?: unknown, instruction?: string): ToolPromptResult {
  const ui = state ? formatUiTree(state) : ''
  return { success: { toolName }, instruction, result: ui ? { text, ui } : { text } }
}

/** 文本工具的统一定失败产出。 */
function failPrompt(toolName: string, error: string): ToolPromptResult {
  return { success: { toolName, error } }
}

function runFlow(api: PluginSetupAPI, flowName: string, input: unknown): Promise<ToolResult> {
  return api.flow.run(flowName, input).then((res: FlowResult) => {
    if (!res.ok) return { ok: false, error: res.error || '游戏引擎执行失败' }
    // state.__render 由宿主 loader 挂载（最后一次渲染树），供 transformPrompt 做 UI 文本化
    const render = (res.state as { __render?: unknown } | undefined)?.__render
    return { ok: true, result: { state: res.state, render } }
  })
}

/** 世界状态变化后刷新慢变世界卡（world_setting）：
 * 渲染文本存入世界对象（storage 数据源，随 ledger.saveAll 持久化），
 * 并注入头部稳定层（prompts.set，覆盖更新；内容不变时前缀逐字稳定，不影响缓存命中）。 */
function refreshWorldSetting(api: PluginSetupAPI, ledger: Ledger, rules: Rules, meta: ToolCallMeta): void {
  const w = ledger.getWorld(meta.conversationId)
  w.worldSetting = rules.worldSetting(w)
  api.prompts.set(w.worldSetting)
}

export function registerTools(api: PluginSetupAPI, ledger: Ledger, rules: Rules): void {
  const defs: NonSilentToolDef[] = [
    {
      name: 'create_world',
      description: '创建/重置世界：清空世界后生成世界骨架、出身/天资池并推送世界屏。与大事件/NPC 生成解耦，成功后必须紧跟 generate_npcs（1次，内部生成 30 人）扩充 NPC 池，再 generate_major_events 生成首五十年大事件。',
      inputSchema: { type: 'object', properties: { text: { type: 'string', description: '玩家输入原文' } }, required: ['text'] },
      silent: false,
transformPrompt: (result: ToolResult) => {
        if (!result.ok) return failPrompt('create_world', result.error)
        const state = (result.result as { render?: unknown })?.render
        // 建角链路：create_world → generate_npcs（1次30人） → generate_major_events → create_character（新档/重开必经）
        return uiPrompt('create_world', '[世界已创建]', state, '请紧跟 generate_npcs 调用 1 次生成 NPC 池（30人），然后 generate_major_events 生成首五十年大事件，完成后继续 create_character 建角，不可提前收轮')
      },
      run: (input: Record<string, unknown>, meta: ToolCallMeta) => {
        return runFlow(api, 'create_world', input).then((res) => {
          if (res.ok) refreshWorldSetting(api, ledger, rules, meta)
          return res
        })
      },
    },
    {
      name: 'create_character',
      description: '创建角色：从已生成的出身/天资池中选出身天资取名建角并推送首屏。需先有世界。',
      inputSchema: { type: 'object', properties: { text: { type: 'string', description: '玩家输入原文' } }, required: ['text'] },
      silent: false,
      transformPrompt: (result: ToolResult) => {
        if (!result.ok) return failPrompt('create_character', result.error)
        const state = (result.result as { render?: unknown })?.render
        // 建角链路终点：角色已建，本轮世界管线完成，收轮
        return uiPrompt('create_character', '[角色已创建]', state, '建角完成，世界管线全部就绪，调用 host_yield 收轮')
      },
      run: (input: Record<string, unknown>, meta: ToolCallMeta) => {
        return runFlow(api, 'create_character', input).then((res) => {
          if (res.ok) refreshWorldSetting(api, ledger, rules, meta)
          return res
        })
      },
    },
    {
      name: 'reset_character',
      description: '仅重置角色：保留当前世界、出身池/天资池与大事件/时间，不推时间，仅清空角色后从池中重选出身天资并重建角色。玩家想换个角色/用此世界重来一次时调用。',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '玩家输入原文（重置角色意愿）' },
        },
        required: ['text'],
      },
      silent: false,
      transformPrompt: (result: ToolResult) => {
        if (!result.ok) return failPrompt('reset_character', result.error)
        const state = (result.result as { render?: unknown })?.render
        // 完整管线：内部已重建角色，本轮完成，收轮
        return uiPrompt('reset_character', '[角色已重置] 已保留世界，仅重建角色。', state, '角色重建完成，调用 host_yield 收轮')
      },
      run: (input: Record<string, unknown>, meta: ToolCallMeta) => {
        return runFlow(api, 'reset_character', input).then((res) => {
          if (res.ok) refreshWorldSetting(api, ledger, rules, meta)
          return res
        })
      },
    },
    {
      name: 'game_turn',
      description: '推进修仙世界日常剧情（时间 +任意月（可为0），按闭关时长；切主修）：叙事推进进行中的大事件，搜刮丹药/功法为辅，好感/道侣/记忆在此表达，界面推送（渲染必达）。战斗遭遇请改调 game_battle；冲击突破请改调 game_breakthrough。',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '玩家输入原文' },
        },
        required: ['text'],
      },
      silent: false,
      autoYield: true,
      transformPrompt: (result: ToolResult) => {
        if (!result.ok) return failPrompt('game_turn', result.error)
        const state = (result.result as { render?: unknown })?.render
        const turns = (result.result as { meta?: { turns?: number; dead?: boolean } })?.meta
        if (turns?.dead) return uiPrompt('game_turn', '[身死道消] 玩家已死亡，此局结束。如需重新开始请调用 create_world。', state)
        return uiPrompt('game_turn', '[UI 已推送]', state, '立即调用 host_yield 结束本轮。在此之前禁止调用任何工具、禁止输出任何文本。host_yield 之后等待玩家下一条消息。')
      },
      run: (input: Record<string, unknown>, meta: ToolCallMeta) => {
        return api.flow
          .run('game_turn', input)
          .then((res: FlowResult) => {
            if (!res.ok) return { ok: false, error: res.error || '游戏引擎执行失败' }
            const w = ledger.getWorld(meta.conversationId)
            refreshWorldSetting(api, ledger, rules, meta)
            const render = (res.state as { __render?: unknown } | undefined)?.__render
            return { ok: true, result: { state: res.state, render, meta: { turns: w.meta.turns, dead: w.meta.dead } } }
          })
      },
    },
    {
      name: 'game_battle',
      description: '战斗遭遇推演：玩家卷入敌对冲突、厮杀、围攻、护法之战等战斗场景时调用（替代 game_turn 推进本回合）。客观推演胜/逃/死，delta 结算战利品与损伤，界面推送（渲染必达）。日常非战斗剧情请用 game_turn。',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '玩家输入原文' },
        },
        required: ['text'],
      },
      silent: false,
      autoYield: true,
      transformPrompt: (result: ToolResult) => {
        if (!result.ok) return failPrompt('game_battle', result.error)
        const state = (result.result as { render?: unknown })?.render
        const turns = (result.result as { meta?: { turns?: number; dead?: boolean } })?.meta
        if (turns?.dead) return uiPrompt('game_battle', '[身死道消] 玩家已战死，此局结束。如需重新开始请调用 create_world。', state)
        return uiPrompt('game_battle', '[UI 已推送]', state, '立即调用 host_yield 结束本轮。在此之前禁止调用任何工具、禁止输出任何文本。host_yield 之后等待玩家下一条消息。')
      },
      run: (input: Record<string, unknown>, meta: ToolCallMeta) => {
        return api.flow
          .run('game_battle', input)
          .then((res: FlowResult) => {
            if (!res.ok) return { ok: false, error: res.error || '游戏引擎执行失败' }
            const w = ledger.getWorld(meta.conversationId)
            refreshWorldSetting(api, ledger, rules, meta)
            const render = (res.state as { __render?: unknown } | undefined)?.__render
            return { ok: true, result: { state: res.state, render, meta: { turns: w.meta.turns, dead: w.meta.dead } } }
          })
      },
    },
    {
      name: 'game_breakthrough',
      description: '冲击突破：玩家修为已达当前境界上限（修为=cap）且意图冲击瓶颈/突破境界时调用，系统判定成败并推演突破叙事，界面推送（渲染必达）。修为未满或日常剧情请用 game_turn。',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '玩家输入原文' },
        },
        required: ['text'],
      },
      silent: false,
      autoYield: true,
      transformPrompt: (result: ToolResult) => {
        if (!result.ok) return failPrompt('game_breakthrough', result.error)
        const state = (result.result as { render?: unknown })?.render
        return uiPrompt('game_breakthrough', '[UI 已推送]', state, '立即调用 host_yield 结束本轮。在此之前禁止调用任何工具、禁止输出任何文本。host_yield 之后等待玩家下一条消息。')
      },
      run: (input: Record<string, unknown>, meta: ToolCallMeta) => {
        return api.flow
          .run('game_breakthrough', input)
          .then((res: FlowResult) => {
            if (!res.ok) return { ok: false, error: res.error || '游戏引擎执行失败' }
            const w = ledger.getWorld(meta.conversationId)
            refreshWorldSetting(api, ledger, rules, meta)
            const render = (res.state as { __render?: unknown } | undefined)?.__render
            return { ok: true, result: { state: res.state, render, meta: { turns: w.meta.turns, dead: w.meta.dead } } }
          })
      },
    },
    {
      name: 'generate_npcs',
      description: '生成一批 NPC（10 人：凡人2 + 修士7 + 大修士1，分阶层）。世界创建后、大事件生成前调用，可连续调用多次扩充 NPC 池（每次一批，自动防重名）。玩家需要更多可结识的 NPC 时也可调用。',
      inputSchema: { type: 'object', properties: {}, required: [] },
      silent: false,
      transformPrompt: (result: ToolResult) => {
        if (!result.ok) return failPrompt('generate_npcs', result.error)
        const count = (result.result as { count?: number })?.count
        return { success: { toolName: 'generate_npcs' }, result: { text: count ? `[NPC 已生成] 当前共 ${count} 名` : '[NPC 已生成]' } }
      },
      run: async (input: Record<string, unknown>, meta: ToolCallMeta) => {
        const res = await runFlow(api, 'generate_npcs', input)
        if (!res.ok) return res
        const w = ledger.getWorld(meta.conversationId)
        refreshWorldSetting(api, ledger, rules, meta)
        return { ok: true, result: { count: w.stats.characters.length } }
      },
    },
    {
      name: 'generate_major_events',
      description: '生成未来五十年大事件：每五十年（600月）生成 15-30 条未来大事件（at/by/type/summary），均匀分布在 50 年内，补充世界时间线。大事件不足或已过五十年未生成时调用。',
      inputSchema: { type: 'object', properties: {}, required: [] },
      silent: false,
      transformPrompt: (result: ToolResult) => {
        if (!result.ok) return failPrompt('generate_major_events', result.error)
        const c = (result.result as { count?: number })?.count
        // 建角链路收尾判断：世界已创建但尚未建角（meta.created=false）→ 必须紧跟 create_character；
        // 已有角色（补大事件场景）→ 本轮工具链完成，收轮
        const created = (result.result as { characterCreated?: boolean })?.characterCreated
        const base = c ? `[大事件已生成] 共${c}条` : '[大事件已生成]'
        return {
          success: { toolName: 'generate_major_events' },
          result: { text: base },
          ...(created === false
            ? { instruction: '世界已就绪但尚无角色：立即调用 create_character 为玩家建角，完成后才能收轮' }
            : { instruction: '大事件已生成，本轮世界管线完成，调用 host_yield 收轮' }),
        }
      },
      run: async (input: Record<string, unknown>, meta: ToolCallMeta) => {
        const res = await runFlow(api, 'generate_major_events', input)
        if (!res.ok) return res
        const w = ledger.getWorld(meta.conversationId)
        refreshWorldSetting(api, ledger, rules, meta)
        return { ok: true, result: { count: w.majorEvents.length, characterCreated: w.meta.created } }
      },
    },
    {
      name: 'game_query',
      description: '纯静态 LLM 查询：基于当前全量状态回答纯规则/世界观/数值/档案问题，不推时间，插件上下文以正常流式文本返回答案。',
      inputSchema: {
        type: 'object',
        properties: {
          focus: { type: 'string', description: '纯问关键词，如“筑基要多少修为”“玄寰界有几域”、某 NPC 名/地点名，非剧情推进行为' },
        },
        required: ['focus'],
      },
      silent: false,
      transformPrompt: (result: ToolResult) => {
        if (!result.ok) return failPrompt('game_query', result.error)
        const ans = (result.result as { answer?: string })?.answer
        return { success: { toolName: 'game_query' }, result: { text: ans ? String(ans) : '[查询无结果]' } }
      },
      run: (input: Record<string, unknown>, meta: ToolCallMeta) =>
        api.flow
          .run('game_query', input)
          .then((res) => {
            if (!res.ok) return { ok: false, error: res.error || '查询失败' }
            const ans = (res.data as Record<string, unknown>)?.queryAnswer as string | undefined
              ?? (res.data as Record<string, unknown>)?.query as unknown as { answer?: string } | undefined
            const text = typeof ans === 'string' ? ans : typeof (ans as unknown as { answer?: string })?.answer === 'string' ? (ans as unknown as { answer?: string }).answer! : ''
            return { ok: true, result: { answer: text } }
          }),
    },

  ]

  for (const def of defs) {
    api.registerTool(def)
  }
}
