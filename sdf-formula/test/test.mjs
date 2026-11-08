// node sdf-formula/test/test.mjs [path to a ShadyTracer checkout]
//
// WHAT HOLDS THE FORMULA TO SHADYTRACER. Without a GPU, against ShadyTracer's own JavaScript twins of its shader:
//   1. the library's shapes, run by the interpreter as symbols and compiled, against core/shapes.js's JS mirror (and
//      closed forms for sdf.js's, which has none) at random points, every parameter random too;
//   2. the joins (scene_api.js csgRound* / csgChamfer*) against builder/joins.js;
//   3. a node's transform against builder/transform.js matrixOf;
//   4. every example scene (scenes/*.json): converted, and the formula -- as JS, compiled -- equal to the same scene
//      evaluated with the point as numbers (every step folded: the simplifier checked), and, where import/test/docsdf.mjs
//      can read the scene (its shapes; no smooth blends), equal to ShadyTracer's own document distance wherever that
//      is outside everything (inside an overlap docsdf folds by the nearest surface, the formula takes the union);
//   5. the emitters: text, JS and GLSL written for each, the inline form where it fits.
// The ShadyTracer checkout is the argument, $SHADYTRACER, or ../../ShadyTracer beside this repository.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as X from '../src/expr.js'
import { Program, Interp, vec } from '../src/interp.js'
import { PRELUDE } from '../src/prelude.js'
import { sceneToSDF, xfPoint } from '../src/scene.js'
import { compile, toText, toJS, toGLSL } from '../src/emit.js'

const here = dirname(fileURLToPath(import.meta.url))
const ST = resolve(process.argv[2] || process.env.SHADYTRACER || resolve(here, '../../../ShadyTracer'))
if (!existsSync(resolve(ST, 'lib/pathtracer/core/shapes.js'))) {
    console.log(`no ShadyTracer checkout at ${ST}: give its path as the argument`)
    process.exit(1)
}
const imp = p => import(pathToFileURL(resolve(ST, p)).href)
const S = await imp('lib/pathtracer/core/shapes.js')
const J = await imp('builder/joins.js')
const { matrixOf } = await imp('builder/transform.js')

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
let rng = 0x2545f491
const rnd = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296 }
const U = (a, b) => a + (b - a) * rnd()
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b))

const prog = new Program(PRELUDE)
const I = new Interp(prog)
const P = vec([X.X, X.Y, X.Z])
/* a library function's distance as a compiled formula of (x, y, z), its other arguments numbers */
const formula = (fn, args) => { const d = I.call(fn, [P, ...args]).c.at(-1); return compile(d) }
const v = a => vec(a)

