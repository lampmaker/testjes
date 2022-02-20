// variables

// canvas initialization ===============================================================================================================================
export const canvas = document.getElementsByTagName('canvas')[0]; export const g = getWebGLContext();


// variables  ===============================================================================================================================
let t


// canvas initialization ===============================================================================================================================
function getWebGLContext() {
    let g = canvas.getContext('webgl2'); g.getExtension('EXT_color_buffer_float'); g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, true); rs();
    g.viewport(0, 0, g.canvas.width, g.canvas.height); g.clearColor(0.0, 0.0, 0.0, 1.0);   //use  this color
    g.clear(g.DEPTH_BUFFER_BIT | g.COLOR_BUFFER_BIT); return g;
}


// canvas resize ===============================================================================================================================
export function rs(scale = 1) {
    const [w, h] = [canvas.clientWidth * scale, canvas.clientHeight * scale]; const r = canvas.width !== w || canvas.height !== h;
    if (r) { canvas.width = w; canvas.height = h; } return r;
}


// FRAMEBUFFERS  ===============================================================================================================================
export var FBOpresets = { default: { i: g.RGBA16F, f: g.RGBA, d: false, t: g.INEAR }, defaultdepth: { i: g.RGBA16F, f: g.RGBA, d: true, t: g.INEAR } }


// creates and attaches texture ===============================================================================================================================
function cFBO(w, h, f) {
    var t3 = (d) => {
        var Q = 0x0DE1, z = (a) => { g.texParameteri(Q, a, f.t || 0x2600) }, T = g.createTexture(); g.bindTexture(Q, T)
        var t4 = (a, b, c) => { g.texImage2D(Q, 0, a, w, h, 0, b, c, null) }, t5 = (a) => { g.framebufferTexture2D(0x8D40, a, Q, T, 0); }
        if (d) { t4(0x81A6, 0x1902, 0x1405); t5(0x8D00) } else { t4(f.i || 0x881A, f.f || 0x1908, 0x1406); t5(0x8CE0) } z(0x2801); z(0x2800); return T;
    }
    g.activeTexture(0x84C0); var f1 = g.createFramebuffer(); g.bindFramebuffer(0x8D40, f1);
    var T = t3(0); if (f.d) t3(1)
    //  g.viewport(0, 0, w, h); g.clear(0x00004000); nodig?
    CHECK_FRAMEBUFFER_STATUS(); return { texture: T, fbo: f1, width: w, height: h, };
}


// Clear framebuffer  ===============================================================================================================================
function clr(f) { g.bindFramebuffer(g.FRAMEBUFFER, f.fbo); g.clear(g.COLOR_BUFFER_BIT); }


// CREATE  width, heitght, format, double (yes.no) ===============================================================================================================================
export class FB {
    constructor(w, h, f, d) { t = this; t.f = f; t.d = d; t.width = w; t.height = h; t.ts = [1 / w, 1 / h]; t.read = cFBO(w, h, f, d); t.write = this.d ? cFBO(w, h, f, d) : t.read; }
    s() { t = this;[t.read, t.write] = [t.write, t.read] } clear() { clr(this.read); clr(this.write) }
}

// get min/max/ave values of framebuffer  ===============================================================================================================================
export function getMinMax(h, w, FB, c) {
    var l = h * w, d = new Float32Array(l); g.bindFramebuffer(g.FRAMEBUFFER, FB.read.fbo); g.readPixels(0, 0, w, h, g.RED, g.FLOAT, d);
    return { min: Math.min(...d), ave: d.reduce((a, b) => a + b, 0) / l, max: Math.max(...d), count: d.filter(o => { return (o == c) }).length / l }
}

var ra = (k) => k.replaceAll(',', '\n#define ')

// PROGRAM (vertex, fragment, keywords)  ==============================================================================================================================
export function Program(vs, fs, w = "") {
    let u = {}, a = 0, i, U, n, k, p = g.createProgram(), CS = (type, s, k) => {
        let r = `#version 300 es\n` + ra(k) + s; const q = g.createShader(type); g.shaderSource(q, r); g.compileShader(q);
        CHECKSHADER(q, s);
        g.attachShader(p, q);
    };
    CS(g.VERTEX_SHADER, vs, ""); CS(g.FRAGMENT_SHADER, fs, w); g.linkProgram(p);
    for (i = 0; i < g.getProgramParameter(p, g.ACTIVE_UNIFORMS); i++) {
        U = g.getActiveUniform(p, i); n = U.name; n = U.size > 1 ? n.substring(0, n.length - 3) : n
        u[n] = new Uniform(U.type, g.getUniformLocation(p, U.name), U.name, U.size, U.type == 0x8B5 ? a : a++);
    }
    var al = (n) => g.getAttribLocation(p, n), use = () => g.useProgram(p)
    var s = (v) => {
        for (k in v) {
            if (u[k] != undefined) u[k].set(v[k])
        }
    }, r = (t, u) => { s(u); use(); x(); blit(t); }
    function x() { for (k in u) { u[k].x() } }
    var position = al('vertexPosition');
    var normal = al('normal');
    var uv = al('uv');
    var opt = al('opt');
    var wireframe = false;
    return { fs, vs, p, u, position, normal, uv, opt, wireframe, use, s, r, x }
}


