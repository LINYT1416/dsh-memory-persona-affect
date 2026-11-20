# 前额叶（prefrontal）

DSH 记忆器官之一。**不存内容，只出判断**：定怎么找、判哪条能用、说清有多可信、把不该用的压下去。
单器官能跑；三个器官不在时全部走默认，接口按 `前额叶-功能总表.md` 的 F1–F17 预留。

## 它做什么

- **计划**：问话 → 意图 / 模式 / 过滤 / 检索目标（`target` 给了，海马认不认都行）
- **判断**：候选 → 留谁、排第几、多可信、跟谁冲突、为什么（30 条断言可验）
- **准入**：值不值得记（噪声、草稿、违反约束的拦掉）
- **记着自己**：热区三档 + 任务栈 + 账本 + 冲突队列（只写这四个地方）
- **会说不确定**：空手就禁断言；有 `unknown` 就把置信封在 0.6

## 数据在哪

`~/.dsh/prefrontal/`

| 文件 | 作用 |
|---|---|
| `hot.json` | 热区：三档 + 槽位权重（分布式维持的近似） |
| `tasks.jsonl` | 任务栈：目标、完成判据、约束、状态 |
| `ledger.jsonl` | 每次判断的账（可回放） |
| `suppressed.jsonl` | 压制记录（带有效期）+ 失败策略黑名单 |
| `conflicts.jsonl` | 冲突队列（等皮层裁，不覆盖原条目） |
| `telemetry.json` | 调用数 / keep 率 / 缓存命中 |
| `calibration.json` | 按意图的成功率（"不对"信号会下调） |
| `meta.json` | 存储版本（迁移用） |

## 怎么验

```bash
node tests/contract.mjs   # 43 项：三态 / 五种器官状态 / 30 条断言 / 说谎器官元测试
node tests/golden.mjs     # 50 组固定输入，接器官前后 diff
```

当前：**43/43 通过**，`node --check` 38 个文件全过，golden 二次运行 0 diff。

## 怎么接别的器官

三个器官不在时是 `absent`，所有调用走三态，绝不拿 `null` 或 `0` 顶替。

```js
ctx.provide('memory.hippocampus', { recall, episode, traces, source, conflicts })
ctx.provide('memory.cortex',      { concepts, contradicts, search, summarize })
ctx.provide('memory.amygdala',    { salience, weight, adjust, state })
```

规矩：
- **结论型接口**：返回判断，不返回原料（不返回相似度让你定阈）。
- **三态**：`value` / `unknown` / `absent`，`unknown ≠ 0 ≠ 默认值`。
- **一律 async**：T0 只读缓存，永不发异步调用。
- **写面带回执**：`applied[]`，比例 <80% 报警。
- **shadow**：新器官先只记录不生效，跑一周再切。

## 工具

- `prefrontal_recall`：定计划再检索（慢路，最多 2 轮）
- `prefrontal_plan` / `prefrontal_judge` / `prefrontal_gate`
- `prefrontal_task`：任务栈（list / push / pop / expire）
- `prefrontal_stats` / `prefrontal_ledger` / `prefrontal_conflicts`
- `prefrontal_priority`：告诉海马先重放谁
- `prefrontal_feedback`：用户说"不对"时下调同类置信

## 面板

`GET /prefrontal/state`、`GET /prefrontal/plan?q=`、`GET /prefrontal/recall?q=`

## 已知边界（单器官阶段）

- 语义一律不做：不摘要、不抽实体、不判"意思相不相同"——那些走 F11–F13。
- 来源种类 / 冲突对 / 检索痕迹 / 读回写要海马补 5 个接口，不补这 9 条只能到形态。
- 消退只算曲线，没人执行（等杏仁核）。
- 置信公式是拍的（单调 + unknown 封顶），没拿真数据校准，属 V 档。
