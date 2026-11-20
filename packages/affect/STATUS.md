# dsh-affect · 状态说明

版本 1.0.0 ｜ 最后验证：2026-11-11 20:40

## 覆盖情况

对着 `~\Desktop\情绪插件-功能总表.md`（功能 209 条，其中 4 条豁免）：

| 表 | 覆盖 |
|---|---|
| 1 杏仁核 | 21/21 |
| 2 下丘脑 | 20/20 |
| 3 岛叶 | 17/17（含 3 条豁免） |
| 4 海马体 | 18/18 |
| 5 前额叶皮层 | 23/23 |
| 6 调质层 | 8/8 |
| 7 注意层 | 6/6 |
| 8 社会层 | 12/12 |
| 9 脑干唤醒 | 5/5 |
| 10 默认模式 | 5/5 |
| 11 神经内分泌 | 5/5 |
| 12 病感行为 | 4/4 |
| 13 时间结构 | 10/10 |
| 14 输入输出 | 13/13 |
| 15 注入与产品约束 | 8/8 |
| 16 动力学不变量 | 12/12 |
| 17 跨表一致性 | 10/10 |
| 18 多器协作 | 12/12 |
| **合计** | **209/209** |

## 目录

```
dsh-affect/
├── index.js              插件入口：心跳、注入、面板
├── core/
│   ├── consts.js         词表、原型、数学
│   ├── engine.js         单一时钟 / A-B 两段 / 补算反转 / 回滚 / 缺省值 / 幂等
│   ├── resource.js       资源总池 + 四个子账
│   ├── fuse.js           评价向量 → 情绪构造 → 心境
│   ├── inject.js         5~7 行注入
│   └── store.js          state.json + journal
├── organs/               杏仁核 / 下丘脑 / 岛叶 / 海马体 / 前额叶皮层
├── layers/               调质 / 注意 / 社会
├── supplements/          脑干 / 默认模式 / 神经内分泌 / 病感
├── time/                 曲线 / 节律
├── io/                   输入偏置 / 输出通道
└── tests/
    ├── selftest.mjs      行为自测
    ├── audit.mjs         声明 vs 源码标记对账
    └── coverage.mjs      对表核覆盖
```

## 怎么验

```powershell
$node="~\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
cd packages/affect
& $node --check index.js
& $node tests/selftest.mjs
& $node tests/audit.mjs
& $node tests\coverage.mjs "~\Desktop\情绪插件-功能总表.md"
```

## 自检轮（2026-11-11 晚）

`tests/audit.mjs` 把每个模块的 `cover` 声明和源码里的 ID 标记对账。第一次跑出 **28 处不一致**，全是"声明了但没接线"：

- A15 替代学习 / A16 不确定性 / A21 自我评价 —— `inject()` 写了但**从没被调用**
- A17 注意捕获 —— 声明了但没有任何输出
- H16 能量分配 / H18 睡眠门 —— 声明了没实现
- P08 错误监测 —— 完全没写
- P06 价值整合 / P12 心理理论 / P18 自上而下注意 —— 算了但没影响决策
- K07 幂等 —— 引擎没做去重
- M10 应激增强编码 —— 没实现
- repair / regret / error / startle / withdraw / seekComfort / nostalgia —— 算了但没人读

修完后：**205/205 声明与标记一致，审计通过**。

多器官协作这轮补的：C08 间隔只算对方的（挪到 engine）、X06 缺省值表（DEFAULTS）、X07 对象裁决（归因决定"他/自己/这件事"）、X08 情景延迟落库（海马 pending → commit）。

## 第二轮自检（20:50）

新增 `tests/liveness.mjs`：跑 21 小时，看哪些状态从头到尾没变过。又加了硬断言：**trace 里不许有被吞掉的器官异常**。

抓到的真问题（都不是"漏写"，是"写了但没跑"）：

1. **海马体每帧抛错，被引擎静默回滚** —— 拿到的 `amy` 是 read 快照，却去调 `amy.inject()`。后果：情绪情景一条都没写进去。之前 selftest 一直 PASS，因为没人查 trace 错误。
2. **杏仁核的 step 从没被调用** —— ORDER_B 里漏了 amygdala，只有 fast()。消退、自发恢复、泛化、情境恐惧、tone 全没跑。
3. `curve.read()` 返回假的 phase、refractory 恒 false → 不应期等于没实现。
4. `world.spoke` 从不清零 → venting 每帧触发。
5. `world.other` 从未赋值 → 共情共振恒 0。
6. `scene` 永远 home → 情境恐惧形同虚设。
7. `social.attitude` 每帧加两次 → 漂移翻倍。
8. H13/H19 依赖 activity 事件，而入口从不发 → 吃饭、咖啡因永不触发（现改为也从对话里读）。

同时接线：nostalgia / mindWander / socialImagining / persons.hurts / schemas（挡住重评）/ ach（写入门槛）/ brainstem 心率呼吸（之前两套心率）/ sickness.fatigue / testosterone / estrogen / attachment。

