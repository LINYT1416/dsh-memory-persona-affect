# 心情插件（dsh-affect）全时期交接

> 写给"心情-人格-记忆"三方联调窗口。最后更新：2026-11-12 00:5x
> 代码根目录：`packages/affect`（安装位置是一个 junction，改这里就是改线上）

## 0. 一句话现状

十五个器官/层 + 一个记忆桥 + 一个输出通道，跑在一个统一时钟上；每拍算一次状态，每句话算一次情绪。线上已验证：`recallSync` 6–11ms 返回、同拍回声、写回带 valence、统计出口干净。人格插件已有六个器官（`str/tpj/ofc/acc/mpfc/pcc`）在跑，`wires.affect='value'`，但 `persona.frame()` 还没接——这是三方联调的第一件事。

---

## 1. 全时期修改过程（按轮次）

| 轮次 | 做了什么 | 为什么 | 结果 |
|---|---|---|---|
| 立地基 | 15 个模块 + 统一时钟 + A/B 两段 tick | 情绪要有前因后果，不能一句话直接给结论 | 209/209 声明覆盖 |
| 原型期 | 7 维评价向量 → 20 原型去均值余弦 | 情绪是"评价×原型"构造，不是 if-else | 负性场景只出负性情绪 |
| 记忆接前半 | `bridge.recall` 读海马体，命中抬 threat | 想到旧事心情会变 | 第 7 轮 +0.077 |
| 时效 | 先同步 `recallSync` 同拍拿结果，异步只兜底 | 隔一拍用记忆像"反应慢半拍" | 6–11ms |
| 记忆接后半 | 写回 `annotate`（force+bypass），带 valence/强度/深度 | "那次我很难受"要进库 | 写回 130 条 |
| 继承 | `inherit.js` 读旧 mood-v2 状态映射 | 换插件不该从零开始 | 一次性 `state.inherited` |
| 情绪标签 | `world.lastUserText` 修对，抱怨/夸奖门才生效 | 之前第 7/8 轮没有情绪 | 厌烦/安心正常出 |
| 表情包 | 跟随当下 rewardPE/threat + 主导情绪 | 曾经"心痛"却配开心图 | 负性不给亮色图 |
| 注入 | 4–7 行、轮换 MOUTH/BODY/MEME/心里、记忆行截 16 字 | 每轮不该说同一句 | 相邻轮重复 ≤3 行 |
| 同拍回声 | `recallFast` 写入 `queryAt`，只认"这一句" | 上一句的回声不能挂到这一句 | 跨句不串 |
| 空结果 | `empty-hits` 当权威，不再用异步硬凑 | "重启完了"曾被塞三条不相干的旧事 | 想不起来就是空 |
| 诊断 | `memoryCaps.lastFast` + `probe()` 只读 | 定位卡在谁那边；探测不能污染结论 | 五档 stage |
| 统计 | `/affect/stats`：byKind / byDay / unnamed / invalid | 人格层要"哪几天低落" | 2 天分桶 |
| 归档 | `archiveInvalid()` 挪走脏样本，不物理删 | 305 条"未分类"+10 条"x"污染统计 | 319→0，保留 130 |
| 深度 | 心情差时强度 ×(1+0.4·max(0,−mood)) + `depth` | 低谷里记得更刻 | 待负心情事件验证 |
| 惯性 | brevity/标点走 EMA + 两拍确认 | 人不是每句重算温度计 | 单句不跳变 |
| 多轮配对 | `world.pair`：变短/软化/升级/上句答太短 | "上条说重了、这条软一点" | 软化降 brevity |
| 后扣带 | dmn 吃 `memoryEcho/memoryRecent` → anchors/chapters | 之前锚点空转，"记得"是零 | anchors>0 |
| 心情优先 | forced 先看评价强度与唤醒，文本只作旁证 | 没接记忆时不退回关键词规则版 | 文本不再是唯一开关 |
| 桥重写 | `bridge.js` 被 PowerShell 编码事故写坏（68 处乱码、丢换行），从零重建 | 文件已无法解析 | 328 行，接口一个不少 |

事故记录：中途一次用 `Get-Content -Raw` + `Set-Content` 做字符串替换，把 UTF-8 当 GBK 写回，`bridge.js` 68 处损坏、语法失败。没有 git、没有备份，只能重写；重写依据是测试契约 + 调用点。**教训：以后改这个目录只用 `edit`/`write` 工具，不用 PowerShell 管道改中文文件。**

