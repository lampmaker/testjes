//======================================================================================================================
// A SYMBOLIC WGSL INTERPRETER: runs a scene's code -- an object's `C = add_new(C, Nsphere(p, radius), MATERIAL);`, a
// group's twist, the library functions they call (prelude.js, ShadyTracer's own WGSL) -- with the point p as the
// variables x, y, z and everything else numbers, and gives back the distance as an expression (expr.js).
//
// VALUES: a scalar is a number, a boolean or an expression node; a vector { t: 'vec', c: [scalars] }; a struct
// { t: 'struct', name, f: { field: value } } (a Hit among them); an array { t: 'arr', items }; and OPAQUE
// { t: 'opaque' } for what the distance never needs -- a ray, a material index, a rotation matrix for normals. Opaque
// in, opaque out; only if the distance itself turns out opaque is that an error.
//
// BRANCHES on the point: both sides run, and every variable they leave different is merged as a select,
// c ? a : b. A branch on a number is decided and only its side runs. A `return` under a condition on the point is
// remembered with it (the state's `done`, a condition, and `ret`): the code after it still runs, and a later return
// only counts where the earlier did not. Loops must be decided by numbers (a parameter, a count): they are unrolled.
//======================================================================================================================
import * as X from './expr.js'
import { parseModule, parseStatements, parseExpression, splitModule, WGSLError } from './wgsl.js'

export const vec = c => ({ t: 'vec', c })
export const OPAQUE = Object.freeze({ t: 'opaque' })
const isScalar = v => typeof v === 'number' || typeof v === 'boolean' || X.isNode(v)
export const isVec = v => v?.t === 'vec'
const isOpaque = v => v?.t === 'opaque'

const LOOP_LIMIT = 100000      // iterations in all, per code run: a loop that does not end is a mistake, not a scene

/* THE SHORTHAND (lib/wgsl_shorthand.js TOKENS) and the WGSL types, as constructors */
const VEC_TYPES = { VEC2: 2, VEC3: 3, VEC4: 4, V: 2, W: 3, X: 4, vec2: 2, vec3: 3, vec4: 4, vec2f: 2, vec3f: 3, vec4f: 4,
                    vec2i: 2, vec3i: 3, vec4i: 4, vec2u: 2, vec3u: 3, vec4u: 4, U3: 3 }
const SCALAR_TYPES = new Set(['f32', 'FLOAT', 'F', 'f16', 'i32', 'INT', 'I', 'u32', 'U', 'bool'])
export const CONSTANTS = { PI: 3.14159265359, TAU: 6.28318530718, EPS: 1e-5 }
const vecSize = name => {
    const m = /^vec([234])(<.*>)?$/.exec(name)
    return m ? +m[1] : VEC_TYPES[name]
}

function typeZero(type, prog) {
    if (!type) return 0
    if (SCALAR_TYPES.has(type) || /^(f32|i32|u32|f16)$/.test(type)) return type === 'bool' ? false : 0
    const n = vecSize(type.replace(/<.*/, ''))
    if (n) return vec(Array(n).fill(/bool/.test(type) ? false : 0))
    const S = prog.struct(type)
    if (S) return { t: 'struct', name: type, f: Object.fromEntries(S.fields.map(f => [f.name, typeZero(f.type, prog)])) }
    const arr = /^array<(.+),\s*(\d+)i?>$/.exec(type)
    if (arr) return { t: 'arr', items: Array.from({ length: +arr[2] }, () => typeZero(arr[1].trim(), prog)) }
    return OPAQUE
}

