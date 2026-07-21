// 环境动效 v2:全屏波场 hero + 平静 CTA 波形 + 扫描转盘背景。
// Drop-in 替换 src/ambient.js —— 导出接口与旧版完全一致:
//   initAmbientMotion() / setProcessingProgress(percent, phase)

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function shouldPaint(canvas) {
  if (document.visibilityState !== 'visible' || canvas.getClientRects().length === 0) return false;
  const rect = canvas.getBoundingClientRect();
  return rect.bottom > -200 && rect.top < window.innerHeight + 200;
}

function fit(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

// 从 CSS 变量取主题色(明暗主题/换色自动跟随)
function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})/i.exec(hex.trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [201, 242, 77];
}
function accentRgb(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v.startsWith('#') ? hexToRgb(v) : fallback;
}
function rgba(rgb, a) {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
}
function mix(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

// ---------- hero:透视波场(6 条低幅慢波,鼠标轻微视差) ----------
function startHeroCanvas() {
  const canvas = document.getElementById('hero-canvas');
  if (!canvas) return;
  const hero = canvas.closest('.hero-stage');
  let mx = 0;
  let targetX = 0;
  let my = 0;
  let targetY = 0;
  let time = 0;

  hero?.addEventListener('pointermove', (event) => {
    const rect = hero.getBoundingClientRect();
    targetX = (event.clientX - rect.left) / rect.width - 0.5;
    targetY = (event.clientY - rect.top) / rect.height - 0.5;
  });
  hero?.addEventListener('pointerleave', () => { targetX = 0; targetY = 0; });

  const ROWS = 6;
  const COLS = 110;
  const BEAT = 60 / 82; // 伪节拍,与 demo 一致

  const draw = () => {
    if (!shouldPaint(canvas)) { requestAnimationFrame(draw); return; }
    const { ctx, width, height } = fit(canvas);
    time += reduceMotion ? 0 : 0.012;
    mx += (targetX - mx) * 0.05;
    my += (targetY - my) * 0.05;
    ctx.clearRect(0, 0, width, height);
    const A = accentRgb('--accent', [201, 242, 77]);
    const B = accentRgb('--accent-2', [58, 230, 143]);
    const beat = Math.pow(Math.max(0, Math.sin(time * Math.PI / BEAT)), 5);
    const horizon = height * (0.34 + my * 0.05);
    for (let r = 0; r < ROWS; r++) {
      const depth = r / (ROWS - 1); // 0 远 → 1 近
      const y0 = horizon + Math.pow(depth, 1.7) * (height - horizon) * 1.04;
      const amp = (4 + depth * 20) * (1 + beat * 0.3);
      const alpha = 0.04 + depth * 0.2;
      const col = mix(A, B, Math.min(1, depth * 0.85));
      ctx.beginPath();
      for (let i = 0; i <= COLS; i++) {
        const p = i / COLS;
        const x = p * width;
        const envelope = Math.pow(Math.sin(p * Math.PI), 0.9);
        const wave = Math.sin(p * 6 + time * 0.9 + r * 0.8) * 0.62
          + Math.sin(p * 2.6 - time * 0.4) * 0.38;
        const y = y0 + wave * amp * envelope + mx * (p - 0.5) * 14 * depth;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgba(col, alpha);
      ctx.lineWidth = 0.6 + depth * 0.9;
      ctx.stroke();
    }
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

// ---------- 拖放区:单条低幅慢波 ----------
function startDropCanvas() {
  const canvas = document.getElementById('drop-canvas');
  if (!canvas) return;
  let time = 0;
  const draw = () => {
    if (!shouldPaint(canvas)) { requestAnimationFrame(draw); return; }
    const { ctx, width, height } = fit(canvas);
    time += reduceMotion ? 0 : 0.025;
    ctx.clearRect(0, 0, width, height);
    const A = accentRgb('--accent', [201, 242, 77]);
    const center = height / 2;
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, rgba(A, 0));
    gradient.addColorStop(0.35, rgba(A, 0.4));
    gradient.addColorStop(0.65, rgba(A, 0.4));
    gradient.addColorStop(1, rgba(A, 0));
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= width; x += 3) {
      const p = x / width;
      const envelope = Math.pow(Math.sin(p * Math.PI), 2);
      const y = center + Math.sin(x * 0.05 + time * 0.9) * envelope * height * 0.13
        + Math.sin(x * 0.016 - time * 0.35) * envelope * height * 0.05;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

// ---------- 分析页:刻度环 + 扫描光束 + 微光点 ----------
function startProcessingCanvas() {
  const canvas = document.getElementById('processing-canvas');
  if (!canvas) return;
  let time = 0;
  const dots = [];
  for (let i = 0; i < 40; i++) dots.push({ a: Math.random() * Math.PI * 2, r: 0.3 + Math.random() * 0.75, tw: Math.random() * Math.PI * 2 });
  const draw = () => {
    if (!shouldPaint(canvas)) { requestAnimationFrame(draw); return; }
    const { ctx, width, height } = fit(canvas);
    time += reduceMotion ? 0 : 0.012;
    ctx.clearRect(0, 0, width, height);
    const A = accentRgb('--accent', [201, 242, 77]);
    const B = accentRgb('--accent-2', [58, 230, 143]);
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.3;

    for (let ring = 0; ring < 22; ring++) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius + ring * 5.2, 0, Math.PI * 2);
      ctx.strokeStyle = ring % 4 === 0 ? rgba(A, 0.09) : rgba([148, 180, 255], 0.03);
      ctx.lineWidth = ring % 4 === 0 ? 0.75 : 0.4;
      ctx.stroke();
    }
    // 旋转扫描光束
    if (ctx.createConicGradient) {
      const grad = ctx.createConicGradient(time * 0.5, cx, cy);
      grad.addColorStop(0, rgba(A, 0.2));
      grad.addColorStop(0.08, rgba(A, 0));
      grad.addColorStop(1, rgba(A, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 2.1, 0, Math.PI * 2);
      ctx.fill();
    }
    // 闪烁的"音符"光点
    for (const d of dots) {
      const a = Math.sin(time * 1.2 + d.tw) * 0.5 + 0.5;
      const px = cx + Math.cos(d.a) * radius * 2 * d.r;
      const py = cy + Math.sin(d.a) * radius * 1.15 * d.r;
      ctx.fillStyle = rgba(mix(A, B, d.r - 0.3), 0.12 + a * 0.3);
      ctx.beginPath();
      ctx.arc(px, py, 1.2 + a, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

function initReveals() {
  const elements = document.querySelectorAll('.reveal');
  if (reduceMotion || !('IntersectionObserver' in window)) {
    elements.forEach((element) => element.classList.add('is-visible'));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.14 });
  elements.forEach((element) => observer.observe(element));
}

function initScrollMeter() {
  const fill = document.getElementById('scroll-meter-fill');
  if (!fill) return;
  let queued = false;
  const update = () => {
    queued = false;
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const progress = document.body.dataset.view === 'upload' ? Math.min(1, window.scrollY / max) : 0;
    fill.style.transform = `scaleX(${progress})`;
  };
  window.addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  }, { passive: true });
  update();
}

export function setProcessingProgress(percent, phase = 'listen') {
  const value = Math.max(0, Math.min(100, percent));
  const orbit = document.querySelector('.proc-orbit');
  orbit?.style.setProperty('--progress', `${value * 3.6}deg`);
  const readout = document.getElementById('proc-percent');
  if (readout) readout.textContent = `${Math.round(value)}%`;
  document.querySelectorAll('.proc-step').forEach((step) => {
    const order = { decode: 0, listen: 1, name: 2, map: 3 };
    step.classList.toggle('done', order[step.dataset.phase] < order[phase]);
    step.classList.toggle('active', step.dataset.phase === phase);
  });
}

export function initAmbientMotion() {
  startHeroCanvas();
  startDropCanvas();
  startProcessingCanvas();
  initReveals();
  initScrollMeter();
}
