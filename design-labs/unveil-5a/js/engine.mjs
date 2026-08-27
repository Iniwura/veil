const fragment = `#version 300 es
precision highp float;
out vec4 outColor;
uniform vec2 resolution;
uniform float time;
uniform float lightMode;
uniform float intensity;
void main(){
 vec2 uv=gl_FragCoord.xy/resolution; uv.y=1.-uv.y;
 vec3 base=mix(vec3(.063,.075,.067),vec3(.933,.941,.937),lightMode);
 vec3 color=base;
 for(int i=0;i<6;i++){
  float k=float(i); float edge=.43+k*.105-uv.y*.055;
  edge+=sin(uv.y*3.1+time*.26+k*.9)*.024+sin(time*.31+k)*.018;
  float distance=uv.x-edge;
  float visible=smoothstep(-.001,.001,distance);
  float fold=exp(-max(distance,0.)*24.);
  vec3 dark=vec3(.105,.144,.119)+k*.012+fold*.028;
  vec3 mineral=vec3(.77,.815,.79)-k*.013+fold*.055;
  color=mix(color,mix(dark,mineral,lightMode),visible*(.56+k*.025));
 }
 color=mix(base,color,intensity);
 outColor=vec4(color,1.);
}`;
const vertex = `#version 300 es
in vec2 position;void main(){gl_Position=vec4(position,0.,1.);}`;
export class MaterialEngine {
  constructor(element, output) {
    this.element = element;
    this.output = output;
    this.mode = "static";
    this.direction = "a";
    this.paused = false;
    this.reduced = false;
    this.visible = false;
    this.light = false;
    this.activity = "landing";
    this.time = 0;
    this.samples = [];
    this.costs = [];
    this.last = 0;
    this.raf = 0;
    this.status = "static fallback";
    this.needsInit = true;
    this.observer = new IntersectionObserver(
      (entries) => {
        this.visible = entries[0].isIntersecting;
        this.element.classList.toggle("offscreen", !this.visible);
        if (this.visible && this.needsInit) {
          this.initialize();
          this.resize();
        }
        this.schedule();
      },
      { threshold: 0 },
    );
    this.observer.observe(element.querySelector("canvas"));
    document.addEventListener("visibilitychange", () => {
      document.documentElement.dataset.hidden = String(document.hidden);
      this.schedule();
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(element);
  }
  configure({ mode, direction, light, paused, reduced, activity }) {
    const rebuild = this.mode !== mode || this.direction !== direction;
    Object.assign(this, { mode, direction, light, paused, reduced, activity });
    this.element.dataset.activity = activity;
    if (rebuild || !this.canvas) this.needsInit = true;
    if (this.visible && this.needsInit) this.initialize();
    this.resize();
    this.paint();
    this.schedule();
  }
  initialize() {
    this.needsInit = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.samples = [];
    this.costs = [];
    this.last = 0;
    if (this.gl) {
      this.gl.deleteProgram(this.program);
      this.gl.deleteBuffer(this.buffer);
    }
    const old = this.element.querySelector("canvas");
    this.observer.unobserve(old);
    this.canvas = document.createElement("canvas");
    this.canvas.id = "material";
    old.replaceWith(this.canvas);
    this.observer.observe(this.canvas);
    this.gl = null;
    this.ctx = null;
    this.element.dataset.live = "false";
    if (this.direction !== "a" || this.mode === "static") {
      this.status = "DOM / static fallback";
      return;
    }
    if (this.mode === "webgl") {
      try {
        const gl = this.canvas.getContext("webgl2", { alpha: false, antialias: false, preserveDrawingBuffer: false });
        if (!gl) throw new Error("WebGL2 unavailable");
        this.gl = gl;
        const compile = (kind, source) => {
          const shader = gl.createShader(kind);
          gl.shaderSource(shader, source);
          gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
          return shader;
        };
        const vs = compile(gl.VERTEX_SHADER, vertex),
          fs = compile(gl.FRAGMENT_SHADER, fragment);
        this.program = gl.createProgram();
        gl.attachShader(this.program, vs);
        gl.attachShader(this.program, fs);
        gl.linkProgram(this.program);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program));
        gl.useProgram(this.program);
        this.buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const position = gl.getAttribLocation(this.program, "position");
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        this.uniforms = Object.fromEntries(
          ["resolution", "time", "lightMode", "intensity"].map((name) => [
            name,
            gl.getUniformLocation(this.program, name),
          ]),
        );
        this.status = "WebGL2";
        this.canvas.addEventListener("webglcontextlost", (event) => {
          event.preventDefault();
          this.gl = null;
          this.status = "WebGL context lost / static fallback";
          this.element.dataset.live = "false";
          this.schedule();
        });
      } catch (error) {
        this.gl = null;
        this.status = `${error.message} / static fallback`;
        this.output.textContent = this.status;
        return;
      }
    } else {
      this.ctx = this.canvas.getContext("2d", { alpha: false });
      this.status = this.ctx ? "Canvas2D" : "Canvas unavailable / static fallback";
    }
    this.element.dataset.live = String(Boolean(this.gl || this.ctx));
  }
  resize() {
    if (!this.canvas) return;
    const box = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(devicePixelRatio, innerWidth < 600 ? 1.25 : 2);
    const w = Math.round(box.width * this.dpr),
      h = Math.round(box.height * this.dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.paint();
    }
  }
  intensity() {
    return this.activity === "home"
      ? 0.13
      : this.activity === "attention"
        ? 0.15
        : this.activity === "encrypt"
          ? 0.32
          : 1;
  }
  paint() {
    const canvas = this.canvas;
    if (!canvas) return;
    const w = canvas.width,
      h = canvas.height,
      t = this.time;
    if (this.gl) {
      const gl = this.gl;
      gl.viewport(0, 0, w, h);
      gl.useProgram(this.program);
      gl.uniform2f(this.uniforms.resolution, w, h);
      gl.uniform1f(this.uniforms.time, t);
      gl.uniform1f(this.uniforms.lightMode, this.light ? 1 : 0);
      gl.uniform1f(this.uniforms.intensity, this.intensity());
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    if (this.ctx) {
      const ctx = this.ctx;
      ctx.fillStyle = this.light ? "#eef0ef" : "#101311";
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = this.intensity();
      for (let i = 0; i < 6; i++) {
        const x = w * (0.45 + i * 0.105) + Math.sin(t * 0.27 + i * 0.9) * w * 0.018;
        const fold = Math.sin(t * 0.22 + i) * w * 0.016;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.bezierCurveTo(x + w * 0.05 + fold, h * 0.25, x - w * 0.12 + fold, h * 0.7, x - w * 0.065, h);
        ctx.lineTo(w, h);
        ctx.lineTo(w, 0);
        ctx.closePath();
        const gradient = ctx.createLinearGradient(x - w * 0.08, 0, x + w * 0.15, 0);
        gradient.addColorStop(
          0,
          this.light
            ? `rgb(${192 - i * 3},${207 - i * 3},${196 - i * 3})`
            : `rgb(${35 + i * 2},${48 + i * 2},${39 + i * 2})`,
        );
        gradient.addColorStop(0.25, this.light ? "#dce3de" : "#344436");
        gradient.addColorStop(1, this.light ? "#bdccc2" : "#1a261d");
        ctx.fillStyle = gradient;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }
  schedule() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.last = 0;
    if (this.paused || this.reduced || document.hidden || !this.visible) {
      this.report();
      return;
    }
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }
  tick(now) {
    if (this.last) {
      const dt = now - this.last;
      this.samples.push(dt);
      if (this.samples.length > 300) this.samples.shift();
      this.time +=
        (Math.min(dt, 100) / 1000) * (this.activity === "encrypt" ? 0.08 : this.activity === "attention" ? 0.1 : 1);
    }
    this.last = now;
    const start = performance.now();
    this.paint();
    this.costs.push(performance.now() - start);
    if (this.costs.length > 300) this.costs.shift();
    if (!this.reportAt || now - this.reportAt > 1000) {
      this.reportAt = now;
      this.report();
    }
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }
  report() {
    const sorted = [...this.samples].sort((a, b) => a - b);
    const average = this.samples.reduce((a, b) => a + b, 0) / (this.samples.length || 1);
    const cpu = this.costs.reduce((a, b) => a + b, 0) / (this.costs.length || 1);
    this.output.textContent = `${this.status} · ${this.reduced ? "REDUCED" : this.paused ? "PAUSED" : !this.visible ? "OFFSCREEN" : document.hidden ? "HIDDEN" : `${average ? (1000 / average).toFixed(1) : "—"} fps`} · p95 ${sorted[Math.floor(sorted.length * 0.95)]?.toFixed(1) || "—"}ms · JS ${cpu.toFixed(2)}ms · DPR ${this.dpr || 1}`;
    this.output.dataset.sampleCount = String(this.samples.length);
    this.output.dataset.status = this.status;
    this.output.dataset.fps = average ? String(1000 / average) : "0";
    this.output.dataset.p95 = String(sorted[Math.floor(sorted.length * 0.95)] || 0);
    this.output.dataset.cpu = String(cpu);
    this.output.dataset.dpr = String(this.dpr || 1);
    this.output.dataset.memory = performance.memory ? String(performance.memory.usedJSHeapSize) : "unavailable";
  }
}
