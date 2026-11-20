# 大脑皮层（cortex）

DSH 记忆器官之一。**单器官版**：从海马体读 episode，抽事实、攒证据、建语义层；前额叶/杏仁核不在时用规则降级，接口全留。

## 它做什么

- **抽**：episode → 事实/偏好/关系/地点候选，规则版，不调模型。
- **攒**：新信息先记假设，两条独立证据才升级为事实；冲突只标记不覆盖。
- **建**：证据链、语义图、共性规律（同谓词 ≥3 个客体）。
- **给**：注入一段「她记得的」；给海马体概念召回、语义判定、语义边。
- **纠**：用户说记错了 → 标作废、留历史、写审计。
- **退**：版本快照可回滚；冷条目归档不删。

## 数据在哪

`~/.dsh/cortex/`

| 文件 | 作用 |
|---|---|
| `cells.jsonl` | 所有 cell（只追加，读时后者覆盖前者） |
| `graph.jsonl` | 语义边 |
| `conflicts.jsonl` | 冲突记录 |
| `audit.jsonl` | 巩固/纠错审计 |
| `meta.json` | 游标、版本、统计 |
| `snapshots/` | 每次蒸馏前的快照（保留 10 份） |

## 怎么验

```bash
node tests/selftest.mjs   # 38 项
node tests/smoke.mjs      # 挂载冒烟
```

## 怎么接别的器官

三个器官不在时 `ctx.get('memory.X')` 返回 null，所有调用点走规则。

```
ctx.get('memory.hippocampus')  // 读 episodes / raw / traces / quiet
ctx.get('memory.prefrontal')   // plan / verify / truthfulness / resolveConflict
ctx.get('memory.amygdala')     // salience / priority
```

皮层对外提供：

```
ctx.get('memory.cortex') // extract / upsert / handoff / concepts / relations / judge
```

契约要点：版本不匹配拒收；读路径 200ms 超时、写路径 50ms；能力探测看方法不看对象；单写者；冲突不覆盖。

## 工具

- `cortex_ask`：问她记住了什么
- `cortex_stats`：现状
- `cortex_correct`：纠错
- `cortex_consolidate`：手动巩固
- `cortex_conflicts`：看冲突
- `cortex_health`：自检

## 面板

`GET /cortex/state`、`GET /cortex/ask?q=`、`GET /cortex/consolidate`

## 已知边界（单器官阶段）

- 反话判定靠词表，前额叶接上才准。
- 显著性靠规则分，杏仁核接上才准。
- 图式只有结构，加速要等图式有内容。
- 真退场要等 handoff 信号；现在只降权。
- 冷热分层要等数据量。
- 海马体缺 `episodes()` / `raw()` / `traces()` 只读 API 时，直读它的数据文件兜底。
