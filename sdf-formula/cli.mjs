#!/usr/bin/env node
// A ShadyTracer scene as its SDF, written out: node sdf-formula/cli.mjs scene.json [options]  (--help for them)
import { readFileSync, writeFileSync } from 'node:fs'
import { sceneToSDF } from './src/scene.js'
import { toText, toJS, toGLSL, compile } from './src/emit.js'

const HELP = `node cli.mjs <scene.json> [options]

  The scene's signed distance f(x, y, z) as a formula: geometry only -- no lights, materials or textures.

  --format text|js|glsl   what to write (default text)
  --inline                one expression, no named parts (can be very long)
  --digits N              significant digits of the numbers (text 6, js 15, glsl 9)
  --skip-unsupported      leave out what the formula cannot hold (a path, noise) instead of stopping
  --no-planes             leave out infinite planes (a floor)
  --exclude a,b           leave out these nodes, by label or id
  --at x,y,z              also print f at this point
  -o FILE                 write to FILE instead of the terminal`

const args = process.argv.slice(2)
if (!args.length || args.includes('--help') || args.includes('-h')) { console.log(HELP); process.exit(args.length ? 0 : 1) }
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt }
const file = args.find((a, i) => !a.startsWith('-') && !['--format', '--digits', '--exclude', '--at', '-o'].includes(args[i - 1]))
if (!file) { console.error('no scene file given'); process.exit(1) }

let doc
try { doc = JSON.parse(readFileSync(file, 'utf8')) } catch (e) { console.error(`${file}: ${e.message}`); process.exit(1) }
let r
try {
    r = sceneToSDF(doc, {
        skipUnsupported: args.includes('--skip-unsupported'),
        planes: !args.includes('--no-planes'),
        exclude: (opt('--exclude', '') || '').split(',').map(s => s.trim()).filter(Boolean),
    })
} catch (e) {
    console.error(`${file}: ${e.message}`)
    if (!args.includes('--skip-unsupported')) console.error('(--skip-unsupported leaves such a node out and writes the rest)')
    process.exit(2)
}

const fmt = opt('--format', 'text'), digits = opt('--digits') ? +opt('--digits') : undefined
const o = { labels: r.labels, inline: args.includes('--inline'), digits }
const writers = { text: toText, js: toJS, glsl: toGLSL }
if (!writers[fmt]) { console.error(`--format ${fmt}: text, js or glsl`); process.exit(1) }
const c = fmt === 'text' ? '#' : '//'
const head = [`${c} ${r.title || file}: the signed distance, in ${r.unit}${fmt === 'text' ? ', at the point (x, y, z)' : ''}`,
              ...r.warnings.map(w => `${c} note: ${w}`), ...r.skipped.map(s => `${c} not in it: ${s}`)].join('\n')
const out = `${head}\n${writers[fmt](r.d, o)}`
if (opt('-o')) writeFileSync(opt('-o'), out)
else process.stdout.write(out)
if (opt('--at')) {
    const p = opt('--at').split(',').map(Number)
    console.error(`f(${p.join(', ')}) = ${compile(r.d, o)(...p)}`)
}
for (const w of r.warnings) console.error(`note: ${w}`)
