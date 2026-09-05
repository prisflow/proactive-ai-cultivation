/**
 * @fileoverview 共享 Schema 模块
 * @description 集中定义所有 LLM 节点的 JSON Schema 约束，作为 FlowNode 中 `schema` 字段的校验依据。
 * - 所有字段均带 description，供 flow-host 拼入 system 提示词，LLM 可见完整字段说明。
 * - 提示词侧不再赘述字段含义，仅保留定量/定性约束（如数量、数值范围、吉凶比例）。
 */
import {
  AFFINITY_MAX, REALM_ORDER, PILL_EFFECTS,
  METHOD_GRADES, NPC_BATCH_MIN, NPC_BATCH_MAX
} from '../constants'

/** 好感度数值 schema（0-100 整数，AFFINITY_MAX 上限） */
export const AFFINITY_SCHEMA = { type: 'integer', minimum: 0, maximum: AFFINITY_MAX, description: '初始好感 0-100，0-9冷淡 10-29相识 30-49友好 50-69亲密 70-89爱慕 90-100挚爱' }
/** 好感变化增量 schema（-20 ~ +20，配合 reason 字段） */
export const AFFINITY_DELTA_SCHEMA = { type: 'integer', minimum: -20, maximum: 20, description: '好感变化增量 -20~20，配合 reason 说明原因' }

/**
 * 行动式提示选项（统一规则）：最多 3 条、可为 0 条。
 * 每条必须是玩家可直接采纳执行的**具体行动**（第一人称可执行句），由两类钩子诱导生成——
 * ①进行中/将到来的大事件（event）②在场/相关 NPC 的关系推进（npc）。
 * 禁止纯情报/预告式表述（那是信息不是行动）。
 */
export const HINT_OPTIONS_SCHEMA = {
  type: 'array', maxItems: 3,
  description: '本回合结束后的可选行动，最多 3 条、可为 0 条。每条必须是玩家可直接采纳执行的具体行动（第一人称可执行句，如「暗中调查坊市失踪案」「邀柳师姐后山论道」「追击溃逃之敌」），由两类钩子诱导生成：①进行中/将到来的大事件（event）②在场/相关 NPC 的关系推进（npc）。禁止纯情报/预告式表述（那是信息不是行动）；行动须与玩家当前境界/处境/认知相称',
  items: {
    type: 'object',
    properties: {
      text: { type: 'string', description: '具体行动句 ≤20 字（玩家可直接采纳执行）' },
      kind: { type: 'string', enum: ['event', 'npc'], description: 'event=由大事件诱导的行动 / npc=由 NPC 关系诱导的行动' },
    },
    required: ['text', 'kind'],
  },
}

/** 术法 schema（隶属功法；纯叙事，无数值，仅描述） */
export const TECHNIQUE_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, description: '术法名，如“天剑斩”' },
    description: { type: 'string', minLength: 1, description: '术法效果描述，如“以灵力凝剑气，近距斩击，附轻微击退”' },
  },
  required: ['name', 'description'],
  description: '单条术法，隶属功法，仅描述无数值',
}

/** 功法 schema（grade 表征修炼效率；内含术法数组，不设境界门槛/五行，术法仅叙事） */
export const METHOD_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, description: '功法名，如“青云剑诀”' },
    grade: { type: 'string', enum: Object.keys(METHOD_GRADES), description: '功法品阶，凡品4/黄阶24/玄阶120/地阶600/天阶3000 修为/月，决定修炼效率' },
    techniques: { type: 'array', items: TECHNIQUE_SCHEMA, description: '功法自带术法列表' },
  },
  required: ['name', 'grade', 'techniques'],
  description: '单部功法，含品阶与术法',
}

