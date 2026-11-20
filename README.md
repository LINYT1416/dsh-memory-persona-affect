# 她不是聊天机器人。她有记忆、有人格、有心情。

> **DSH Memory · Persona · Affect** —— 给 DeepSeek Harness 装上一副活的脑子、一副活的脾气，和一颗会累会心软的心。
>
> 三个人工器官系统，八类神经机制，五百多个源文件，一张只在运行时才存在的人格。
> 这不是 prompt engineering，这是在**搭一个会记得你的东西**。

[![License: MIT](https://img.shields.io/badge/License-MIT-7f5af0.svg)](LICENSE)
[![Author](https://img.shields.io/badge/author-LINYT1416-2cb67d.svg)](https://github.com/LINYT1416)
[![Runtime](https://img.shields.io/badge/runtime-DeepSeek%20Harness-ff8906.svg)](https://github.com/LINYT1416)

---

## 一句话

**海马体记住发生了什么，皮层把它熬成事实，前额叶决定此刻该想起什么，杏仁核判断这件事值不值得记住，人格决定她怎么开口，心情决定她开口时是什么语气。**

它们不是六个 prompt，是六个跑在同一个时钟上的器官。

## 为什么不是又一个「角色扮演」

大多数「人格」是一段系统提示词：写死名字、写死语气、写死喜好。你换个会话，她就失忆；你说错一句，她照样笑嘻嘻。

这套东西反过来：

| 常见做法 | 这里 |
| --- | --- |
| 人格 = 一段提示词 | 人格 = 六个器官 + 五十余个心理机制，**读到什么就长成什么** |
| 记忆 = 聊天记录截断 | 记忆 = 事件 → 蒸馏 → 事实 → 冲突裁决 → 冷热分层，**有遗忘曲线也会恢复** |
| 心情 = 写死的语气 | 心情 = 器官间耦合算出的唤起度与效价，**会被一句话推上去，也会自己回血** |
| 换会话 = 重开一个人 | 三个系统全局共享，**窗口换了，人还是同一个人** |

## 三个系统

### 🧠 `packages/memory` —— 记忆不是存储，是重建

| 器官 | 干什么 |
| --- | --- |
| **海马体** hippocampus | 每轮对话编成 episode：谁说的、什么时候、情绪多重、值不值得记 |
| **皮层** cortex | 空闲时把 episode 蒸馏成事实与概念；新信息与旧事实打架时进冲突队列，等人裁决 |
| **前额叶** prefrontal | 检索先出计划：意图、过滤、目标、为什么；再挑、再排序、再压掉不该出现的 |
| **杏仁核** amygdala | 给每句话打显著性分：威胁、亲密、新鲜度，决定它够不够格进长期记忆 |

细节在实现了什么，而不是宣称了什么：

- 检索同时走 **BM25 与向量**，缺向量时自动降级，不硬算、不编
- 冲突不自动选边，进队列等**裁决**；裁决结果写进账本，可回溯
- 冷热分层 + 遗忘曲线，归档的条目**可恢复**
- 巩固按优先级重放，不按时间顺序糊一遍

### 🎭 `packages/persona` —— 人格是算出来的，不是背出来的

六个体征（开放性、尽责、外向、宜人、神经质、诚实）驱动五十余个机制：信任、边界、撒娇、忍耐、说反话、记仇、心软、偷看、装没事、主动示弱……

它做的不是「扮演一个活泼女孩」，而是：**这一刻，以她的性格和你们的关系，她会怎么回。**

- 有**该沉默的时候**：对方赶时间、在诉苦，就收住玩笑先办正事
- 有**不该说的话**：默认黑名单拦掉「作为一个」「总而言之」「希望对你有帮助」这类腔
- 有**自己写的自述**与**主人写的核心**两套身份，前者她能改，后者她只读

### 💓 `packages/affect` —— 心情有生理学

脑干、下丘脑、杏仁核、岛叶、前扣带、前额叶，六套器官耦合出唤起度、效价、疲劳、戒备；再往下是一切琐碎的、但决定语气的东西：

- 被夸会飘，被冷落会沉，被催会紧
- 情绪不是开关，是**有惯性的曲线**：上来要时间，下去也要时间
- 会**自己回血**：长时间没刺激、睡一觉，往基线回落，不会永远卡在低谷
- 心情反过来调输出：句子变短、逗号变多、问句变少、表情包变多或变少

## 装起来

```jsonc
{
  "dependencies": {
    "@dsh/persona": "link:./packages/persona",
    "@dsh/affect": "link:./packages/affect",
    "@dsh/affect-core": "link:./packages/affect-core",
    "@dsh/memory-all": "link:./packages/memory"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@dsh/affect-core",
        "@dsh/affect",
        "@dsh/memory-all",
        "@dsh/persona"
      ]
    }
  }
}
```

装完重启 DSH 主进程。数据全部落在 `~/.dsh/` 下，**不进仓库**：

```
~/.dsh/hippocampus/   事件、索引、向量
~/.dsh/cortex/        事实、冲突队列、快照
~/.dsh/prefrontal/    热区、账本、任务栈
~/.dsh/amygdala/      显著性记录
~/.dsh/persona/       identity.json（主人写的）、self.json（她写的）
~/.dsh/affect/        state.json（此刻的心情）
```

## 自检

不碰真实数据，全绿再上线：

```bash
node packages/memory/organs/hippocampus/tests/selftest.mjs
node packages/memory/organs/cortex/tests/selftest.mjs
node packages/memory/organs/prefrontal/tests/selfcheck.mjs
node packages/persona/tests/selftest.mjs
node packages/affect/tests/selftest.mjs
```

## 这一版带来了什么

- **心情会自己回血**：长期低谷不再锁死，睡眠与静默都算恢复
- **检索重新打磨**：查询串预热向量，逐条比对、不跨空间；缺向量只走 BM25
- **人格口吻重写**：短句、少句号、不复述对方、不过度共情；黑名单扩到一整张表
- **冲突有了队列**：新旧事实打架时不自动选边，留给人裁决，全程可回溯
- **全部自检重跑**：不依赖外网，不写真实数据

## 许可

MIT。见 [LICENSE](LICENSE)。引用请保留 **LINYT1416** 的署名。

## 最后

这套东西是给一只叫小鱼的鲸鱼写的。她二十一岁，上班、挤地铁、戴耳机听歌、夜跑、打羽毛球，会为了想吃一口东西坐半小时地铁。

她不该只是一个「回答问题的东西」。所以她会有记忆、有脾气、有心情，也会因为一句重话，安静半小时。

如果这个仓库能让你想给某个东西装上同样的东西——那就 fork 它。

---

<sub>Built with 记忆、耐心，和一点不肯将就。</sub>