/* ---- the arithmetic on values: componentwise, a scalar against a vector spread over it ---- */
function zip(f, ...args) {
    if (args.some(isOpaque)) return OPAQUE
    const vs = args.filter(isVec)
    if (!vs.length) {
        if (!args.every(isScalar)) throw new WGSLError(`an operation on a ${args.map(a => a?.t ?? typeof a).join(' and ')}`)
        return f(...args)
    }
    const n = vs[0].c.length
    if (vs.some(v => v.c.length !== n)) throw new WGSLError('vectors of different sizes')
    return vec(Array.from({ length: n }, (_, k) => f(...args.map(a => isVec(a) ? a.c[k] : a))))
}
const BINOPS = {
    '+': X.add, '-': X.sub, '*': X.mul, '/': X.div, '%': X.mod,
    '<': X.lt, '<=': X.le, '>': X.gt, '>=': X.ge, '==': X.eq, '!=': X.ne,
    '&&': X.and, '||': X.or,
    '&': (a, b) => intOp(a, b, (x, y) => x & y, '&'), '|': (a, b) => intOp(a, b, (x, y) => x | y, '|'),
    '^': (a, b) => intOp(a, b, (x, y) => x ^ y, '^'), '<<': (a, b) => intOp(a, b, (x, y) => x << y, '<<'),
    '>>': (a, b) => intOp(a, b, (x, y) => x >>> y, '>>'),
}
function intOp(a, b, f, op) {
    if (typeof a === 'boolean' && typeof b === 'boolean' && (op === '&' || op === '|')) return op === '&' ? a && b : a || b
    if (typeof a === 'boolean' || typeof b === 'boolean') return op === '&' ? X.and(a, b) : op === '|' ? X.or(a, b) : X.ne(a, b)
    if (typeof a === 'number' && typeof b === 'number') return f(a, b)
    throw new WGSLError(`the bit operation ${op} on a value that depends on the point`)
}
export function binop(op, a, b) {
    if (op === '*' && (isOpaque(a) || isOpaque(b))) return OPAQUE           // a matrix times a vector: normals
    const f = BINOPS[op]
    if (!f) throw new WGSLError(`the operator ${op}`)
    return zip(f, a, b)
}

/* ---- the builtins ---- */
const sum = c => c.reduce((s, x) => X.add(s, x), 0)
const dotv = (a, b) => isVec(a) ? sum(a.c.map((x, k) => X.mul(x, b.c[k]))) : X.mul(a, b)
const lengthv = a => isVec(a) ? X.sqrt(dotv(a, a)) : X.abs(a)
const cwise = f => (...a) => zip(f, ...a)
const toInt = x => typeof x === 'number' ? Math.trunc(x) : typeof x === 'boolean' ? +x : X.trunc(x)
const smooth = (e0, e1, x) => { const t = X.clamp(X.div(X.sub(x, e0), X.sub(e1, e0)), 0, 1); return X.mul(X.mul(t, t), X.sub(3, X.mul(2, t))) }
export const BUILTINS = {
    abs: cwise(X.abs), sign: cwise(X.sign), floor: cwise(X.floor), ceil: cwise(X.ceil), round: cwise(X.round),
    fract: cwise(X.fract), trunc: cwise(X.trunc), sqrt: cwise(X.sqrt), inverseSqrt: cwise(X.inversesqrt),
    sin: cwise(X.sin), cos: cwise(X.cos), tan: cwise(X.tan), asin: cwise(X.asin), acos: cwise(X.acos),
    atan: cwise(X.atan), atan2: cwise(X.atan2), exp: cwise(X.exp), log: cwise(X.log), exp2: cwise(X.exp2),
    log2: cwise(X.log2), sinh: cwise(X.sinh), cosh: cwise(X.cosh), tanh: cwise(X.tanh), pow: cwise(X.pow),
    min: cwise(X.min), max: cwise(X.max), clamp: cwise(X.clamp), saturate: cwise(x => X.clamp(x, 0, 1)),
    fma: cwise((a, b, c) => X.add(X.mul(a, b), c)),
    mix: cwise((a, b, t) => X.add(X.mul(a, X.sub(1, t)), X.mul(b, t))),
    step: cwise((e, x) => X.sel(X.ge(x, e), 1, 0)),
    smoothstep: cwise(smooth),
    degrees: cwise(x => X.mul(x, 180 / Math.PI)), radians: cwise(x => X.mul(x, Math.PI / 180)),
    select: (f, t, c) => isVec(c) ? zip((fv, tv, cv) => X.sel(cv, tv, fv), f, t, c)
                                 : (isOpaque(f) || isOpaque(t)) ? (f === t ? f : OPAQUE) : merge(c, t, f),
    all: v => isVec(v) ? v.c.reduce((s, x) => X.and(s, x), true) : v,
    any: v => isVec(v) ? v.c.reduce((s, x) => X.or(s, x), false) : v,
    length: v => isOpaque(v) ? OPAQUE : lengthv(v),
    distance: (a, b) => lengthv(binop('-', a, b)),
    dot: (a, b) => (isOpaque(a) || isOpaque(b)) ? OPAQUE : dotv(a, b),
    cross: (a, b) => (isOpaque(a) || isOpaque(b)) ? OPAQUE : vec([
        X.sub(X.mul(a.c[1], b.c[2]), X.mul(a.c[2], b.c[1])),
        X.sub(X.mul(a.c[2], b.c[0]), X.mul(a.c[0], b.c[2])),
        X.sub(X.mul(a.c[0], b.c[1]), X.mul(a.c[1], b.c[0]))]),
    normalize: v => isOpaque(v) ? OPAQUE : binop('/', v, lengthv(v)),
    reflect: (e, n) => binop('-', e, binop('*', n, X.mul(2, dotv(n, e)))),
    faceForward: (n, i, r) => BUILTINS.select(BUILTINS['-'](n), n, X.lt(dotv(r, i), 0)),
    '-': v => zip(X.neg, v),
    f32: x => zip(x => typeof x === 'boolean' ? +x : x, x), f16: x => zip(x => x, x),
    i32: x => zip(toInt, x), u32: x => zip(toInt, x), bool: x => zip(x => typeof x === 'boolean' ? x : X.ne(x, 0), x),
    noUnroll: x => x,
    transpose: () => OPAQUE, determinant: () => OPAQUE, inverse: () => OPAQUE,
    dpdx: () => OPAQUE, dpdy: () => OPAQUE, fwidth: () => OPAQUE,
    arrayLength: () => { throw new WGSLError('arrayLength: a runtime array') },
}
for (const k of ['FLOAT', 'F']) BUILTINS[k] = BUILTINS.f32
for (const k of ['INT', 'I']) BUILTINS[k] = BUILTINS.i32
BUILTINS.U = BUILTINS.u32