// ---- 1. THE SHAPES ----
const SHAPES = [
    ['Ntorus', () => [U(0.2, 1), U(0.02, 0.3)], a => a],
    ['NroundCone', () => [U(0, 0.5), U(0, 0.5), U(0.05, 1.5)], a => a],
    ['Noctahedron', () => [U(0.05, 1)], a => a],
    ['Npyramid', () => [U(0.1, 1.5), U(0.1, 1.5)], a => a],
    ['Nfrustum', () => [[U(0.1, 1.5), U(0.1, 1.5)], [U(0, 1), U(0, 1)], U(0.1, 1.5)], a => [v(a[0]), v(a[1]), a[2]]],
    ['Nprism', () => [Math.floor(U(3, 9)), U(0.1, 1), U(0.1, 1.5)], a => a],
    ['Ntriprism', () => [U(0.1, 1.5), U(0.1, 1.5), U(-0.3, 1.3), U(0.1, 1)], a => a],
    ['NcappedTorus', () => [U(0.2, 1), U(0.02, 0.2), U(10, 360)], a => a],
    ['Nlink', () => [U(0, 1), U(0.1, 0.5), U(0.02, 0.15)], a => a],
    ['Ndome', () => [U(0.1, 1), U(0.05, 1.8)], a => a],
    ['Ntube', () => [U(0.2, 1), U(-0.1, 0.8), U(0.1, 1.5)], a => a],
    ['Nparabolic', () => [U(0.05, 0.5), U(0.2, 1), U(0.005, 0.05), rnd() < 0.5 ? 1 : 0], a => a],
    ['NfacetedReflector', () => [U(0.05, 0.3), U(0.3, 1), U(0.005, 0.05), rnd() < 0.5 ? 1 : 0, Math.floor(U(0, 30)), Math.floor(U(0, 8)), U(0.01, 0.1)], a => a],
    ['Nasphere', () => [U(0.5, 1.5), U(0.1, 0.5), U(-3, 3), U(-3, 1), [U(-0.1, 0.1), 0, 0, 0], U(-3, 3), U(-3, 1), [0, U(-0.05, 0.05), 0, 0]],
        a => [a[0], a[1], a[2], a[3], v(a[4]), a[5], a[6], v(a[7])]],
]
for (const [name, gen, wrap] of SHAPES) {
    let worst = 0, n = 0
    for (let trial = 0; trial < 6; trial++) {
        const args = gen()
        const f = formula(name, wrap(args))
        for (let k = 0; k < 60; k++) {
            const p = [U(-2, 2), U(-2, 2), U(-2, 2)]
            const want = S[name](p, ...args).at(-1), got = f(...p)
            worst = Math.max(worst, Math.abs(want - got) / Math.max(1, Math.abs(want)))
            n++
        }
    }
    ok(`${name}: the formula is core/shapes.js's mirror at ${n} points`, worst < 1e-9, `worst relative difference ${worst}`)
}
/* sdf.js's shapes have no JS mirror: their closed forms */
{
    const cases = [
        ['Nsphere', [0.7], p => Math.hypot(...p) - 0.7],
        ['NboxRounded', [v([0.5, 0.3, 0.2]), 0.05], p => {
            const b = [0.45, 0.25, 0.15], q = p.map((x, k) => Math.abs(x) - b[k])
            return Math.hypot(...q.map(x => Math.max(x, 0))) + Math.min(Math.max(...q), 0) - 0.05
        }],
        ['Ncylinder', [0.4, 0.3], p => {
            const d = [Math.hypot(p[0], p[1]) - 0.3, Math.abs(p[2]) - 0.4]
            return Math.min(Math.max(...d), 0) + Math.hypot(Math.max(d[0], 0), Math.max(d[1], 0))
        }],
        ['Ncapsule', [0.4, 0.2], p => Math.hypot(p[0], p[1], p[2] - Math.min(Math.max(p[2], -0.4), 0.4)) - 0.2],
        ['Nplane', [], p => p[2]],
        ['Ndisc', [0.5], p => Math.hypot(Math.max(Math.hypot(p[0], p[1]) - 0.5, 0), p[2])],
        ['Nrectangle', [v([0.4, 0.2])], p => Math.hypot(Math.max(Math.abs(p[0]) - 0.4, 0), Math.max(Math.abs(p[1]) - 0.2, 0), p[2])],
        ['sdCappedCone', [0.5, 0.4, 0.1], null],      // Quilez's: checked against itself written here
    ]
    const cone = (p, h, r1, r2) => {           // sdf.js sdCappedCone, line for line
        const q = [Math.hypot(p[0], p[1]), p[2]], k1 = [r2, h], k2 = [r2 - r1, 2 * h]
        const ca = [q[0] - Math.min(q[0], q[1] < 0 ? r1 : r2), Math.abs(q[1]) - h]
        const t = Math.min(Math.max(((k1[0] - q[0]) * k2[0] + (k1[1] - q[1]) * k2[1]) / (k2[0] ** 2 + k2[1] ** 2), 0), 1)
        const cb = [q[0] - k1[0] + k2[0] * t, q[1] - k1[1] + k2[1] * t]
        const s = cb[0] < 0 && ca[1] < 0 ? -1 : 1
        return s * Math.sqrt(Math.min(ca[0] ** 2 + ca[1] ** 2, cb[0] ** 2 + cb[1] ** 2))
    }
    for (const [name, args, ref] of cases) {
        const f = formula(name, args)
        let worst = 0
        for (let k = 0; k < 200; k++) {
            const p = [U(-1, 1), U(-1, 1), U(-1, 1)]
            const want = ref ? ref(p) : cone(p, ...args)
            worst = Math.max(worst, Math.abs(want - f(...p)))
        }
        ok(`${name}: the formula is its closed form`, worst < 1e-12, `worst difference ${worst}`)
    }
}
/* a profile, extruded and revolved, against shapes.js's profileEval and g2Extrude */
{
    const { profilePieces } = await import('../src/profiles.js')
    const pts = [[-0.5, -0.35, 0.08], [0.5, -0.35, 0.08], [0.5, 0.35, 0.08], [0.125, 0.35, 0.035], [0, 0.125, 0.05], [-0.125, 0.35, 0.035], [-0.5, 0.35, 0.08]]
    const mine = profilePieces(pts), theirs = S.profilePieces(pts)
    ok('profilePieces: the pieces ShadyTracer compiles', JSON.stringify(mine) === JSON.stringify(theirs))
    const doc = {
        format: 'raytracer-scene', version: 29, root: { id: 'root', kind: 'group', children: [
            { id: 'e', kind: 'object', label: 'e', block: 'b', params: { outline: pts, height: 0.2 } },
            { id: 'r', kind: 'object', label: 'r', block: 'c', params: { outline: [[0, -0.42], [0.5, -0.42, 0.08], [0.5, 0.08], [0.21, 0.25, 0.125], [0.33, 0.5, 0.08], [0, 0.5]] },
              transform: { pos: { x: 3, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: 1 } },
        ] },
        blocks: [{ id: 'b', code: 'C = add_new(C, extrude(outline, p, height), MATERIAL);' },
                 { id: 'c', code: 'C = add_new(C, revolve(outline, p), MATERIAL);' }],
    }
    const r = sceneToSDF(doc), f = compile(r.d)
    const revPieces = S.profilePieces(doc.root.children[1].params.outline).pieces
    let worst = 0
    for (let k = 0; k < 400; k++) {
        const p = [U(-1, 4), U(-1, 1), U(-1, 1)]
        const e = S.g2Extrude(p, S.profileEval(theirs.pieces, [p[0], p[1]], false), 0.1)[3]
        const q = [p[0] - 3, p[1], p[2]]
        const rv = S.g2Revolve(q, S.profileEval(revPieces, [Math.hypot(q[0], q[1]), q[2]], true))[3]
        worst = Math.max(worst, Math.abs(Math.min(e, rv) - f(...p)))
    }
    ok('an extruded and a revolved profile: shapes.js profileEval, g2Extrude, g2Revolve', worst < 1e-12, `worst ${worst}`)
}

// ---- 2. THE JOINS ----
for (const shape of ['round', 'chamfer']) for (const op of ['union', 'subtract', 'intersect']) {
    const fn = { round: { union: 'csgRoundUnion', subtract: 'csgRoundSubtract', intersect: 'csgRoundIntersect' },
                 chamfer: { union: 'csgChamferUnion', subtract: 'csgChamferSubtract', intersect: 'csgChamferIntersect' } }[shape][op]
    let worst = 0
    for (let k = 0; k < 300; k++) {
        const a = U(-1, 1), b = U(-1, 1), r = U(0.01, 0.5)
        const got = I.call(fn, [vec([0, 0, 0, a]), vec([0, 0, 0, b]), r]).c[3]
        const want = J.joinShaped(op, shape, [0, 0, 1, a], [0, 0, 1, b], r)[3]
        worst = Math.max(worst, Math.abs(got - want))
    }
    // 1e-8: the WGSL writes its caps as 0.41421356 and 0.70710678, joins.js as Math.SQRT2 - 1 and Math.SQRT1_2
    ok(`${shape} ${op}: builder/joins.js`, worst < 1e-8, `worst ${worst}`)
}

// ---- 3. THE TRANSFORM ----
{
    let worst = 0
    for (let k = 0; k < 200; k++) {
        const T = { pos: { x: U(-5, 5), y: U(-5, 5), z: U(-5, 5) }, rot: { x: U(-180, 180), y: U(-180, 180), z: rnd() < 0.3 ? 90 : U(-180, 180) }, scale: U(0.2, 3) }
        const p = [U(-5, 5), U(-5, 5), U(-5, 5)]
        const m = matrixOf(T), s = m[15], d = [p[0] - m[12], p[1] - m[13], p[2] - m[14]]
        const want = [0, 1, 2].map(c => (d[0] * m[4 * c] + d[1] * m[4 * c + 1] + d[2] * m[4 * c + 2]) / s)
        const got = xfPoint(vec(p), T).c
        worst = Math.max(worst, ...got.map((g, i) => Math.abs(g - want[i])))
    }
    ok('a node\'s transform: transform.js matrixOf as scene_api.js xfPoint reads it', worst < 1e-12, `worst ${worst}`)
}

// ---- 3b. WHAT docsdf.mjs DOES NOT READ, by hand: a smooth blend, a subtraction, an array, a modifier, a scale ----
{
    const sphere = (id, x, r, extra = {}) => ({ id, kind: 'object', label: id, block: 'bs', params: { radius: r },
        transform: { pos: { x, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: 1 }, ...extra })
    const blocks = [{ id: 'bs', code: 'C = add_new(C, Nsphere(p, radius), MATERIAL);' },
        { id: 'rep', code: 'p = p - spacing * clamp(round(p / spacing), -count, count);\nC = children(C, p);', params: { spacing: { x: 3, y: 3, z: 3 }, count: { x: 2, y: 0, z: 0 } } },
        { id: 'sh', code: 'var H = children(emptyHit(r), p);\nH.s = VEC4(H.s.xyz * sign(H.s.w), abs(H.s.w) - thickness * XF_S);\nC = fold(C, H.s, H.m);', params: { thickness: 0.05 } },
        { id: 'tw', code: 'let a = rate * p.z;\np = VEC3(cos(a) * p.x - sin(a) * p.y, sin(a) * p.x + cos(a) * p.y, p.z);\nwarp(1.0 / sqrt(1.0 + rate * rate * extent * extent));\nC = children(C, p);', params: { rate: 1, extent: 1 } }]
    const at = (children, p) => sceneToSDF({ format: 'raytracer-scene', version: 29, blocks, root: { id: 'root', kind: 'group', children } }, { at: p }).d
    const sm = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0); return Math.min(a, b) - h * h * 0.25 / k }
    const smax = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0); return Math.max(a, b) + h * h * 0.25 / k }
    const L = (p, c) => Math.hypot(p[0] - c, p[1], p[2])
    const cases = [
        ['a smooth union, the group\'s blend (csgUnion)', [{ id: 'g', kind: 'group', blend: 0.3, children: [sphere('a', 0, 1), sphere('b', 1.5, 0.8)] }],
            p => sm(L(p, 0) - 1, L(p, 1.5) - 0.8, 0.3)],
        ['a subtraction with its own blend (csgSubtract)', [{ id: 'g', kind: 'group', blend: 0, children: [sphere('a', 0, 1), sphere('b', 0.8, 0.6, { join: 'subtract', joinBlend: 0.2 })] }],
            p => smax(L(p, 0) - 1, -(L(p, 0.8) - 0.6), 0.2)],
        ['an array\'s copies: a union', [{ id: 'g', kind: 'group', copies: [0, 2, 5].map(x => ({ pos: { x, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: x === 5 ? 2 : 1 })), children: [sphere('a', 0, 0.5)] }],
            p => Math.min(L(p, 0) - 0.5, L(p, 2) - 0.5, (Math.hypot((p[0] - 5) / 2, p[1] / 2, p[2] / 2) - 0.5) * 2)],
        ['a scaled group: the distance times its scale', [{ id: 'g', kind: 'group', transform: { pos: { x: 1, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: 3 }, children: [sphere('a', 0, 0.5)] }],
            p => L(p, 1) - 1.5],
        ['the repeat modifier', [{ id: 'g', kind: 'group', block: 'rep', params: { spacing: { x: 3, y: 3, z: 3 }, count: { x: 2, y: 0, z: 0 } }, children: [sphere('a', 0, 0.5)] }],
            p => Math.min(...[-6, -3, 0, 3, 6].map(c => L(p, c))) - 0.5],
        ['the shell modifier', [{ id: 'g', kind: 'group', block: 'sh', params: { thickness: 0.05 }, children: [sphere('a', 0, 1)] }],
            p => Math.abs(L(p, 0) - 1) - 0.05],
        ['the twist modifier: the point turned, the distance times warp', [{ id: 'g', kind: 'group', block: 'tw', params: { rate: 1, extent: 1 }, children: [sphere('a', 0.5, 0.3)] }],
            p => { const a = p[2]; return (Math.hypot(Math.cos(a) * p[0] - Math.sin(a) * p[1] - 0.5, Math.sin(a) * p[0] + Math.cos(a) * p[1], p[2]) - 0.3) / Math.SQRT2 }],
    ]
    for (const [what, children, ref] of cases) {
        let worst = 0
        for (let k = 0; k < 100; k++) { const p = [U(-8, 8), U(-2, 2), U(-2, 2)]; worst = Math.max(worst, Math.abs(at(children, p) - ref(p))) }
        ok(`${what}: its closed form`, worst < 1e-12, `worst ${worst}`)
    }
}

// ---- 4. EVERY EXAMPLE SCENE ----
let docsdf = null
try { docsdf = await imp('import/test/docsdf.mjs') } catch (e) { console.log(`(docsdf.mjs not loaded: ${e.message})`) }
const dir = resolve(ST, 'scenes')
const docsdfScenes = [], docsdfNot = []
/* what docsdf.mjs (written for imported parts) does not read: a smooth blend, group code, an array's copies */
const blocksOf = doc => new Map((doc.blocks || []).map(b => [b.id, b]))
const beyondDocsdf = (n, B) => (n.blend > 0) || (n.joinBlend > 0) || (n.kind === 'group' && (n.copies ||
    /[^\s]/.test((B.get(n.block)?.code || '').replace(/\/\/.*$/gm, '')))) || (n.children || []).some(c => beyondDocsdf(c, B))
for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const doc = JSON.parse(readFileSync(resolve(dir, f), 'utf8'))
    let r
    try { r = sceneToSDF(doc, { skipUnsupported: true }) } catch (e) { ok(`${f}: converts`, false, e.stack); continue }
    ok(`${f}: converts`, true)
    const fn = compile(r.d, { labels: r.labels })
    const box = doc.envRadius ? Math.min(doc.envRadius, 2000) : 500
    let worst = 0, n = 0, nd = 0, worstDoc = 0, noDoc = null
    const kids = (doc.root.children || []).filter(c => c.enabled !== false && c.type !== 'light' && c.type !== 'haze' && !r.skipped.some(s => s.startsWith(`'${c.label}'`)))
    for (let k = 0; k < 40; k++) {
        const p = [U(-box, box) * 0.3, U(-box, box) * 0.3, U(-box * 0.05, box * 0.3)]
        const at = sceneToSDF(doc, { skipUnsupported: true, at: p }).d, got = fn(...p)
        if (typeof at !== 'number') { worst = Infinity; continue }
        if (!(Number.isNaN(at) && Number.isNaN(got))) worst = Math.max(worst, Math.abs(at - got) / Math.max(1, Math.abs(at)))
        n++
        if (docsdf && noDoc === null && !beyondDocsdf(doc.root, blocksOf(doc))) {
            try {
                const want = kids.reduce((m, c) => { const d = docsdf.nodeSDF(c, p, doc.blocks); return Math.abs(d) < Math.abs(m) ? d : m }, Infinity)
                if (got > 0) { worstDoc = Math.max(worstDoc, Math.abs(want - got) / Math.max(1, Math.abs(want))); nd++ }
            } catch (e) { noDoc = e.message }
        }
    }
    ok(`${f}: the compiled formula is the scene evaluated at the point (${n} points)`, worst < 1e-9, `worst relative ${worst}`)
    if (nd) docsdfScenes.push(`${f} (${nd})`)
    else if (noDoc) docsdfNot.push(f)
    if (nd) ok(`${f}: ShadyTracer's docsdf.mjs where outside (${nd} points)`, worstDoc < 1e-9, `worst relative ${worstDoc}`)
    // ---- 5. THE EMITTERS ----
    const t = toText(r.d, { labels: r.labels }), js = toJS(r.d, { labels: r.labels }), gl = toGLSL(r.d, { labels: r.labels })
    ok(`${f}: text, JS and GLSL written`, t.startsWith('f(x, y, z) = ') && js.includes('export function sdfXYZ') && gl.includes('float sdf(vec3 p)'))
    try {
        const one = compile(r.d, { inline: true })
        const p = [U(-box, box) * 0.3, U(-box, box) * 0.3, U(0, box * 0.3)]
        ok(`${f}: the inline formula is the same function`, close(one(...p), fn(...p)) || (Number.isNaN(one(...p)) && Number.isNaN(fn(...p))))
    } catch (e) { if (!/in one piece/.test(e.message)) ok(`${f}: inline`, false, e.message) }
}

console.log(`\nagainst docsdf.mjs: ${docsdfScenes.join(', ') || 'none'}; its shapes cannot read: ${docsdfNot.length} scenes`)
console.log(`\n${pass} passed, ${fail} failed  (against ShadyTracer at ${ST})`)
process.exit(fail ? 1 : 0)
