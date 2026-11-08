//======================================================================================================================
// PROFILES -- an outline parameter ([[x, y], [x, y, fillet], ...], closed), as the pieces the shader walks: straight
// segments and the fillets' arcs. A copy of ShadyTracer's lib/pathtracer/core/shapes.js profilePieces, which codegen
// compiles every profile with; the walk itself (pfStart, pfSegment, pfArc, pfEnd) is the library's own WGSL, run by
// the interpreter (scene.js).
//======================================================================================================================

const sub = (a, b) => a.map((x, k) => x - b[k])
const add = (a, b) => a.map((x, k) => x + b[k])
const scl = (a, s) => a.map(x => x * s)
const dot = (a, b) => a.reduce((s, x, k) => s + x * b[k], 0)
const cross2 = (a, b) => a[0] * b[1] - a[1] * b[0]
const norm2 = v => { const l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l] }

/* whether segments a-b and c-d share a point (touching counts) */
function segmentsMeet(a, b, c, d) {
    const o = (p, q, r) => Math.sign(cross2(sub(q, p), sub(r, p)))
    const on = (p, q, r) => Math.min(p[0], q[0]) <= r[0] && r[0] <= Math.max(p[0], q[0]) && Math.min(p[1], q[1]) <= r[1] && r[1] <= Math.max(p[1], q[1])
    const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b)
    if (o1 !== o2 && o3 !== o4) return true
    return (o1 === 0 && on(a, b, c)) || (o2 === 0 && on(a, b, d)) || (o3 === 0 && on(c, d, a)) || (o4 === 0 && on(c, d, b))
}

/**
 * A profile's points (numbers) as pieces: { kind: 'segment', a, b, axis } and { kind: 'arc', c, r, a, b, convex },
 * counter-clockwise, and what is wrong with it, in the user's own point numbers.
 * @returns {{ pieces: object[], problems: string[] }}
 */
export function profilePieces(points) {
    const problems = []
    if (!Array.isArray(points) || points.length < 3) return { pieces: [], problems: ['a profile needs at least three points'] }
    points.forEach((pt, i) => {
        if (!Array.isArray(pt) || (pt.length !== 2 && pt.length !== 3) || !pt.every(Number.isFinite))
            problems.push(`point ${i + 1}: x, y, and a fillet radius if it has one -- numbers`)
        else if (pt.length === 3 && pt[2] < 0) problems.push(`point ${i + 1}: a fillet radius cannot be negative`)
    })
    if (problems.length) return { pieces: [], problems }
    const n = points.length
    const at = i => (i % n + n) % n
    for (let i = 0; i < n; i++) {
        const a = points[i], b = points[at(i + 1)]
        if (a[0] === b[0] && a[1] === b[1]) problems.push(`points ${i + 1} and ${at(i + 1) + 1} are the same point`)
    }
    if (problems.length) return { pieces: [], problems }
    let area = 0
    for (let i = 0; i < n; i++) area += cross2(points[i], points[at(i + 1)]) / 2
    const size = Math.max(...points.map(p => Math.max(Math.abs(p[0]), Math.abs(p[1]))), 1e-30)
    if (!(Math.abs(area) > 1e-12 * size * size)) return { pieces: [], problems: ['the outline encloses no area'] }
    for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue
        if (segmentsMeet(points[i], points[at(i + 1)], points[j], points[at(j + 1)]))
            problems.push(`edges ${i + 1}-${at(i + 1) + 1} and ${j + 1}-${at(j + 1) + 1} cross`)
    }
    if (problems.length) return { pieces: [], problems }
    const idx = [...Array(n).keys()]
    if (area < 0) idx.reverse()
    const P = idx.map(i => points[i])
    const corner = P.map((p, i) => {
        const r = p[2] ?? 0
        if (!(r > 0)) return null
        const prev = P[at(i - 1)], next = P[at(i + 1)]
        const u = norm2(sub(prev, p)), v = norm2(sub(next, p))
        const ang = Math.acos(Math.min(1, Math.max(-1, dot(u, v))))
        if (ang > Math.PI - 1e-9) return null
        const t = r / Math.tan(ang / 2)
        const bis = norm2([u[0] + v[0], u[1] + v[1]])
        const pp = [p[0], p[1]]
        return { t, r, A: add(pp, scl(u, t)), B: add(pp, scl(v, t)), c: add(pp, scl(bis, r / Math.sin(ang / 2))),
                 convex: cross2(sub(p, prev), sub(next, p)) > 0 }
    })
    for (let i = 0; i < n; i++) {
        const j = at(i + 1), need = (corner[i]?.t ?? 0) + (corner[j]?.t ?? 0)
        const L = Math.hypot(P[j][0] - P[i][0], P[j][1] - P[i][1])
        if (need > L * (1 + 1e-9)) {
            const which = [corner[i] && idx[i] + 1, corner[j] && idx[j] + 1].filter(Boolean).sort((a, b) => a - b)
            problems.push(`the fillet${which.length > 1 ? 's' : ''} at point${which.length > 1 ? 's' : ''} ${which.join(' and ')} need ${+need.toPrecision(4)} of an edge ${+L.toPrecision(4)} long`)
        }
    }
    if (problems.length) return { pieces: [], problems }
    const pieces = []
    for (let i = 0; i < n; i++) {
        const k = corner[i]
        if (k) pieces.push({ kind: 'arc', c: k.c, r: k.r, a: k.A, b: k.B, convex: k.convex })
        const a = k ? k.B : [P[i][0], P[i][1]], j = at(i + 1), b = corner[j] ? corner[j].A : [P[j][0], P[j][1]]
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-12 * size)
            pieces.push({ kind: 'segment', a, b, axis: Math.abs(a[0]) <= 1e-12 * size && Math.abs(b[0]) <= 1e-12 * size })
    }
    return { pieces, problems }
}

/** Is this parameter value a profile (an outline of points)? As ShadyTracer's model.js reads one: a list of lists. */
export const isProfile = v => Array.isArray(v) && v.length > 0 && v.every(Array.isArray)
/** ...or a path (a tube's or a sweep's route)? */
export const isPath = v => v !== null && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.path)