/** 丹药 schema（带境界段位，用于世界观限制：丹药仅在对应境界内有效） */
export const PILL_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: '丹药名，如“聚气丹”' },
    effectType: { type: 'string', enum: [...PILL_EFFECTS], description: '丹药效果类型：cultivation 修为/breakthrough 提高突破几率/heal 回血/lifespan 延寿' },
    power: { type: 'number', minimum: 1, description: '丹药效力数值，正数，按境界衰减' },
    realm: { type: 'string', enum: [...REALM_ORDER], description: '丹药对应境界，凡人/练气/筑基/金丹/元婴/化神' },
  },
  required: ['name', 'effectType', 'power', 'realm'],
  description: '单粒丹药定义',
}

/** 合一得失 delta schema（正加负减，全字段覆盖，含战斗/逃离的丹药气血与修为/突破率双向） */
export const DELTA_SCHEMA = {
  type: 'object',
  properties: {
    spiritStones: { type: 'integer', description: '灵石变化，正得负耗，无上限' },
    cultivation: { type: 'integer', description: '修为变化，正得负耗，无 cap，LLM 据当前修为/上限自定' },
    breakthroughDelta: { type: 'number', description: '下次突破率变化，正加负减，无 cap，默认突破概率：凡人60%/练气20%/筑基15%/金丹10%/元婴8%/化神5%，天资吉凶会提交或降低，已通过固定计算计入' },
    pills: {
      type: 'array', description: '丹药得失列表，amount 正得负耗',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '丹药名' },
          amount: { type: 'integer', description: '正数为得负为耗，1 表示得1粒或耗1粒' },
          effectType: { type: 'string', enum: [...PILL_EFFECTS], description: '丹药效果类型' },
          realm: { type: 'string', enum: [...REALM_ORDER], description: '丹药境界' },
          power: { type: 'number', minimum: 1, description: '丹药效力' },
        },
        required: ['name', 'amount', 'effectType', 'realm'],
      },
    },
    methods: {
      type: 'array', description: '功法得失列表',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, description: '功法名' },
          grade: { type: 'string', enum: Object.keys(METHOD_GRADES), description: '功法品阶，凡品4/黄阶24/玄阶120/地阶600/天阶3000 修为/月' },
          action: { type: 'string', enum: ['learn', 'teach', 'forget'], description: 'learn 得，teach 授不扣自身，forget 弃' },
          targetNpc: { type: 'string', description: 'teach 时目标 NPC 名' },
          techniques: { type: 'array', items: TECHNIQUE_SCHEMA, description: 'learn 时可附带的术法（仅描述）' },
        },
        required: ['name', 'grade'],
      },
    },
    hpDelta: { type: 'integer', description: '气血变化，正补负耗，用于战斗/逃离' },
  },
  description: '单回合得失聚合，唯一真源',
}

/** 出身模板 schema（叙事定义 + 初始物品，无财富档） */
export const ORIGIN_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, description: '出身名，如“天剑宗遗孤”' },
    location: { type: 'string', minLength: 1, description: '出身地，须为世界地域/城镇或宗门所在地' },
    background: { type: 'string', minLength: 1, description: '出身背景故事' },
    realm: { type: 'string', enum: ['凡人', '练气'], description: '开局境界：凡人=尘世出身；练气=宗门弟子/世家子弟（starter.methods 须给对应功法）' },
    starter: {
      type: 'object', description: '初始携带',
      properties: {
        spiritStones: { type: 'number', minimum: 0, maximum: 500, description: '初始灵石 0-50，凡人无仙缘宜0' },
        methods: { type: 'array', items: METHOD_SCHEMA, description: '初始功法列表' },
        pills: { type: 'array', items: PILL_SCHEMA, description: '初始丹药列表' },
      },
    },
    npcs: {
      type: 'object', description: '出身关联 NPC 初始好感映射，key 为 NPC 名，value 为好感 0-100',
      additionalProperties: AFFINITY_SCHEMA,
    },
  },
  required: ['name', 'location', 'background'],
  description: '单条出身模板',
}

