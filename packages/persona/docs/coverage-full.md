# 全量覆盖账本（按规格逐条，不靠记忆）

> 生成时间：2026-11-19 13:08:45
> 规格来源：E:/person/人格-功能总表.md（本表抽出 103 条）
> 代码范围：dsh-persona + 委托的 dsh-affect / dsh-affect-core（34 个文件）

判定规则（机械判定，可复查）：

- **已做**：有一个测试文件里提到这个编号（说明有可复现断言）
- **部分**：只有代码注释提到编号，没有任何测试提到（有实现，没断言）
- **没做**：代码和测试都没有提到这个编号

## 汇总：已做 103 / 部分 0 / 没做 0（共 103 条）

| 编号 | 功能 | 状态 | 证据 |
| --- | --- | --- | --- |
| T01 | 反应阈值：多小的刺激能点着 | 已做 | tests/packages/affect\tests\fn-hippo-neuromod.mjs |
| T02 | 反应强度：点着之后多大 | 已做 | tests/packages/affect\tests\fn-hippo-neuromod.mjs |
| T03 | 恢复速度：多久平下来 | 已做 | tests/packages/affect\tests\fn-brainstem-endocrine-io.mjs |
| T04 | 基线唤醒：平时是松还是绷 | 已做 | tests/packages/affect\tests\fn-hippo-neuromod.mjs |
| T05 | 趋近／回避：见到新东西先凑还是先退 | 已做 | tests/packages/affect\tests\fn-brainstem-endocrine-io.mjs |
| T06 | 新异寻求：多需要新鲜感 | 已做 | tests/packages/affect\tests\fn-hippo-neuromod.mjs |
| T07 | 复原力：跌到底之后被拉回来的力 | 已做 | tests/fn-persona-resilience-contagion.mjs |
| E01 | 基本情绪产生 | 已做 | tests/packages/affect\tests\fn-brainstem-endocrine-io.mjs |
| E02 | 混合情绪：同时两种 | 已做 | tests/packages/affect\tests\fn-brainstem-endocrine-io.mjs |
| E03 | 心境：小时到天的慢变量 | 已做 | tests/packages/affect\tests\fn-brainstem-endocrine-io.mjs |
| E04 | 情绪曲线：发作／峰／平台／衰减／残留 | 已做 | tests/packages/affect\tests\fn-brainstem-endocrine-io.mjs |
| E05 | 调节·重评 | 已做 | tests/packages/affect\tests\fn-brainstem-endocrine-io.mjs |
| E06 | 调节·抑制与泄漏 | 已做 | tests/fn-persona-social-emotions.mjs |
| E07 | 表达规则：这个场合不能表现出来 | 已做 | tests/fn-persona-expression-mindread-explain.mjs |
| E08 | 共情·认知：猜到你怎么想 | 已做 | tests/fn-persona-expression-mindread-explain.mjs |
| E09 | 共情·情绪：被你的情绪带动 | 已做 | tests/fn-persona-empathy-retire-degrade.mjs |
| E10 | 情绪传染：一群人里的氛围 | 已做 | tests/fn-persona-resilience-contagion.mjs |
| E11 | 解释风格：同一件事往好里想还是往坏里想 | 已做 | tests/fn-persona-expression-mindread-explain.mjs |
| E12 | 怀旧：旧事带回来的暖或酸 | 已做 | tests/fn-persona-expression-mindread-explain.mjs |
| M01 | 生理需求：饿、渴、困 | 已做 | tests/packages/affect\tests\fn-hippo-neuromod.mjs |
| M02 | 安全 | 已做 | tests/fn-persona-self-concept.mjs |
| M03 | 归属 | 已做 | tests/packages/affect\tests\fn-hippo-neuromod.mjs |
| M04 | 地位与尊重 | 已做 | tests/packages/affect\tests\fn-hippo-neuromod.mjs |
| M05 | 掌控感 | 已做 | tests/packages/affect\tests\fn-hippo-neuromod.mjs |
| M06 | 意义 | 已做 | tests/packages/affect\tests\fn-hippo-neuromod.mjs |
| M07 | 好奇与玩心 | 已做 | tests/packages/affect\tests\fn-hippo-neuromod.mjs |
| M08 | 目标与拖延 | 已做 | tests/packages/affect\tests\fn-brainstem-endocrine-io.mjs |
| M09 | 耐心与延迟满足 | 已做 | tests/packages/affect\tests\fn-hippo-neuromod.mjs |
| M10 | 完美主义 | 已做 | tests/packages/affect\tests\fn-hippo-neuromod.mjs |
| M11 | 目标结果：成了、黄了、还悬着 | 已做 | tests/fn-persona-goal.mjs |
| S01 | 自我概念：我是什么样的人 | 已做 | tests/fn-persona-self-concept.mjs |
| S02 | 自尊：我够不够好 | 已做 | tests/fn-persona-worth.mjs |
| S03 | 自传体叙事：我的故事 | 已做 | tests/fn-persona-autobio.mjs |
| S04 | 理想我与现实我的差 | 已做 | tests/fn-persona-ideal.mjs |
| S05 | 自我效能：我做不做得到 | 已做 | tests/fn-persona-efficacy.mjs |
| S06 | 自我欺骗：给自己找台阶 | 已做 | tests/fn-persona-deceive.mjs |
| S07 | 自我观察：我知道我在干嘛 | 已做 | tests/fn-persona-aware.mjs |
| S08 | 身份：年龄、职业、住在哪、怎么过日子 | 已做 | tests/fn-persona-identity.mjs |
| S09 | 自我一致性需求：我不能不像我 | 已做 | tests/fn-persona-consistency.mjs |
| S10 | 冲突自检：我家状态跟别的器官对不上时进队列 | 已做 | tests/fn-persona-conflict-audit.mjs |
| R01 | 依恋类型 | 已做 | tests/fn-persona-attach-trust-boundary.mjs |
| R02 | 信任 | 已做 | tests/fn-persona-attach-trust-boundary.mjs |
| R03 | 亲密与边界 | 已做 | tests/fn-persona-attach-trust-boundary.mjs |
| R04 | 角色：对爸妈、朋友、同事不是一张脸 | 已做 | tests/fn-persona-role.mjs |
| R05 | 互惠账本：谁欠谁 | 已做 | tests/fn-persona-reciprocity-major.mjs |
| R06 | 嫉妒与占有 | 已做 | tests/fn-persona-possess.mjs |
| R07 | 被排斥的痛 | 已做 | tests/fn-persona-privacy-ostracism.mjs |
| R08 | 冲突与和解 | 已做 | tests/fn-persona-repair.mjs |
| R09 | 记仇与消气 | 已做 | tests/fn-persona-social-emotions.mjs |
| R10 | 读空气：社交监控 | 已做 | tests/fn-persona-air.mjs |
| R11 | 隐私：什么不告诉人 | 已做 | tests/fn-persona-privacy-ostracism.mjs |
| R12 | 对话者：这一轮对面是谁、什么关系、之前发生过什么 | 已做 | tests/fn-persona-speakers.mjs |
| V01 | 价值排序：什么更重要 | 已做 | tests/fn-persona-values.mjs |
| V02 | 规范内化 | 已做 | tests/fn-persona-values.mjs |
| V03 | 内疚 | 已做 | tests/fn-persona-social-emotions.mjs |
| V04 | 羞耻与面子 | 已做 | tests/fn-persona-social-emotions.mjs |
| V05 | 骄傲 | 已做 | tests/fn-persona-social-emotions.mjs |
| V06 | 底线：不能忍什么 | 已做 | tests/fn-persona-values.mjs |
| C01 | 注意风格：专注还是分心 | 已做 | tests/packages/affect\tests\fn-time-inject-invariants.mjs |
| C02 | 不确定性容忍 | 已做 | tests/packages/affect\tests\fn-time-inject-invariants.mjs |
| C03 | 决策风格：快刀还是慢想 | 已做 | tests/packages/affect\tests\fn-time-inject-invariants.mjs |
| C04 | 归因与控制点：怪自己还是怪世界 | 已做 | tests/packages/affect\tests\fn-time-inject-invariants.mjs |
| C05 | 反刍 | 已做 | tests/packages/affect\tests\fn-time-inject-invariants.mjs |
| C06 | 走神 | 已做 | tests/packages/affect\tests\fn-time-inject-invariants.mjs |
| C07 | 心理时间：时间感、过去／现在／未来取向 | 已做 | tests/packages/affect\tests\fn-time-inject-invariants.mjs |
| C08 | 资源预算：这一拍能分给几件事 | 已做 | tests/fn-persona-budget.mjs |
| X01 | 词汇与句式 | 已做 | tests/fn-persona-lexicon.mjs |
| X02 | 节奏与语速 | 已做 | tests/fn-persona-rhythm.mjs |
| X03 | 语气与标点 | 已做 | tests/packages/affect\tests\fn-time-inject-invariants.mjs |
| X04 | 表情包与图像 | 已做 | tests/packages/affect\tests\fn-time-inject-invariants.mjs |
| X05 | 幽默：什么好笑、怎么损人、怎么自嘲 | 已做 | tests/fn-persona-humor.mjs |
| X06 | 称呼 | 已做 | tests/packages/affect\tests\fn-time-inject-invariants.mjs |
| X07 | 口头禅与口癖 | 已做 | tests/packages/affect\tests\fn-time-inject-invariants.mjs |
| X08 | 沉默与回避 | 已做 | tests/packages/affect\tests\fn-time-inject-invariants.mjs |
| X09 | 主动发起：自己找话说 | 已做 | tests/packages/affect\tests\fn-time-inject-invariants.mjs |
| X10 | 道歉方式 | 已做 | tests/fn-persona-repair.mjs |
| X11 | 撒娇与示弱 | 已做 | tests/fn-persona-cute.mjs |
| X12 | 发言决策：说、不说、什么时候说、说几条 | 已做 | tests/fn-persona-speak.mjs |
| H01 | 行为固化：重复成习惯 | 已做 | tests/fn-persona-habit.mjs |
| H02 | 仪式感 | 已做 | tests/fn-persona-ritual.mjs |
| H03 | 渴求与上瘾 | 已做 | tests/fn-persona-crave.mjs |
| H04 | 生活节律：作息、吃饭时间 | 已做 | tests/packages/affect\tests\fn-core-six-tables.mjs |
| D01 | 可塑性 | 已做 | tests/packages/affect\tests\behavior-coverage.mjs |
| D02 | 淬火 | 已做 | tests/packages/affect\tests\fn-core-six-tables.mjs |
| D03 | 创伤与关键期 | 已做 | tests/fn-persona-keyperiod.mjs |
| D04 | 漂移 | 已做 | tests/packages/affect\tests\fn-core-six-tables.mjs |
| D05 | 模式结晶 | 已做 | tests/packages/affect\tests\fn-core-six-tables.mjs |
| D06 | 重大事件：能撬开已经定型的那块 | 已做 | tests/fn-persona-reciprocity-major.mjs |
| D07 | 模式退役与合并：长期不激活就降权，太像就合 | 已做 | tests/fn-persona-empathy-retire-degrade.mjs |
| D08 | 降级策略：器官缺席时冻结，不顶替 | 已做 | tests/fn-persona-empathy-retire-degrade.mjs |
| F01 | 压抑 | 已做 | tests/fn-persona-suppress.mjs |
| F02 | 合理化 | 已做 | tests/fn-persona-blame.mjs |
| F03 | 投射 | 已做 | tests/fn-persona-project.mjs |
| F04 | 回避 | 已做 | tests/fn-persona-avoid.mjs |
| F05 | 否认 | 已做 | tests/fn-persona-deny.mjs |
| F06 | 升华 | 已做 | tests/fn-persona-sublimate.mjs |
| U01 | 不可及的动机 | 已做 | tests/fn-persona-motive.mjs |
| U02 | 自己不知道的状态 | 已做 | tests/fn-persona-unclear.mjs |
| U03 | 口误与泄漏 | 已做 | tests/fn-persona-leak.mjs |
| A01 | 外表 | 已做 | tests/fn-persona-fixed.mjs |
| A02 | 音色 | 已做 | tests/fn-persona-fixed.mjs |
| A03 | 姿态与小动作 | 已做 | tests/fn-persona-fixed.mjs |
| A04 | 生理节律：心率、呼吸、体温 | 已做 | tests/packages/affect\tests\behavior-coverage.mjs |