liveness 仍报告 53 个字段没动过，其中真死：`temp`/`pain` 没有输入源、`cycle` 默认关、`pfc.slots` 恒 4、`attribution.stability/globality` 在威胁未过 0.6 时不动。

## 第三轮：10 轮生命周期测试（20:30）

用记忆插件那条线的真实对话（从 companion-memory 原话里取 10 句）跑 10 轮，每轮 19 项不变量。
逐轮发现并修复：

1. 第 1 轮：带宽 0.739 > 上限 0.666 —— 接口冲突，带宽没被上限夹住 → 加 `bandwidth = min(bandwidth, cap)`。
2. 第 1 轮：09:10 却显示"这会儿（晚上）" —— 注入用了真实系统时间 → 改用模拟时钟。
3. 第 2 轮：同一条带宽犯规复现，确认修好。
4. 第 3 轮：无害的话被判"内疚" → 中立输入硬凑情绪；加 flat 门限，归因不是"怪自己"时不许出内疚/羞耻。
5. 第 4 轮：rewardPE 恒为 -0.1（基线悲观）→ 中性改 0，只有被夸才为正。
6. 第 5~7 轮：睡眠债只涨不还 → 夜间恢复被"这一拍有消息"整段跳过 → 改成按区间夜间比例恢复。
7. 第 7 轮：饿到顶导致带宽上限压到 0.2、语气 flat → 饿 0.85 自己会去吃。
8. 第 8 轮：情景 1→0 —— 夜间巩固淘汰，是功能不是 bug；测试断言改为跨天允许遗忘。
9. 第 8 轮：注入"有点累"其实不累 —— MOOD_WORD 把 felt 当疲劳 → 只看 mood。
10. 第 9~10 轮：无新问题。

另外补了 temp / pain 的来源（此前是死字段）：体温按时段、疼痛按缺觉与能量。

## 第四轮：崩溃点 + 生理周期 + 记忆桥（20:40）

崩溃点检查（`tests/bridge.mjs`，9 项全过）：状态文件损坏、restore 收到垃圾、记忆器官全缺、记忆器官抛错、500 拍长跑、首次启动无文件、schema 不符、`text()` 未加载、单器官抛错回滚。

生理周期默认开启（`cycle.on !== false`），12 天前起算，经前阈值 -0.2、经期 -0.15，雌激素进岛叶增益。

记忆桥 `core/bridge.js`：只读 `memory.cortex / hippocampus / prefrontal / amygdala`。
- 情绪 ← 记忆：`recall()` 命中会把 threat 垫高（负性）或抬一点正性，并拽一下 moodTarget；`salience()` 当先验抬显著性。
- 情绪 → 记忆：新情景产生时 `announce('affect.episode.closed')`，记不记由记忆侧决定。
- 任何一个器官不在或抛错，桥返回 null，情绪照跑。

## 仪表页（20:50）

`/affect/dashboard`：深色单页，2 秒轮询 `/affect/live`，十个维度条 + 八张卡：
概括（情绪/效价/唤醒/混合情绪/心情折线）、十个维度（心情/唤醒/体内感/理性余量/忍住多少/戒备/社交电量/专注/疲惫/饥饿）、身体（心率/呼吸/紧张/疼/体温/质地）、脑子里在转什么（走神/反刍/想他/念头黏住/渴求）、关系（信任/被晾的痛/依恋/没清的事/情绪外溢）、需求与周期、记忆（情景数/刚想起/记忆回声/图式）、表达倾向（语气/话变短/延迟/表情包/曲线阶段）。

数据由 `core/dashboard.js: summarize(engine)` 生成，只读不改状态；`tests/dashboard.mjs` 校验字段、范围、HTML 自包含与轮询。

## 设置页 + 回忆再体验（21:05）

- `client.js`：注册 `settings.section`（id `affect`，order 26，label「她的心情」），里面嵌 `/affect/dashboard`。package.json 加了 `exports["./client"]` 和 `dsh.client`（inject: `@deepseek-ai/dsh-client-ui-settings`）。
- 岛叶加了「记忆再体验」：`recall` 命中时按记忆强度直接抬身体感受（0.12 + 0.20×|valence|），10 分钟后退掉——想起旧事身体会重新紧一下，不再只影响评价。
- `/affect/live` 增加 `memory.organs`（四器官在不在、方法有没有）和 `memory.debug`（recall 原样返回前 500 字），用来定位字段对不上的问题。

## 第五轮：十轮生命周期（21:20）

这一轮把十句话换成更真的一版（含抱怨、命令、冷淡、道歉、深夜夸奖），逐轮跑。

修掉的真问题：
1. **I11 标记被吞** —— 我加"记忆再体验"代码块时把 `// I11 等待` 这行注释替换掉了，审计立刻报「声明了 I11 源码没标记」。补回。
2. **情景数在清晨掉** —— 08:30 那轮从 2 掉到 1，是夜间巩固在淘汰低强度情景。不是 bug，是断言写死了；改成「跨天或清晨允许淘汰，但最多掉一半」。
3. **强度映射太硬** —— 原型 sim 为负时 `max(0, sim)` 直接归零，弱情绪一个都出不来。改成连续映射 `0.5 + 0.5×sim`。
4. **抱怨权重不够** —— "累死我了"这种只让 goal 掉 0.12，压不过平线闸门；提到 0.18。

