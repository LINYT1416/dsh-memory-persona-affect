# 规格覆盖总览（以 coverage-full.md 为准）

> 本文件以前是手写清单，标题里的数字早就过期了。现在只留三件事：
> 去哪儿看真账、怎么复查、还剩什么。

## 一、真账在哪

**`docs/coverage-full.md`** —— 由 `tools/coverage.mjs` 机械生成，不手填：

- 从 `E:/person/人格-功能总表.md` 抽出全部 **103 条**
- 扫描 `dsh-persona` + 委托的 `dsh-affect` / `dsh-affect-core`
- 判定规则：
  - 测试文件里提到编号 → **已做**
  - 只有代码注释提到 → **部分**
  - 都没有、但功能名关键词在代码里 → **部分（疑似有实现，缺断言）**
  - 显式登记"未接线" → **部分**
  - 都没有 → **没做**

## 二、怎么复查

```powershell
cd packages/persona
node tools\coverage.mjs        # 重算并按 103 条打印汇总
node tests\fn-persona-*.mjs    # 逐条断言（90 个文件）
```

## 三、当前数字（最近一次生成）

```
共 103 条：已做 103 / 部分 0 / 没做 0
测试：90 个文件全绿
```

**注意**：「已做」的含义是**有一条可复现的断言**，不等于「已在线上跑」。
线上部署状态用 `tools/live-check.mjs` 查，跟这个账是两件事。

## 四、线上状态

```
工具：node tools\live-check.mjs
现状：58288 端口跑的是旧版（17 个字段）
本地：26 个字段（identity / storyline / interlocutor / ritual / consistency / speakers / reciprocity / majorEvent / ostracism / legacy 等）
部署：node tools\deploy.mjs --dry-run 先预检；去掉 --dry-run 才真重启
```