/** 世界骨架生成 schema（仅 world，不含大事件，解耦设计） */
export const WORLD_BASE_SCHEMA = {
  type: 'object',
  properties: {
    world: {
      type: 'object', description: '世界骨架',
      properties: {
        name: { type: 'string', minLength: 1, description: '大陆名' },
        regions: { type: 'array', maxItems: 10, items: { type: 'string', minLength: 1 }, description: '地域列表 4-10 个' },
        sects: {
          type: 'array', maxItems: 10, description: '宗门列表 4-10 个',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', minLength: 1, description: '宗门名' },
              stance: { type: 'string', minLength: 1, description: '宗门立场：正/魔/中立' },
              location: { type: 'string', minLength: 1, description: '宗门所在地域/城镇' },
              feature: { type: 'string', description: '宗门特色' },
            },
            required: ['name', 'stance', 'location'],
          },
        },
        towns: {
          type: 'array', maxItems: 10, description: '城镇列表 6-10 个',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', minLength: 1, description: '城镇名' },
              location: { type: 'string', minLength: 1, description: '城镇所在地域' },
              feature: { type: 'string', description: '城镇特色' },
            },
            required: ['name', 'location'],
          },
        },
        law: { type: 'string', minLength: 1, description: '天地法则' },
        rumor: { type: 'string', description: '世道传闻' },
      },
      required: ['name', 'regions', 'sects', 'law'],
    },
  },
  required: ['world'],
  description: '世界骨架生成',
}

/** 五十年大事件生成 schema（未来五十年 15-30 条，均匀分布） */
export const DECADAL_EVENTS_SCHEMA = {
  type: 'object',
  properties: {
    majorEvents: {
      type: 'array', minItems: 15, maxItems: 30, description: '未来五十年大事件 15-30 条，均匀分布在 50 年内（不要扎堆在开头）',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, description: '事件名' },
          at: { type: 'number', minimum: 1, description: '触发月（绝对月，>当前月且 ≤当前月+600）' },
          by: { type: 'number', minimum: 2, description: '截止月（>at+6）' },
          type: { type: 'string', enum: ['机遇', '危机', '转折', '高潮'], description: '事件类型' },
          summary: { type: 'string', minLength: 1, description: '事件概要 5-60字' },
        },
        required: ['name', 'at', 'by', 'type', 'summary'],
      },
    },
  },
  required: ['majorEvents'],
  description: '五十年大事件生成',
}

/** NPC 池生成 schema 工厂（每批 10 人：凡人 2 + 修士 7 + 大修士 1，分阶层） */
export const npcBatchSchema = (key: string) => ({
  type: 'object',
  properties: {
    [key]: {
      type: 'array', minItems: NPC_BATCH_MIN, maxItems: NPC_BATCH_MAX, description: `NPC 批次 ${key}，10 人（阶层比例：凡人 2 人 + 修士 7 人 + 大修士 1 人）`,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, description: 'NPC 名' },
          gender: { type: 'string', enum: ['男', '女'], description: '性别' },
          age: { type: 'number', minimum: 10, maximum: 500, description: '年龄 10-500，参考寿元：凡人80/练气120/筑基200/金丹300/元婴500/化神800，高境可活更久' },
          identity: { type: 'string', minLength: 1, description: '身份，如村民/散修/弟子/长老' },
          realm: { type: 'string', enum: [...REALM_ORDER], description: '境界：凡人=凡人；修士=练气/筑基/金丹；大修士=元婴/化神。须为原词，对应寿元凡人80/练气120/筑基200/金丹300/元婴500/化神800' },
          location: { type: 'string', minLength: 1, description: '所在地域/城镇，须为世界已有' },
          temperament: { type: 'string', description: '性情/性格' },
          note: { type: 'string', description: '一句话档案' },
        },
        required: ['name', 'gender', 'identity', 'realm', 'location', 'temperament'],
      },
    },
  },
  required: [key],
  description: `NPC 批次 ${key} 生成（10 人）`,
})

/** 出身池生成 schema（仅 origins 2-4 条，引用 npcPool 中已生成的名字） */
export const ORIGINS_SCHEMA = {
  type: 'object',
  properties: {
    origins: { type: 'array', minItems: 2, maxItems: 4, items: ORIGIN_SCHEMA, description: '出身列表 2-4 条' },
  },
  required: ['origins'],
  description: '出身池生成',
}

