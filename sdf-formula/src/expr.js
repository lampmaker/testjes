//======================================================================================================================
// SYMBOLIC SCALAR EXPRESSIONS -- the formula the scene's SDF becomes.
//
// A value is a plain JS number (a constant), a JS boolean, or a Node: { op, a: [args], id }. Nodes are hash-consed
// (one object per distinct op + arguments), so a subexpression used twice -- a group's local point, read by each of
// its children -- is one node, and the emitters (emit.js) write it once. Every builder folds constants and applies a
// few identities, so a node whose transform is the identity costs nothing in the formula and a branch on a parameter
// (not on the point) disappears before it is ever written.
//
// The only free variables are the point's coordinates x, y, z. Everything else in a scene -- sizes, positions,
// blends -- is a number by the time it reaches here.
//======================================================================================================================

/** Distances at or beyond this are "nothing here" (emptyHit's 1e30): min(x, BIG) is x, and a comparison with it is
 *  decided. Far beyond any scene's size, so the rule never changes a real value. */
export const BIG = 1e29

let nextId = 1
const table = new Map()

export const isNode = v => v !== null && typeof v === 'object' && typeof v.op === 'string'
export const isConst = v => typeof v === 'number' || typeof v === 'boolean'
const keyOf = v => isNode(v) ? `#${v.id}` : typeof v === 'number' ? (Object.is(v, -0) ? '0' : String(v)) : String(v)

function mk(op, ...a) {
    const key = op + '(' + a.map(keyOf).join(',') + ')'
    let n = table.get(key)
    if (!n) { n = { op, a, id: nextId++ }; table.set(key, n) }
    return n
}
/** Drop the hash-consing table (between conversions in a long-running page). */
export function reset() { table.clear() }

/* WGSL's round(): half to even */
export const rne = x => { const r = Math.round(x); return (r - x === 0.5 && r % 2 !== 0) ? r - 1 : r }
/* WGSL's % on floats: x - y * trunc(x / y) -- JS's % already is that */
const NUM = {
    add: (x, y) => x + y, sub: (x, y) => x - y, mul: (x, y) => x * y, div: (x, y) => x / y, mod: (x, y) => x % y,
    neg: x => -x, sqrt: Math.sqrt, abs: Math.abs, min: Math.min, max: Math.max, sin: Math.sin, cos: Math.cos,
    tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2, exp: Math.exp, log: Math.log,
    pow: Math.pow, floor: Math.floor, ceil: Math.ceil, round: rne, trunc: Math.trunc, fract: x => x - Math.floor(x),
    sign: Math.sign, inversesqrt: x => 1 / Math.sqrt(x), exp2: x => 2 ** x, log2: Math.log2,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    lt: (x, y) => x < y, le: (x, y) => x <= y, gt: (x, y) => x > y, ge: (x, y) => x >= y,
    eq: (x, y) => x === y, ne: (x, y) => x !== y,
    and: (x, y) => x && y, or: (x, y) => x || y, not: x => !x,
    sel: (c, a, b) => c ? a : b,
}
export const OPS = Object.keys(NUM)

export const v = name => mk('var', name)
export const X = v('x'), Y = v('y'), Z = v('z')

const num = v => typeof v === 'number'
const allConst = a => a.every(isConst)

