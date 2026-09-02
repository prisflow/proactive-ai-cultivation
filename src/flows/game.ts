/**
 * @fileoverview 世界/初始化管线模块
 * @description 提供 worldGenNodes 工厂与初始化流程的注册：
 * - worldGenNodes：世界骨架 → 出身/天资生成与重试 → 合审重写 的完整子链，供 create_world 复用（NPC 由独立工具 generate_npcs 生成）
 * - registerGameFlows：注册 create_world / generate_npcs / create_character / reset_character 四个 flow
 * 每个 LLM 节点均配有 system prompt、input 构造、JSON Schema 与 assign 键，配合 rules.* 做校验落库。
 */
import type { PluginSetupAPI } from '@prisflow/proactiveai-plugin-types'
import type { FlowNode } from '@prisflow/proactiveai-plugin-types'
import type { FlowCtx } from '@prisflow/proactiveai-plugin-types'
import type { Ledger, WorldState } from '../ledger'
import type { Rules } from '../rules'
import type { Views } from '../views'
import { initCtx, resetWorld, resetCharacter } from './helpers'
import { characterCreationNodes } from './character'
import { WORLD_BASE_SCHEMA, ORIGINS_SCHEMA, TALENTS_SCHEMA, REVIEW_SCHEMA, npcBatchSchema } from './schemas'
import { WORLD_BASE_SYSTEM, ORIGINS_SYSTEM, TALENTS_SYSTEM, ORIGINS_RETRY_SYSTEM, TALENTS_RETRY_SYSTEM, REVIEW_STARTER_COMBINED_SYSTEM, reviewStarterCombinedInput, npcSystem, buildNpcInput } from '../prompts'

/**
 * 世界生成节点链工厂（create_world 专用）
 * @param rules - 规则集，提供 applyWorldBase/applyNpcPool/applyOrigins/applyTalents 等校验落库方法及 parseOriginPool 解析
 * @returns FlowNode[] 世界生成完整链路：世界骨架 → NPC 池 → 出身 → 天资 → 合审重写
 * @description 按序生成世界观与初始资源，含出身/天资的单次重试与评审驱动的二次重写，确保内容质量与数值合规
 */
