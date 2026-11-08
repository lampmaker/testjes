//======================================================================================================================
// A WGSL PARSER for the part of the language a ShadyTracer scene's code is written in: functions, structs, module
// constants, let / var / const, assignment (= += -= *= /= %=, ++ --), if / else, for, while, loop, break, continue,
// return, blocks, and expressions with WGSL's precedence, calls (a type with its template too: vec3<f32>(...)),
// member access and indexing. Attributes (@...) are skipped, types are read and kept as text.
//
// The scene's shorthand (lib/wgsl_shorthand.js TOKENS: VEC3 for vec3<f32>, FLOAT, PI...) is not expanded here: the
// interpreter knows those names.
//======================================================================================================================

export class WGSLError extends Error {
    constructor(msg, line) { super(line ? `${msg} (line ${line})` : msg); this.line = line }
}

const PUNCT = ['<<=', '>>=', '->', '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
               '++', '--', '<<', '>>']
const SINGLE = '+-*/%<>=!&|^~(){}[],;:.@?'

/** Tokens: { t: 'num' | 'id' | 'op', v, line, suffix? } */
export function lex(src) {
    const out = []
    let i = 0, line = 1
    const n = src.length
    while (i < n) {
        const c = src[i]
        if (c === '\n') { line++; i++; continue }
        if (/\s/.test(c)) { i++; continue }
        if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue }
        if (c === '/' && src[i + 1] === '*') {            // block comments nest in WGSL
            let depth = 1; i += 2
            while (i < n && depth) {
                if (src[i] === '\n') line++
                if (src[i] === '/' && src[i + 1] === '*') { depth++; i += 2 } else if (src[i] === '*' && src[i + 1] === '/') { depth--; i += 2 } else i++
            }
            continue
        }
        const num = /^(0[xX][0-9a-fA-F]+|(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?)([fhiu])?/.exec(src.slice(i, i + 64))
        if (num && (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1])))) {
            const text = num[1], suffix = num[4] || ''
            const v = /^0[xX]/.test(text) ? parseInt(text, 16) : parseFloat(text)
            out.push({ t: 'num', v, int: suffix === 'u' || suffix === 'i' || (!suffix && /^(0[xX][0-9a-fA-F]+|\d+)$/.test(text)), line })
            i += num[0].length
            continue
        }
        const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i, i + 256))
        if (id) { out.push({ t: 'id', v: id[0], line }); i += id[0].length; continue }
        const p = PUNCT.find(s => src.startsWith(s, i))
        if (p) { out.push({ t: 'op', v: p, line }); i += p.length; continue }
        if (SINGLE.includes(c)) { out.push({ t: 'op', v: c, line }); i++; continue }
        throw new WGSLError(`unexpected character '${c}'`, line)
    }
    out.push({ t: 'eof', v: '', line })
    return out
}

const TEMPLATED = /^(vec[234]|mat[234]x[234]|array|ptr|atomic|texture\w*)$/
const BIN = [
    ['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '<=', '>', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%'],
]

class Parser {
    constructor(src) { this.k = lex(src); this.i = 0 }
    get cur() { return this.k[this.i] }
    peek(o = 1) { return this.k[this.i + o] }
    is(v, t = 'op') { const c = this.cur; return c.t === t && (v == null || c.v === v) }
    eat(v, t = 'op') { if (this.is(v, t)) { return this.k[this.i++] } return null }
    want(v, t = 'op') {
        const c = this.eat(v, t)
        if (!c) throw new WGSLError(`expected '${v ?? t}' but found '${this.cur.v || 'the end'}'`, this.cur.line)
        return c
    }
    ident() { return this.want(null, 'id').v }

    attributes() {
        while (this.eat('@')) {
            this.ident()
            if (this.is('(')) this.balanced('(', ')')
        }
    }
    balanced(open, close) {
        let depth = 0
        do {
            const c = this.k[this.i++]
            if (c.t === 'eof') throw new WGSLError(`unclosed '${open}'`, c.line)
            if (c.t === 'op' && c.v === open) depth++
            if (c.t === 'op' && c.v === close) depth--
        } while (depth)
    }
    /* a type as text: name, or name<...> (nested), as written */
    type() {
        let s = this.ident()
        if (this.is('<')) s += this.template()
        return s
    }
    template() {
        let s = '', depth = 0
        do {
            const c = this.k[this.i++]
            if (c.t === 'eof') throw new WGSLError('unclosed template', c.line)
            if (c.v === '<') depth++
            if (c.v === '>') depth--
            if (c.v === '>>') depth -= 2
            s += c.v
        } while (depth > 0)
        return s
    }

