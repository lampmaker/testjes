//======================================================================================================================
// A SHADYTRACER SCENE AS ONE FUNCTION OF THE POINT: the scene document (File > Export > scene, a .json with
// "format": "raytracer-scene") walked as ShadyTracer's codegen walks it, every node's code run by the interpreter with
// the point as x, y, z -- giving the signed distance f(x, y, z) as one expression. Geometry only: lights, haze boxes,
// materials and their textures are not in it.
//
// HOW EACH PART BECOMES THE FORMULA (ShadyTracer's file in brackets: what this follows):
//   a node's TRANSFORM   (builder/transform.js matrixOf, scene_api.js xfPoint) the point into the node's frame:
//                        q = R^T (p - pos) / scale, R = Rz Ry Rx of its angles in degrees; the distance out of it
//                        times the scale -- here every distance is in WORLD units, as codegen's add_new makes it
//                        (sdf.w * XF_S, XF_S the frames' scales multiplied)
//   an OBJECT            its code run as written: `C = add_new(C, <sdf>, MATERIAL)` folds the sdf's .w into C
//   a PLAIN GROUP        the union of its children: min. (The renderer folds separate objects by the nearest surface,
//                        |d| least, which is min wherever they do not overlap; inside an overlap min is the union's
//                        distance, which is what a formula for the solid should say.)
//   a CSG GROUP          (codegen.js isCsg, joinFn) its children top to bottom, each joined to what is above by its
//                        join -- union, subtract, intersect -- hard, smooth (csgUnion's polynomial, the blend in world
//                        units) or round / chamfer (csgRound*, csgChamfer*): the library's own functions, run here
//   GROUP CODE           (a modifier: twist, bend, repeat, mirror, circular array, round, shell, displace) run as
//                        written, `children(C, p)` the union of the children at that p; warp(k) multiplies the
//                        distances after it by k, as the renderer's does
//   an ARRAY (copies)    the union of the children at each copy's transform
//   a PROFILE            (extrude, revolve) the outline compiled to pieces as codegen does (profiles.js), walked by
//                        the library's pfSegment / pfArc
// NOT SUPPORTED (an error naming the node, or skipped with `skipUnsupported`): a path (tube, sweep), noise (the
// relief modifier and noise functions), image textures used as heights, anything whose loop or index depends on the
// point. A material's relief is a surface texture: left out, and said in the warnings.
//======================================================================================================================
import * as X from './expr.js'
import { Program, Interp, vec, OPAQUE, isVec } from './interp.js'
import { WGSLError } from './wgsl.js'
import { PRELUDE } from './prelude.js'
import { profilePieces, isProfile, isPath } from './profiles.js'

export class SceneError extends Error {}

const FAR = 1e30          // emptyHit: nothing yet (expr.js BIG folds it away)
const hit = d => ({ t: 'struct', name: 'Hit', f: { r: OPAQUE, s: vec([0, 0, 0, d]), m: OPAQUE, a: OPAQUE, insideW: -FAR } })
const distOf = h => {
    if (h?.t !== 'struct' || h.name !== 'Hit') throw new SceneError('the code left C something other than a Hit')
    return h.f.s.c[3]
}
const isNothing = d => typeof d === 'number' && d >= X.BIG

