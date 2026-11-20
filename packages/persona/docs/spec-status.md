# 人格插件 · 规格落地状态（对照 packages 四份规格）

> 目的：一条一条能查到“做到没、靠什么证明”，不靠嘴说。
> 更新时间：2026-11-19　｜　测试：32 个文件全绿（`node tests/<name>.mjs`）

## 一、已经真正生效，并且有断言＋线上证据

| 规格项 | 现在的行为 | 断言 | 线上证据 |
|---|---|---|---|
| 注入条数可调 | 默认 8，面板可推到 40；实测 25 行 ≈186 token | `fn-persona-inject-depth` | 注入块 8~10 行 |
| 快拍不推慢器官（K1） | 空拍只走 `str`，慢器官不步进 | `selftest` / `persona-ofc-warm` | — |
| 记忆接缝（K2） | 服务不在 → 读 `episodes.jsonl`；情绪条目挡住；无数据如实失败 | `integration-memory` / `memory-link` | 读到 14~19 条她的原话 |
| 两种模式 | `custom` 生效自述+旋钮；`learn` 下旋钮返回 `learn-mode`、自述不进注入 | `fn-persona-modes` | `/persona/state` → `mode=custom` |
| 自述改了就自动改行为 | 每拍比对自述指纹 → 重算句长/语气偏置 → `setUserBias` | `fn-persona-selfbias` | `hex.brevity 0.506`（含偏置） |
| 人设要求落成硬提示 | 自述写“语气词/1~3 句/别感叹号”→ 注入末尾挂一句 | `fn-persona-selfhints` | 注入里能看到那 3 行 |
| 复杂情绪可读化 | 70+ 读数 → 一句人话；缺读数不编 | `fn-persona-desc-extra` / `desc-rules-safe` | “后面的事一片糊，不敢想” |
| 自我概念 | 被反复说的词 → “别人老说 X，我自己也认了” | `fn-persona-self-concept` | — |
| 主动提起 | 6 小时以上的旧事，每 12 拍提一条，提过不再提，落盘 | `fn-persona-recall` / `-dedupe` / `-persist` / `-due` / `-quality` | `recall.json` 4 条已提记录 |
| 仪表页 | 模式/旋钮/口吻统计/音色/注入条数/**六器官读数**/原始 JSON | `fn-persona-panel-state` / `-organs` | `organs.ofc = {warm:0,...}` |
| 落盘与重启一致（K4） | 重启前后 hex 一致（同文比较） | `persona-state-persists` | `0.262 → 0.242` |
| 关系账本 | 人情 ±3 才念一句；伤人掉亲密；每轮落盘（turns 不再被重启清零） | `fn-persona-relation` | `relation={debt:0,intimacy:0.88,turns:68}` |
| 关系修复 | 伤过但之后道过歉 → 翻篇；时间戳进快照，重启后仍翻篇 | `fn-persona-relation-repair` | 同上 |
| 同帧互动 | 两个读数同时高才说一句（冒犯+冲突 / 暖+羞 / 想要+该停 / 危机+怀旧） | `fn-persona-interaction` | 注入里出现「还想要，又知道该停了，两股劲在扯」 |
| 覆盖率审计 | 扫源码算「83 个读数里几个真被用上」 | `fn-persona-coverage` | `coverage={total:83,used:39,ratio:0.47,unused:44}` |
| 器官配额 | 一个器官最多占 2 行，不让"想要"刷屏 | `fn-persona-diversity` | — |
| 离线端到端 | 挂起插件喂 4 句，验注入含账本行 + 落盘 | `fn-persona-offline-e2e` | — |

## 二、接了但只进了“偏置/文字”，还没做成独立行为

| 读数 | 现在的作用 |
|---|---|
| `mpfc.idealGap` | 话更短、热度更低（偏置）＋一句可读的话 |
| `pcc.crisis` | 反应更慢、话更碎（偏置） |
| `ofc.unfair` | 更直（偏置） |
| `mpfc.discomfort` / `acc.error` / `pcc.future` / `tpj.air` | 各一句可读的话 |

## 三、还没做（按规格条目，别装作做完了）

1. **关系账本**：谁欠谁人情、称呼变化、亲密度分档 —— 完全空白
2. **目标与结果**：她想要什么、做成没 —— 只有 `str.wanting` 一个数
3. **同一帧内的一致**：六个器官在同一拍里的相互影响（现在各自独立步进）
4. **外部语料学习**：QQ 群/私聊真实对话取样 —— 两次尝试都因语料为空没做成
5. **生成侧硬约束**：语气词/句数的**执行层**约束（现在只是提示，不是强制）
6. 剩余约 35 条读数仍只出数、未接行为

## 四、已知会踩的坑（都写进 known-issues.md）

- K1 快拍分层
- K2 记忆服务不存在
- K3 口吻语料被技术汇报污染（句均 68 → 26）
- K4 “重启不一致”其实是测试比错了
- 调试文件写不出来：`index.js` 少 `fs` 导入，异常被内层 catch 吞掉
- `ticks % 12` 节流在重启后永远到不了点 → 改成“距上次 ≥12 拍”


## 当前快照（2026-11-19 19:5x）

- 测试：51 个文件全绿（node tests/*.mjs）
- 注入自检：tools/inject-sanity.mjs PASS（8 轮里最多 1 条指令，无互相矛盾）
- 线上：端口 63434，mode=custom，coverage 42/83
- 仪表页可见：goals / conflicts / possess / coverage / relation
- 「没人做」40 条：已做 13、部分 13、没做 14（详见 spec-gap-list.md）


## 收官快照（2026-11-19 晚）

- 测试：79 个文件全绿（含端到端 12 轮对话：最多 13 行注入、2 条指令、无矛盾）
- 缺口：40 条「没人做」→ 已做 42 行 / 部分 0 / 没做 0（A01/A02 占两行）
- 两种模式：自定义带人设、纯学习不带；有断言
- 仪表页字段：relation / goals / conflicts / possess / crave / worth / habit / keyPeriod / consistency / identity / speakers
- 线上：58288（旧版；新批次按主人要求未部署）


### 部署前最后一项验证（2026-11-19 21:0x）

- /persona/state 端到端测试：直接调路由处理器，返回 26 个字段
- 其中 identity / interlocutor / storyline 读的是真实文件内容（不是 null）
- 线上当前仍是 17 字段（tools/live-check.mjs 可复查）
