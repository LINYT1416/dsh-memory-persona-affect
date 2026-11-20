# 杏仁核（amygdala）

DSH 记忆器官之一。**单器官版**：能自己打分、调质、建关联、门控、复核；三个器官（皮层/前额叶/海马体）的口按 `杏仁核-功能总表.md` 预留。

它不存内容，只存**重要性**。输出是一个分、三个调制量、四个标签、一个门控、一个队列。

## 它做什么

- **打分**：六因子 + 时间临近 → 合成 → 标定。快路同步 <5ms，慢路异步精算。
- **调质**：NE/皮质醇小时级余韵。吵完一架，接下来半天看什么都烦——靠这个。
- **打标与捕获**：高唤醒给源头打标，同窗口的条目被"捕获"一起加权。
- **恐惧与消退**：cue（怕这个）和 context（怕这个场景）分开存；消退是新建安全条目，不是删；三种复发都实现了。
- **失真**：主观生动度和准确度分开，会随时间漂；复述会重建；"变了"和"错了"分开标。
- **复核**：极端情绪进队列，3 天过期；每 90 天定期复核一次。
- **调制**：给海马体输出 depth / days / rounds / summaryLevel。

## 数据在哪

`~/.dsh/amygdala/`（`AMYGDALA_DIR` 可覆盖）

| 文件 | 作用 |
|---|---|
| `scores.jsonl` | 每次打分的记录（不含原文，只有 hash） |
| `windows.jsonl` | 时间窗 |
| `aversion.jsonl` | 负面关联 |
| `safety.jsonl` | 安全条目（消退时新建） |
| `corrections.jsonl` | 更正 |
| `conflicts.jsonl` | 冲突（"变了"，不是"错了"） |
| `review.jsonl` | 复核队列 |
| `audit.jsonl` | 决策日志（只记谁/为什么/改多少） |
| `state.json` | 调质、计数、样本 |

**注意**：这个目录里有"谁让谁不高兴"，默认不进云端同步。

## 怎么验

```bash
node tests/selftest.mjs   # 79 项，功能级
node tests/smoke.mjs      # 18 项，挂载级
```

`selftest` 覆盖 V1–V12 全部验收，`smoke` 用假 ctx 把插件真挂起来跑一遍。

## 怎么接别的器官

三个器官不在时用 `null`，所有调用点走 optional chaining，自动落到规则实现。接入时：

```
ctx.provide('memory.amygdala', provider)   // 我在，别人来拿
ctx.get('memory.cortex')                   // 皮层的精细输入（慢路）
ctx.get('memory.prefrontal')               // 消退裁决、复核消费者
ctx.get('memory.hippocampus')              // 情境、原文、被想起次数
ctx.get('memory.mood')                     // 心情源
```

我对外给：

```
salience(text, meta)          -> { score, rank, components, reasons, modulators, tags, degraded }
observe(event)                -> 同上（走完整链路：调质/捕获/恐惧/复核）
observeMany(events)
gate(id, {session})           -> { memory, expression, info }
caution(subject)              -> { level, since } | null
review(id, {action})          -> 已处理的那条
modulate(score)               -> { depth, days, rounds, summaryLevel }
prioritize(item)              -> 给皮层的优先写（没接就空转）
tone()                        -> { ne, cort, gain }
stats()                       -> 接线状态 + 分布 + 队列
```

**判据**：别人来接的时候，`lib/` 一行都不用改。接进来跑不满，看 `stats().capabilities` 和 `degraded`。

## 工具

- `amygdala_salience`：给一句话打分（不写记忆）
- `amygdala_review`：看/处理复核队列
- `amygdala_stats`：接线状态 + 分布 + 过度信任自检
- `amygdala_caution`：查某个话题有没有负面关联

## 面板

`GET /amygdala/state`、`GET /amygdala/score?q=`、`GET /amygdala/review`

**面板第一行永远是接线状态**，还有一句"当前只影响编码深度/保留时长/巩固轮次，不参与主排序"。这句话比任何功能都重要——防止"看起来接上了"。

## 给别的器官的接缝（三方都要对齐）

| 器官 | 要什么 | 我给什么 |
|---|---|---|
| 海马体 | `salience(text, meta)` / `gate(id)` / `caution(subject)` | 全有 |
| 皮层 | `salience(text)` | 有，同步返回对象 |
| 前额叶 | `salience` / `weight(id)` / `adjust(id,{delta})` / `state()` | 全有（见下） |

前额叶四个的语义：

- `weight(id)` → `{ weight: 0..1 }`，拿不到返回 **null**（它的三态铁律：不许用 0 顶替 absent）
- `adjust(id, { delta })` → `{ ok, id, weight }`，正数压得更狠、负数抬回来。**执行方是我，算曲线的是它**
- `state()` → `{ valence, arousal, tone, at }`，当前情绪，同步

## 两个必须知道的坑（实测踩过）

**1. 必须声明 `export const inject = ['tools', 'webServer']`。**
不声明，`ctx.tools` / `ctx.webServer` 拿不到，工具和面板会静默不注册——插件「活着但哑了」。

**2. `inject` 会让 apply 变晚，所以要排在消费方前面。**
海马体在 `apply()` 里快照器官（`makeOrgans`），它有个 3 秒 × 20 次的重探窗口，60 秒后就不再补。
如果杏仁核排在它后面，且重探窗口过了，就永远是 `adapters.amygdala === null`，海马体悄悄退回规则分（`salienceSource: 'rule'`）。
所以 `bundles` 里 `@local/amygdala` 必须排在 `@local/hippocampus` **前面**。

验证方法：随便写一条记忆，看 `~/.dsh/hippocampus/raw/*.jsonl` 里最后一条的 `salienceSource` 是不是 `amygdala`，以及 `~/.dsh/amygdala/scores.jsonl` 有没有新行。

## 已知边界（单器官阶段）
- 只影响编码深度、保留时长、巩固轮次。**不参与主排序**（那是海马体 + 前额叶的活）。
- 慢路只有规则版，等皮层给精细输入。
- context 型恐惧只能拿 session 近似，等海马给情境。
- relation 推断只有规则，等关系图谱。
- 摘要强度、优先写入、回执对账：口开着，没人消费。
- 三个数还没定：`tone` 增益上限（现在 0.25）、`threat` 阈值（现在 0.5）、隐私边界（现在只存 hash + 前 40 字）。
