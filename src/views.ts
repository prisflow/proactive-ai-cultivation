/**
 * 渲染构造层：构造 UI 数据结构（widget 树），供图内 render 节点使用。
 * 宿主负责实际推送（落库 + webContents.send），本层只声明"长什么样"。
 * 组件词汇：Row/Column/Text/Button/Divider/Card/Badge/List/Progress/Image/Icon。
 */
import type { FlowCtx } from '@prisflow/proactiveai-plugin-types'
import type { WorldState } from './ledger'
import type { Rules } from './rules'
import { calcBreakthroughRate, cultivationCap, fmtTime, fmtRealm, fmtAssets } from './rules'

export interface Views {
  buildWorldScreen(ctx: FlowCtx): { component: string; props: Record<string, unknown>; children: unknown[] }
  buildFirstScreen(ctx: FlowCtx): { component: string; props: Record<string, unknown>; children: unknown[] }
  buildPlayScreen(ctx: FlowCtx): { component: string; props: Record<string, unknown>; children: unknown[] }
  buildDeathScreen(ctx: FlowCtx): { component: string; props: Record<string, unknown>; children: unknown[] }
}

export function createViews(rules: Rules): Views {
  /** 状态卡：标题（名字·境界·位置·时间，居中）+ 修为/体力进度条 + 彩色徽标行（灵石/寿元/主修/突破率）+ 天资嵌套卡 + 储物袋。 */
  function statusCard(w: WorldState): { component: string; props: Record<string, unknown>; children: unknown[] } {
    const s = w.stats
    const breakRate = Math.round(calcBreakthroughRate(w).rate * 100)
    return {
      component: 'Card',
      props: {
        title: `${s.name || '无名'} · ${fmtRealm(w)} · ${s.location} · ${fmtTime(w)}`,
        titleAlign: 'center',
        collapsible: true,
        defaultCollapsed: true,
      },
      children: [
        { component: 'Progress', props: { label: '修为', value: s.cultivation, max: cultivationCap(w) } },
        { component: 'Progress', props: { label: '体力', value: s.hp, max: s.maxHp, color: s.hp / Math.max(1, s.maxHp) < 0.3 ? 'danger' : 'default' } },
        {
          component: 'Row',
          props: { className: 'gap-1.5 flex-wrap' },
          children: [
            { component: 'Badge', props: { icon: 'Coins', text: `灵石 ${s.spiritStones}`, variant: 'plain', className: 'bg-sky-500/15 text-sky-600 dark:text-sky-400' } },
            { component: 'Badge', props: { icon: 'Hourglass', text: `寿元 ${Math.floor(s.lifespan)} 年`, variant: 'plain', className: 'bg-violet-500/15 text-violet-600 dark:text-violet-400' } },
            { component: 'Badge', props: { icon: 'BookOpen', text: `主修 ${s.mainMethod || '无'}`, variant: 'plain', className: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400' } },
            { component: 'Badge', props: { icon: 'TrendingUp', text: `突破率 ${breakRate}%`, variant: 'plain', className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' } },
          ],
        },
        ...(s.talents?.length ? [{
          component: 'Card',
          props: { title: '天资' },
          children: s.talents.map((t) => ({
            component: 'Row',
            props: { className: 'items-start gap-1.5' },
            children: [
              { component: 'Badge', props: { text: String(t.name), variant: t.quality === '凶' ? 'danger' : 'success' } },
              { component: 'Text', props: { content: String(t.description ?? ''), size: 'sm' } },
            ],
          })),
        }] : []),
        ...(s.bag?.length ? [{
          component: 'Card',
          props: { title: '储物袋' },
          // 每物品一枚带边框徽章（名称含数量 + 描述并入，wrap 折行），流式排列
          children: [{
            component: 'Row',
            props: { className: 'gap-1.5 flex-wrap' },
            children: s.bag.map((it) => ({
              component: 'Badge',
              props: {
                text: it.desc ? `${it.name}：${it.desc}` : it.name,
                variant: 'plain',
                wrap: true,
                className: 'bg-slate-500/20 border-slate-500/40 text-slate-600 dark:text-slate-300',
              },
            })),
          }],
        }] : []),
      ],
    }
  }

  /** 选项按钮区：两列排布。 */
  function choiceButtons(opts: Array<{ text: string; kind?: string }>): unknown[] {
    const rows: unknown[] = [{ component: 'Divider', props: {} }, { component: 'Text', props: { content: '你欲何为？', size: 'sm' } }]
    for (let i = 0; i < opts.length; i += 2) {
      const row = opts.slice(i, i + 2)
      rows.push({
        component: 'Row',
        props: { className: 'gap-2 flex-wrap' },
        children: row.map((o) => ({
          component: 'Button',
          props: { content: o.text, action: { type: 'send', text: o.text } },
        })),
      })
    }
    return rows
  }

  /** 世界观屏：世界卡（折叠，居中标题）→ 地域卡（标题=地域，内容=分行宗门）→ 法则/城镇/传闻徽标行。 */
  function buildWorldScreen(ctx: FlowCtx): { component: string; props: Record<string, unknown>; children: unknown[] } {
    const w = ctx.state._w as WorldState
    const world = w.stats.world as Record<string, unknown> | undefined
    const regions = (world?.regions as string[] | undefined) || []
    const sects = (world?.sects as Array<Record<string, string>> | undefined) || []
    const towns = (world?.towns as Array<Record<string, string>> | undefined) || []
    const law = world?.law ? String(world.law) : ''
    const rumor = world?.rumor ? String(world.rumor) : ''

    // 地域卡：标题=地域名，内容=该地域内宗门分行列举。归属=包含匹配
    // （宗门 location 为「立场·地域·地点」复合串，地域名是其子串；全等永不命中）
    const regionCards: unknown[] = regions.map((region) => {
      const inRegion = sects.filter((s) => String(s.location ?? '').includes(region))
      return {
        component: 'Card',
        props: { title: region, titleAlign: 'center' },
        children: inRegion.length
          ? [{ component: 'List', props: { items: inRegion.map((s) => `${s.name}（${s.stance}·${s.location}）`) } }]
          : [{ component: 'Text', props: { content: '暂无宗门驻扎', size: 'sm' } }],
      }
    })
    const orphans = sects.filter((s) => !regions.some((r) => String(s.location ?? '').includes(r)))
    if (orphans.length) {
      regionCards.push({
        component: 'Card',
        props: { title: '散落各地', titleAlign: 'center' },
        children: [{ component: 'List', props: { items: orphans.map((s) => `${s.name}（${s.stance}·${s.location}）`) } }],
      })
    }

    // 徽标行：词条 Badge（带底色）+ 内容
    const infoLine = (word: string, content: string, color: string): unknown => ({
      component: 'Row',
      props: { className: 'items-start gap-1.5' },
      children: [
        { component: 'Badge', props: { text: word, variant: 'plain', className: color } },
        { component: 'Text', props: { content, size: 'sm' } },
      ],
    })

    const infoChildren: unknown[] = [
      ...regionCards,
      ...(law ? [infoLine('法则', law, 'bg-indigo-500/15 border-transparent text-indigo-600 dark:text-indigo-400')] : []),
      ...(towns.length ? [infoLine('城镇', towns.map((t) => t.name).join('、'), 'bg-sky-500/15 border-transparent text-sky-600 dark:text-sky-400')] : []),
      ...(rumor ? [infoLine('传闻', rumor, 'bg-amber-500/15 border-transparent text-amber-600 dark:text-amber-400')] : []),
    ]

    const children: unknown[] = [
      {
        component: 'Card',
        props: {
          title: `世界 · ${String(world?.name || '未知大陆')}`,
          collapsible: true,
          defaultCollapsed: true,
          titleAlign: 'center',
        },
        children: infoChildren,
      },
    ]
    return { component: 'Column', props: { className: 'gap-2' }, children }
  }

  /** 首屏：开场剧情 + 状态卡 + 开局选项按钮。 */
  function buildFirstScreen(ctx: FlowCtx): { component: string; props: Record<string, unknown>; children: unknown[] } {
    const w = ctx.state._w as WorldState
    const s = w.stats
    const opening = ctx.data.opening as { text: string; options: Array<{ text: string; kind?: string }> } | undefined
    const opts = opening?.options || []
    const children: unknown[] = [
      statusCard(w),
      { component: 'Divider', props: {} },
      { component: 'Text', props: { content: opening?.text || '', size: 'md' } },
    ]
    // 同地人物关系（徽章化：每人一枚）
    const nearbyFirst = s.characters.filter((c) => c.location === s.location && (c.affinity > 0 || c.relationship !== '无'))
    if (nearbyFirst.length) {
      children.push({ component: 'Divider', props: {} })
      children.push({ component: 'Text', props: { content: '附近之人', size: 'sm' } })
      children.push({
        component: 'Row',
        props: { className: 'gap-1.5 flex-wrap' },
        children: nearbyFirst.slice(0, 6).map((c) => ({
          component: 'Badge',
          props: {
            text: `${c.name} · ${c.identity}${c.relationship !== '无' ? ` · ${c.relationship}` : ''}`,
            variant: c.affinity >= 50 ? 'success' : 'default',
          },
        })),
      })
    }
    children.push(...choiceButtons(opts))
    return { component: 'Column', props: { className: 'gap-2' }, children }
  }

  /** 主屏：大事件卡 + 状态卡 + 叙事 + 关系 + 抉择。死亡时渲染结局。 */
  function buildPlayScreen(ctx: FlowCtx): { component: string; props: Record<string, unknown>; children: unknown[] } {
    const w = ctx.state._w as WorldState
    if (w.meta.dead) return buildDeathScreen(ctx)
    const s = w.stats
    // 战斗实写分支：beat 优先 battleConfrontation（旧）/ battle（game_battle 工具）；
    // 突破轮取 breakthrough（game_breakthrough 工具）；否则日常 turn
    const battleBeat = (ctx.data.battleConfrontation ?? ctx.data.battle) as { text?: string } | undefined
    const beat = (battleBeat?.text ? battleBeat : (ctx.data.breakthrough ?? ctx.data.turn) as { text?: string } | undefined)
    // 选项来源：常规路径说书人直接输出（turn.options），战斗路径战后生成（choice.options）
    const opts = ((ctx.data.choice as { options?: Array<{ text: string; kind?: string }> } | undefined)?.options
      || (ctx.data.turn as { options?: Array<{ text: string; kind?: string }> } | undefined)?.options
      || [])
    const children: unknown[] = []
    // 状态面板置顶（信息密度最高的先呈现）
    children.push(statusCard(w))
    children.push({ component: 'Divider', props: {} })
    // 进行中的大事件卡
    const actives = w.majorEvents.filter((e) => e.status === 'active')
    if (actives.length) {
      children.push({
        component: 'Card',
        props: { title: '进行中的大事件' },
        children: actives.map((e) => ({
          component: 'Row',
          props: { className: 'items-center gap-1.5' },
          children: [
            { component: 'Badge', props: { icon: 'Hourglass', text: `第${e.by}月前`, variant: 'warning' } },
            { component: 'Text', props: { content: `${e.name}（${e.type}）：${e.summary}`, size: 'sm' } },
          ],
        })),
      })
      children.push({ component: 'Divider', props: {} })
    }
    if (beat?.text) children.push({ component: 'Text', props: { content: beat.text, size: 'md' } })
    // 同地人物关系（徽章化：每人一枚，好感正数=success 底）
    const nearby = s.characters.filter((c) => c.location === s.location && (c.affinity > 0 || c.relationship !== '无'))
    if (nearby.length) {
      children.push({ component: 'Divider', props: {} })
      children.push({ component: 'Text', props: { content: '附近之人', size: 'sm' } })
      children.push({
        component: 'Row',
        props: { className: 'gap-1.5 flex-wrap' },
        children: nearby.slice(0, 6).map((c) => ({
          component: 'Badge',
          props: {
            text: `${c.name} · ${c.identity}${c.relationship !== '无' ? ` · ${c.relationship}` : ''}`,
            variant: c.affinity >= 50 ? 'success' : 'default',
          },
        })),
      })
    } else {
      const dao = s.characters.filter((c) => c.relationship === '道侣')
      if (dao.length) {
        children.push({ component: 'Divider', props: {} })
        children.push({ component: 'Text', props: { content: `道侣：${dao.map((c) => `${c.name}（${c.identity}）`).join('、')}`, size: 'sm' } })
      }
    }
    if (opts.length) children.push(...choiceButtons(opts))
    return { component: 'Column', props: { className: 'gap-2' }, children }
  }

  /** 死亡结局屏（补战斗场景）。 */
  function buildDeathScreen(ctx: FlowCtx): { component: string; props: Record<string, unknown>; children: unknown[] } {
    const w = ctx.state._w as WorldState
    const battleText = (ctx.data.battleConfrontation as { text?: string } | undefined)?.text || ''
    const children: unknown[] = [
      {
        component: 'Row',
        props: { className: 'items-center gap-1.5' },
        children: [
          { component: 'Icon', props: { name: 'Skull', size: 16 } },
          { component: 'Badge', props: { text: '身死道消', variant: 'danger' } },
        ],
      },
      { component: 'Divider', props: {} },
      ...(battleText ? [{ component: 'Text', props: { content: battleText, size: 'md' } }] : []),
      { component: 'Text', props: { content: w.meta.deathCause || '你死了。', size: 'md' } },
      { component: 'Divider', props: {} },
      { component: 'Text', props: { content: `历 ${w.meta.turns} 回合 · 境界 ${rules.fmtRealm(w)} · 你长眠于${w.stats.location || '无名之地'}。`, size: 'sm' } },
      { component: 'Divider', props: {} },
      {
        component: 'Button',
        props: { content: '转世重修', action: { type: 'send', text: '转世重修' } },
      },
    ]
    return { component: 'Column', props: { className: 'gap-2' }, children }
  }

  return {
    buildWorldScreen, buildFirstScreen, buildPlayScreen,
    buildDeathScreen,
  }
}
