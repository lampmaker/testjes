//======================================================================================================================
// THE FORMULA AS MATHEMATICS: LaTeX (the page renders it with KaTeX) and Unicode text for a terminal -- fractions,
// roots, |x|, x², min and max, and a branch as a brace of cases ("als" / "anders"), not a programming language's
// a ? b : c, &&, *.
//
// The same expression DAG as emit.js, named the same way: a part used more than once, and every part the conversion
// labelled (each object's distance, d_ball), is defined once under its own name; and every branch on the point gets
// a name of its own too, so a brace of cases always stands alone on the right of an equals sign. The definitions are
// listed after f, in the order f reads them: f first, then what it is made of, down to x, y and z.
//======================================================================================================================
import { isNode, topo, and } from './expr.js'

const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' }
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻' }

/* precedence: a looser one is put in brackets inside a tighter one */
const P = { or: 2, and: 3, cmp: 5, add: 6, mul: 7, neg: 8, pow: 9, atom: 10 }
const CMP = new Set(['lt', 'le', 'gt', 'ge', 'eq', 'ne'])

/**
 * The formula's parts, named: [{ node, name: { latex, text } }], f's own first, in reading order.
 */
function plan(root, labels, inline) {
    const nodes = topo([root])
    // how many parts read a node: a square reads its base once (u² is u·u, one use, written once)
    const parents = new Map()
    for (const n of nodes) for (const c of new Set(n.a)) if (isNode(c)) (parents.get(c) || parents.set(c, []).get(c)).push(n)
    const refs = new Map([...parents].map(([c, ps]) => [c, ps.length]))
    /* written where it is used even when shared: a coordinate moved or scaled (x + 70, 0.5 z) reads as easily as a name */
    const cheap = n => (n.op === 'add' || n.op === 'sub' || n.op === 'mul') && n.a.some(c => isNode(c) && c.op === 'var') && n.a.some(c => typeof c === 'number')
    /* a branch inside another's branch is a row of the outer brace, not a brace of its own */
    const inBrace = n => refs.get(n) === 1 && parents.get(n)[0].op === 'sel' && parents.get(n)[0].a[0] !== n
    const named = new Map()
    const seen = new Set()
    let k = 0
    const own = (lab) => {
        // a label as the scene gave it, d_glass cylinder -> d with "glass cylinder" below it; twice, numbered
        let base = lab.replace(/^d_/, '').replace(/_/g, ' ').trim() || 'deel'
        let s = base, i = 2
        while (seen.has(s)) s = `${base} (${i++})`
        seen.add(s)
        const tex = s.replace(/[\\{}$&#^%~]/g, c => `\\${c === '\\' ? 'backslash' : c}`)
        return { latex: `d_{\\text{${tex}}}`, text: `d[${s}]` }
    }
    const generic = () => { k++; return { latex: `u_{${k}}`, text: `u${String(k).replace(/\d/g, c => SUB[c])}` } }
    // which nodes get a name, decided in topo order (so numbers count up from the innermost)...
    for (const n of nodes) {
        if (n.op === 'var' || n === root) continue
        const lab = labels.get(n)
        if (lab && !inline) named.set(n, own(lab))
        else if (n.op === 'sel' && !inBrace(n)) named.set(n, null)  // a brace of cases: a definition of its own
        else if (!inline && (refs.get(n) || 0) > 1 && !cheap(n) && !(n.op === 'neg' && n.a[0].op === 'var')) named.set(n, null)
    }
    // ...the generic ones numbered in reading order instead: u1 is the first a reader meets
    const order = []
    const visit = n => {
        for (const c of n.a) if (isNode(c)) {
            if (named.has(c)) {
                if (!order.includes(c)) { order.push(c); visit(c) }
            } else visit(c)
        }
    }
    const visited = new Set()
    const visitOnce = n => { if (visited.has(n)) return; visited.add(n); visit(n) }
    visitOnce(root)
    for (const n of order) if (named.get(n) === null) named.set(n, generic())
    return { order, named }
}

function numberParts(n, digits) {
    if (typeof n === 'boolean') return { kind: 'bool', v: n }
    if (!Number.isFinite(n)) return { kind: 'inf', neg: n < 0, nan: Number.isNaN(n) }
    const s = String(+n.toPrecision(digits))
    const m = /^(-?)([\d.]+)e([+-]\d+)$/.exec(s)
    if (m) return { kind: 'sci', neg: m[1] === '-', mant: m[2], exp: +m[3] }
    return { kind: 'dec', neg: s.startsWith('-'), s: s.replace(/^-/, '') }
}

/* one writer, two notations */
const LATEX = {
    num(n, d) {
        const q = numberParts(n, d)
        if (q.kind === 'bool') return q.v ? '\\text{waar}' : '\\text{onwaar}'
        if (q.kind === 'inf') return q.nan ? '\\text{NaN}' : `${q.neg ? '-' : ''}\\infty`
        const body = q.kind === 'sci' ? (q.mant === '1' ? `10^{${q.exp}}` : `${q.mant} \\cdot 10^{${q.exp}}`) : q.s
        return (q.neg ? '-' : '') + body
    },
    var: v => v,
    paren: s => `\\left(${s}\\right)`,
    add: (a, b) => `${a} + ${b}`, sub: (a, b) => `${a} - ${b}`, neg: a => `-${a}`,
    coef: (c, a) => `${c}\\,${a}`, mul: (a, b) => `${a} \\cdot ${b}`,
    frac: (a, b) => `\\frac{${a}}{${b}}`,
    sq: a => `${a}^{2}`, pow: (a, b) => `${a}^{${b}}`,
    sqrt: a => `\\sqrt{${a}}`, abs: a => `\\left|${a}\\right|`,
    fn: (f, args) => `${({ min: '\\min', max: '\\max', sin: '\\sin', cos: '\\cos', tan: '\\tan', asin: '\\arcsin',
        acos: '\\arccos', atan: '\\arctan', sinh: '\\sinh', cosh: '\\cosh', tanh: '\\tanh', log: '\\ln', log2: '\\log_2',
        sign: '\\operatorname{sgn}', round: '\\operatorname{round}', trunc: '\\operatorname{trunc}',
        fract: '\\operatorname{frac}', atan2: '\\operatorname{atan2}' })[f] ?? `\\operatorname{${f}}`}\\left(${args.join(', ')}\\right)`,
    floor: a => `\\left\\lfloor ${a} \\right\\rfloor`, ceil: a => `\\left\\lceil ${a} \\right\\rceil`,
    exp: a => `e^{${a}}`, exp2: a => `2^{${a}}`, isqrt: a => `\\frac{1}{\\sqrt{${a}}}`,
    mod: (a, b) => `${a} \\bmod ${b}`,
    cmp: { lt: '<', le: '\\le', gt: '>', ge: '\\ge', eq: '=', ne: '\\ne' },
    and: (a, b) => `${a} \\wedge ${b}`, or: (a, b) => `${a} \\vee ${b}`, not: a => `\\neg ${a}`,
    cases: rows => `\\begin{cases} ${rows.map(([v, c], i) => `${v} & ${c === null ? '\\text{anders}' : `\\text{${i ? 'anders, als' : 'als'} } ${c}`}`).join(' \\\\ ')} \\end{cases}`,
}
const TEXT = {
    num(n, d) {
        const q = numberParts(n, d)
        if (q.kind === 'bool') return q.v ? 'waar' : 'onwaar'
        if (q.kind === 'inf') return q.nan ? 'NaN' : `${q.neg ? '−' : ''}∞`
        const sup = String(q.exp ?? '').replace(/[-\d]/g, c => SUP[c])
        const body = q.kind === 'sci' ? (q.mant === '1' ? `10${sup}` : `${q.mant}·10${sup}`) : q.s
        return (q.neg ? '−' : '') + body
    },
    var: v => v,
    paren: s => `(${s})`,
    add: (a, b) => `${a} + ${b}`, sub: (a, b) => `${a} − ${b}`, neg: a => `−${a}`,
    // a number before a letter or a bracket is a product as written by hand (0.94x, 3(y − 20)); before a number or a
    // function's name it takes a dot (0.25·max(...))
    coef: (c, a) => `${c}${/^(\d|[a-zA-Z]{2,}\()/.test(a) ? '·' : ''}${a}`, mul: (a, b) => `${a}·${b}`,
    frac: (a, b) => `${a} / ${b}`,
    sq: a => `${a}²`, pow: (a, b) => `${a}^(${b})`,
    sqrt: a => `√(${a})`, abs: a => `|${a}|`,
    fn: (f, args) => `${({ log: 'ln', sign: 'sgn', fract: 'frac' })[f] ?? f}(${args.join(', ')})`,
    floor: a => `⌊${a}⌋`, ceil: a => `⌈${a}⌉`,
    exp: a => `e^(${a})`, exp2: a => `2^(${a})`, isqrt: a => `1/√(${a})`,
    mod: (a, b) => `${a} mod ${b}`,
    cmp: { lt: '<', le: '≤', gt: '>', ge: '≥', eq: '=', ne: '≠' },
    and: (a, b) => `${a} ∧ ${b}`, or: (a, b) => `${a} ∨ ${b}`, not: a => `¬${a}`,
    cases: rows => rows,              // laid out by toMath, over several lines
}

function writer(N, named, digits, nameOf) {
    const show = v => {
        if (!isNode(v)) return [N.num(v, digits), typeof v === 'number' && v < 0 ? P.neg : P.atom]
        if (named.has(v)) return [nameOf(v), P.atom]
        if (v.op === 'var') return [N.var(v.a[0]), P.atom]
        return write(v)
    }
    const at = (v, p) => { const [s, q] = show(v); return q < p ? N.paren(s) : s }
    const flat = (n, op, top = true) => isNode(n) && n.op === op && (top || !named.has(n))
        ? [...flat(n.a[0], op, false), ...flat(n.a[1], op, false)] : [n]
    /* branches as rows [value, condition], read top down, the first whose condition holds: c1 ? (c2 ? a : b) : d
       is a when c1 and c2, else b when c1, else d. The last row has no condition ("anders"). */
    const rows = n => {
        const out = []
        const go = (v, guard) => {
            if (isNode(v) && v.op === 'sel' && (v === n || !named.has(v))) {
                go(v.a[1], and(guard, v.a[0]))
                go(v.a[2], guard)
            } else out.push([show(v)[0], guard === true ? null : show(guard)[0]])
        }
        go(n, true)
        return out
    }
    function write(n) {
        const { op, a } = n
        switch (op) {
            case 'add': return [N.add(at(a[0], P.add), at(a[1], P.add)), P.add]
            case 'sub': return [N.sub(at(a[0], P.add), at(a[1], P.add + 1)), P.add]
            case 'neg': return [N.neg(at(a[0], P.mul)), P.neg]
            case 'mul': {
                if (a[0] === a[1]) return [N.sq(at(a[0], P.atom)), P.pow]
                // a constant factor in front of the rest: 0.94 x, -0.34 (y - 20)
                if (typeof a[1] === 'number') {
                    const c = N.num(a[1], digits)
                    return [N.coef(c, at(a[0], a[1] < 0 ? P.mul + 1 : P.mul + 1)), a[1] < 0 ? P.neg : P.mul]
                }
                return [N.mul(at(a[0], P.mul), at(a[1], P.mul + 1)), P.mul]
            }
            case 'div': return N === LATEX ? [N.frac(show(a[0])[0], show(a[1])[0]), P.atom] : [N.frac(at(a[0], P.mul), at(a[1], P.pow)), P.mul]
            case 'mod': return [N.mod(at(a[0], P.mul), at(a[1], P.pow)), P.mul]
            case 'pow': return [N.pow(at(a[0], P.atom), show(a[1])[0]), P.pow]
            case 'sqrt': return [N.sqrt(show(a[0])[0]), P.atom]
            case 'abs': return [N.abs(show(a[0])[0]), P.atom]
            case 'floor': return [N.floor(show(a[0])[0]), P.atom]
            case 'ceil': return [N.ceil(show(a[0])[0]), P.atom]
            case 'exp': return [N.exp(show(a[0])[0]), P.pow]
            case 'exp2': return [N.exp2(show(a[0])[0]), P.pow]
            case 'inversesqrt': return [N.isqrt(show(a[0])[0]), N === LATEX ? P.atom : P.mul]
            case 'min': case 'max': return [N.fn(op, flat(n, op).map(x => show(x)[0])), P.atom]
            case 'and': return [N.and(at(a[0], P.and), at(a[1], P.and)), P.and]
            case 'or': return [N.or(at(a[0], P.or), at(a[1], P.or)), P.or]
            case 'not': return [N.not(at(a[0], P.atom)), P.neg]
            case 'sel': return [N.cases(rows(n)), P.atom]
        }
        if (CMP.has(op)) return [`${at(a[0], P.add)} ${N.cmp[op]} ${at(a[1], P.add)}`, P.cmp]
        return [N.fn(op, a.map(x => show(x)[0])), P.atom]
    }
    return { show, write, rows }
}

/**
 * The formula in mathematical notation.
 * @param {'latex' | 'text'} notation
 * @returns {{ result: string, defs: { name: string, body: string | string[][] }[] }}  (text's cases: rows)
 */
export function math(root, { labels = new Map(), inline = false, digits = 6, notation = 'latex' } = {}) {
    const N = notation === 'latex' ? LATEX : TEXT
    const { order, named } = plan(root, labels, inline)
    if (inline) {
        const size = new Map()
        for (const n of topo([root])) size.set(n, 1 + n.a.reduce((s, c) => s + (isNode(c) ? size.get(c) : 1), 0))
        if (size.get(root) > 2e5) throw new Error(`de formule in één stuk zou ${size.get(root).toExponential(1)} termen hebben: zet inline uit`)
    }
    const nameOf = n => named.get(n)[notation === 'latex' ? 'latex' : 'text']
    const W = writer(N, named, digits, nameOf)
    const body = n => (isNode(n) && !named.has(n)) || n === root ? W.write(n)[0] : W.show(n)[0]
    const defs = order.map(n => ({ name: nameOf(n), body: W.write(n)[0] }))
    return { result: isNode(root) && root.op !== 'var' && !named.has(root) ? W.write(root)[0] : W.show(root)[0], defs }
}

/** LaTeX, one equation an entry: [lhs, rhs], f first, then its parts (the page renders each with KaTeX). */
export function latexLines(root, opts = {}) {
    const { result, defs } = math(root, { ...opts, notation: 'latex' })
    return [['f(x, y, z)', result], ...defs.map(d => [d.name, d.body])]
}
/** LaTeX for a document: one align* (amsmath), f first, then "waarin" and its parts. */
export function toLatex(root, opts = {}) {
    const [f, ...rest] = latexLines(root, opts)
    const row = ([l, r]) => `  ${l} &= ${r}`
    return ['% needs \\usepackage{amsmath}; \\allowdisplaybreaks lets a long one break across pages',
        '\\begin{align*}', row(f) + (rest.length ? ' \\\\' : ''),
        ...(rest.length ? ['  &\\text{waarin} \\\\', rest.map(row).join(' \\\\\n')] : []),
        '\\end{align*}', ''].join('\n')
}

/** Unicode text: f(x, y, z) = ..., waarin each part, a brace of cases over several lines. */
export function toMath(root, opts = {}) {
    const { result, defs } = math(root, { ...opts, notation: 'text' })
    const eq = (lhs, rhs) => {
        if (!Array.isArray(rhs)) return [`${lhs} = ${rhs}`]
        const w = Math.max(...rhs.map(r => r[0].length))
        const pad = ' '.repeat(lhs.length + 3)
        return rhs.map(([v, c], i) => {
            const brace = rhs.length === 1 ? '{' : i === 0 ? '⎧' : i === rhs.length - 1 ? '⎩' : i === Math.floor((rhs.length - 1) / 2) ? '⎨' : '⎪'
            return `${i === 0 ? `${lhs} = ` : pad}${brace} ${v.padEnd(w)}   ${c === null ? 'anders' : `${i ? 'anders, als' : 'als'} ${c}`}`
        })
    }
    const lines = [...eq('f(x, y, z)', result)]
    if (defs.length) {
        lines.push('', 'waarin')
        // the equals signs under each other
        const w = Math.max(...defs.map(d => d.name.length))
        for (const d of defs) lines.push(...eq(d.name.padEnd(w), d.body).map(l => '  ' + l))
    }
    return lines.join('\n').replace(/\n+$/, '') + '\n'
}