    module() {
        const items = []
        while (!this.is(null, 'eof')) {
            this.attributes()
            if (this.eat(';')) continue
            const kw = this.cur
            if (this.eat('fn', 'id')) items.push(this.fn(kw.line))
            else if (this.eat('struct', 'id')) items.push(this.struct(kw.line))
            else if (this.is('const', 'id') || this.is('let', 'id') || this.is('var', 'id') || this.is('override', 'id')) {
                const s = this.decl(); this.want(';'); items.push({ kind: 'global', ...s, line: kw.line })
            } else if (this.eat('alias', 'id')) { const name = this.ident(); this.want('='); const t = this.type(); this.want(';'); items.push({ kind: 'alias', name, type: t }) }
            else throw new WGSLError(`unexpected '${kw.v}' at module scope`, kw.line)
        }
        return items
    }
    fn(line) {
        const name = this.ident()
        this.want('(')
        const params = []
        while (!this.eat(')')) {
            this.attributes()
            const pn = this.ident(); this.want(':'); const pt = this.type()
            params.push({ name: pn, type: pt })
            if (!this.eat(',')) { this.want(')'); break }
        }
        let ret = null
        if (this.eat('->')) { this.attributes(); ret = this.type() }
        const body = this.block()
        return { kind: 'fn', name, params, ret, body, line }
    }
    struct(line) {
        const name = this.ident()
        this.want('{')
        const fields = []
        while (!this.eat('}')) {
            this.attributes()
            const f = this.ident(); this.want(':'); const t = this.type()
            fields.push({ name: f, type: t })
            if (!this.eat(',')) { this.eat(';'); if (this.eat('}')) break }
        }
        this.eat(';')
        return { kind: 'struct', name, fields, line }
    }
    block() {
        this.want('{')
        const out = []
        while (!this.eat('}')) {
            if (this.is(null, 'eof')) throw new WGSLError("missing '}'", this.cur.line)
            const s = this.statement()
            if (s) out.push(s)
        }
        return out
    }
    /** Statements as a list with no braces around them: the node code a scene's object or group holds. */
    statements() {
        const out = []
        while (!this.is(null, 'eof')) { const s = this.statement(); if (s) out.push(s) }
        return out
    }
    decl() {
        const kw = this.k[this.i++].v
        if (kw === 'var' && this.is('<')) this.template()
        const name = this.ident()
        let type = null
        if (this.eat(':')) type = this.type()
        let init = null
        if (this.eat('=')) init = this.expr()
        return { k: kw === 'override' ? 'const' : kw, name, type, init }
    }
    statement() {
        const c = this.cur, line = c.line
        this.attributes()
        if (this.eat(';')) return null
        if (this.is('{')) return { k: 'block', body: this.block(), line }
        if (c.t === 'id') {
            switch (c.v) {
                case 'let': case 'var': case 'const': { const s = this.decl(); this.want(';'); return { ...s, line } }
                case 'return': { this.i++; const e = this.is(';') ? null : this.expr(); this.want(';'); return { k: 'return', e, line } }
                case 'break': { this.i++; if (this.eat('if', 'id')) { const cond = this.expr(); this.want(';'); return { k: 'if', cond, then: [{ k: 'break', line }], else: null, line } } this.want(';'); return { k: 'break', line } }
                case 'continue': this.i++; this.want(';'); return { k: 'continue', line }
                case 'discard': this.i++; this.want(';'); return { k: 'discard', line }
                case 'if': return this.ifStmt()
                case 'for': {
                    this.i++; this.want('(')
                    const init = this.is(';') ? null : this.simple(); this.want(';')
                    const cond = this.is(';') ? null : this.expr(); this.want(';')
                    const update = this.is(')') ? null : this.simple(); this.want(')')
                    return { k: 'for', init, cond, update, body: this.block(), line }
                }
                case 'while': { this.i++; const cond = this.expr(); return { k: 'while', cond, body: this.block(), line } }
                case 'loop': {
                    this.i++
                    const body = this.block()
                    // a continuing block at the end is the update
                    const last = body[body.length - 1]
                    return { k: 'for', init: null, cond: null, update: last?.k === 'continuing' ? last : null, body, line }
                }
                case 'continuing': { this.i++; return { k: 'continuing', body: this.block(), line } }
                case 'switch': throw new WGSLError('switch is not supported', line)
            }
        }
        const s = this.simple()
        this.want(';')
        return s
    }
    ifStmt() {
        const line = this.want('if', 'id').line
        const cond = this.expr()
        const then = this.block()
        let els = null
        if (this.eat('else', 'id')) els = this.is('if', 'id') ? [this.ifStmt()] : this.block()
        return { k: 'if', cond, then, else: els, line }
    }
    /* an assignment, an increment, a declaration or a call: what a for loop's header holds too */
    simple() {
        const line = this.cur.line
        if (this.is('let', 'id') || this.is('var', 'id') || this.is('const', 'id')) return { ...this.decl(), line }
        if (this.is('_', 'id') && this.peek().v === '=') { this.i += 2; return { k: 'expr', e: this.expr(), line } }
        const target = this.unary()
        for (const op of ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=']) {
            if (this.eat(op)) return { k: 'assign', target, op, value: this.expr(), line }
        }
        if (this.eat('++')) return { k: 'assign', target, op: '+=', value: { k: 'num', v: 1, int: true }, line }
        if (this.eat('--')) return { k: 'assign', target, op: '-=', value: { k: 'num', v: 1, int: true }, line }
        return { k: 'expr', e: target, line }
    }

