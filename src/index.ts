/**
 * 修仙世界插件入口。
 *
 * 架构：工具边界 = 业务管线边界。
 * - create_world/create_character/reset_character/era_rebirth/generate_major_events/generate_npcs  世界/角色管线
 * - game_turn  主推演（战斗并入）
 * - game_query  纯静态查询
 * - 记忆由宿主通用层单源，不在此维护
 *
 * UI 推送不是原子工具：它是管线内部的必经步骤（图内 render 节点声明输出，
 * 宿主执行推送）。LLM 只需触发管线（调一次 game_turn / create_character），
 * 渲染由管线自动完成——不存在"LLM 单独推送 UI"这个可遗忘的动作。
 *
 * 编译：esbuild --bundle → 单文件 CJS（userData/plugins/cultivation.js），宿主零改动。
 */
import type { Plugin, PluginSetupAPI } from '@prisflow/proactiveai-plugin-types'
import { createLedger } from './ledger'
import { createRules } from './rules'
import { createViews } from './views'
import { registerFlows } from './flows'
import { registerTools } from './tools'
import { PROTOCOL_PROMPT } from './prompts'

/** 压缩器系统提示：把旧对话归纳为叙事史摘要（game_lore），保持宿主解耦。 */
const COMPACT_SYSTEM =
  '你是对话压缩器。把给定的对话记录压缩成叙事史摘要，供后续剧情续写参考。' +
  '要求：保留新出现/变化的人物与关系、事件推进与因果、玩家的重要选择与结果、获得的物品/功法/丹药、玩家的目标与承诺；' +
  '按时间顺序归纳为短段落，每段以（第X~Y回合：）开头；只归纳事实与情节，不输出评论；输出纯文本，300字以内。'

const plugin: Plugin = {
  id: 'cultivation',
  name: '修仙世界',
  version: '0.5.1',
  description: '数值修仙世界：境界阶梯/功法/丹药/术法量化，大事件驱动叙事，NPC 池与道侣系统，战败即死。',
  setup(api: PluginSetupAPI) {
    const ledger = createLedger(api)
    const rules = createRules(ledger)
    const views = createViews(rules)

    registerFlows(api, ledger, rules, views)
    registerTools(api, ledger, rules)

    api.registerContext({
      contextId: 'cultivation',
      role: 'sub',
      description: '修仙文字游戏：仅当用户明确想进入/开始修仙世界、玩修仙游戏、或在修仙世界内继续行动时进入；问候/闲聊/无关话题不要进入，直接文本回复。',
      initialPrompt: PROTOCOL_PROMPT,
      toolNames: ['create_world', 'create_character', 'reset_character', 'game_turn', 'game_query', 'generate_major_events', 'generate_npcs'],
      compaction: {
        summaryPrompt: COMPACT_SYSTEM,
        summarySlot: 'game_lore',
        summaryLabel: '【剧情史】',
        prefixSlots: ['game_lore'],
        keepTokens: 8000,
        allowResummarize: true,
      },
    })
  },
}

export = plugin
