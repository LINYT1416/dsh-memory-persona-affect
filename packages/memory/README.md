# dsh-all

四器官记忆系统的**合并版**：海马体 + 大脑皮层 + 前额叶 + 杏仁核，一个入口启动。

> 这是外壳合并，不是重写。四个器官的内核原封不动，放在 `organs/` 下。

## 为什么要合并

分开装的时候，四个插件之间靠 `ctx.get('memory.xxx')` 互相探测，还要担心启动顺序——
海马体启动时如果另外三个还没起来，它就得开个定时器反复重试。

合并后：

- 启动顺序由外壳固定（皮层 → 杏仁核 → 前额叶 → 海马体），一上来就能互相看见
- 一个 `apply`、一套清理函数，卸载时不会漏
- 多一个 `memory.brain` 服务，能查四个器官的加载状态
- 对外只有一个包

## 目录

```
dsh-all/
├── index.js            外壳：按顺序启动四个器官
├── package.json
├── cordis.patch.yml
├── organs/
│   ├── cortex/         皮层内核（原封不动）
│   ├── amygdala/       杏仁核内核
│   ├── prefrontal/     前额叶内核
│   └── hippocampus/    海马体内核
└── tests/
    └── smoke.mjs       冒烟：验证四个器官都能 apply、工具都注册
```

## 冒烟测试

```bash
node tests/smoke.mjs
```

期望输出：

```
applyOk: true
toolsRegistered: 33
services: memory.cortex, memory.amygdala, memory.prefrontal, memory.hippocampus, memory.brain
```

## 安装

在 profile 的 `package.json` 里：

```json
{
  "dependencies": {
    "dsh-all": "link:E:/memory/dsh-all"
  },
  "dsh": {
    "profile": {
      "bundles": ["dsh-all"]
    }
  }
}
```

**同时要把 `@local/hippocampus`、`@local/cortex`、`@local/prefrontal`、`@local/amygdala`
从 bundles 里去掉**，否则同一套器官会被注册两次，工具名会撞。

然后重启 DSH。

## 数据

数据目录不变，还是四个：

```
~/.dsh/hippocampus/
~/.dsh/cortex/
~/.dsh/prefrontal/
~/.dsh/amygdala/
```

所以切换过来不用迁移，原来的记忆直接能用。

## 工具

33 个工具名也不变：

| 前缀 | 数量 |
|---|---|
| `hippocampus_*` | 8 |
| `cortex_*` | 11 |
| `prefrontal_*` | 10 |
| `amygdala_*` | 4 |

外加服务 `memory.brain`（查加载状态）。

## 后续可以做的

外壳合并之后，如果想继续，下一步是**内核直连**：
把器官之间的 `ctx.get` 换成直接对象引用，省掉服务查找和探针重试。

再往后才是真正的深度合并（共享存储层、统一调度器）——但那要重写，收益不如前两步明显。

## 协议

MIT（与 four-memory 一致）