---

## 2. 目录与职责（代码位置）

```
core/
  engine.js      370 行  统一时钟、A+B 两段 tick、世界组装、状态落盘/恢复
  fuse.js        204 行  评价向量→情绪原型；forced 门；融合输出
  bridge.js      328 行  记忆桥（只读四器官 + 写回 + 统计 + 诊断）
  consts.js      150 行  原型表、常量、时间工具、语用分析
  context.js      33 行  单句特征（抱怨/夸奖/提问/催促/称呼）+ 最近 8 轮上下文
  inject.js      150 行  系统注入文案（4–7 行、无阿拉伯数字）
  dashboard.js   194 行  设置页仪表盘 HTML
  inherit.js      63 行  旧 mood-v2 状态继承
  store.js        46 行  状态文件读写（坏文件自愈）
  resource.js     40 行  计算资源账本（注意力/抑制/共情/意志）
io/
  output.js       93 行  句长/标点/延迟/表情包/语音/泄漏/释放/求安慰/自报误差
  bias.js         30 行  心境一致性偏置（记忆重排用）
organs/          五个器官，各自独立状态与 step
  hypothalamus.js 166  渴饿困、皮质醇、压力负荷、周期、体温/疼痛
  amygdala.js     150  威胁、奖赏预测误差、敏化、冻结、线索
  insula.js       134  体感（强度/性质/位置）、厌恶、渴求、内感受
  pfc.js          185  抑制、带宽、面具、泄漏风险、语气位移、道德判断
  hippocampus.js  159  情景编码/再体验/睡眠巩固（插件内部的小海马，和记忆插件不是同一个）
layers/
  attention.js     48  显著性与门控
  neuromod.js      55  多巴胺/血清素/催产素/阿片/内源性大麻素
  social.js        73  心智理论、共情疲劳、社交痛、人情账、地位
supplements/
  dmn.js           47  走神、自我参照、反刍、心理时间、社交想象、**锚点/章节**
  brainstem.js     33  唤醒、心率、呼吸
  endocrine.js     34  皮质醇/催产素/睾酮/甲状腺
  sickness.js      30  疲惫、痛觉敏化（生病行为）
time/
  curve.js         72  情绪曲线：起始、峰、不应期、双峰、矛盾
  rhythm.js        31  昼夜节律
index.js          212  插件入口：服务注册、HTTP 路由、tick 调度
client.js          32  设置页前端注册
tests/            12 个文件，见第 6 节
```

---

## 3. 每个功能的用途（按"它解决什么"列）

### 3.1 评估与情绪
- **评价向量**（`core/fuse.js` `appraisalOf`）：把"威胁/奖赏/信任/上下文"折成 7 维（相关性、目标、他人能动、确定性、应对、规范、新奇）。用途：同一句"又崩了"，在不同信任和带宽下不该是同一个情绪。
- **原型构造**（`constructEmotions`）：7 维去均值后和 20 个情绪原型做余弦，符号与规范先过滤再排序。用途：避免"越像越挑错"，也避免负性场景出"开心"。
- **强制门**（`forced`）：评价强度 >0.5，或文本像抱怨/夸奖且身上已有动静。用途：弱信号不被平线闸门吃掉；同时不再让"字面像抱怨"单独决定情绪。
- **心境一致性**（`core/bridge.js` `moodRerank` + `io/bias.js`）：心情差时同类旧事权重 +0.075（降级）/0.15。用途：心情差更容易想起同类的事。

### 3.2 五个器官
- **下丘脑**：渴/饿/困/温度/接触/控制/意义、皮质醇与压力负荷、生理周期、疼痛门控。用途：身体状态能压过情绪（累到不想说话）。
- **杏仁核**：威胁、奖赏预测误差、敏化、冻结、线索捕获。用途：所有情绪的源头强度。
- **岛叶**：体感强度/性质/位置、厌恶、渴求、内感受精度。用途：把"胸口沉"这种话变成状态，而不是文案。
- **前额叶**：抑制、带宽、面具（mask）、泄漏风险、语气位移（soft/hard/flat）、道德判断。用途：决定"想骂但忍住"还是"漏出来"。
- **海马回（内部）**：情景编码、再体验、睡眠巩固、上限。用途：给情绪提供"刚才发生过什么"的短期痕迹。