export function worldGenNodes(rules: Rules): FlowNode[] {
  return [
    // [llm] 世界骨架生成：根据玩家愿望生成 world（name/regions/sects/towns/law/rumor） | prompt: WORLD_BASE_SYSTEM | schema: WORLD_BASE_SCHEMA | assign: worldBase
    {
      type: 'llm',
      system: WORLD_BASE_SYSTEM,
      input: (ctx: FlowCtx) => `玩家愿望：${(ctx.input as { text?: string })?.text || ''}\n请生成世界骨架（world + majorEvents）。`,
      schema: WORLD_BASE_SCHEMA,
      assign: 'worldBase',
    },
    // [static] 世界骨架落库：校验 worldBase 并写入 WorldState，失败则阻断 | 无 prompt/schema | 读 worldBase | 规则: rules.applyWorldBase
    { type: 'static', fn: rules.applyWorldBase },
    // [llm] 出身池生成：基于世界名+玩家初输生成 2-4 个出身（NPC 池由独立工具 generate_npcs 生成） | prompt: ORIGINS_SYSTEM | schema: ORIGINS_SCHEMA | assign: origins
    {
      type: 'llm',
      system: ORIGINS_SYSTEM,
      input: (ctx: FlowCtx) => {
        const w = (ctx.state._w as { stats: { world?: { name?: string; regions?: string[]; towns?: Array<{ name: string }> } } }).stats
        const wish = (ctx.input as { text?: string })?.text?.trim() ? `玩家初输：${(ctx.input as { text?: string }).text}\n` : ''
        return `${wish}世界：${w.world?.name || ''}\n地域：${(w.world?.regions || []).join('、')}\n城镇：${(w.world?.towns || []).map((t) => t.name).join('、')}\n请生成 2-4 个出身（origins），location 须为上述地域/城镇。`
      },
      schema: ORIGINS_SCHEMA,
      assign: 'origins',
    },
    // [static] 出身初次校验：调用 rules.applyOrigins，失败且未重试则暂存 originsError 待 condition 重试 | 无 prompt/schema | 读 origins | 规则: rules.applyOrigins
    {
      type: 'static',
      fn: (ctx: FlowCtx): string | void => {
        const err = rules.applyOrigins(ctx)
        if (err) {
          if (!(ctx.data as Record<string, unknown>).originsRetried) {
            ;(ctx.data as Record<string, unknown>).originsError = err
            return
          }
          return err
        }
        delete (ctx.data as Record<string, unknown>).originsError
      },
    },
    // [condition] 出身重试分支：当 originsError 存在且未重试时进入重试子链
    {
      type: 'condition',
      when: (ctx: FlowCtx) => !!(ctx.data as Record<string, unknown>).originsError && !(ctx.data as Record<string, unknown>).originsRetried,
      then: [
        // [static] 标记重试：置 originsRetried=true | 无 prompt/schema
        {
          type: 'static',
          fn: (ctx: FlowCtx): string | void => {
            ;(ctx.data as Record<string, unknown>).originsRetried = true
            return
          },
        },
        // [llm] 出身重试生成：携带上次校验失败反馈重写出身，约束灵石 0-50 | prompt: ORIGINS_RETRY_SYSTEM | schema: ORIGINS_SCHEMA | assign: origins（覆盖）
        {
          type: 'llm',
          system: ORIGINS_RETRY_SYSTEM,
          input: (ctx: FlowCtx) => {
            const w = (ctx.state._w as { stats: { world?: { name?: string; regions?: string[]; towns?: Array<{ name: string }> } } }).stats
            const wish = (ctx.input as { text?: string })?.text?.trim() ? `玩家初输：${(ctx.input as { text?: string }).text}\n` : ''
            const fb = (ctx.data as Record<string, unknown>).originsError as string || ''
            return `${wish}世界：${w.world?.name || ''}\n地域：${(w.world?.regions || []).join('、')}\n城镇：${(w.world?.towns || []).map((t) => t.name).join('、')}\n上次校验失败：${fb}\n请修正后重写出身（初始灵石 0-50，低阶出身勿超 50）。`
          },
          schema: ORIGINS_SCHEMA,
          assign: 'origins',
        },
        // [static] 出身重试校验落库：再次调用 rules.applyOrigins，失败直接阻断 | 读 origins | 规则: rules.applyOrigins
        {
          type: 'static',
          fn: (ctx: FlowCtx): string | void => {
            const err = rules.applyOrigins(ctx)
            if (err) return err
            delete (ctx.data as Record<string, unknown>).originsError
          },
        },
      ],
      else: [],
    },
    // [llm] 天资池生成：基于世界名+出身池+玩家初输生成 9 条天资（6吉3凶） | prompt: TALENTS_SYSTEM | schema: TALENTS_SCHEMA | assign: talents
    {
      type: 'llm',
      system: TALENTS_SYSTEM,
      input: (ctx: FlowCtx) => {
        const w = (ctx.state._w as { stats: { world?: { name?: string } } }).stats
        const origins = (rules.parseOriginPool(ctx.state._w as unknown as WorldState) as unknown as Array<Record<string, unknown>>).map((o) => o.name as string)
        const wish = (ctx.input as { text?: string })?.text?.trim() ? `玩家初输：${(ctx.input as { text?: string }).text}\n` : ''
        return `${wish}世界：${w.world?.name || ''}\n出身池：${JSON.stringify(origins)}\n请生成 2-4 个天资（talents）。`
      },
      schema: TALENTS_SCHEMA,
      assign: 'talents',
    },
    // [static] 天资初次校验：调用 rules.applyTalents，失败且未重试则暂存 talentsError | 无 prompt/schema | 读 talents | 规则: rules.applyTalents
    {
      type: 'static',
      fn: (ctx: FlowCtx): string | void => {
        const err = rules.applyTalents(ctx)
        if (err) {
          if (!(ctx.data as Record<string, unknown>).talentsRetried) {
            ;(ctx.data as Record<string, unknown>).talentsError = err
            return
          }
          return err
        }
        delete (ctx.data as Record<string, unknown>).talentsError
      },
    },
    // [condition] 天资重试分支：当 talentsError 存在且未重试时进入重试子链
    {
      type: 'condition',
      when: (ctx: FlowCtx) => !!(ctx.data as Record<string, unknown>).talentsError && !(ctx.data as Record<string, unknown>).talentsRetried,
      then: [
        // [static] 标记重试：置 talentsRetried=true | 无 prompt/schema
        {
          type: 'static',
          fn: (ctx: FlowCtx): string | void => {
            ;(ctx.data as Record<string, unknown>).talentsRetried = true
            return
          },
        },
        // [llm] 天资重试生成：携带校验失败反馈重写天资，约束灵石 0-50 | prompt: TALENTS_RETRY_SYSTEM | schema: TALENTS_SCHEMA | assign: talents（覆盖）
        {
          type: 'llm',
          system: TALENTS_RETRY_SYSTEM,
          input: (ctx: FlowCtx) => {
            const w = (ctx.state._w as { stats: { world?: { name?: string } } }).stats
            const origins = (rules.parseOriginPool(ctx.state._w as unknown as WorldState) as unknown as Array<Record<string, unknown>>).map((o) => o.name as string)
            const wish = (ctx.input as { text?: string })?.text?.trim() ? `玩家初输：${(ctx.input as { text?: string }).text}\n` : ''
            const fb = (ctx.data as Record<string, unknown>).talentsError as string || ''
            return `${wish}世界：${w.world?.name || ''}\n出身池：${JSON.stringify(origins)}\n上次校验失败：${fb}\n请修正后重写天资（初始灵石 0-50）。`
          },
          schema: TALENTS_SCHEMA,
          assign: 'talents',
        },
        // [static] 天资重试校验落库：再次调用 rules.applyTalents | 读 talents | 规则: rules.applyTalents
        {
          type: 'static',
          fn: (ctx: FlowCtx): string | void => {
            const err = rules.applyTalents(ctx)
            if (err) return err
            delete (ctx.data as Record<string, unknown>).talentsError
          },
        },
      ],
      else: [],
    },
    // 合审 origins+talents 一次（80分阈值）
    // [llm] Starter 合审：对出身+天资做 80 分阈值评审，输出 score/feedback/pass | prompt: REVIEW_STARTER_COMBINED_SYSTEM | input: reviewStarterCombinedInput | schema: {score, feedback, pass} | assign: reviewStarterCombined
    {
      type: 'llm',
      system: REVIEW_STARTER_COMBINED_SYSTEM,
      input: reviewStarterCombinedInput,
      schema: REVIEW_SCHEMA,
      assign: 'reviewStarterCombined',
    },
    // [condition] 合审未通过重写分支：score<80 && pass===false 且未重试时，整体重写出身与天资
    {
      type: 'condition',
      when: (ctx: FlowCtx) => {
        const r = ctx.data.reviewStarterCombined as { score?: number; pass?: boolean } | undefined
        return (r?.score ?? 100) < 80 && r?.pass === false && !(ctx.data as Record<string, unknown>).starterRetried
      },
      then: [
        // [static] 标记合审重试：置 starterRetried=true 并保存 feedback 到 starterFeedback | 无 prompt/schema | 读 reviewStarterCombined
        {
          type: 'static',
          fn: (ctx: FlowCtx): string | void => {
            const r = ctx.data.reviewStarterCombined as { feedback?: string } | undefined
            ;(ctx.data as Record<string, unknown>).starterRetried = true
            ;(ctx.data as Record<string, unknown>).starterFeedback = r?.feedback || ''
            return
          },
        },
        // [llm] 出身合审重写：携带评审反馈重写出身 | prompt: ORIGINS_RETRY_SYSTEM | schema: ORIGINS_SCHEMA | assign: origins
        {
          type: 'llm',
          system: ORIGINS_RETRY_SYSTEM,
          input: (ctx: FlowCtx) => {
            const w = (ctx.state._w as any).stats
            const fb = (ctx.data as Record<string, unknown>).starterFeedback as string || ''
            const wish = (ctx.input as { text?: string })?.text?.trim() ? `玩家初输：${(ctx.input as { text?: string }).text}\n` : ''
            const towns = Array.isArray(w.world?.towns) ? (w.world.towns as Array<{ name: string }>).map((t: { name: string }) => t.name) : []
            return `${wish}世界：${w.world?.name || ''}\n地域：${(w.world?.regions || []).join('、')}\n城镇：${towns.join('、')}\n评审反馈：${fb}\n请重写出身。`
          },
          schema: ORIGINS_SCHEMA,
          assign: 'origins',
        },
        // [static] 出身重写落库：校验并写入 | 读 origins | 规则: rules.applyOrigins
        { type: 'static', fn: rules.applyOrigins },
        // [llm] 天资合审重写：携带评审反馈重写天资 | prompt: TALENTS_RETRY_SYSTEM | schema: TALENTS_SCHEMA | assign: talents
        {
          type: 'llm',
          system: TALENTS_RETRY_SYSTEM,
          input: (ctx: FlowCtx) => {
            const w = (ctx.state._w as any).stats
            const origins = rules.parseOriginPool(ctx.state._w as unknown as WorldState).map((o) => (o as unknown as Record<string, unknown>).name as string)
            const fb = (ctx.data as Record<string, unknown>).starterFeedback as string || ''
            const wish = (ctx.input as { text?: string })?.text?.trim() ? `玩家初输：${(ctx.input as { text?: string }).text}\n` : ''
            return `${wish}世界：${w.world?.name || ''}\n出身池：${JSON.stringify(origins)}\n评审反馈：${fb}\n请重写天资。`
          },
          schema: TALENTS_SCHEMA,
          assign: 'talents',
        },
        // [static] 天资重写落库：校验并写入 | 读 talents | 规则: rules.applyTalents
        { type: 'static', fn: rules.applyTalents },
      ],
      else: [],
    },
  ]
}