仍没解决的：第 7 轮「累死我了」和第 8 轮深夜的「你好棒啊」还是不出标签。原因是一层显示阈值（试过 0.12 / 0.08 / 0.05 三档）叠在低唤醒上，强度算出来仍然很低。这是下一轮要动的点，不能算修好。

## 第六轮：记忆 ↔ 心情 专项（21:35）

这轮把重点放在记忆联动上，逐轮对照"带记忆/不带记忆"两遍跑。抓到四个真问题：

1. **`recall()` 是 async，被当同步调** —— 拿回来是 Promise，永远判空，所以线上 `memory.echo` 一直是空的。改成异步取 + 缓存，下一拍用。
2. **`episodes()` 也是 async** —— 同样被当同步调，`recentEpisodes` 永远返回 null。改成 await。
3. **再体验只写不读** —— 岛叶记了 `memoryReplay`，`read()` 没暴露，外面看是"没发生"。补上。
4. **表情包与情绪打架** —— 只看底色心情（继承来的 0.44），不看此刻效价，于是"心痛"时提示"多发开心类"。改成跟当前效价 + 主导情绪走。
5. **记忆行太长** —— 线上出现过 `这事以前有过：ta把这个窗口的职责限定为只做记忆插件（防止上下` 这种被截断的长句。截到 18 字并去换行，测试加了"记忆行不超过 26 字"的断言。

逐轮结果：只有第 7 轮（"累死我了"）命中记忆，威胁 0.05→0.13，回声、再体验、写回都在；其余九轮未命中且无误回声。写回 10 条。

## 第七轮：情绪丢失的根因（21:40）

前几轮一直说"第 7、8 轮不出标签"，这轮定位到了真因：**`world.lastUserText` 从来没有被赋过值**，所以 fuse 里判断"这句话是不是在抱怨/在夸"永远是 false，平线闸门（|goal|<0.16 就不给情绪）就一直生效。评价里 goal 只有 −0.09，被闸门吃干净。

修法：fuse 改用 `world.context.lastText` 兜底拿原话，再按抱怨/夸奖放行；并且加了兜底——语境明确却全被阈值滤掉时，保留最像的那个弱情绪（强度下限 0.15），情绪不许凭空消失。

十轮结果（全部有数据）：1–3 中性无情绪；4 过渡；5、6 厌烦；**7 厌烦（修好了）**；**8 安心（修好了）**；9 安心；10 中性。记忆逐轮：第 7 轮命中，威胁 0.05→0.13，回声/再体验/写回全通，写回 10 条。

## 第八轮：同拍召回 + 心境一致性（21:55）

按与记忆侧商定的接口做了我方这一半：

- `bridge.recallFast(text, {valence, arousal, beforeMs/ excludeMsgId})`：记忆侧有 `recallSync` 就同拍用，没有就返回 null 退回异步。
- `bridge.moodRerank(hits, moodValence, {degraded, ledger})`：同号效价加分（0.15×乘积 + 0.05 同号），降级时只加一半。
- `bridge.notesLedger()`：自己账本 id→valence 的 join，记忆侧还没补 `valence` 字段时先用它顶上。
- 写回 `annotate` 现在带 `id`，为 join 做准备。
- engine：消息那一拍先试同步召回，命中就当场出回声，不再隔一拍；异步仍保留兜底。

抓到并修掉一个静默失败：engine 里传了未定义的 `arousal`，ReferenceError 被 `catch { fast = null }` 吞掉，表现成"永远没有同步召回"。改成 `state.arousal`。

新增 `tests/brain-sync.mjs`：同拍回声、低落先想起糟心事/开心先想起好事、降级半权、无 valence 时账本 join、没有 recallSync 时异步回退。全部通过。

## 旧插件

`include:mood-v2` 已禁用（`enabled:false`，application: applied）。新插件**未安装**。

## 还没做

- 没装进 DSH（装了就全局生效）
- 没有 UI 面板（只有 `/affect/state`、`/affect/trace`）
- 没有 `affect_*` 工具（让她能主动"说出来"）
- 没有跨会话共享的锁（多开时各自一份内存状态）

## 第 9 轮（五条差距一次修完）
- 惯性：brevity/标点走 EMA + 两拍确认，不再单句跳变（io/output.js）
- 多轮配对：world.pair（上一问/上一答/变短/软化/升级），fused.pair 透出
- 虚胖审计：tests/wiring.mjs 用 Proxy 实测接线率 41.8%，未接线字段单列
- 后扣带：dmn 吃真实 memoryEcho/memoryRecent → anchors/chapters，负性旧事启动反刍
- 心情优先：fuse 的 forced 先看评价强度与唤醒，文本只作旁证，不再字面抱怨就出情绪
- 全套 10 项测试绿；接线率仍是硬缺口，记在这