export function add(x, y) {
    if (num(x) && num(y)) return x + y
    if (x === 0) return y
    if (y === 0) return x
    if (num(y) && y < 0) return sub(x, -y)
    if (isNode(y) && y.op === 'neg') return sub(x, y.a[0])
    if (isNode(x) && x.op === 'neg') return sub(y, x.a[0])
    // (u + c1) + c2 and (u - c1) + c2: one constant
    if (num(y) && isNode(x) && (x.op === 'add' || x.op === 'sub') && num(x.a[1]))
        return add(x.a[0], (x.op === 'add' ? x.a[1] : -x.a[1]) + y)
    if (num(x) && !num(y)) return add(y, x)
    return mk('add', x, y)
}
export function sub(x, y) {
    if (num(x) && num(y)) return x - y
    if (y === 0) return x
    if (x === 0) return neg(y)
    if (x === y) return 0
    if (num(y) && y < 0) return add(x, -y)
    if (isNode(y) && y.op === 'neg') return add(x, y.a[0])
    if (num(y) && isNode(x) && (x.op === 'add' || x.op === 'sub') && num(x.a[1]))
        return add(x.a[0], (x.op === 'add' ? x.a[1] : -x.a[1]) - y)
    return mk('sub', x, y)
}
export function mul(x, y) {
    if (num(x) && num(y)) return x * y
    if (x === 1) return y
    if (y === 1) return x
    if (x === 0 || y === 0) return 0
    if (x === -1) return neg(y)
    if (y === -1) return neg(x)
    if (num(x) && !num(y)) return mul(y, x)                        // the constant last: (u * c)
    if (num(y) && isNode(x) && x.op === 'mul' && num(x.a[1])) return mul(x.a[0], x.a[1] * y)
    if (num(y) && isNode(x) && x.op === 'div' && num(x.a[1])) return mul(x.a[0], y / x.a[1])
    if (num(y) && isNode(x) && x.op === 'neg') return mul(x.a[0], -y)
    return mk('mul', x, y)
}
export function div(x, y) {
    if (num(x) && num(y)) return x / y
    if (y === 1) return x
    if (y === -1) return neg(x)
    if (x === 0 && num(y) && y !== 0) return 0
    if (num(y) && y !== 0) {
        const r = 1 / y
        // a division by a round number reads better than a product by its reciprocal
        if (Number.isInteger(r) || Math.abs(r * 1e6 - Math.round(r * 1e6)) < 1e-9) return mul(x, r)
    }
    return mk('div', x, y)
}
export function neg(x) {
    if (num(x)) return -x
    if (isNode(x) && x.op === 'neg') return x.a[0]
    if (isNode(x) && x.op === 'sub') return sub(x.a[1], x.a[0])
    if (isNode(x) && x.op === 'mul' && num(x.a[1])) return mul(x.a[0], -x.a[1])
    return mk('neg', x)
}
export const mod = (x, y) => allConst([x, y]) ? x % y : mk('mod', x, y)

function unary(op) {
    return x => {
        if (num(x)) return NUM[op](x)
        if (op === 'abs' && isNode(x) && (x.op === 'abs' || x.op === 'sqrt')) return x
        if (op === 'abs' && isNode(x) && x.op === 'neg') return unary('abs')(x.a[0])
        return mk(op, x)
    }
}
export const sqrt = unary('sqrt'), abs = unary('abs'), sin = unary('sin'), cos = unary('cos'), tan = unary('tan')
export const asin = unary('asin'), acos = unary('acos'), atan = unary('atan'), exp = unary('exp'), log = unary('log')
export const floor = unary('floor'), ceil = unary('ceil'), round = unary('round'), trunc = unary('trunc')
export const fract = unary('fract'), sign = unary('sign'), inversesqrt = unary('inversesqrt')
export const exp2 = unary('exp2'), log2 = unary('log2'), sinh = unary('sinh'), cosh = unary('cosh'), tanh = unary('tanh')
export const atan2 = (y, x) => allConst([y, x]) ? Math.atan2(y, x) : mk('atan2', y, x)
export function pow(x, y) {
    if (num(x) && num(y)) return Math.pow(x, y)
    if (y === 1) return x
    if (y === 0) return 1
    if (y === 2) return mul(x, x)
    if (y === 0.5) return sqrt(x)
    return mk('pow', x, y)
}

export function min(x, y) {
    if (num(x) && num(y)) return Math.min(x, y)
    if (x === y) return x
    if (num(x) && x >= BIG) return y
    if (num(y) && y >= BIG) return x
    if (num(x) && !num(y)) return mk('min', y, x)
    return mk('min', x, y)
}
export function max(x, y) {
    if (num(x) && num(y)) return Math.max(x, y)
    if (x === y) return x
    if (num(x) && x <= -BIG) return y
    if (num(y) && y <= -BIG) return x
    if (num(x) && !num(y)) return mk('max', y, x)
    return mk('max', x, y)
}
export const clamp = (x, lo, hi) => min(max(x, lo), hi)