### 3.3 层与补充
- **注意力/神经调质/社交**：显著性门控、五种调质、心智理论与社交痛、人情账。用途：同一句话，在"被当众说"和"私下问"里后果不同。
- **默认模式网络（dmn）**：走神、自我参照、反刍、心理时间、社交想象，**锚点 anchors / 章节 chapters**（读 `world.memoryEcho` 与 `memoryRecent`）。用途：让"记得"真的进入自我参照；负性旧事首次出现立刻触发反刍。
- **脑干/内分泌/病感**：唤醒、心率呼吸、激素、疲惫与痛觉敏化。用途：给情绪一个"身体底噪"。
- **曲线/节律**：情绪的时间形状（峰、不应期、双峰）与昼夜。用途：情绪不是阶跃，是有形状的。

### 3.4 输出通道（`io/output.js`）
- 句长 `brevity`：抑制越强、情绪越强，话越短；**走惯性 EMA**，单句不跳变；多轮配对里的"软化"会往下压、"升级"往上推。
- 标点 `punctuation`：hard/flat→句号多，soft→暖；**连续两拍同向才换**。
- 延迟、表情包、语音、泄漏、释放、求安慰、自报误差：用途分别是"回复快慢""配不配图""语速音量""忍没忍住""说完轻一点""想不想找人""说没事和真没事的差"。

### 3.5 记忆桥（`core/bridge.js`）
- `recallFast` / `probe` / `fastStage`：同拍同步召回；`probe` 只读，不污染 `lastFast`。
- `recallAsync` / `recall` / `recentEpisodes`：异步兜底与最近情景。
- `moodRerank` / `notesLedger`：心境重排；账本按 episode id（或 `b:brief`）把 valence 对上。
- `annotate`：写回（`force`+`bypass`），带 valence/强度/`depth`/`mood`/`named`；本地 jsonl 与记忆侧 write 双写，任一成功即 `wrote:true`。
- `stats(days)`：`byKind/byDay/unnamed/invalid/valenceMean/intensityMean/deepShare/lastAt`。
- `archiveInvalid()`：脏样本挪去 `memory-notes.invalid.jsonl`，原文件只留干净行（先写 tmp 再 rename）。
- `capabilities()` / `status()`：接线诊断（`recallSync/recallAsync/recall/episodes/write` + `lastFast`）。

### 3.6 注入与仪表盘
- `render(fused, {hour,lastLine,tick})`：4–7 行，心里/身体/嘴上/这事以前有过/表情包；数字一律不出现（记忆引用行除外）。
- `dashboard.js` `summarize` + `dashboardHtml`：设置页里看六维、情绪、记忆、器官健康。

---

## 4. 对外接口（三方联调要用的）

### 4.1 HTTP（本机）
| 路由 | 用途 | 关键字段 |
|---|---|---|
| `/affect/live` | 器官健康 | 各器官 `ok`、记忆三能力 |
| `/affect/state` | 此刻全量 | `fused`（含 `emotions/mood/pair/memoryEcho`）、`memoryCaps.lastFast` |
| `/affect/recall?q=` | 只读探测召回 | `stage/ms/hits` |
| `/affect/stats?days=N` | 长期统计 | `writebacks`（含 `byDay/unnamed/invalid`）、`memory`、`now` |
| `/affect/stats?days=N&archive=invalid` | 归档脏样本 | `archive:{moved,kept}` |
| `/affect/trace` | 最近 12 拍轨迹 | 每拍 mood/情绪/耗时 |
| `/affect/dashboard` | 仪表盘 HTML | — |

### 4.2 进程内服务
- `ctx.provide('affect.io')`：`read()` 拿快照给外面。
- 记忆桥每拍只读：`memory.hippocampus` / `memory.cortex` / `memory.prefrontal` / `memory.amygdala`；只写 `write`（带 `force/bypass`）。

### 4.3 人格层契约（未接，优先级最高）
人格窗口提供 `persona.frame()`，返回五项：
```js
{ baselineMood, threatGain, complaintThreshold, sensitivity, trustGain }
```
- `baselineMood`：心情基线（-1..1）；`threatGain`：威胁放大系数（0.5..2）；
- `complaintThreshold`：抱怨判定门槛（0..1）；`sensitivity`：体感/共情灵敏度（0.5..2）；
- `trustGain`：信任累积速度（0.5..2）。
engine 侧已预留 `persona` 入参（`createEngine({persona})`），接上后写在 `p` 的覆盖位；不接就按默认跑。

