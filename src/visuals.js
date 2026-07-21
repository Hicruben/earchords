// 视觉效果 v2:发光播放头波形进度条 + 荧光频谱柱可视化。
// Drop-in 替换 src/visuals.js —— 导出接口与旧版完全一致:
//   drawWaveform(canvas, peaks, progress, markers) / class Visualizer

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})/i.exec(hex.trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [201, 242, 77];
}
function rgba(rgb, a) {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
}
function mix(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

function fitCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

// ---------- 波形进度条(发光播放头 + 和弦刻度 + 和弦段色带) ----------
// segments(可选):[{p0,p1,root}] —— 归一化起止位置 + 根音 pitch class,底部色带按根音着色
export function drawWaveform(canvas, peaks, progress, markers, segments) {
  if (!peaks || !peaks.length) return;
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const A = hexToRgb(cssVar('--accent', '#c9f24d'));
  const ink = hexToRgb(cssVar('--ink', '#edf2fb'));
  const mid = h / 2;
  const n = peaks.length;
  const playedX = progress * w;
  const drawHalf = (direction) => {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * w;
      const y = mid + direction * Math.max(1, peaks[i] * h * 0.42);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  // 未播放:低对比;已播放:accent 高亮
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(ink, 0.16);
  drawHalf(-1);
  drawHalf(1);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, playedX, h);
  ctx.clip();
  ctx.strokeStyle = rgba(A, 0.95);
  ctx.lineWidth = 1.25;
  drawHalf(-1);
  drawHalf(1);
  ctx.restore();
  // 和弦变化刻度
  if (markers) {
    ctx.fillStyle = rgba(A, 0.35);
    for (const m of markers) ctx.fillRect(m * w, 0, 1, h * 0.18);
  }
  // 和弦段时间轴(底部色带,按根音在 accent→accent-2 间取色,当前段提亮)
  if (segments && segments.length) {
    const B = hexToRgb(cssVar('--accent-2', '#3ae68f'));
    const bandH = Math.max(4, Math.round(h * 0.16));
    for (const s of segments) {
      const col = mix(A, B, (s.root || 0) / 11);
      const active = progress >= s.p0 && progress < s.p1;
      ctx.fillStyle = rgba(col, active ? 0.95 : 0.38);
      ctx.fillRect(s.p0 * w, h - bandH, Math.max(1, (s.p1 - s.p0) * w - 1), bandH);
    }
  }
  // 发光播放头
  ctx.fillStyle = rgba(A, 1);
  ctx.shadowColor = rgba(A, 0.9);
  ctx.shadowBlur = 8;
  ctx.fillRect(playedX - 0.75, 0, 1.5, h);
  ctx.beginPath();
  ctx.arc(playedX, mid, 3.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

// ---------- 实时可视化:荧光频谱柱(accent→accent-2 渐变 + 峰值帽) ----------
export class Visualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.analyser = null;
    this.data = null;
    this.raf = null;
    this.t = 0;
    this.playing = false;
    this.level = 0;
    this.prevEnergy = 0;
    this.beatFlash = 0;
  }

  // 从 AudioContext + 源节点接入(旁路,不影响输出链)
  attach(audioCtx, sourceNode) {
    if (this.analyser) return;
    this.analyser = audioCtx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;
    this.data = new Uint8Array(this.analyser.frequencyBinCount);
    sourceNode.connect(this.analyser);
  }

  setPlaying(p) { this.playing = p; }

  start() {
    if (this.raf) return;
    const loop = () => {
      this._frame();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  _bins() {
    if (this.analyser && this.playing) {
      this.analyser.getByteFrequencyData(this.data);
      return this.data;
    }
    // ambient 回退:无音频数据时的柔和呼吸
    const N = 96;
    const bins = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const s = Math.sin(this.t * 1.6 + i * 0.31) * 0.5 + 0.5;
      const s2 = Math.sin(this.t * 0.7 - i * 0.13) * 0.5 + 0.5;
      const env = Math.pow(Math.sin((i / N) * Math.PI), 0.8);
      bins[i] = Math.min(255, (s * 0.62 + s2 * 0.38) * env * (this.playing ? 110 : 40));
    }
    return bins;
  }

  _frame() {
    this.t += 0.016;
    const { ctx, w, h } = fitCanvas(this.canvas);
    ctx.clearRect(0, 0, w, h);
    const A = hexToRgb(cssVar('--accent', '#c9f24d'));
    const B = hexToRgb(cssVar('--accent-2', '#3ae68f'));
    const bins = this._bins();
    let energy = 0;
    for (let i = 0; i < bins.length; i++) energy += bins[i];
    energy /= bins.length * 255;
    this.level += (energy - this.level) * 0.12;
    if (energy - this.prevEnergy > 0.045 && this.playing) this.beatFlash = 1;
    this.prevEnergy = energy;
    this.beatFlash *= 0.9;

    const n = 72;
    const bw = w / n;
    for (let i = 0; i < n; i++) {
      const p = i / (n - 1);
      const v = bins[Math.floor(p * (bins.length - 1))] / 255;
      const env = Math.pow(Math.sin(p * Math.PI), 0.55);
      const bh = Math.max(2, v * env * h * 0.72);
      const col = mix(A, B, p);
      const x = i * bw + bw * 0.22;
      const grad = ctx.createLinearGradient(0, h, 0, h - bh);
      grad.addColorStop(0, rgba(col, 0.02));
      grad.addColorStop(1, rgba(col, 0.16 + this.level * 0.3 + this.beatFlash * 0.12));
      ctx.fillStyle = grad;
      ctx.fillRect(x, h - bh, bw * 0.56, bh);
      // 峰值帽
      ctx.fillStyle = rgba(col, 0.3 + this.level * 0.4);
      ctx.fillRect(x, h - bh - 2, bw * 0.56, 1.5);
    }
  }

  // 当前电平(0..1),供节拍/光晕使用
  getLevel() { return this.level; }
}