/* rows of R = Rz Ry Rx (transform.js matrixOf), angles in degrees */
function rotation(rot = { x: 0, y: 0, z: 0 }) {
    const r = Math.PI / 180
    const c = a => Math.abs(a % 360) === 90 || Math.abs(a % 360) === 270 ? 0 : Math.cos(a * r)
    const s = a => (a % 180 === 0) ? 0 : Math.sin(a * r)
    const [cx, sx, cy, sy, cz, sz] = [c(rot.x), s(rot.x), c(rot.y), s(rot.y), c(rot.z), s(rot.z)]
    return [
        [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
        [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
        [-sy, cy * sx, cy * cx],
    ]
}
/** The parent-frame point p in the frame of transform T: R^T (p - pos) / scale. */
export function xfPoint(p, T) {
    if (!T) return p
    const R = rotation(T.rot), t = T.pos ?? { x: 0, y: 0, z: 0 }, s = T.scale ?? 1
    const d = [X.sub(p.c[0], t.x ?? 0), X.sub(p.c[1], t.y ?? 0), X.sub(p.c[2], t.z ?? 0)]
    return vec([0, 1, 2].map(k => X.div(X.add(X.add(X.mul(d[0], R[0][k]), X.mul(d[1], R[1][k])), X.mul(d[2], R[2][k])), s)))
}

/* codegen.js: the children that are shapes, a node's join, whether a group combines its children by joins */
const shapesOf = g => (g?.children || []).filter(c => c.type !== 'haze' && c.type !== 'light')
const joinOf = c => c?.join ?? 'union'
export const isCsg = g => g.csg ?? (g.blend > 0 || shapesOf(g).some((c, i) => i > 0 && (joinOf(c) !== 'union' || c.joinBlend > 0)))
const JOIN_FN = { union: 'csgUnion', subtract: 'csgSubtract', intersect: 'csgIntersect' }
const SHAPED_FN = {
    round: { union: 'csgRoundUnion', subtract: 'csgRoundSubtract', intersect: 'csgRoundIntersect' },
    chamfer: { union: 'csgChamferUnion', subtract: 'csgChamferSubtract', intersect: 'csgChamferIntersect' },
}
/* code with nothing in it but comments and space: a group's parameters alone, or a group with no code */
const hasCode = src => typeof src === 'string' && src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').trim().length > 0

/**
 * The scene's SDF.
 * @param doc   the scene document (parsed JSON)
 * @param opts  { skipUnsupported: false -- skip a node the formula cannot hold, with a warning, instead of failing;
 *                exclude: [] -- node ids or labels to leave out (a floor plane, say);
 *                planes: true -- false leaves out every infinite plane (Nplane);
 *                at: [x, y, z] -- the distance at that point as a number instead of the formula }
 * @returns {{ d, labels: Map<node, string>, warnings: string[], skipped: string[], unit: string }}
 */
export function sceneToSDF(doc, opts = {}) {
    if (!doc || typeof doc !== 'object') throw new SceneError('not a scene: give the parsed JSON of a ShadyTracer scene')
    if (doc.format && doc.format !== 'raytracer-scene')
        throw new SceneError(`not a scene: its format is '${doc.format}' (a ShadyTracer scene says "format": "raytracer-scene"${doc.format === 'raytracer-project' ? '; a project holds several -- export one scene' : ''})`)
    if (!doc.root || doc.root.kind !== 'group') throw new SceneError('not a scene: no root group')
    const warnings = [], skipped = [], labels = new Map()
    if (typeof doc.version === 'number' && doc.version > 29)
        warnings.push(`the scene is version ${doc.version}; this tool was written against version 29 -- check what is new`)
    if (typeof doc.version === 'number' && doc.version < 16)
        warnings.push(`the scene is version ${doc.version}: older than blocks (16); open and save it in ShadyTracer first`)
    const exclude = new Set(opts.exclude || [])
    const blocks = new Map((doc.blocks || []).map(b => [b.id, b]))
    const prog = new Program(PRELUDE, doc.functions || '')
    for (const m of doc.materials || []) if (m.relief && hasCode(m.relief.code))
        warnings.push(`material '${m.label}' has a relief (a texture moving its surface): left out of the formula`)

    const name = n => `'${n.label ?? n.id}'`
    const blockOf = n => n.block ? blocks.get(n.block) : null
    const codeOf = n => blockOf(n)?.code ?? n.code ?? ''
    /* a node's parameters: its block's, in its block's order, with the node's own values (model.js inOrder) */
    const paramsOf = n => ({ ...(blockOf(n)?.params || {}), ...(n.params || {}) })

    /* A parameter as the code sees it: a number, a vector, a colour, a profile; a path refused */
    const interp = new Interp(prog)
    function paramValue(n, k, v, all) {
        if (typeof v === 'number' || typeof v === 'boolean') return v
        if (isProfile(v)) {
            const plain = Object.fromEntries(Object.entries(all).filter(([, w]) => typeof w === 'number' || (w && typeof w === 'object' && !Array.isArray(w) && !isPath(w))))
            const vars = Object.fromEntries(Object.entries(plain).map(([kk, w]) => [kk, paramValue(n, kk, w, {})]))
            const points = v.map((pt, i) => pt.map((c, j) => {
                if (typeof c === 'number') return c
                if (typeof c !== 'string') throw new SceneError(`${name(n)}: profile '${k}' point ${i + 1}: not a number or an expression`)
                const val = interp.value(c.replace(/−/g, '-').replace(/×/g, '*').replace(/÷/g, '/'), vars)
                if (typeof val !== 'number') throw new SceneError(`${name(n)}: profile '${k}' point ${i + 1}, entry ${j + 1}: "${c}" is not a number`)
                return val
            }))
            const { pieces, problems } = profilePieces(points)
            if (problems.length) warnings.push(`${name(n)}: profile '${k}' is not sound (${problems[0]}): it draws nothing, as in ShadyTracer`)
            return { t: 'profile', pieces, label: `${name(n)}.${k}` }
        }
        if (isPath(v)) return { t: 'path', label: `${name(n)}.${k}` }
        if (v && typeof v === 'object') {
            const keys = 'x' in v ? ['x', 'y', 'z', 'w'] : 'r' in v ? ['r', 'g', 'b', 'a'] : null
            if (keys) return vec(keys.filter(c => c in v).map(c => v[c]))
        }
        if (typeof v === 'string') return OPAQUE                 // an image's name, a choice: nothing the shape reads
        return OPAQUE
    }

    /* THE PROFILE FUNCTIONS (codegen.js's profile, extrude and revolve, per profile there): the library's walk */
    const walk = (P, q, axis) => {
        let A = interp.call('pfStart', [])
        for (const k of P.pieces) A = k.kind === 'arc'
            ? interp.call('pfArc', [A, q, vec(k.c), k.r, vec(k.a), vec(k.b), k.convex])
            : interp.call('pfSegment', [A, q, vec(k.a), vec(k.b), k.axis ? !axis : true])
        return interp.call('pfEnd', [A])
    }
    const FAR2 = vec([1, 0, 1e7])
    const wantProfile = (P, fn) => {
        if (P?.t === 'path') throw new SceneError(`${fn}(${P.label}): a path, not a profile`)
        if (P?.t !== 'profile') throw new SceneError(`${fn}() is given no profile`)
        return P
    }
    const profileHooks = {
        profile: ([P, q]) => { P = wantProfile(P, 'profile'); return P.pieces.length ? walk(P, q, false) : FAR2 },
        extrude: ([P, p, h]) => {
            P = wantProfile(P, 'extrude')
            const g = P.pieces.length ? walk(P, vec([p.c[0], p.c[1]]), false) : FAR2
            return interp.call('g2Extrude', [p, g, X.max(X.mul(0.5, h), 0)])
        },
        revolve: ([P, p]) => {
            P = wantProfile(P, 'revolve')
            const q = vec([X.sqrt(X.add(X.mul(p.c[0], p.c[0]), X.mul(p.c[1], p.c[1]))), p.c[2]])
            return interp.call('g2Revolve', [p, P.pieces.length ? walk(P, q, true) : FAR2])
        },
        tube: ([P]) => { throw new SceneError(`a tube along a path (${P?.label ?? 'a path'}) is not supported yet`) },
        sweep: ([P]) => { throw new SceneError(`a sweep along a path (${P?.label ?? 'a path'}) is not supported yet`) },
    }

    /* THE SCENE API as the formula reads it: every fold a union (min), distances in world units */
    const xfs = st => st.find('XF_S').get('XF_S')
    const minHit = (C, d) => hit(X.min(distOf(C), d))
    const apiHooks = {
        add_new: ([C, sdf], st) => minHit(C, X.mul(sdfW(sdf), xfs(st))),
        fold: ([C, sdf]) => minHit(C, sdfW(sdf)),
        foldRelief: ([C, d, , slope]) => minHit(C, X.div(d, slope)),
        warp: ([k], st) => {
            const sc = st.find('XF_S'); sc.set('XF_S', X.mul(sc.get('XF_S'), k))
            const kc = st.find('XF_K'); if (kc) kc.set('XF_K', X.mul(kc.get('XF_K'), k))
            return OPAQUE
        },
        emptyHit: () => hit(FAR),
        marchEps: () => 0,
        localPoint: () => { throw new SceneError('localPoint() in scene code') },
    }
    const sdfW = s => {
        if (isVec(s) && s.c.length === 4) return s.c[3]
        throw new SceneError('an sdf is a VEC4 (normal, distance): add_new was given something else')
    }
    for (const k of ['fbm3', 'noise3', 'gnoise3', 'worley3', 'nzFbmLip', 'snoise', 'valueNoise3'])
        apiHooks[k] = () => { throw new SceneError(`${k}(): noise is not supported (the formula would be the noise's hash, bit by bit)`) }

    /* the variables a code block is run with (codegen.js OBJECT_CODE_TEMPLATE, GROUP_CODE_TEMPLATE) */
    const frameVars = (n, q, S) => {
        const vars = {
            p: q, C: hit(FAR), r: OPAQUE, MATERIAL: OPAQUE,
            XF_S: S, XF_K: 1, XF_M: OPAQUE, XF_SUB: 0, XF_P: q, XF_QM: OPAQUE, XF_QS: S, XF_STRAIGHT: true,
            XF_TAG: 0, XF_COPY: 0, XF_COPIES: 1, XF_RL: 1,
            LOCAL_CAPTURE: false, HIT_LOCAL: OPAQUE, HIT_FRAME: OPAQUE, HIT_SCALE: 1, HIT_TAG: 0, HIT_TAG_D: FAR,
            HIT_TAG_COPY: 0, HIT_TAG_COPIES: 1,
            DIVIDED_ABOVE: false, SURFACE_ONLY: false, READ_REACH: FAR,
        }
        const P = paramsOf(n)
        for (const [k, v] of Object.entries(P)) vars[k] = paramValue(n, k, v, P)
        return vars
    }

    const label = (d, base) => { if (X.isNode(d) && !labels.has(d)) labels.set(d, base); return d }

    /* A node's distance in world units at p (its parent's frame), S the parent frame's scale to the world; null for
       nothing (hidden, a light, empty) */
    function node(n, p, S) {
        if (n.enabled === false) return null
        if (exclude.has(n.id) || exclude.has(n.label)) { skipped.push(`${name(n)}: excluded`); return null }
        if (n.type === 'light' || n.type === 'haze') { skipped.push(`${name(n)}: a ${n.type === 'light' ? 'light' : 'haze box'}, no geometry`); return null }
        const q = xfPoint(p, n.transform), Sq = X.mul(S, n.transform?.scale ?? 1)
        try {
            const d = n.kind === 'group' ? group(n, q, Sq) : object(n, q, Sq)
            return d === null || isNothing(d) ? null : d
        } catch (e) {
            const msg = `${name(n)}: ${e.message}`
            if (!(e instanceof SceneError || e instanceof WGSLError)) throw e
            // the path of labels down to the node that failed: 'group': 'child': why
            if (!opts.skipUnsupported) throw new SceneError(msg)
            warnings.push(`${msg}: left out`)
            skipped.push(`${name(n)}: ${e.message}`)
            return null
        }
    }

    function object(n, q, S) {
        const code = codeOf(n)
        if (opts.planes === false && /\bNplane\s*\(/.test(code)) { skipped.push(`${name(n)}: a plane (planes: false)`); return null }
        if (!hasCode(code)) return null
        const it = new Interp(prog, { ...apiHooks, ...profileHooks })
        const out = it.run(code, frameVars(n, q, S))
        const d = distOf(out.get('C'))
        if (d?.t === 'opaque' || isVec(d)) throw new SceneError('its distance depends on something the formula does not have')
        return isNothing(d) ? null : label(d, `d_${n.label ?? n.id}`)
    }

    /* the children combined, in this group's frame: CSG by their joins, else a union */
    function children(g, q, S) {
        const kids = shapesOf(g).filter(c => c.enabled !== false)
        for (const c of g.children || []) if (!kids.includes(c)) node(c, q, S)       // a light or a haze box: said in `skipped`
        if (!isCsg(g)) {
            let C = FAR
            for (const c of kids) { const d = node(c, q, S); if (d !== null) C = X.min(C, d) }
            return C
        }
        let C = null
        for (const c of kids) {
            const d = node(c, q, S)
            if (d === null) continue
            if (C === null) { C = d; continue }
            const join = joinOf(c), k = c.joinBlend ?? g.blend ?? 0
            const fn = (SHAPED_FN[c.joinShape] ?? JOIN_FN)[join]
            if (!fn) throw new SceneError(`${name(c)}: no join '${join}'`)
            C = interp.call(fn, [vec([0, 0, 0, C]), vec([0, 0, 0, d]), k]).c[3]
        }
        return C ?? FAR
    }

    function group(g, q, S) {
        const code = codeOf(g)
        const copies = Array.isArray(g.copies) && g.copies.length ? g.copies : null
        const inner = (pp, SS) => {
            if (!copies) return children(g, pp, SS)
            let C = FAR
            for (const T of copies) C = X.min(C, children(g, xfPoint(pp, T), X.mul(SS, T.scale ?? 1)))
            return C
        }
        let d
        if (!hasCode(code)) d = inner(q, S)
        else {
            const it = new Interp(prog, {
                ...apiHooks, ...profileHooks,
                children: ([C, pp], st) => minHit(C, inner(pp, xfs(st))),
            })
            d = distOf(it.run(code, frameVars(g, q, S)).get('C'))
        }
        if (d?.t === 'opaque' || isVec(d)) throw new SceneError('its distance depends on something the formula does not have')
        return g === doc.root ? d : label(d, `d_${g.label ?? g.id}`)
    }

    // `at`: a point [x, y, z] instead of the variables -- the distance there as a number, every step folded (the tests
    // hold the formula to it)
    const P0 = opts.at ? vec(opts.at.slice(0, 3)) : vec([X.X, X.Y, X.Z])
    let d = node({ ...doc.root, transform: doc.root.transform }, P0, 1)
    if (d === null) { d = FAR; warnings.push('the scene has no geometry: the formula is "far away" everywhere (1e30)') }
    return { d, labels, warnings, skipped, unit: doc.unit ?? 'mm', title: doc.title ?? '' }
}
