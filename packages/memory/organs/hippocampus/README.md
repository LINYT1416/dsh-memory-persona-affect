# 海马体（hippocampus）

DSH 记忆器官之一。**单器官版**：能自己记、自己查、自己忘、自己整理；三个器官（皮层/前额叶/杏仁核）的接口按 `海马体-功能总表.md` 预留。

## 它做什么

- **写**：消息进来 → 去重 → 按空档切段 → 分离三档 → 落 raw + 索引。不调模型，不阻塞。
- **查**：模糊问法走补全（BM25 + 向量 + 图扩散），精确问法走分离（数字/引号/账号直命中）。
- **忘**：可及性衰减，过线归档，原文不删。
- **整理**：安静期或凌晨跑巩固，重放、抽候选、拼接、写审计日志。
- **注入**：只给最近几条索引摘要，不给全文。

## 数据在哪

`~/.dsh/hippocampus/`

| 文件 | 作用 |
|---|---|
| `raw/raw-YYYY-MM-DD.jsonl` | 原话，只追加，按天分卷 |
| `episodes.jsonl` | 事件（索引摘要 + 槽位 + 状态） |
| `index.jsonl` | 检索索引，可重建 |
| `links.jsonl` | 边 |
| `traces.jsonl` | 每次检索的痕迹 |
| `candidates.jsonl` | 巩固产出，等皮层确认 |
| `consolidation.jsonl` | 巩固审计日志 |
| `encode.log` | 编码日志 |
| `vectors.json` | 向量缓存（没有模型就是空的） |
| `meta.json` | 版本与统计 |

## 怎么验

```bash
node tests/selftest.mjs
```

11 项：写入、去重、稀疏门、同事件合并、精确检索、补全检索、序列查询、巩固、遗忘、契约桩、分层开关。

## 怎么接别的器官

三个器官不在时用 `null`，所有调用点走 optional chaining，自动落到规则实现。接入时：

```
ctx.provide('memory.cortex',     { extract, upsert, concepts, relations })
ctx.provide('memory.amygdala',   { salience, relevance })
ctx.provide('memory.prefrontal', { shouldRemember, plan, verify })
```

海马体这边不用改。交接协议：写路径只 push 不 await、50ms 超时吃默认、`dedupeKey` 幂等、版本不匹配拒收、episode id 只由海马体生成。

## 工具

- `hippocampus_recall`：找记忆
- `hippocampus_write`：手动写一条
- `hippocampus_sequence`：看前后发生了什么
- `hippocampus_consolidate`：手动巩固
- `hippocampus_stats`：现状

## 面板

`GET /hippocampus/state`、`GET /hippocampus/recall?q=`、`GET /hippocampus/consolidate`

## 向量层

- 模型 `Xenova/bge-small-zh-v1.5`，512 维，quantized。
- 直连 huggingface.co 在国内拉不动，默认走 `https://hf-mirror.com`；要换设 `DSH_HF_MIRROR`。
- 模型缓存在 `~/.dsh/hippocampus/models`（可用 `DSH_MODEL_CACHE` 换）。
- 装法（这台机器没有 npm，用 DSH 自带的 pnpm）：

```
node "<dsh-runtime>/dependencies/pnpm/bin/pnpm.cjs" --dir ~/.dsh/hippocampus --ignore-workspace install
```

- 老坑：`@xenova/transformers` 自带的 sharp 是 0.32，Windows 上没预编译会直接崩。
  处理办法：`package.json` 里 `pnpm.overrides.sharp = 0.35.5`，装完再把
  `node_modules/.pnpm/@xenova+transformers@*/node_modules/sharp` 这个软链删掉，
  让它向上解析到顶层的 sharp 0.35。
- 拉不到模型时向量路自动跳过，只走 BM25——绝不拿哈希向量冒充真向量。

## 已知边界（单器官阶段）

- 语义摘要没有，索引里只有抽取式首句；语义归皮层。
- 显著性靠规则分；杏仁核接上才准。
- 查询意图靠正则；前额叶接上才准。
- 主题层级、概念召回、真因果判断，都要等皮层。