/** 天资模板 schema（纯词条 6吉3凶，无数值加成；供建角抽取） */
export const TALENT_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, description: '天资名，如“天生剑骨”' },
    description: { type: 'string', minLength: 1, description: '天资说明，吉凶分明' },
    temperament: { type: 'string', minLength: 1, description: '性格倾向' },
    quality: { type: 'string', enum: ['吉', '凶'], description: '吉凶，6吉3凶' },
  },
  required: ['name', 'description', 'temperament', 'quality'],
  description: '单条天资词条',
}

/** 天资池生成 schema（仅 talents，固定 9 条 6吉3凶） */
export const TALENTS_SCHEMA = {
  type: 'object',
  properties: {
    talents: { type: 'array', minItems: 9, maxItems: 9, items: TALENT_SCHEMA, description: '天资池 9 条 6吉3凶' },
  },
  required: ['talents'],
  description: '天资池生成',
}

// ── 组合大对象（套娃继承，供 flow 直接引用，关系清晰） ──

/** 事件引用 schema（turn 的 eventRef） */
export const EVENT_REF_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, description: '大事件名，必须逐字取自当前状态 majorEvents 列表中已存在的 name，禁止自创、缩写或改写事件名；只能引用 active（已触发进行中）状态的事件，未到触发月（at）的 pending 事件不得引用' },
    progress: { type: 'string', minLength: 1, description: '事件进展描述' },
    resolved: { type: 'boolean', description: '是否解决，仅高潮可 true' },
  },
  required: ['name', 'progress'],
  description: '大事件推进引用',
}

/** 关系变化项 schema */
export const RELATIONSHIP_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    npc: { type: 'string', description: 'NPC 名' },
    delta: { ...AFFINITY_DELTA_SCHEMA, description: '好感增量 -20~20' },
    reason: { type: 'string', minLength: 1, description: '好感变化原因' },
  },
  required: ['npc', 'delta', 'reason'],
  description: '单条关系变化',
}

/** 道侣互动 schema */
export const ROMANCE_SCHEMA = {
  type: 'object',
  properties: {
    npc: { type: 'string', description: '对象 NPC 名' },
    action: { type: 'string', enum: ['互动', '表白'], description: '互动不限好感，表白需≥70爱慕' },
  },
  required: ['npc', 'action'],
  description: '道侣互动',
}

/** 修炼/闭关 schema */
export const CULTIVATE_SCHEMA = {
  type: 'object',
  properties: {
    months: { type: 'number', enum: [1, 3, 12], description: '闭关月数 1/3/12，按主修效率结算' },
    mode: { type: 'string', enum: ['solo', 'dual'], description: 'solo 单修/dual 双修' },
    partner: { type: 'string', description: '双修道侣名' },
  },
  required: ['months'],
  description: '修炼安排',
}

/** 切主修 schema */
export const SWITCH_MAIN_SCHEMA = {
  type: 'object',
  properties: {
    method: { type: 'string', description: '目标主修功法名，须已习得非当前主修' },
  },
  required: ['method'],
  description: '切主修',
}