    expr() { return this.binary(0) }
    binary(level) {
        if (level === BIN.length) return this.unary()
        let l = this.binary(level + 1)
        for (;;) {
            const c = this.cur
            if (c.t === 'op' && BIN[level].includes(c.v)) {
                this.i++
                l = { k: 'bin', op: c.v, l, r: this.binary(level + 1), line: c.line }
            } else return l
        }
    }
    unary() {
        const c = this.cur
        if (c.t === 'op' && ['-', '!', '~'].includes(c.v)) { this.i++; return { k: 'un', op: c.v, e: this.unary(), line: c.line } }
        if (c.t === 'op' && (c.v === '&' || c.v === '*')) { this.i++; return this.unary() }    // pointers: the value itself
        return this.postfix(this.primary())
    }
    primary() {
        const c = this.cur
        if (c.t === 'num') { this.i++; return { k: 'num', v: c.v, int: c.int, line: c.line } }
        if (this.eat('(')) { const e = this.expr(); this.want(')'); return e }
        if (c.t === 'id') {
            this.i++
            if (c.v === 'true' || c.v === 'false') return { k: 'num', v: c.v === 'true', bool: true, line: c.line }
            let name = c.v
            if (TEMPLATED.test(name) && this.is('<')) name += this.template()
            if (this.is('(')) {
                this.i++
                const args = []
                while (!this.eat(')')) {
                    args.push(this.expr())
                    if (!this.eat(',')) { this.want(')'); break }
                }
                return { k: 'call', name, args, line: c.line }
            }
            return { k: 'id', name, line: c.line }
        }
        throw new WGSLError(`unexpected '${c.v || 'end of code'}'`, c.line)
    }
    postfix(e) {
        for (;;) {
            if (this.eat('.')) e = { k: 'member', obj: e, name: this.ident(), line: e.line }
            else if (this.eat('[')) { const index = this.expr(); this.want(']'); e = { k: 'index', obj: e, index, line: e.line } }
            else return e
        }
    }
}

/** A whole module: { kind: 'fn' | 'struct' | 'global' | 'alias', ... }[] */
export const parseModule = src => new Parser(src).module()
/** Statements as an object's or a group's code holds them, braces not around them. */
export const parseStatements = src => new Parser(src).statements()
/** One expression (a profile point's coordinate written as text, e.g. "-w / 2"). */
export function parseExpression(src) {
    const p = new Parser(src)
    const e = p.expr()
    if (!p.is(null, 'eof')) throw new WGSLError(`unexpected '${p.cur.v}' after the expression`, p.cur.line)
    return e
}

/**
 * The module's top-level items as SOURCE TEXT, by name, without parsing their bodies: the library is large and only
 * a few of its functions are ever called by one scene, and a function in it written in syntax this parser does not
 * read is only an error if something calls it.
 * @returns {Map<string, { kind: 'fn' | 'struct' | 'global', src: string }>}
 */
export function splitModule(src) {
    const toks = lex(src), out = new Map()
    // each item's text rebuilt from its own tokens (lex keeps no offsets): comments gone, the same program
    const text = (a, b) => toks.slice(a, b).map(t => t.t === 'num' ? numText(t) : t.v).join(' ')
    let i = 0
    while (toks[i].t !== 'eof') {
        const t = toks[i]
        if (t.t === 'op' && t.v === '@') {           // an attribute: skip it and its arguments
            i += 2
            if (toks[i]?.v === '(') { let d = 0; do { if (toks[i].v === '(') d++; if (toks[i].v === ')') d--; i++ } while (d) }
            continue
        }
        if (t.t === 'id' && (t.v === 'fn' || t.v === 'struct')) {
            const name = toks[i + 1].v, start = i
            let j = i
            while (toks[j].v !== '{') j++
            let d = 0
            do { if (toks[j].v === '{') d++; if (toks[j].v === '}') d--; j++ } while (d)
            out.set(name, { kind: t.v, src: text(start, j), line: t.line })
            i = j
            continue
        }
        if (t.t === 'id' && (t.v === 'const' || t.v === 'let' || t.v === 'var' || t.v === 'override' || t.v === 'alias')) {
            let j = i + 1
            if (toks[j].v === '<') { while (toks[j].v !== '>') j++; j++ }
            const name = toks[j].v, start = i
            while (toks[j].v !== ';') j++
            out.set(name, { kind: 'global', src: text(start, j + 1), line: t.line })
            i = j + 1
            continue
        }
        i++
    }
    return out
}
/* a number token written back so that lex() reads the same number and kind: an integer with a suffix, a float with
   a point or an exponent (String(1e30) is "1e+30", already a float) */
const numText = t => {
    if (t.int) return `${t.v}i`
    const s = String(t.v)
    return /[.eE]/.test(s) ? s : `${s}.0`
}