/* a vector constructor: splat one scalar, or the components of its arguments in order */
function construct(n, args) {
    if (args.some(isOpaque)) return OPAQUE
    if (!args.length) return vec(Array(n).fill(0))
    if (args.length === 1 && isScalar(args[0])) return vec(Array(n).fill(args[0]))
    const c = args.flatMap(a => isVec(a) ? a.c : [a])
    if (c.length !== n) throw new WGSLError(`vec${n} made of ${c.length} components`)
    return vec(c)
}

/** The two values as one: a where c holds, b elsewhere. */
export function merge(c, a, b) {
    if (a === b) return a
    if (a === undefined) return b
    if (b === undefined) return a
    if (isScalar(a) && isScalar(b)) return X.sel(c, a, b)
    if (isOpaque(a) || isOpaque(b)) return OPAQUE
    if (isVec(a) && isVec(b) && a.c.length === b.c.length) return vec(a.c.map((x, k) => merge(c, x, b.c[k])))
    if (a.t === 'struct' && b.t === 'struct' && a.name === b.name)
        return { t: 'struct', name: a.name, f: Object.fromEntries(Object.keys(a.f).map(k => [k, merge(c, a.f[k], b.f[k])])) }
    if (a.t === 'arr' && b.t === 'arr' && a.items.length === b.items.length) return { t: 'arr', items: a.items.map((x, k) => merge(c, x, b.items[k])) }
    if (a.t && a.t === b.t && a.t !== 'vec' && a.t !== 'struct' && a.t !== 'arr') return a     // a profile, a path: a parameter, never merged
    throw new WGSLError('two branches leave a variable as different kinds of value')
}

