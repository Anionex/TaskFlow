import fs from 'node:fs'; import path from 'node:path'
// Fetch the real TaskFlow brand fonts locally for a deterministic render.
// Latin fonts: full. CJK fonts (Noto Serif/Sans SC): subset to exactly the glyphs we overlay.
const OUT = path.resolve('assets/fonts'); fs.mkdirSync(OUT, { recursive: true })
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'

// Derive the exact glyph set from index.html so subsets always cover every
// character we actually render (native UI recreations + overlays + JS-typed strings).
const html = fs.readFileSync(path.resolve('index.html'), 'utf8')
const baseLatin = ' 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,:—→…·、，。：（）%✦✓✕★'
const chars = [...new Set([...html, ...baseLatin])]
  .filter(c => { const cp = c.codePointAt(0); return cp >= 0x2000 || /[0-9A-Za-z .,:%]/.test(c) })
  .join('')

const JOBS = [
  { fam: 'Hanken Grotesk', css: 'Hanken+Grotesk:wght@400;500;600;700', file: 'hanken', subset: false },
  { fam: 'Source Serif 4', css: 'Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600', file: 'sourceserif', subset: false },
  { fam: 'IBM Plex Mono', css: 'IBM+Plex+Mono:wght@400;500;600', file: 'plexmono', subset: false },
  { fam: 'Noto Serif SC', css: 'Noto+Serif+SC:wght@500;600;700', file: 'notoserifsc', subset: true },
  { fam: 'Noto Sans SC', css: 'Noto+Sans+SC:wght@400;500;700', file: 'notosanssc', subset: true },
]

let cssOut = '/* TaskFlow brand fonts — bundled locally for deterministic render */\n'
for (const job of JOBS) {
  let url = `https://fonts.googleapis.com/css2?family=${job.css}&display=swap`
  if (job.subset) url += `&text=${encodeURIComponent(chars)}`
  const css = await (await fetch(url, { headers: { 'User-Agent': UA } })).text()
  // parse each @font-face: capture font-weight + woff2 url
  const faces = css.split('@font-face').slice(1)
  let idx = 0
  for (const face of faces) {
    const w = (face.match(/font-weight:\s*(\d+)/) || [])[1] || '400'
    const style = /italic/.test(face) ? 'italic' : 'normal'
    if (style === 'italic') continue
    const m = face.match(/src:\s*url\(([^)]+)\)\s*format\(['"]woff2['"]\)/)
    if (!m) continue
    const woffUrl = m[1].replace(/['"]/g, '')
    const ur = (face.match(/unicode-range:\s*([^;}]+)/) || [])[1]
    const buf = Buffer.from(await (await fetch(woffUrl, { headers: { 'User-Agent': UA } })).arrayBuffer())
    const fname = `${job.file}-${w}${job.subset ? '-sub' : ''}-${idx}.woff2`
    fs.writeFileSync(path.join(OUT, fname), buf)
    cssOut += `@font-face{font-family:"${job.fam}";font-style:normal;font-weight:${w};font-display:block;src:url("./${fname}") format("woff2");${ur ? `unicode-range:${ur.trim()};` : ''}}\n`
    idx++
    console.log('·', job.fam, w, (buf.length/1024).toFixed(0)+'KB', fname)
  }
}
fs.writeFileSync(path.join(OUT, 'fonts.css'), cssOut)
console.log('DONE — fonts.css with', cssOut.split('@font-face').length - 1, 'faces')