class Uniform {
    val; name; type; loc; size; attachid; changed;
    constructor(type, location, name, size, attachid = 0) {
        t = this;
        t.type = type; t.loc = location; t.name = name; t.size = size; if (size == 1) t.val = 0; else t.val = []; t.changed = false; t.attachid = attachid;
    }
    get value() { return this.val }
    set(V) { this.CHECK(V); this.val = V; this.changed = true; }
    CHECK(v) { if (v === undefined || v === null) { console.error(this); throw new Error(); } }
    x() {
        var t = this, v = t.val, l = t.loc
        if (!t.changed) return;
        if (t.type == 35678 && t.val) { var framebuffer = t.val.read; g.uniform1i(t.loc, t.attachid); g.activeTexture(g.TEXTURE0 + t.attachid); g.bindTexture(g.TEXTURE_2D, framebuffer.texture); return; }
        switch (t.type) {
            case 35678: if (v != 0) { } break;
            case 5124: g.uniform1i(l, v); break;
            case 5126: g.uniform1f(l, v); break;
            case 35664: g.uniform2fv(l, v); break;
            case 35665: g.uniform3fv(l, v); break;
            case 35666: g.uniform4fv(l, v); break;
            //case 35664: g.uniform2f(l, v[0], v[1]); break;
            //case 35665: g.uniform3f(l, v[0], v[1], v[2]); break;
            //case 35666: g.uniform4f(l, v[0], v[1], v[2], v[3]); break;
            case 35676: g.uniformMatrix4fv(l, false, v.flat()); break;
            default: console.log("Uniform conversion unknown type:", t.type, t.name); break;
        }
        t.changed = false;
    }
}



//====================================================================================================================
// rendert het actieve programma naar de target.  als target=null, rendert naar de target FBO
//
//====================================================================================================================
const A1 = new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]);  //coordinates of points  x1,y1,x2,y3,x3,y3,x4,y4
const A2 = new Uint16Array([0, 1, 2, 0, 2, 3]);  // triangles defined by points index
export function blit(target, clear = false) {
    g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer());
    g.bufferData(g.ARRAY_BUFFER, A1, g.STATIC_DRAW);
    g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, g.createBuffer());
    g.bufferData(g.ELEMENT_ARRAY_BUFFER, A2, g.STATIC_DRAW);
    g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
    g.enableVertexAttribArray(0);
    if (target == null) {
        g.viewport(0, 0, g.drawingBufferWidth, g.drawingBufferHeight);
        g.bindFramebuffer(g.FRAMEBUFFER, null);
    }
    else {
        g.viewport(0, 0, target.write.width, target.write.height);
        g.bindFramebuffer(g.FRAMEBUFFER, target.write.fbo);
    }
    if (clear) {
        g.clearColor(1.0, 0.0, 0.0, 1.0);
        g.clear(g.COLOR_BUFFER_BIT);
    }
    g.drawElements(g.TRIANGLES, 6, g.UNSIGNED_SHORT, 0);
    if (target != null) {
        g.bindFramebuffer(g.FRAMEBUFFER, null);
        target = target.s();   // swap double framebuffers
    };

}


// shader defines , vertex & common uniforms

const D = ra(',u9 uvTransform,s2 sampler2D,v2 vec2,v3 vec3,v4 vec4,f float,tq texture,e 1.0,n 0.0,v vUv,le length,m void main(){,u uniform,r1 return,u2 uniform sampler2D,p2 precision highp,i9 in highp v2,o9 out v2\n')
export var V = D + `p2 f;in v2 a;o9 v;o9 vL;o9 vR;o9 vT;o9 vB;u v2 ts;u v3 u9;m v=a*0.5+0.5;if(u9.z!=n)v=(v+u9.xy)*u9.z;vL=v-v2(ts.x,n);vR=v+v2(ts.x,n);vT=v+v2(n,ts.y);vB=v-v2(n,ts.y);gl_Position= v4(a, n,e);}`
export var U = D + `p2 f;p2 s2;i9 vUv;i9 vL;i9 vR;i9 vT;i9 vB;out v4 o;u2 uc;u2 uv;u2 us;u2 ue;u2 uw;u2 up;u2 ud;u f wl;u f dt;u f whs;u f ss;u f ps;u f es;u f er;u f hs;u f sc;u v2 ef;u v3 of;u v2 ts;` +
    `v4 tx(s2 r,v2 uv){v2 st=uv/ts-.5;v2 iv=floor(st);v2 fv=fract(st);r1 mix(mix(tq(r,(iv+vec2(.5,.5))*ts),tq(r,(iv+vec2(1.5,.5))*ts),fv.x),mix(tq(r,(iv+vec2(.5,1.5))*ts),tq(r,(iv+vec2(1.5,1.5))*ts),fv.x),fv.y);}`
U += `u f hsv; u f hsd; u f hsp; u f crl;u f PRES ;u f DIV1;u f DIV2; u f WD;`

export const CP = new Program(V, U + `m o=tq(us,vUv);}`);
export function renderFramebufferToScreen(fb) { CP.r(null, { us: fb }) }







// DEBUGGING - remove once everything works...
function CHECKSHADER(q, s) { if (!g.getShaderParameter(q, g.COMPILE_STATUS)) { console.log("ERRROR COMPILING SHADER ================================================================="); console.trace(g.getShaderInfoLog(q)); var lines = s.split('\n'); var L2 = ""; for (var l = 0; l < lines.length; l++) { L2 = L2 + (l + 1).toString() + "  " + lines[l] + '\n' } console.log(L2) } }
function CHECK_FRAMEBUFFER_STATUS() { let status = g.checkFramebufferStatus(g.FRAMEBUFFER); if (status != g.FRAMEBUFFER_COMPLETE) console.trace("Framebuffer error: " + status); }