/**
 * 注册初始化相关 flow（世界与角色）
 * @param api - 插件注册 API
 * @param ledger - 世界账本
 * @param rules - 规则集
 * @param views - 视图构建器
 * @description 注册 create_world、create_character、reset_character 四个流程，供前端按 flow 名触发
 */
export function registerGameFlows(api: PluginSetupAPI, ledger: Ledger, rules: Rules, views: Views): void {
  api.flow.register({
    name: 'create_world',
    nodes: [
      // [static] 上下文初始化：加载 ledger 世界到 ctx.state._w | 规则: initCtx(ledger)
      { type: 'static', fn: initCtx(ledger) },
      // [static] 世界重置：全量清空 WorldState 为 newWorld 初始值 | 规则: resetWorld
      { type: 'static', fn: resetWorld },
      // [subflow] 世界生成子链：展开 worldGenNodes 全部节点（LLM+校验+重试+合审）
      ...worldGenNodes(rules),
      // [render] 世界屏渲染：调用 views.buildWorldScreen 展示世界信息与出身/天资预览 | 依赖 worldBase/origins/talents
      { type: 'render', build: views.buildWorldScreen },
    ],
    requireRender: true,
  })

  // generate_npcs：独立 NPC 生成（一个 flow 三个 LLM 节点，一次调用生成 3 批共 30 人；
  // 同 flow 内 ctx 共享，后批 input 自动带前批名单防重名；LLM 调度器在 create_world 后、generate_major_events 前调用，
  // 后续也可随时调用增量扩充 NPC 池）
  api.flow.register({
    name: 'generate_npcs',
    nodes: [
      // [static] 上下文初始化：加载 ledger 世界到 ctx.state._w | 规则: initCtx(ledger)
      { type: 'static', fn: initCtx(ledger) },
      // [llm×3] NPC 三批生成：每批 10 人（凡人2+修士7+大修士1），input 带已有名单（世界已存 NPC + 前批）防重名
      ...Array.from({ length: 3 }, (_, i) => {
        const idx = i + 1
        return {
          type: 'llm',
          system: npcSystem(idx),
          input: (ctx: FlowCtx) => buildNpcInput(ctx, idx),
          schema: npcBatchSchema('npcBatch' + idx),
          assign: 'npcBatch' + idx,
        }
      }),
      // [static] NPC 池合并落库：三批去重后追加进 WorldState.characters | 读 npcBatch1..3 | 规则: rules.applyNpcPool
      { type: 'static', fn: rules.applyNpcPool },
    ],
    requireRender: false,
  })

  api.flow.register({
    name: 'create_character',
    nodes: [
      // [static] 上下文初始化：加载 WorldState | 规则: initCtx(ledger)
      { type: 'static', fn: initCtx(ledger) },
      // [subflow] 建角子链：展开 characterCreationNodes（选角→落库→开场→渲染）
      ...characterCreationNodes(rules, views),
    ],
    requireRender: true,
  })



  api.flow.register({
    name: 'reset_character',
    nodes: [
      // [static] 上下文初始化：加载 WorldState | 规则: initCtx(ledger)
      { type: 'static', fn: initCtx(ledger) },
      // [static] 角色重置：仅清空角色维度，保留世界/出身池/天资池/时间 | 规则: resetCharacter
      { type: 'static', fn: resetCharacter },
      // [subflow] 建角子链：重走选角与开场 | 依赖 characterCreationNodes
      ...characterCreationNodes(rules, views),
    ],
    requireRender: true,
  })
}