/* COMPARISONS: decided when both sides are numbers, or one is "nothing here" (BIG) */
const big = v => num(v) && Math.abs(v) >= BIG
function cmp(op) {
    return (x, y) => {
        if (isConst(x) && isConst(y)) return NUM[op](x, y)          // booleans too: pfCross's (a.y > q.y) != (b.y > q.y)
        if (big(y) && !big(x)) return y > 0 ? (op === 'lt' || op === 'le' || op === 'ne') : (op === 'gt' || op === 'ge' || op === 'ne')
        if (big(x) && !big(y)) return x > 0 ? (op === 'gt' || op === 'ge' || op === 'ne') : (op === 'lt' || op === 'le' || op === 'ne')
        if (x === y) return op === 'le' || op === 'ge' || op === 'eq'
        return mk(op, x, y)
    }
}
export const lt = cmp('lt'), le = cmp('le'), gt = cmp('gt'), ge = cmp('ge'), eq = cmp('eq'), ne = cmp('ne')
export function and(x, y) {
    if (x === false || y === false) return false
    if (x === true) return y
    if (y === true) return x
    if (x === y) return x
    return mk('and', x, y)
}
export function or(x, y) {
    if (x === true || y === true) return true
    if (x === false) return y
    if (y === false) return x
    if (x === y) return x
    return mk('or', x, y)
}
const NOT_OF = { lt: 'ge', le: 'gt', gt: 'le', ge: 'lt', eq: 'ne', ne: 'eq' }
export function not(x) {
    if (typeof x === 'boolean') return !x
    if (isNode(x) && x.op === 'not') return x.a[0]
    if (isNode(x) && NOT_OF[x.op]) return mk(NOT_OF[x.op], ...x.a)
    return mk('not', x)
}
/** c ? a : b. A select between the two sides of its own comparison is a min or a max. */
export function sel(c, a, b) {
    if (c === true) return a
    if (c === false) return b
    if (a === b) return a
    if (a === true && b === false) return c
    if (a === false && b === true) return not(c)
    if (isNode(c) && c.op === 'not') return sel(c.a[0], b, a)
    if (isNode(c) && ['lt', 'le', 'gt', 'ge'].includes(c.op)) {
        const [u, w] = c.a, less = c.op === 'lt' || c.op === 'le'
        if (u === a && w === b) return less ? min(a, b) : max(a, b)
        if (u === b && w === a) return less ? max(a, b) : min(a, b)
    }
    return mk('sel', c, a, b)
}

/** The op table by name, for the interpreter's builtins and the numeric evaluator. */
export const E = { add, sub, mul, div, neg, mod, sqrt, abs, sin, cos, tan, asin, acos, atan, atan2, exp, log, pow,
                   floor, ceil, round, trunc, fract, sign, inversesqrt, exp2, log2, sinh, cosh, tanh,
                   min, max, clamp, lt, le, gt, ge, eq, ne, and, or, not, sel }

/** Every node reachable from the roots, children before parents. */
export function topo(roots) {
    const seen = new Set(), out = []
    const stack = roots.filter(isNode).map(n => [n, 0])
    while (stack.length) {
        const top = stack[stack.length - 1], [n, i] = top
        if (seen.has(n)) { stack.pop(); continue }
        if (i < n.a.length) {
            top[1]++
            const c = n.a[i]
            if (isNode(c) && !seen.has(c)) stack.push([c, 0])
        } else { seen.add(n); out.push(n); stack.pop() }
    }
    return out
}

/** The value of an expression at (x, y, z), by walking it (the emitters' JS is the fast way). */
export function evaluate(root, p) {
    const vars = { x: p[0], y: p[1], z: p[2] }
    const val = new Map()
    const get = v => isNode(v) ? val.get(v) : v
    for (const n of topo([root])) {
        if (n.op === 'var') { val.set(n, vars[n.a[0]]); continue }
        if (n.op === 'sel') { val.set(n, get(n.a[0]) ? get(n.a[1]) : get(n.a[2])); continue }
        val.set(n, NUM[n.op](...n.a.map(get)))
    }
    return get(root)
}