---

## 5. 数据落点
- 状态：`~/.dsh/affect/state.json`（坏文件自愈回默认）。
- 写回账本：`~/.dsh/affect/memory-notes.jsonl`（每行 `{at,id,kind,named,valence,intensity,depth,mood,brief}`）。
- 脏样本归档：`~/.dsh/affect/memory-notes.invalid.jsonl`。
- 记忆侧：`memory.hippocampus` 的 episode 库（只经 `write` 与 `recallSync` 交互，不改结构）。

---

## 6. 测试与"怎么算真的过"

**判据：不看有没有数，看输入变了它有没有按方向动。**

| 测试 | 管什么 | 通过标准 |
|---|---|---|
| `selftest` | 模块数与声明覆盖 | 18 模块 / 206 条 |
| `behavior` | 11 个器官/通道的行为 | 饿会涨、被骂威胁>被夸、难受体感强、当众更压抑、被冷落社交痛不降、负性旧事出锚点与反刍、只出负性情绪、情绪差话短图少、注入 4–7 行无数字、被顶心情降且安静会回、软化被识别 |
| `wiring` | 接线率（Proxy 实测谁读了谁） | 当前 41.8%，未接线 117/201 如实输出 |
| `brain-sync` | 同拍召回/账本/权重/空结果/跨句 | 全 Pass |
| `stats` | byDay、unnamed、invalid、归档、写回 | 全 Pass |
| `lifecycle` | 十轮全生命周期 + 记忆逐轮 | 无越界、无接口冲突 |
| `bridge` | 桥的 9 组崩溃点 | 全 Pass |
| `dashboard` / `inherit` / `audit` / `coverage` | 仪表盘/继承/声明/覆盖 | 205/205、209/209 |
| `liveness` | 在线存活 | — |

跑法：`node tests/<name>.mjs`（用运行时自带 node：`~\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`）。**不要用 `Select-Object -First` 截断输出**——那会把 node 杀掉，退出码 1 是截断不是失败。

---

## 7. 已知缺口（不许当已经好了）
1. **接线率 41.8%**：201 个读数里 117 个没人读（如 `hypothalamus.hunger` 只在 `snapshot()` 里、`pfc.cap/mask` 只被自己用）。要么接进逻辑，要么从 `read()` 撤掉。
2. **`degraded` 恒 true**：同步路径不走向量；短句召回时紧时松（"累死我了"空、"重启完了"却给三条）。
3. **`valenceReady` false**：历史 episode 无 valence，心境重排靠账本 join 近似；新写回已带 valence（覆盖率 0.64→0.80）。
4. **`deepShare` 可能长期 0**：深度只在心情为负时触发；正性为主的时期不会出现。
5. **`persona.frame()` 未接**：人格插件六个器官在跑（`wires.affect='value'`），但只读了心情值，没读五项参数。
6. **`pcc.anchors` 曾为 0**：它读记忆缓存，需一次真召回才填；接入后要验。
7. **`archive` 回显**：`/affect/stats?archive=invalid` 的 `archive` 字段最后才补上，需一次重启确认。

---

## 8. 新窗口第一周建议做的三件事
1. **接 `persona.frame()`**，把五项映射进 `p`；写一个 `tests/persona-link.mjs`，断言"基线心情变了 → 同句话的 moodTarget 跟着变"。
2. **清接线率**：从 `wiring` 输出的 117 个字段里挑 20 个最该用的（`hunger/thirst/sleep`、`pfc.cap/load`、`social.ledger`），接进输出或下丘脑反馈；目标先到 60%。
3. **记忆侧把 `valence` 补进 episode**（`valenceReady:true`），然后关掉账本 join 的近似，改吃她自己的 valence；改完用 `brain-sync` 复查权重 0.15/0.075 是否还成立。

## 9. 纪律（血换的）
- 改中文文件只用 `edit`/`write`，不用 PowerShell 管道做替换。
- 所有代码改动都要重启才在线上生效；改完给数字，不给"应该好了"。
- 一个数字要么有命令输出、要么有测试断言；没有就标"未验"。
- 任何"探测/诊断"接口必须只读，不许改被诊断对象的状态（`probe` 就是这么来的）。