const SWZ = { x: 0, y: 1, z: 2, w: 3, r: 0, g: 1, b: 2, a: 3 }
function member(o, name) {
    if (isOpaque(o)) return OPAQUE
    if (isVec(o)) {
        const ks = [...name].map(ch => SWZ[ch])
        if (ks.some(k => k === undefined || k >= o.c.length)) throw new WGSLError(`no .${name} on a vec${o.c.length}`)
        return ks.length === 1 ? o.c[ks[0]] : vec(ks.map(k => o.c[k]))
    }
    if (o?.t === 'struct') {
        if (!(name in o.f)) throw new WGSLError(`no field ${name} in ${o.name}`)
        return o.f[name]
    }
    if (o && typeof o === 'object' && o.t && o.members && name in o.members) return o.members[name]
    throw new WGSLError(`.${name} of a ${o?.t ?? typeof o}`)
}
function withMember(o, name, val) {
    if (isOpaque(o)) return OPAQUE
    if (isVec(o)) {
        const ks = [...name].map(ch => SWZ[ch]), c = o.c.slice()
        if (ks.length === 1) c[ks[0]] = val
        else ks.forEach((k, i) => { c[k] = val.c[i] })
        return vec(c)
    }
    if (o?.t === 'struct') return { ...o, f: { ...o.f, [name]: val } }
    throw new WGSLError(`.${name} = on a ${o?.t ?? typeof o}`)
}
const constIndex = i => {
    if (typeof i !== 'number') throw new WGSLError('an index that depends on the point')
    return i
}

/* ---- the state of a run: scopes of variables, and whether (where) it has returned ---- */
class State {
    constructor(scopes = [new Map()]) { this.scopes = scopes; this.done = false; this.ret = undefined; this.flow = null; this.loops = 0 }
    clone() { const s = new State(this.scopes.map(m => new Map(m))); s.done = this.done; s.ret = this.ret; s.loops = this.loops; return s }
    find(name) { for (let i = this.scopes.length - 1; i >= 0; i--) if (this.scopes[i].has(name)) return this.scopes[i]; return null }
    declare(name, v) { this.scopes[this.scopes.length - 1].set(name, v) }
    /* the state after `if (c) A else B`, each run from this one */
    takeMerged(c, A, B) {
        this.scopes.forEach((m, k) => { for (const name of m.keys()) m.set(name, merge(c, A.scopes[k].get(name), B.scopes[k].get(name))) })
        this.ret = A.done === false ? B.ret : B.done === false ? A.ret : merge(c, A.ret, B.ret)
        this.done = X.sel(c, A.done, B.done)
        this.loops = Math.max(A.loops, B.loops)
    }
}
const jumps = list => list?.some(s => s.k === 'break' || s.k === 'continue' ||
    (s.k === 'if' && (jumps(s.then) || jumps(s.else))) || (s.k === 'block' && jumps(s.body)))

/**
 * The library and a scene's own functions, parsed as they are first called.
 */
export class Program {
    constructor(...sources) {
        this.items = new Map()
        for (const src of sources) if (src) for (const [k, v] of splitModule(src)) this.items.set(k, v)
        this.parsed = new Map()
        this.structs = new Map([['Hit', { fields: [{ name: 'r', type: 'Ray' }, { name: 's', type: 'vec4<f32>' },
            { name: 'm', type: 'u32' }, { name: 'a', type: 'u32' }, { name: 'insideW', type: 'f32' }] }]])
        this.globals = new Map()
    }
    /** More functions (a scene's own, a generated profile's), later ones winning. */
    add(src) { for (const [k, v] of splitModule(src)) { this.items.set(k, v); this.parsed.delete(k); this.globals.delete(k) } }
    item(name) {
        if (this.parsed.has(name)) return this.parsed.get(name)
        const it = this.items.get(name)
        if (!it) return null
        const [ast] = parseModule(it.src)
        this.parsed.set(name, ast)
        return ast
    }
    struct(name) {
        if (this.structs.has(name)) return this.structs.get(name)
        const it = this.items.get(name)
        if (it?.kind !== 'struct') return null
        const ast = this.item(name)
        this.structs.set(name, ast)
        return ast
    }
    global(name, interp) {
        if (this.globals.has(name)) return this.globals.get(name)
        const it = this.items.get(name)
        if (it?.kind !== 'global') return undefined
        const ast = this.item(name)
        const v = ast.init ? interp.expr(ast.init, new State()) : typeZero(ast.type, this)
        this.globals.set(name, v)
        return v
    }
}

/**
 * Runs code. `hooks`: functions the caller answers itself (add_new, children, ...), as (args, state, interp) => value;
 * they win over the library's of the same name.
 */
export class Interp {
    constructor(prog, hooks = {}) { this.prog = prog; this.hooks = hooks; this.steps = 0; this.depth = 0 }