/** 主推进回合 schema（game_turn 主 LLM） */
/** 主推进回合 schema（game_turn 的 LLM） */
export const TURN_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string', minLength: 1, description: '本回合剧情叙事，第二人称推进' },
    kind: { type: 'string', enum: ['日常', '机缘', '危机', '转折', '高光'], description: '剧情类型（机缘/危机/转折/高光需配 eventRef）' },
    eventRef: EVENT_REF_SCHEMA,
    delta: DELTA_SCHEMA,
    relationships: { type: 'array', items: RELATIONSHIP_ITEM_SCHEMA, description: '好感变化列表（挑 1-2 条）' },
    romance: ROMANCE_SCHEMA,
    cultivate: CULTIVATE_SCHEMA,
    switchMain: SWITCH_MAIN_SCHEMA,
    location: { type: 'string', description: '玩家本回合移动后的位置；默认保持（输出原值）；位置更新条件见 npcMoves 说明' },
    npcMoves: {
      type: 'array',
      description: 'NPC 位置变更列表。铁律：不要让任何 NPC 无故瞬移到玩家所在地， NPCs 离开则移到别处',
      items: {
        type: 'object',
        properties: {
          npc: { type: 'string', minLength: 1, description: 'NPC 名（须为当前状态 characters 中者）' },
          location: { type: 'string', minLength: 1, description: '该 NPC 移动到的位置（与玩家当前所在地同框架的城/地区）' },
          reason: { type: 'string', description: '移动原因，一句话' },
        },
        required: ['npc', 'location'],
      },
    },
    npcChanges: {
      type: 'array',
      description: '本回合 NPC 境界变化列表（寻常省略）',
      items: {
        type: 'object',
        properties: {
          npc: { type: 'string', minLength: 1, description: 'NPC 名（须为当前状态 characters 中者）' },
          realm: { type: 'string', enum: [...REALM_ORDER], description: '该 NPC 变化后的境界' },
          reason: { type: 'string', minLength: 1, description: '变化原因一句话' },
        },
        required: ['npc', 'realm', 'reason'],
      },
    },
    timeCost: { type: 'number', description: '本回合推进时间（月）：0-短时，1-数十月自定' },
    dead: { type: 'boolean', description: '仅当本回合叙事明确导致角色死亡（形神俱灭/陨落/被杀）才为 true；默认 false。死亡时 text 必须写出完整的死亡场景与结局' },
    options: HINT_OPTIONS_SCHEMA,
  },
  required: ['text', 'kind'],
  description: '本回合数据（game_turn）',
}

/** 战斗实写 schema（game_battle 的 LLM） */
export const BATTLE_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string', minLength: 1, description: '战斗叙事，第二人称' },
    dead: { type: 'boolean', description: '是否战死（仅当战败即死才 true）' },
    delta: DELTA_SCHEMA,
    options: HINT_OPTIONS_SCHEMA,
  },
  required: ['text', 'dead'],
  description: '战斗实写（game_battle）',
}


/** 突破 schema（game_breakthrough 的 LLM） */
export const BREAKTHROUGH_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string', minLength: 1, description: '突破的完整叙事（系统判定 success=true 写凭机缘成功突破；false 则严禁写突破成功或境界提升，只写失败后的状态：经脉震荡/走火入魔征兆/瓶颈更固等，可以禁止再次尝试突破）' },
    extraCultivation: { type: 'number', description: '突破的修为增减；成功可给增益，失败可给小增益或不给' },
    nextRateBonus: { type: 'number', description: '下次突破率加成；成功可给增益，失败可给小补偿' },
    options: HINT_OPTIONS_SCHEMA,
  },
  required: ['text'],
  description: '突破结果',
}


/** 查询回答 schema */
export const QUERY_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string', minLength: 1, description: '查询回答，简洁中文' },
  },
  required: ['answer'],
  description: '档案查询回答',
}

/** 建角 schema */
export const CHAR_CREATE_SCHEMA = {
  type: 'object',
  properties: {
    origin: { type: 'string', minLength: 1, description: '出身名，须为池内' },
    talents: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string', minLength: 1, description: '天资名，须为池内' }, description: '抽取3天资' },
    name: { type: 'string', minLength: 1, description: '名字 1-12字' },
    gender: { type: 'string', enum: ['男', '女'], description: '性别' },
    temperament: { type: 'string', minLength: 1, description: '性格 2-8字' },
  },
  required: ['origin', 'talents', 'name', 'gender', 'temperament'],
  description: '建角（选出身天资取名）',
}

/** 开场 schema */
export const OPENING_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string', minLength: 1, description: '开场叙事 200-400字第二人称' },
    options: HINT_OPTIONS_SCHEMA,
  },
  required: ['text', 'options'],
  description: '开场剧情',
}