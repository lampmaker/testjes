//======================================================================================================================
// WRITING THE FORMULA DOWN: one expression DAG (expr.js) as text, JavaScript or GLSL.
//
// A node used more than once -- a group's local point, read by each child -- becomes a named temporary, written
// once, before its first use; so does every node the conversion LABELLED (each object's distance, `d_ball`), so the
// text reads as the scene does. `inline: true` writes one expression with no temporaries at all: the "pure" formula,
// which can be much longer, since a shared subexpression is then written at every use.
//======================================================================================================================
import { isNode, topo } from './expr.js'

const PREC = { sel: 1, or: 2, and: 3, eq: 4, ne: 4, lt: 5, le: 5, gt: 5, ge: 5, add: 6, sub: 6, mul: 7, div: 7, mod: 7,
               neg: 8, not: 8 }
const INFIX = { add: '+', sub: '-', mul: '*', div: '/', lt: '<', le: '<=', gt: '>', ge: '>=', eq: '==', ne: '!=',
                and: '&&', or: '||' }
const ATOM = 10

function numberText(n, digits, fmt) {
    if (typeof n === 'boolean') return String(n)
    if (Number.isNaN(n)) return fmt === 'glsl' ? '(0.0/0.0)' : 'NaN'
    if (!Number.isFinite(n)) return fmt === 'js' ? (n > 0 ? 'Infinity' : '-Infinity') : (n > 0 ? '1e30' : '-1e30')
    let s = String(+n.toPrecision(digits))
    if (fmt === 'glsl' && !/[.eE]/.test(s)) s += '.0'
    if (fmt === 'glsl' && /^-?\d+e/.test(s)) s = s.replace('e', '.0e')
    return s
}

/* how each format writes a function of its arguments */
const FN = {
    js: { sqrt: 'Math.sqrt', abs: 'Math.abs', min: 'Math.min', max: 'Math.max', sin: 'Math.sin', cos: 'Math.cos',
          tan: 'Math.tan', asin: 'Math.asin', acos: 'Math.acos', atan: 'Math.atan', atan2: 'Math.atan2',
          exp: 'Math.exp', log: 'Math.log', pow: 'Math.pow', floor: 'Math.floor', ceil: 'Math.ceil', round: 'rne',
          trunc: 'Math.trunc', fract: 'fract', sign: 'Math.sign', inversesqrt: 'isqrt', exp2: 'exp2', log2: 'Math.log2',
          sinh: 'Math.sinh', cosh: 'Math.cosh', tanh: 'Math.tanh' },
    glsl: { atan2: 'atan', round: 'roundEven', inversesqrt: 'inversesqrt' },
    text: { inversesqrt: '1/sqrt' },
}
export const JS_HELPERS = [
    'const rne = x => { const r = Math.round(x); return (r - x === 0.5 && r % 2 !== 0) ? r - 1 : r }   // WGSL round: half to even',
    'const fract = x => x - Math.floor(x)',
    'const isqrt = x => 1 / Math.sqrt(x)',
    'const exp2 = x => 2 ** x',
].join('\n')

/**
 * The formula as a list of definitions and a result, in `fmt` ('text' | 'js' | 'glsl').
 * @returns {{ defs: [string, string, object][], result: string }}  (name, expression, node)
 */
