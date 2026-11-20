# 回滚手册

三条逃生通道，按"影响面从小到大"排。

---

## 1. 只想改注入开关（不用碰代码，不用重装）

编辑 `config.json`：

```json
{
  "inject": {
    "hippocampus": true,
    "cortex": false,
    "prefrontal": false
  }
}
```

| 值 | 含义 |
|---|---|
| `true` | 该器官往 system prompt 里注入内容 |
| `false` | 不注入，器官退化成纯资料库（工具照常可用） |

改完**重启生效**。

**想恢复改动前的样子**（三个都注入）：

```json
{ "inject": { "hippocampus": true, "cortex": true, "prefrontal": true } }
```

**想彻底关掉所有注入**：

```json
{ "inject": { "hippocampus": false, "cortex": false, "prefrontal": false } }
```

**配置文件读不到或写坏了会怎样**：自动按"全开"处理，等于改动前的行为，不会崩。

---

## 2. 想回退这次注入开关的代码改动

备份目录：

```
packages/memory.bak-before-inject-20261110-060248
```

只回退三个内核文件：

```powershell
Copy-Item "packages/memory.bak-before-inject-20261110-060248\organs\cortex\index.js" `
          "packages/memory\organs\cortex\index.js" -Force
Copy-Item "packages/memory.bak-before-inject-20261110-060248\organs\prefrontal\index.js" `
          "packages/memory\organs\prefrontal\index.js" -Force
Copy-Item "packages/memory.bak-before-inject-20261110-060248\organs\hippocampus\index.js" `
          "packages/memory\organs\hippocampus\index.js" -Force
```

或者整个目录盖回去（注意别把 `organs\hippocampus\node_modules` 这个 junction 冲掉，
它是向量模型依赖，丢了会退化成纯 BM25，但不崩）：

```powershell
robocopy "packages/memory.bak-before-inject-20261110-060248" "packages/memory" /E /XD node_modules
```

---

## 3. 想彻底放弃合并，回到四个独立插件

profile 备份：

```
<DSH_HOME>/profiles/desktop\package.json.bak-before-dsh-all-20261110-055609
```

恢复步骤：

```powershell
# 1. 盖回 profile 配置
Copy-Item "<DSH_HOME>/profiles/desktop\package.json.bak-before-dsh-all-20261110-055609" `
          "<DSH_HOME>/profiles/desktop\package.json" -Force

# 2. 删掉 dsh-all 的 junction（不然还挂着）
Remove-Item "<DSH_HOME>/profiles/desktop\node_modules\dsh-all" -Force

# 3. 重启 DSH
```

四个器官的 `link:` 依赖和 junction 都还在原来的位置（`@local/hippocampus` 等），
所以恢复后能直接跑，数据也没动过。

---

## 数据安全

这次改动**没有碰任何数据**：

- `~/.dsh/hippocampus/` —— 原样
- `~/.dsh/cortex/` —— 原样
- `~/.dsh/prefrontal/` —— 原样
- `~/.dsh/amygdala/` —— 原样

注入开关只影响"往 system prompt 写不写"，不影响存储和检索。
所以不管怎么来回切，记忆都还在。

---

## 快速自检

重启后如果怀疑哪里不对，跑这个：

```powershell
cd <DSH_HOME>/profiles/desktop
node packages/memory\tests\smoke.mjs
```

正常输出应该包含：

```
"ok": true,
"tools": 33,
"services": [ 5 个 memory.* ],
"systemPromptBlocks": [ 跟 config.json 里 true 的那几个对应 ]
```

如果 `ok` 是 `false`，看 `error` 字段；如果是某个器官挂了，`brain.failed` 里会写哪个。
