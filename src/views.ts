/**
 * 渲染构造层：构造 UI 数据结构（widget 树），供图内 render 节点使用。
 * 宿主负责实际推送（落库 + webContents.send），本层只声明"长什么样"。
 */
import type { FlowCtx } from '@proactive-ai/plugin-types'
import type { WorldState } from './ledger'
import type { Rules } from './rules'
import { fmtTime } from './rules'
import { affinityLabel } from './constants'

export interface Views {
  buildWorldScreen(ctx: FlowCtx): { component: string; props: Record<string, unknown>; children: unknown[] }
  buildFirstScreen(ctx: FlowCtx): { component: string; props: Record<string, unknown>; children: unknown[] }
  buildPlayScreen(ctx: FlowCtx): { component: string; props: Record<string, unknown>; children: unknown[] }
  buildDeathScreen(ctx: FlowCtx): { component: string; props: Record<string, unknown>; children: unknown[] }
}

export function createViews(rules: Rules): Views {
  const statusOf = (w: WorldState): string => rules.fmtStatus(w)

  function appendQuickBar(children: unknown[], w: WorldState): void {
    const s = w.stats
    const quick: unknown[] = []
    const nonMain = s.methods.filter((m) => m.name !== s.mainMethod)
    for (const m of nonMain.slice(0, 3)) {
      quick.push({ component: 'Button', props: { content: `主修${m.name}`, action: { type: 'send', text: `主修${m.name}` } } })
    }
    if (s.mainMethod) {
      for (const mo of [1, 3, 12] as const) {
        quick.push({ component: 'Button', props: { content: `闭关${mo}月`, action: { type: 'send', text: `闭关${mo}月` } } })
      }
    }
    if (s.cultivation >= rules.cultivationCap(w)) {
      quick.push({ component: 'Button', props: { content: '突破', action: { type: 'send', text: '突破' } } })
    }
    if (quick.length) {
      children.push({ component: 'Divider', props: {} })
      children.push({ component: 'Text', props: { content: '快捷操作', size: 'sm' } })
      for (let i = 0; i < quick.length; i += 3) {
        children.push({ component: 'Row', props: { className: 'gap-2 flex-wrap' }, children: quick.slice(i, i + 3) })
      }
    }
    // 丹药单行 per pill (1,3,全部) 与修炼分开
    if (s.pills.length) {
      children.push({ component: 'Divider', props: {} })
      children.push({ component: 'Text', props: { content: '丹药', size: 'sm' } })
      for (const p of s.pills.slice(0, 4)) {
        const pillRow: unknown[] = []
        if (p.amount >= 1) pillRow.push({ component: 'Button', props: { content: `服${p.name}×1`, action: { type: 'send', text: `服用${p.name}×1` } } })
        if (p.amount >= 3) pillRow.push({ component: 'Button', props: { content: `服${p.name}×3`, action: { type: 'send', text: `服用${p.name}×3` } } })
        if (p.amount > 1) pillRow.push({ component: 'Button', props: { content: `服${p.name}全部(${p.amount})`, action: { type: 'send', text: `服用${p.name}全部` } } })
        if (pillRow.length) children.push({ component: 'Row', props: { className: 'gap-2 flex-wrap' }, children: pillRow })
      }
    }
  }

  /** 世界观屏：大陆/地域/宗门/城镇/法则/传闻 + 大事件时间线。 */
  function buildWorldScreen(ctx: FlowCtx): { component: string; props: Record<string, unknown>; children: unknown[] } {
    const w = ctx.state._w as WorldState
    const world = w.stats.world as Record<string, unknown> | undefined
    const children: unknown[] = [
      { component: 'Text', props: { content: `世界 · ${String(world?.name || '未知大陆')}`, size: 'lg' } },
      { component: 'Divider', props: {} },
    ]
    if (world) {
      const regions = (world.regions as string[] | undefined) || []
      if (regions.length) children.push({ component: 'Text', props: { content: `地域：${regions.join('、')}`, size: 'sm' } })
      const sects = (world.sects as Array<Record<string, string>> | undefined) || []
      if (sects.length) children.push({ component: 'Text', props: { content: `宗门：${sects.map((s) => `${s.name}（${s.stance}·${s.location}）`).join('、')}`, size: 'sm' } })
      const towns = (world.towns as Array<Record<string, string>> | undefined) || []
      if (towns.length) children.push({ component: 'Text', props: { content: `城镇：${towns.map((t) => t.name).join('、')}`, size: 'sm' } })
      if (world.law) children.push({ component: 'Text', props: { content: `法则：${String(world.law)}`, size: 'sm' } })
      if (world.rumor) children.push({ component: 'Text', props: { content: `传闻：${String(world.rumor)}`, size: 'sm' } })
    }
    if (w.majorEvents.length) {
      children.push({ component: 'Divider', props: {} })
      children.push({ component: 'Text', props: { content: '大事件', size: 'sm' } })
      for (const e of w.majorEvents) {
        children.push({ component: 'Text', props: { content: `${e.name}（${e.type}）第${e.at}月→${e.by}月：${e.summary}`, size: 'sm' } })
      }
    }
    return { component: 'Column', props: { className: 'gap-2' }, children }
  }

  /** 首屏：开场剧情 + 状态面板 + 开局选项按钮。 */
  function buildFirstScreen(ctx: FlowCtx): { component: string; props: Record<string, unknown>; children: unknown[] } {
    const w = ctx.state._w as WorldState
    const s = w.stats
    const opening = ctx.data.opening as { text: string; options: Array<{ text: string; risk: string }> } | undefined
    const opts = opening?.options || []
    const children: unknown[] = [
      { component: 'Text', props: { content: `名字「${s.name || '无名'}」· ${s.gender || ''}${s.temperament ? `·${s.temperament}` : ''} · ${s.location}`, size: 'lg' } },
      { component: 'Divider', props: {} },
      { component: 'Text', props: { content: opening?.text || '', size: 'md' } },
      { component: 'Divider', props: {} },
      { component: 'Text', props: { content: statusOf(w), size: 'sm' } },
    ]
    // 同地人物关系（仅标签）
    const nearbyFirst = s.characters.filter((c) => c.location === s.location && (c.affinity > 0 || c.relationship !== '无'))
    if (nearbyFirst.length) {
      children.push({ component: 'Divider', props: {} })
      children.push({ component: 'Text', props: { content: `附近之人：${nearbyFirst.slice(0, 5).map((c) => `${c.name}（${c.identity}）${affinityLabel(c.affinity)}${c.relationship !== '无' ? `·${c.relationship}` : ''}`).join('、')}`, size: 'sm' } })
    }
    appendQuickBar(children, w)
    children.push({ component: 'Divider', props: {} })
    children.push({ component: 'Text', props: { content: '你欲何为？', size: 'sm' } })
    for (let i = 0; i < opts.length; i += 2) {
      const row = opts.slice(i, i + 2)
      children.push({
        component: 'Row',
        props: { className: 'gap-2 flex-wrap' },
        children: row.map((o) => ({
          component: 'Button',
          props: {
            content: o.risk === '无' ? o.text : `${o.text}（${o.risk}风险）`,
            action: { type: 'send', text: o.text },
          },
        })),
      })
    }
    return { component: 'Column', props: { className: 'gap-2' }, children }
  }

  /** 主屏：大事件面板 + 状态 + 叙事 + 关系 + 抉择。死亡时渲染结局。 */
  function buildPlayScreen(ctx: FlowCtx): { component: string; props: Record<string, unknown>; children: unknown[] } {
    const w = ctx.state._w as WorldState
    if (w.meta.dead) return buildDeathScreen(ctx)
    const s = w.stats
    // 战斗实写分支的 beat 来自 battleConfrontation，否则来自 turn
    const battleBeat = ctx.data.battleConfrontation as { text?: string } | undefined
    const beat = (battleBeat?.text ? battleBeat : ctx.data.turn as { text?: string } | undefined)
    // 选项来源：常规路径说书人直接输出（turn.options），战斗路径战后生成（choice.options）
    const opts = ((ctx.data.choice as { options?: Array<{ text: string; risk: string }> } | undefined)?.options
      || (ctx.data.turn as { options?: Array<{ text: string; risk: string }> } | undefined)?.options
      || [])
    const children: unknown[] = [
      { component: 'Text', props: { content: `${rules.fmtRealm(w)} · ${s.location} · ${fmtTime(w)}`, size: 'lg' } },
      { component: 'Divider', props: {} },
    ]
    // 大事件面板
    const actives = w.majorEvents.filter((e) => e.status === 'active')
    if (actives.length) {
      children.push({ component: 'Text', props: { content: '【进行中的大事件】', size: 'sm' } })
      for (const e of actives) {
        children.push({ component: 'Text', props: { content: `⚡ ${e.name}（${e.type}）第${e.by}月前须了结：${e.summary}`, size: 'sm' } })
      }
      children.push({ component: 'Divider', props: {} })
    }
    children.push({ component: 'Text', props: { content: statusOf(w), size: 'sm' } })
    children.push({ component: 'Divider', props: {} })
    if (beat?.text) children.push({ component: 'Text', props: { content: beat.text, size: 'md' } })
    // 同地人物关系（仅标签，同地点才算附近）
    const nearby = s.characters.filter((c) => c.location === s.location && (c.affinity > 0 || c.relationship !== '无'))
    if (nearby.length) {
      children.push({ component: 'Divider', props: {} })
      children.push({ component: 'Text', props: { content: `附近之人：${nearby.slice(0, 5).map((c) => `${c.name}（${c.identity}）${affinityLabel(c.affinity)}${c.relationship !== '无' ? `·${c.relationship}` : ''}`).join('、')}`, size: 'sm' } })
    } else {
      const dao = s.characters.filter((c) => c.relationship === '道侣')
      if (dao.length) {
        children.push({ component: 'Divider', props: {} })
        children.push({ component: 'Text', props: { content: `道侣：${dao.map((c) => `${c.name}（${c.identity}）`).join('、')}`, size: 'sm' } })
      }
    }
    appendQuickBar(children, w)
    if (opts.length) {
      children.push({ component: 'Divider', props: {} })
      children.push({ component: 'Text', props: { content: '你欲何为？', size: 'sm' } })
      for (let i = 0; i < opts.length; i += 2) {
        const row = opts.slice(i, i + 2)
        children.push({
          component: 'Row',
          props: { className: 'gap-2 flex-wrap' },
          children: row.map((o) => ({
            component: 'Button',
            props: {
              content: o.risk === '无' ? o.text : `${o.text}（${o.risk}风险）`,
              action: { type: 'send', text: o.text },
            },
          })),
        })
      }
    }
    return { component: 'Column', props: { className: 'gap-2' }, children }
  }

  /** 死亡结局屏（补战斗场景）。 */
  function buildDeathScreen(ctx: FlowCtx): { component: string; props: Record<string, unknown>; children: unknown[] } {
    const w = ctx.state._w as WorldState
    const battleText = (ctx.data.battleConfrontation as { text?: string } | undefined)?.text || ''
    const children: unknown[] = [
      { component: 'Text', props: { content: '身死道消', size: 'lg' } },
      { component: 'Divider', props: {} },
      ...(battleText ? [{ component: 'Text', props: { content: battleText, size: 'md' } } as unknown as { component: string; props: Record<string, unknown> }] : []),
      ...(battleText ? [{ component: 'Divider', props: {} } as unknown as { component: string; props: Record<string, unknown> }] : []),
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
