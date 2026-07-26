// 歌曲页互动控制器(Chordify 式):内部时钟为主时间轴,和弦网格随播放实时高亮、
// 自动滚动、点击跳转;转调 / 变调夹 / 乐器指法图 / 变速 / 跟弹和弦。
// 音源策略:能嵌入的 YouTube 视频 → 用视频时间;嵌入被挡(error 150 等)→ 自动
// 降级到内部时钟 + 我们自己的和弦合成器,页面永不空转、始终与和弦轨同步。
// 复用主站已验证的乐理与指法图模块;由 esbuild 打包成 /assets/songpage.js。
import { chordByLabel, transposeLabel } from './chords.js';
import { diagramSVG } from './diagrams.js';
import { ChordPlayer, voicingFor } from './chordplayer.js';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const fmt = (s) => {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
};

// 自己实现的平滑滚动(不依赖 CSS scroll-behavior,浏览器兼容更稳)
let _scrollRAF = null;
function smoothScrollTop(el, to, dur = 280) {
  cancelAnimationFrame(_scrollRAF);
  to = Math.max(0, Math.min(to, el.scrollHeight - el.clientHeight));
  const from = el.scrollTop, d = to - from, start = performance.now();
  if (Math.abs(d) < 2) { el.scrollTop = to; return; }
  const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) ** 2) / 2);
  const step = (now) => {
    const p = Math.min(1, (now - start) / dur);
    el.scrollTop = from + d * ease(p);
    if (p < 1) _scrollRAF = requestAnimationFrame(step);
  };
  _scrollRAF = requestAnimationFrame(step);
}

