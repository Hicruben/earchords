// 首页产品实景:一个自走的迷你"和弦网格播放器"预览,让访客一眼看到成品长什么样。
// 完全自包含:只操作 #home-showcase 内部元素,不存在则直接返回,不影响主 App。
// 复用真实指法图(diagrams.js),所以预览里的和弦形状是真的。
import { diagramSVG } from './diagrams.js';

// 一段好听、耳熟的走向(I–V–vi–IV 系,穿插变化),纯展示用
const PROG = ['C', 'G', 'Am', 'F', 'C', 'G', 'Em', 'Am', 'Dm', 'G', 'C', 'F',
  'Am', 'F', 'C', 'G', 'F', 'C', 'G', 'Em', 'Am', 'D', 'G', 'C'];
const STEP_MS = 620;

function initShowcase() {
  const root = document.getElementById('home-showcase');
  if (!root) return;
  const grid = root.querySelector('#hs-grid');
  const nowEl = root.querySelector('#hs-now');
  const diagEl = root.querySelector('#hs-diagram');
  const fill = root.querySelector('#hs-fill');
  if (!grid) return;

  const cells = PROG.map((c, i) => {
    const b = document.createElement('div');
    b.className = 'hs-cell';
    b.textContent = c;
    b.style.setProperty('--i', i);
    grid.appendChild(b);
    return b;
  });

  let i = -1;
  let timer = null;

  const advance = () => {
    if (i >= 0) cells[i].classList.remove('is-active');
    i = (i + 1) % PROG.length;
    const cell = cells[i];
    cell.classList.add('is-active');
    if (nowEl) nowEl.textContent = PROG[i];
    if (diagEl) diagEl.innerHTML = diagramSVG('guitar', PROG[i]);
    if (fill) fill.style.width = `${((i + 1) / PROG.length) * 100}%`;
  };

  const start = () => { if (!timer) { advance(); timer = setInterval(advance, STEP_MS); } };
  const stop = () => { clearInterval(timer); timer = null; };

  // 只在进入视口时animate(省电、也更有"活起来"的感觉)
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((ents) => {
      for (const e of ents) e.isIntersecting ? start() : stop();
    }, { threshold: 0.25 });
    io.observe(root);
  } else {
    start();
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initShowcase);
else initShowcase();