    /** Statements (an object's or a group's code) run in a state whose outer scope holds `vars`. */
    run(code, vars) {
        const st = new State([new Map(Object.entries(vars))])
        st.scopes.push(new Map())
        this.list(typeof code === 'string' ? parseStatements(code) : code, st)
        st.scopes.pop()
        return st.scopes[0]
    }
    /** One expression with these variables (a profile point written as text). */
    value(src, vars) { return this.expr(parseExpression(src), new State([new Map(Object.entries(vars))])) }

    call(name, args, st, line) {
        if (this.hooks[name]) return this.hooks[name](args, st, this)
        const n = vecSize(name)
        if (n) return construct(n, args)
        const base = name.replace(/<.*$/, '')
        // a builtin, unless the library defines a function of that name itself
        if (BUILTINS[base] && !this.prog.items.has(base)) return BUILTINS[base](...args)
        if (/^mat\d/.test(base) || base === 'MAT4') return OPAQUE
        if (base === 'array') return { t: 'arr', items: args }
        const S = this.prog.struct(base)
        if (S) {
            if (!args.length) return typeZero(base, this.prog)
            return { t: 'struct', name: base, f: Object.fromEntries(S.fields.map((f, i) => [f.name, args[i]])) }
        }
        const fn = this.prog.item(name)
        if (fn?.kind === 'fn') return this.invoke(fn, args)
        throw new WGSLError(`no function '${name}' (not in ShadyTracer's library, nor the scene's functions)`, line)
    }
    invoke(fn, args) {
        if (args.length !== fn.params.length) throw new WGSLError(`${fn.name} takes ${fn.params.length} arguments, given ${args.length}`, fn.line)
        if (++this.depth > 64) throw new WGSLError(`${fn.name}: calls nested too deep (recursion is not WGSL)`)
        const st = new State([new Map(fn.params.map((p, i) => [p.name, args[i]]))])
        try { this.list(fn.body, st) } finally { this.depth-- }
        if (fn.ret && st.ret === undefined) throw new WGSLError(`${fn.name} returned nothing`, fn.line)
        return st.ret
    }

    lookup(name, st, line) {
        const scope = st.find(name)
        if (scope) return scope.get(name)
        if (name in CONSTANTS) return CONSTANTS[name]
        const g = this.prog.global(name, this)
        if (g !== undefined) return g
        if (this.hooks['$' + name]) return this.hooks['$' + name](st, this)
        throw new WGSLError(`unknown name '${name}'`, line)
    }

    expr(e, st) {
        switch (e.k) {
            case 'num': return e.v
            case 'id': return this.lookup(e.name, st, e.line)
            case 'un': {
                const v = this.expr(e.e, st)
                if (e.op === '-') return zip(X.neg, v)
                if (e.op === '!') return zip(X.not, v)
                return zip(x => { if (typeof x !== 'number') throw new WGSLError('~ on the point', e.line); return ~x }, v)
            }
            case 'bin': {
                // && and || short-circuit on a decided left side, as WGSL does: the right side may not be valid then
                if (e.op === '&&' || e.op === '||') {
                    const l = this.expr(e.l, st)
                    if (l === (e.op === '||')) return l
                    if (typeof l === 'boolean') return this.expr(e.r, st)
                    return binop(e.op, l, this.expr(e.r, st))
                }
                return binop(e.op, this.expr(e.l, st), this.expr(e.r, st))
            }
            case 'call': {
                const args = e.args.map(a => this.expr(a, st))
                try { return this.call(e.name, args, st, e.line) } catch (err) {
                    if (err instanceof WGSLError && !err.message.includes(' in ') && err.line == null) err.message += ` in ${e.name}()`
                    throw err
                }
            }
            case 'member': return member(this.expr(e.obj, st), e.name)
            case 'index': {
                const o = this.expr(e.obj, st), i = constIndex(this.expr(e.index, st))
                if (isOpaque(o)) return OPAQUE
                if (isVec(o)) return o.c[i]
                if (o?.t === 'arr') return o.items[i]
                throw new WGSLError('[] on something not an array', e.line)
            }
        }
        throw new WGSLError(`an expression of kind ${e.k}`, e.line)
    }