export function emit(root, { fmt = 'text', labels = new Map(), inline = false, digits } = {}) {
    digits ??= fmt === 'text' ? 6 : fmt === 'glsl' ? 9 : 15
    const nodes = topo([root])
    const refs = new Map()
    for (const n of nodes) for (const c of n.a) if (isNode(c)) refs.set(c, (refs.get(c) || 0) + 1)
    const names = new Map(), used = new Set(['x', 'y', 'z', 'p'])
    const nameFor = base => {
        let s = base.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 't'
        if (/^\d/.test(s)) s = '_' + s
        let k = s, i = 2
        while (used.has(k)) k = `${s}_${i++}`
        used.add(k)
        return k
    }
    let tmp = 0
    if (!inline) for (const n of nodes) {
        if (n.op === 'var' || n === root) continue
        const lab = labels.get(n)
        if (lab) names.set(n, nameFor(lab))
        else if ((refs.get(n) || 0) > 1 && !(n.op === 'neg' && n.a[0].op === 'var')) names.set(n, nameFor(`t${++tmp}`))
    }
    if (inline) {
        // one expression: refuse what would not fit anywhere useful (a shared node is written at every use)
        const size = new Map()
        for (const n of nodes) size.set(n, 1 + n.a.reduce((s, c) => s + (isNode(c) ? size.get(c) : 1), 0))
        if (size.get(root) > 2e6) throw new Error(`the formula written out in one piece would have ${size.get(root).toExponential(1)} terms: leave inline off`)
    }
    const fnName = op => FN[fmt]?.[op] ?? op

    /* an expression, and its precedence; a temporary or a variable is an atom */
    const memo = new Map()
    const show = (v) => {
        if (!isNode(v)) {
            const s = numberText(v, digits, fmt)
            return [s, typeof v === 'number' && v < 0 ? PREC.neg : ATOM]
        }
        if (names.has(v)) return [names.get(v), ATOM]
        if (v.op === 'var') return [v.a[0], ATOM]
        if (!inline && memo.has(v)) return memo.get(v)
        const r = write(v)
        if (!inline) memo.set(v, r)
        return r
    }
    const wrap = (v, p, strict = false) => { const [s, q] = show(v); return (q < p || (strict && q === p)) ? `(${s})` : s }
    const flat = (n, op, top = true) => isNode(n) && n.op === op && (top || !names.has(n))
        ? [...flat(n.a[0], op, false), ...flat(n.a[1], op, false)] : [n]
    function write(n) {
        const { op, a } = n
        if (op === 'neg') return [`-${wrap(a[0], PREC.neg + 1)}`, PREC.neg]
        if (op === 'not') return [`!${wrap(a[0], PREC.not + 1)}`, PREC.not]
        if (op === 'sel') return [`${wrap(a[0], PREC.sel + 1)} ? ${wrap(a[1], PREC.sel + 1)} : ${wrap(a[2], PREC.sel)}`, PREC.sel]
        if (op === 'mod' && fmt === 'glsl') {        // WGSL's % truncates; GLSL's mod() floors
            const [x, y] = [show(a[0])[0], show(a[1])[0]]
            return [`((${x}) - (${y}) * trunc((${x}) / (${y})))`, ATOM]
        }
        if (op === 'mod') return [`${wrap(a[0], PREC.mod)} % ${wrap(a[1], PREC.mod, true)}`, PREC.mod]
        if (op === 'mul' && fmt === 'text' && a[0] === a[1]) return [`${wrap(a[0], ATOM)}²`, ATOM]
        if (op === 'abs' && fmt === 'text') return [`|${show(a[0])[0]}|`, ATOM]
        if (INFIX[op]) {
            const p = PREC[op]
            // left-associative: the right side of - and / binds tighter
            return [`${wrap(a[0], p)} ${INFIX[op]} ${wrap(a[1], p, op === 'sub' || op === 'div' || op === 'lt' || op === 'le' || op === 'gt' || op === 'ge')}`, p]
        }
        if ((op === 'min' || op === 'max') && fmt !== 'glsl') {
            const args = flat(n, op)
            return [`${fnName(op)}(${args.map(x => show(x)[0]).join(', ')})`, ATOM]
        }
        if (op === 'sqrt' && fmt === 'text') return [`√(${show(a[0])[0]})`, ATOM]
        return [`${fnName(op)}(${a.map(x => show(x)[0]).join(', ')})`, ATOM]
    }

    const defs = []
    for (const n of nodes) if (names.has(n)) defs.push([names.get(n), write(n)[0], n])
    return { defs, result: show(root)[0] }
}

/** The formula as a JavaScript module's source: `sdf([x, y, z])` and the same as `sdf(x, y, z)` by name. */
export function toJS(root, opts = {}) {
    const { defs, result } = emit(root, { ...opts, fmt: 'js' })
    const body = [...defs.map(([k, e]) => `    const ${k} = ${e}`), `    return ${result}`].join('\n')
    return `${JS_HELPERS}\n\n/** The scene's signed distance at the point (x, y, z). */\nexport function sdfXYZ(x, y, z) {\n${body}\n}\n` +
           `/** ...at p = [x, y, z]. */\nexport const sdf = p => sdfXYZ(p[0], p[1], p[2])\n`
}

/** A callable function (x, y, z) -> distance, compiled from the formula. */
export function compile(root, opts = {}) {
    const { defs, result } = emit(root, { ...opts, fmt: 'js' })
    const body = [...defs.map(([k, e]) => `const ${k} = ${e};`), `return ${result};`].join('\n')
    // eslint-disable-next-line no-new-func
    return new Function(`${JS_HELPERS}\nreturn function sdfXYZ(x, y, z) {\n${body}\n}`)()
}

const BOOL_OPS = new Set(['lt', 'le', 'gt', 'ge', 'eq', 'ne', 'and', 'or', 'not'])
const isBool = n => typeof n === 'boolean' || (isNode(n) && (BOOL_OPS.has(n.op) || (n.op === 'sel' && isBool(n.a[1]))))

/** The formula as a GLSL function `float sdf(vec3 p)`. */
export function toGLSL(root, opts = {}) {
    const { defs, result } = emit(root, { ...opts, fmt: 'glsl' })
    const body = [...defs.map(([k, e, n]) => `    ${isBool(n) ? 'bool' : 'float'} ${k} = ${e};`), `    return ${result};`].join('\n')
    return `float sdf(vec3 p) {\n    float x = p.x, y = p.y, z = p.z;\n${body}\n}\n`
}

/** The formula as text: f(x, y, z) = ..., where each named part follows. */
export function toText(root, opts = {}) {
    const { defs, result } = emit(root, { ...opts, fmt: 'text' })
    const lines = [`f(x, y, z) = ${result}`]
    if (defs.length) {
        lines.push('', 'where:')
        for (const [k, e] of defs) lines.push(`  ${k} = ${e}`)
    }
    return lines.join('\n') + '\n'
}