function boot() {
  const dataEl = $('#ec-data');
  if (!dataEl) return;
  const data = JSON.parse(dataEl.textContent);
  const chords = (data.chords || []).filter((c) => c.c && c.c !== 'N.C.');
  if (!chords.length) return;

  const state = {
    transpose: 0,
    capo: 0,
    instrument: 'guitar',
    playChords: false,
    playing: false,
    activeIdx: -1,
    duration: data.duration || (chords[chords.length - 1].e) || 1,
    loopA: null,
    loopB: null,
    t: 0,                 // 主时间轴(秒)
    videoBlocked: false,  // 嵌入被挡后置真,降级到内部时钟 + 合成器
    autoFallback: false,  // 兜底是自动触发的(区别于用户手动开跟弹)
    userChords: false,    // 用户手动开过跟弹和弦
    waitingVideo: false,  // 已点播放、正等原声视频起播(此时不推进时间轴)
    pendingPlay: false,   // 在 YT API 就绪前点了播放,待 onReady 补起播
    loading: false,
  };

  // ---- 渲染和弦网格 ----
  const grid = $('#ec-grid');
  const cells = chords.map((c, i) => {
    const cell = document.createElement('button');
    cell.className = 'ec-cell';
    cell.dataset.i = i;
    cell.innerHTML = `<span class="ec-cell-lab"></span><span class="ec-cell-t"></span>`;
    grid.appendChild(cell);
    return cell;
  });

  const dispLabel = (raw) => transposeLabel(raw, state.transpose);
  const shapeLabel = (raw) => transposeLabel(raw, state.transpose - state.capo);
  const viewIdx = () => (state.activeIdx >= 0 ? state.activeIdx : 0);

  function paintLabels() {
    chords.forEach((c, i) => {
      $('.ec-cell-lab', cells[i]).textContent = dispLabel(c.c);
    });
    renderLegend();
    renderNow(viewIdx());
  }

  // ---- 指法图区 ----
  const nowLabel = $('#ec-now-label');
  const nowNext = $('#ec-now-next');
  const diagWrap = $('#ec-diagram');

  function renderNow(i) {
    const raw = chords[i]?.c;
    if (!raw) return;
    nowLabel.textContent = dispLabel(raw);
    const nx = chords[i + 1];
    nowNext.textContent = nx ? `next · ${dispLabel(nx.c)}` : '';
    diagWrap.innerHTML = diagramSVG(state.instrument, shapeLabel(raw));
  }

  // ---- 唯一和弦图例(顶部一排)----
  const legend = $('#ec-legend');
  function renderLegend() {
    const seen = [];
    for (const c of chords) {
      const l = dispLabel(c.c);
      if (!seen.includes(l)) seen.push(l);
    }
    legend.innerHTML = seen.slice(0, 14).map((l) =>
      `<button class="ec-chip" data-lab="${l}"><span>${l}</span>${diagramSVG(state.instrument, transposeLabel(l, -state.capo))}</button>`
    ).join('');
  }

  // ---- 主时钟(内部时间轴)----
  // 视频真正在播 → 用视频时间;否则用 performance.now() 累积(受变速影响)。
  const player = new ChordPlayer();
  const progFill = $('#ec-prog-fill');
  const timeCur = $('#ec-time-cur');
  const timeDur = $('#ec-time-dur');
  const playBtn = $('#ec-play');
  timeDur.textContent = fmt(state.duration);

  let yt = null;
  let ytReady = false;
  let rafId = null;
  let clockBase = performance.now(); // 内部时钟基准(perf 毫秒)
  let clockT = 0;                    // clockBase 时刻对应的播放秒数
  let curSpeed = 1;
  let waitTimer = null;
  const DEFAULT_NOTE = 'Video is the audio source · chords sync to playback';

  const videoLive = () =>
    ytReady && !state.videoBlocked && yt && yt.getPlayerState &&
    yt.getPlayerState() === YT.PlayerState.PLAYING;

  function clockNow() {
    if (videoLive()) return yt.getCurrentTime();
    return clockT + (performance.now() - clockBase) * 0.001 * curSpeed;
  }
  function setClock(t) { clockT = t; clockBase = performance.now(); }

  function idxAt(t) {
    let i = state.activeIdx;
    if (i < 0 || t < chords[i].t || t >= chords[i].e) {
      let lo = 0, hi = chords.length - 1;
      i = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (t < chords[mid].t) hi = mid - 1;
        else if (t >= chords[mid].e) lo = mid + 1;
        else { i = mid; break; }
        i = Math.min(lo, chords.length - 1);
      }
    }
    return i;
  }

  function setActive(i) {
    if (i === state.activeIdx) return;
    if (state.activeIdx >= 0) {
      cells[state.activeIdx].classList.remove('is-active');
      cells[state.activeIdx].classList.add('is-past');
    }
    state.activeIdx = i;
    const cell = cells[i];
    cell.classList.add('is-active');
    cell.classList.remove('is-past');
    const gw = grid.parentElement;
    const target = gw.scrollTop + (cell.getBoundingClientRect().top - gw.getBoundingClientRect().top) - gw.clientHeight / 2 + cell.clientHeight / 2;
    smoothScrollTop(gw, target);
    renderNow(i);
    if (state.playing && state.playChords) {
      const ch = chordByLabel(shapeLabel(chords[i].c));
      player.playChord(voicingFor(ch));
    }
  }

  function paintTime(t) {
    progFill.style.width = `${(t / state.duration) * 100}%`;
    timeCur.textContent = fmt(t);
  }

  function seek(t) {
    t = Math.max(0, Math.min(t, state.duration));
    state.t = t;
    setClock(t);
    paintTime(t);
    if (ytReady) { try { yt.seekTo(t, true); } catch { /* noop */ } }
    setActive(idxAt(t));
  }

  function tick() {
    if (!state.playing) return;
    let t = clockNow();
    // A-B 循环
    if (state.loopA != null && state.loopB != null && t >= state.loopB) {
      seek(state.loopA);
      if (videoLive()) { rafId = requestAnimationFrame(tick); return; }
      t = state.loopA;
    }
    // 到结尾
    if (t >= state.duration) {
      if (state.loopA != null && state.loopB != null) { seek(state.loopA); rafId = requestAnimationFrame(tick); return; }
      pause();
      seek(0);
      return;
    }
    state.t = t;
    paintTime(t);
    setActive(idxAt(t));
    rafId = requestAnimationFrame(tick);
  }

  function setLoading(on) {
    state.loading = on;
    playBtn.classList.toggle('is-loading', on);
    const note = $('#ec-video-note');
    if (note && !state.videoBlocked) note.textContent = on ? 'Loading original audio…' : DEFAULT_NOTE;
  }

  // 开始推进时间轴(视频起播后 或 兜底模式);此前 grid 停在 state.t 不抢跑
  function beginTick() {
    state.waitingVideo = false;
    clearTimeout(waitTimer);
    setLoading(false);
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
  }

  function play() {
    if (state.playing) return;
    state.playing = true;
    playBtn.classList.add('is-playing');
    player.ensure();
    if (!state.videoBlocked) {
      // 原声视频当音源:进入等待态,先不推进时间轴,等它真正起播再走
      // (否则视频还在 loading,和弦已抢跑,等视频起播又跳回从头)
      state.waitingVideo = true;
      setLoading(true);
      if (ytReady) { try { yt.playVideo(); } catch { /* noop */ } }
      else { state.pendingPlay = true; } // YT API 还没就绪,onReady 里再起播
      // 兜底防卡:10s 仍没起播(视频真被挡 / YT API 被拦)就切内部时钟
      clearTimeout(waitTimer);
      waitTimer = setTimeout(() => { if (state.playing && state.waitingVideo) markVideoBlocked(); }, 10000);
    } else {
      // 已知不可嵌:内部时钟自走
      setClock(state.t);
      beginTick();
    }
  }

  function pause() {
    if (!state.playing) return;
    if (!state.waitingVideo) { state.t = clockNow(); setClock(state.t); }
    state.playing = false;
    state.waitingVideo = false;
    state.pendingPlay = false;
    clearTimeout(waitTimer);
    setLoading(false);
    playBtn.classList.remove('is-playing');
    if (ytReady) { try { yt.pauseVideo(); } catch { /* noop */ } }
    cancelAnimationFrame(rafId);
    player.silence();
  }

  function setChords(on) {
    state.playChords = on;
    const btn = $('#ec-chords-toggle');
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
    if (on) player.ensure();
    else player.silence();
  }

  // 视频嵌入被挡(onError 或超时未起播):降级到内部时钟 + 和弦合成器,页面照常能播
  function markVideoBlocked() {
    if (state.videoBlocked) return;
    state.videoBlocked = true;
    state.autoFallback = true;
    const note = $('#ec-video-note');
    if (note) {
      note.innerHTML =
        `This video can’t be embedded here — playing the chord track instead. ` +
        `<a href="https://www.youtube.com/watch?v=${data.youtubeId}" target="_blank" rel="noopener">Watch on YouTube ↗</a>`;
      note.classList.add('is-blocked');
    }
    document.querySelector('.video-frame')?.classList.add('is-blocked');
    if (!state.playChords) setChords(true); // 没原声时至少让和弦轨发声(非用户手动)
    // 若正在等视频起播却被判定不可嵌,立刻切到内部时钟自走
    if (state.playing && state.waitingVideo) { setClock(state.t); beginTick(); }
  }

  // 视频最终成功起播:撤销自动兜底(除非用户手动开了跟弹)
  function restoreVideo() {
    if (!state.autoFallback) return;
    state.autoFallback = false;
    state.videoBlocked = false;
    const note = $('#ec-video-note');
    if (note) { note.textContent = DEFAULT_NOTE; note.classList.remove('is-blocked'); }
    document.querySelector('.video-frame')?.classList.remove('is-blocked');
    if (!state.userChords) setChords(false); // 关掉自动开的和弦轨,避免与原声重叠
  }

  // ---- YouTube 播放器 ----
  window.onYouTubeIframeAPIReady = () => {
    yt = new YT.Player('ec-video', {
      videoId: data.youtubeId,
      playerVars: { rel: 0, modestbranding: 1, playsinline: 1, origin: location.origin },
      events: {
        onReady: () => {
          ytReady = true;
          // 用户在 API 就绪前就点了播放:现在补起播
          if (state.pendingPlay && state.playing && !state.videoBlocked) {
            state.pendingPlay = false;
            try { yt.playVideo(); } catch { /* noop */ }
          }
        },
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.PLAYING) {
            // 视频真正起播:以视频时间为准开始推进(避免抢跑/跳回)
            restoreVideo();
            setClock(yt.getCurrentTime());
            if (state.playing) beginTick();
          }
        },
        onError: () => { markVideoBlocked(); }, // 150/101 嵌入禁用、100 不存在等一律降级
      },
    });
  };
  (function loadYT() {
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  })();

  // ---- 控件 ----
  playBtn.addEventListener('click', () => {
    if (state.playing) pause();
    else play();
  });

  $('#ec-prog').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - r.left) / r.width;
    seek(frac * state.duration);
  });

  grid.addEventListener('click', (e) => {
    const cell = e.target.closest('.ec-cell');
    if (!cell) return;
    const i = +cell.dataset.i;
    if (e.shiftKey) {
      if (state.loopA == null || state.loopB != null) {
        state.loopA = chords[i].t; state.loopB = null;
        cells.forEach((c) => c.classList.remove('is-loop'));
        cell.classList.add('is-loop');
      } else {
        state.loopB = chords[i].e;
        cell.classList.add('is-loop');
      }
      return;
    }
    seek(chords[i].t);
    if (!state.playing) play();
  });

  // 转调
  const transVal = $('#ec-trans-val');
  const setTrans = (n) => {
    state.transpose = Math.max(-6, Math.min(6, n));
    transVal.textContent = state.transpose > 0 ? `+${state.transpose}` : `${state.transpose}`;
    paintLabels();
  };
  $('#ec-trans-down').addEventListener('click', () => setTrans(state.transpose - 1));
  $('#ec-trans-up').addEventListener('click', () => setTrans(state.transpose + 1));

  // 变调夹
  const capoVal = $('#ec-capo-val');
  const setCapo = (n) => {
    state.capo = Math.max(0, Math.min(9, n));
    capoVal.textContent = state.capo;
    const tag = $('#ec-capo-tag'); if (tag) tag.textContent = state.capo;
    document.body.classList.toggle('has-capo', state.capo > 0);
    renderLegend();
    renderNow(viewIdx());
  };
  $('#ec-capo-down').addEventListener('click', () => setCapo(state.capo - 1));
  $('#ec-capo-up').addEventListener('click', () => setCapo(state.capo + 1));

  // 乐器
  $('#ec-inst').addEventListener('click', (e) => {
    const b = e.target.closest('.ec-inst-tab');
    if (!b) return;
    state.instrument = b.dataset.inst;
    $$('.ec-inst-tab', $('#ec-inst')).forEach((t) => t.classList.toggle('is-on', t === b));
    renderLegend();
    renderNow(viewIdx());
  });

  // 变速(内部时钟与视频都跟随)
  $('#ec-speed').addEventListener('change', (e) => {
    const v = parseFloat(e.target.value) || 1;
    state.t = clockNow();
    setClock(state.t);
    curSpeed = v;
    if (ytReady) { try { yt.setPlaybackRate(v); } catch { /* noop */ } }
  });

  // 跟弹和弦(手动):点开瞬间立刻弹一下当前和弦,给即时反馈
  // (否则要等下一次和弦切换才出声,容易以为"没反应")
  $('#ec-chords-toggle').addEventListener('click', () => {
    const on = !state.playChords;
    state.userChords = on;
    setChords(on);
    if (on) {
      player.ensure();
      const ch = chordByLabel(shapeLabel(chords[viewIdx()].c));
      player.playChord(voicingFor(ch));
    }
  });

  // 清除循环
  $('#ec-loop-clear').addEventListener('click', () => {
    state.loopA = state.loopB = null;
    cells.forEach((c) => c.classList.remove('is-loop'));
  });

  // 键盘
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); playBtn.click(); }
  });

  paintLabels();
  renderNow(0);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