    /* assignment: the name at the root of the target, and the path of members and indices below it */
    assign(target, value, st, line) {
        const path = []
        let t = target
        while (t.k === 'member' || t.k === 'index') { path.unshift(t.k === 'member' ? { m: t.name } : { i: constIndex(this.expr(t.index, st)) }); t = t.obj }
        if (t.k !== 'id') throw new WGSLError('assignment to something that is not a variable', line)
        if (t.name === '_') return
        const scope = st.find(t.name)
        if (!scope) {
            if (this.hooks['=' + t.name]) return this.hooks['=' + t.name](value, st)
            throw new WGSLError(`assignment to '${t.name}', which is not declared`, line)
        }
        const put = (o, k) => {
            if (k === path.length) return value
            const s = path[k]
            if (s.m !== undefined) return withMember(o, s.m, put(member(o, s.m), k + 1))
            if (isVec(o)) { const c = o.c.slice(); c[s.i] = put(o.c[s.i], k + 1); return vec(c) }
            if (o?.t === 'arr') { const items = o.items.slice(); items[s.i] = put(o.items[s.i], k + 1); return { t: 'arr', items } }
            if (isOpaque(o)) return OPAQUE
            throw new WGSLError('[] = on something not an array', line)
        }
        scope.set(t.name, put(scope.get(t.name), 0))
    }

    list(stmts, st) {
        for (const s of stmts) {
            if (st.done === true || st.flow) return
            this.stmt(s, st)
        }
    }
    block(stmts, st) { st.scopes.push(new Map()); try { this.list(stmts, st) } finally { st.scopes.pop() } }

    stmt(s, st) {
        if (++this.steps > 5e6) throw new WGSLError('the code ran too long (5 million statements)')
        switch (s.k) {
            case 'let': case 'const': case 'var': {
                const v = s.init ? this.expr(s.init, st) : typeZero(s.type, this.prog)
                st.declare(s.name, v)
                return
            }
            case 'assign': {
                let v = this.expr(s.value, st)
                if (s.op !== '=') v = binop(s.op.slice(0, -1), this.expr(s.target, st), v)
                this.assign(s.target, v, st, s.line)
                return
            }
            case 'expr': this.expr(s.e, st); return
            case 'block': this.block(s.body, st); return
            case 'return': {
                const v = s.e ? this.expr(s.e, st) : null
                st.ret = st.done === false ? v : merge(st.done, st.ret, v)
                st.done = true
                return
            }
            case 'break': case 'continue':
                if (!st.loops) throw new WGSLError(`${s.k} outside a loop`, s.line)
                st.flow = s.k
                return
            case 'discard': throw new WGSLError('discard in scene code', s.line)
            case 'if': {
                const c = this.expr(s.cond, st)
                if (isVec(c)) throw new WGSLError('if on a vector of booleans', s.line)
                if (typeof c === 'boolean') { const b = c ? s.then : s.else; if (b) this.block(b, st); return }
                if (jumps(s.then) || jumps(s.else))
                    throw new WGSLError('break or continue under a condition on the point: a loop the formula cannot unroll', s.line)
                const A = st.clone(), B = st.clone()
                this.block(s.then, A)
                if (s.else) this.block(s.else, B)
                st.takeMerged(c, A, B)
                return
            }
            case 'for': case 'while': {
                st.scopes.push(new Map())
                st.loops++
                try {
                    if (s.init) this.stmt(s.init, st)
                    let n = 0
                    for (;;) {
                        if (s.cond) {
                            const c = this.expr(s.cond, st)
                            if (typeof c !== 'boolean') throw new WGSLError('a loop whose end depends on the point: the formula cannot unroll it', s.line)
                            if (!c) break
                        }
                        if (++n > LOOP_LIMIT) throw new WGSLError(`a loop that ran ${LOOP_LIMIT} times`, s.line)
                        const body = s.body.filter(b => b.k !== 'continuing')
                        this.block(body, st)
                        if (st.flow === 'break') { st.flow = null; break }
                        st.flow = null
                        if (st.done === true) break
                        if (s.update) s.update.k === 'continuing' ? this.block(s.update.body, st) : this.stmt(s.update, st)
                    }
                } finally { st.loops--; st.scopes.pop() }
                return
            }
            case 'continuing': return
        }
        throw new WGSLError(`a statement of kind ${s.k}`, s.line)
    }
}
