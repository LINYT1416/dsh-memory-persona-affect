// 从本地表情库（index.db）里挑一张对得上情绪的图，直接给出可原样带上的标记。
// 目的：注入里不只有"去调 send_meme"这一步，还给出成品行，模型抄一行就能发出去。
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const DIR = 'C:/Users/64091/.dsh/meme-packs'
let cache = null

function load() {
  if (cache) return cache
  const byTag = {}
  try {
    for (const pack of fs.readdirSync(DIR)) {
      const db = `${DIR}/${pack}/index.db`
      if (!fs.existsSync(db)) continue
      try {
        const d = new DatabaseSync(db, { readOnly: true })
        for (const r of d.prepare('SELECT tag, caption FROM memes WHERE caption IS NOT NULL AND caption <> \'\'').all()) {
          const t = String(r.tag || '').trim()
          const c = String(r.caption || '').trim()
          if (!t || !c) continue
          ;(byTag[t] ||= []).push(c)
        }
        d.close()
      } catch { /* 单个库坏了不影响别的 */ }
    }
  } catch { /* 没装图库就返回空 */ }
  cache = byTag
  return byTag
}

export function readyMeme(emotion) {
  const byTag = load()
  const list = byTag[emotion] || []
  if (!list.length) return ''
  const pick = list[Math.floor(Math.random() * list.length)]
  return `[表情: ${pick}]`
}
