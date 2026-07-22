import './style.css';
import './premium.css';
import { detectChords, transposeLabel, chordByLabel } from './chords.js';
import { diagramSVG } from './diagrams.js';
import { spellRoot } from './music.js';
import { ChordPlayer, voicingFor } from './chordplayer.js';
import { drawWaveform, Visualizer } from './visuals.js';
import { initAmbientMotion, setProcessingProgress } from './ambient.js';

initAmbientMotion();

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const toastRegion = document.getElementById('toast-region');
let toastTimer = null;
function announce(message) {
  if (!toastRegion) return;
  toastRegion.textContent = message;
  toastRegion.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastRegion.classList.remove('show'), 2400);
}

const chordPlayer = new ChordPlayer();
const viz = new Visualizer(document.getElementById('viz'));
let mediaCtx = null;
let mediaSource = null;
// 首次播放时接入媒体音频图(供可视化取频谱),需在用户手势内
function ensureMediaGraph() {
  if (mediaCtx) { if (mediaCtx.state === 'suspended') mediaCtx.resume(); return; }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    mediaCtx = new AC();
    mediaSource = mediaCtx.createMediaElementSource(audio);
    mediaSource.connect(mediaCtx.destination); // 保持原声可听
    viz.attach(mediaCtx, mediaSource);          // 旁路取频谱
  } catch (e) { /* 某些环境不支持,可视化走 ambient 回退 */ }
}

// 重量级的 TF.js + Basic Pitch 按需加载,首屏(落地页)保持轻快。
let _analyzeFile = null;
async function getAnalyzeFile() {
  if (!_analyzeFile) {
    const mod = await import('./audio.js');
    _analyzeFile = mod.analyzeFile;
  }
  return _analyzeFile;
}

// Warm the analysis code after the first screen is stable. The model itself still
// initializes only after a user chooses a song, keeping initial load lightweight.
const warmAnalyzer = () => { getAnalyzeFile().catch(() => {}); };
if ('requestIdleCallback' in window) requestIdleCallback(warmAnalyzer, { timeout: 5000 });
else setTimeout(warmAnalyzer, 2200);

// ---------- state ----------
const state = {
  segments: [],       // [{start,end,label}] label 为规范升号拼写
  duration: 0,
  peaks: null,        // 波形峰值
  key: null,          // {name, isFlat, ...}
  tempo: null,        // {bpm, beat, ...}
  activeIdx: -1,
  instrument: 'guitar',
  transpose: 0,       // semitones
  capo: 0,            // fret
  autoscroll: true,
  loop: false,
  loopRange: null,    // {startIdx, endIdx} A-B 循环
  playChords: false,  // 跟弹和弦
  sheetRendered: false,
};

const audio = document.getElementById('audio');
let objectUrl = null;

// ---------- view switching ----------
function show(view) {
  const update = () => {
    toastRegion?.classList.remove('show');
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    document.getElementById(view).classList.add('active');
    document.body.dataset.view = view.replace('-view', '');
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  if (!reduceMotion && document.startViewTransition) {
    // 快速连续切换视图时,进行中的过渡会被中止并抛出 InvalidStateError;
    // 吞掉这个良性拒绝,避免控制台噪音。
    const t = document.startViewTransition(update);
    t.finished?.catch(() => {});
    t.ready?.catch(() => {});
  } else {
    update();
  }
}

// ---------- effective label (transpose + capo) ----------
// Capo N => fingered shapes sound N semitones higher, so shapes are shown N lower.
// effCanonical:升号规范名(供 diagrams / transpose 用)
function effCanonical(seg) {
  if (!seg.label) return null;
  const shift = state.transpose - state.capo;
  return shift === 0 ? seg.label : transposeLabel(seg.label, shift);
}
// effDisplay:按调性升/降号拼写(供文本显示用)
function effDisplay(seg) {
  const canon = effCanonical(seg);
  if (!canon) return null;
  const c = chordByLabel(canon);
  if (!c) return canon;
  const isFlat = state.key ? state.key.isFlat : false;
  return spellRoot(c.root, isFlat) + c.suffix;
}

// ---------- upload handling ----------
const fileInput = document.getElementById('file-input');
const dropZone = document.getElementById('drop-zone');
const MAX_FILE_BYTES = 250 * 1024 * 1024;
const AUDIO_EXT = /\.(mp3|wav|m4a|flac|ogg|aac|webm)$/i;

function validateAudioFile(file) {
  if (!file) return 'Choose an audio file to continue.';
  if (file.size > MAX_FILE_BYTES) return 'That file is over 250 MB. Try a shorter or compressed version.';
  if (!(file.type.startsWith('audio/') || AUDIO_EXT.test(file.name))) return 'That file does not look like supported audio.';
  return '';
}

function rejectFile(message) {
  dropZone.classList.remove('is-rejected');
  requestAnimationFrame(() => dropZone.classList.add('is-rejected'));
  setTimeout(() => dropZone.classList.remove('is-rejected'), 500);
  announce(message);
}

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});
fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});
['dragenter', 'dragover'].forEach((ev) =>
  dropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    dropZone.classList.add('drag');
  }),
);
['dragleave', 'drop'].forEach((ev) =>
  dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove('drag'); }),
);
dropZone.addEventListener('drop', (e) => {
  const f = e.dataTransfer.files[0];
  if (f) handleFile(f);
});

document.getElementById('demo-btn').addEventListener('click', async () => {
  try {
    const res = await fetch(import.meta.env.BASE_URL + 'demo.wav');
    if (!res.ok) throw new Error('no demo');
    const blob = await res.blob();
    handleFile(new File([blob], 'sample.wav', { type: 'audio/wav' }));
  } catch {
    alert('Sample not available — please upload your own audio file.');
  }
});

// ---------- 麦克风实时听歌扒谱 ----------
// 录一段麦克风音频 -> Blob -> 复用 handleFile 的完整分析/播放管线。
const micBtn = document.getElementById('mic-btn');
const recordOverlay = document.getElementById('record-overlay');
const recordClose = document.getElementById('record-close');
const recordStop = document.getElementById('record-stop');
const recordTime = document.getElementById('record-time');
const recordSub = document.getElementById('record-sub');
const recordMeter = document.getElementById('record-meter');
const recordChoose = document.getElementById('record-choose');
const recordLive = document.getElementById('record-live');
const recordHint = document.getElementById('record-hint');
const captureTab = document.getElementById('capture-tab');
const captureMic = document.getElementById('capture-mic');
const rec = {
  recorder: null, chunks: [], stream: null, ctx: null, analyser: null,
  raf: null, timer: null, startedAt: 0, analyze: false, data: null,
};

function pickRecMime() {
  if (!('MediaRecorder' in window)) return null;
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

// 录音反馈:实时波形 + 电平条 + 声音强度文字状态,让用户一眼看出"有没有收到声音"。
function drawMeter() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = recordMeter.clientWidth || 300;
  const h = recordMeter.clientHeight || 90;
  recordMeter.width = w * dpr; recordMeter.height = h * dpr;
  const ctx = recordMeter.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#c9f24d';
  const N = rec.analyser ? rec.analyser.fftSize : 1024;
  const timeBuf = new Uint8Array(N);
  let smooth = 0;            // 平滑后的电平(驱动电平条/透明度)
  let quietMs = 0;           // 持续安静时长(用于"太安静"提示)
  let heardOnce = false;     // 是否曾经听到明显声音
  let last = performance.now();
  const frame = (ts) => {
    const dt = ts - last; last = ts;
    ctx.clearRect(0, 0, w, h);
    let level = 0;
    if (rec.analyser) {
      rec.analyser.getByteTimeDomainData(timeBuf);
      let sum = 0;
      for (let i = 0; i < N; i++) { const d = (timeBuf[i] - 128) / 128; sum += d * d; }
      level = Math.min(1, Math.sqrt(sum / N) * 4.5); // RMS 放大到 0..1
    }
    smooth += (level - smooth) * 0.25;
    if (level > rec.peak) rec.peak = level; // 追踪整段最大电平
    const col = accent();
    const mid = h / 2;
    // 实时波形(时域),明显随声音起伏
    ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.strokeStyle = col;
    ctx.globalAlpha = 0.55 + smooth * 0.45;
    ctx.beginPath();
    const step = Math.max(1, Math.floor(N / w));
    for (let i = 0, x = 0; i < N; i += step, x = (i / (N - 1)) * w) {
      const y = mid + ((timeBuf[i] - 128) / 128) * (mid - 6) * 1.7;
      i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    // 底部电平条:随音量填充,直观显示"收到多大声"
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(127,127,127,0.18)';
    ctx.fillRect(0, h - 5, w, 4);
    ctx.fillStyle = col;
    ctx.fillRect(0, h - 5, w * smooth, 4);
    ctx.globalAlpha = 1;
    // 文字状态
    if (level > 0.06) heardOnce = true;
    if (level < 0.02) quietMs += dt; else quietMs = 0;
    if (recordOverlay.classList.contains('is-recording')) {
      recordSub.textContent = quietMs > 1400
        ? (heardOnce ? 'Paused? Play the song again — turn it up or move the mic closer.'
                     : 'Too quiet — turn the volume up or move the mic closer to the sound.')
        : 'Hearing the sound 🎵 — keep it playing.';
    }
    rec.raf = requestAnimationFrame(frame);
  };
  rec.raf = requestAnimationFrame(frame);
}

// 采集能力 + 平台探测:决定显示哪些选项、用什么文案(避免"以为能抓结果抓不到")
function captureCaps() {
  const md = navigator.mediaDevices;
  const ua = navigator.userAgent || '';
  const isMac = /Mac/.test(ua) && !/iPhone|iPad|iPod/.test(ua);
  return {
    canDisplay: !!(md && md.getDisplayMedia), // 桌面 Chrome/Edge 有;手机/部分浏览器没有
    isMac, // macOS 浏览器抓不了系统/窗口音频,只能抓浏览器标签页
  };
}

// 打开录音面板:先让用户选来源。按系统只显示"真能抓到"的选项 + 对应文案。
function openRecorder() {
  recordOverlay.hidden = false;
  recordOverlay.classList.remove('is-recording');
  recordChoose.hidden = false;
  recordLive.hidden = true;
  recordStop.textContent = 'Stop & get chords';
  const { canDisplay, isMac } = captureCaps();
  captureTab.hidden = !canDisplay; // 手机等抓不了 -> 直接不显示,只留麦克风
  if (canDisplay) {
    const title = captureTab.querySelector('.capture-txt strong');
    const desc = captureTab.querySelector('.capture-txt small');
    if (isMac) {
      // macOS:只能抓浏览器标签页,说清楚,免得用户以为能抓桌面 App
      title.textContent = 'Capture a browser tab playing the song';
      desc.textContent = 'Best quality — play it in a tab (YouTube, Spotify web…). Desktop apps can’t be captured on macOS.';
    } else {
      title.textContent = 'Capture a song playing on this computer';
      desc.textContent = 'Best quality — grab audio from a tab, or your whole screen’s sound.';
    }
  }
}

function backToChoose() {
  cleanupMic();
  recordLive.hidden = true;
  recordChoose.hidden = false;
}

// 采集音频并开始录制。source='tab' 抓标签页/系统音频(数字直取,音质=原文件);
// source='mic' 用麦克风(手机凑音箱的兜底,音质有损)。
async function startCapture(source) {
  recordChoose.hidden = true;
  recordLive.hidden = false;
  recordStop.disabled = true;
  recordTime.textContent = '0:00';
  rec.chunks = [];
  rec.peak = 0; // 记录整段最大电平,用于停止时判断是否真的收到了声音
  const caps = captureCaps();
  recordSub.textContent = source === 'tab' ? 'Choose what’s playing the song…' : 'Requesting microphone…';
  recordHint.textContent = source === 'tab'
    ? (caps.isMac
        ? 'Pick the tab playing the song and turn on “Share tab audio”. 15–30s is plenty — nothing is uploaded.'
        : 'Pick the tab (turn on “Share tab audio”), or choose “Entire screen” to grab your system sound. 15–30s is plenty — nothing is uploaded.')
    : 'Point your mic at a speaker playing the song, volume up. 15–30s is plenty — mic audio is rougher than a direct capture.';
  try {
    if (source === 'tab') {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const audioTracks = display.getAudioTracks();
      display.getVideoTracks().forEach((t) => t.stop()); // 视频用不上,只留音频
      if (!audioTracks.length) {
        display.getTracks().forEach((t) => t.stop());
        announce('No audio was shared — pick a tab and turn on “Share tab audio”.');
        backToChoose();
        return;
      }
      rec.stream = new MediaStream(audioTracks);
      // 用户在共享栏点"停止共享" -> 视为完成并出谱
      audioTracks[0].addEventListener('ended', () => {
        if (rec.recorder && rec.recorder.state !== 'inactive') stopRecorder(true);
      });
    } else {
      rec.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
    }
  } catch (e) {
    announce(source === 'tab' ? 'Audio capture was canceled or blocked.' : 'Microphone permission denied.');
    backToChoose();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  rec.ctx = new AC();
  // 关键:AudioContext 可能以 suspended 启动,不 resume 分析器会一直是 0(反馈假死)
  if (rec.ctx.state === 'suspended') { try { await rec.ctx.resume(); } catch (_) {} }
  const src = rec.ctx.createMediaStreamSource(rec.stream);
  rec.analyser = rec.ctx.createAnalyser();
  rec.analyser.fftSize = 1024;
  rec.analyser.smoothingTimeConstant = 0.6;
  src.connect(rec.analyser);
  drawMeter();

  const mime = pickRecMime();
  if (mime === null) {
    recordSub.textContent = 'Recording is not supported in this browser. Please upload a file instead.';
    cleanupMic();
    return;
  }
  rec.recorder = new MediaRecorder(rec.stream, mime ? { mimeType: mime } : undefined);
  rec.recorder.ondataavailable = (e) => { if (e.data && e.data.size) rec.chunks.push(e.data); };
  rec.recorder.onstop = onRecorderStop;
  rec.recorder.start();
  rec.startedAt = performance.now();
  recordSub.textContent = source === 'tab' ? 'Capturing — let the song play.' : 'Listening… play the song now.';
  recordStop.disabled = false;
  recordOverlay.classList.add('is-recording');
  rec.timer = setInterval(() => {
    const s = Math.floor((performance.now() - rec.startedAt) / 1000);
    recordTime.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (s >= 4) recordStop.textContent = 'Stop & get chords';
  }, 250);
}

function cleanupMic() {
  clearInterval(rec.timer); rec.timer = null;
  if (rec.raf) cancelAnimationFrame(rec.raf); rec.raf = null;
  if (rec.stream) rec.stream.getTracks().forEach((t) => t.stop());
  if (rec.ctx && rec.ctx.state !== 'closed') rec.ctx.close();
  rec.stream = null; rec.ctx = null; rec.analyser = null;
  recordOverlay.classList.remove('is-recording');
}

function onRecorderStop() {
  const type = (rec.recorder && rec.recorder.mimeType) || 'audio/webm';
  const analyze = rec.analyze;
  const elapsed = (performance.now() - rec.startedAt) / 1000;
  const peak = rec.peak || 0;
  cleanupMic();
  recordOverlay.hidden = true;
  if (!analyze) return;
  if (elapsed < 4 || !rec.chunks.length) {
    announce('That clip was too short — try recording at least 5 seconds.');
    return;
  }
  // 整段几乎没收到声音:别浪费时间去解析静音(会出一堆垃圾和弦),直接提示重录
  if (peak < 0.03) {
    announce('We barely heard anything — turn the volume up or move the mic closer, then record again.');
    return;
  }
  const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
  const blob = new Blob(rec.chunks, { type });
  handleFile(new File([blob], `Live recording.${ext}`, { type }));
}

function stopRecorder(analyze) {
  rec.analyze = analyze;
  if (rec.recorder && rec.recorder.state !== 'inactive') rec.recorder.stop();
  else { cleanupMic(); recordOverlay.hidden = true; }
}

micBtn.addEventListener('click', () => {
  const md = navigator.mediaDevices;
  if (!md || (!md.getUserMedia && !md.getDisplayMedia)) {
    announce('This browser can’t capture audio. Please upload a file instead.');
    return;
  }
  openRecorder();
});
captureTab.addEventListener('click', () => startCapture('tab'));
captureMic.addEventListener('click', () => startCapture('mic'));
recordStop.addEventListener('click', () => stopRecorder(true));
recordClose.addEventListener('click', () => stopRecorder(false));
recordOverlay.addEventListener('click', (e) => { if (e.target === recordOverlay) stopRecorder(false); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !recordOverlay.hidden) stopRecorder(false);
});

const procTitle = document.getElementById('proc-title');
const procFile = document.getElementById('proc-file');
const procStage = document.getElementById('proc-stage');
const progressFill = document.getElementById('progress-fill');
const procElapsed = document.getElementById('proc-elapsed');
const procCancel = document.getElementById('proc-cancel');
const processing = document.querySelector('.processing');
let analysisRun = 0;
let analysisTimer = null;
let analysisStartedAt = 0;

function stopAnalysisClock() {
  clearInterval(analysisTimer);
  analysisTimer = null;
}

function startAnalysisClock() {
  stopAnalysisClock();
  analysisStartedAt = performance.now();
  const update = () => {
    const seconds = Math.max(0, Math.floor((performance.now() - analysisStartedAt) / 1000));
    procElapsed.textContent = seconds < 2 ? 'Preparing the audio engine' : `Listening locally · ${seconds}s elapsed`;
  };
  update();
  analysisTimer = setInterval(update, 1000);
}

function setProcessingError(title, detail) {
  stopAnalysisClock();
  processing.classList.add('is-error');
  procTitle.textContent = title;
  procStage.textContent = detail;
  procElapsed.textContent = 'No audio was uploaded or stored.';
  procCancel.textContent = 'Choose another file';
  setProcessingProgress(100, 'map');
}

procCancel.addEventListener('click', () => {
  if (!processing.classList.contains('is-error')) {
    // Reloading is the only reliable way to terminate an in-flight TF.js graph;
    // returning to the upload screen alone would leave inference using the CPU.
    window.location.reload();
    return;
  }
  analysisRun += 1;
  stopAnalysisClock();
  audio.pause();
  show('upload-view');
  announce('Ready for another song.');
});

async function handleFile(file) {
  const invalid = validateAudioFile(file);
  if (invalid) { rejectFile(invalid); return; }
  const run = ++analysisRun;
  state.sheetRendered = false;
  show('processing-view');
  processing.classList.remove('is-error');
  procCancel.textContent = 'Cancel analysis';
  startAnalysisClock();
  state.fileName = file.name;
  procFile.textContent = file.name;
  procTitle.textContent = 'Transcribing your music';
  procStage.textContent = 'Decoding audio';
  progressFill.style.width = '4%';
  setProcessingProgress(4, 'decode');

  // set up playback source
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  audio.src = objectUrl;

  try {
    const analyzeFile = await getAnalyzeFile();
    if (run !== analysisRun) return;
    const { notes, duration, peaks } = await analyzeFile(file, (stage, p) => {
      if (run !== analysisRun) return;
      if (stage === 'decode') {
        procStage.textContent = 'Decoding audio';
        progressFill.style.width = '8%';
        setProcessingProgress(8, 'decode');
      }
      if (stage === 'infer') {
        procStage.textContent = 'Hearing notes';
        const progress = 10 + p * 76;
        progressFill.style.width = `${progress}%`;
        setProcessingProgress(progress, 'listen');
      }
    });
    if (run !== analysisRun) return;
    procStage.textContent = 'Naming chords';
    progressFill.style.width = '91%';
    setProcessingProgress(91, 'name');
    await new Promise((r) => setTimeout(r, 70));

    const { segments, key, tempo } = detectChords(notes, duration);
    if (run !== analysisRun) return;
    procStage.textContent = 'Building timeline';
    progressFill.style.width = '97%';
    setProcessingProgress(97, 'map');
    await new Promise((r) => setTimeout(r, 80));
    progressFill.style.width = '100%';
    setProcessingProgress(100, 'map');

    if (!segments.length) {
      setProcessingError('No clear harmony found', 'Try a track with clearer guitar, piano, or sustained chords.');
      return;
    }
    state.segments = segments;
    state.duration = duration;
    state.peaks = peaks;
    state.key = key;
    state.tempo = tempo;
    state.activeIdx = -1;
    state.waveSegs = null;
    stopAnalysisClock();
    procElapsed.textContent = 'Chord timeline ready';
    await new Promise((r) => setTimeout(r, 250));
    if (run !== analysisRun) return;
    startPlayer();
  } catch (err) {
    if (run !== analysisRun) return;
    console.error(err);
    setProcessingError('Something went wrong', String(err.message || err));
  }
}

// ---------- player ----------
const sheet = document.getElementById('sheet');
const nowLabel = document.getElementById('now-label');
const nowNext = document.getElementById('now-next');
const nowTime = document.getElementById('now-time');
const nowDiagram = document.getElementById('now-diagram');
const playBtn = document.getElementById('play-btn');
const waveform = document.getElementById('waveform');
const waveTip = document.getElementById('wave-tip');

// 和弦变化点(用于波形上的标记)
function chordMarkers() {
  if (!state.duration) return [];
  return state.segments.filter((s) => s.label).map((s) => s.start / state.duration);
}
// 波形底部和弦色带数据(按检测原调的根音着色,不随转调变化;换歌时重置)
function waveSegments() {
  if (!state.duration) return [];
  if (!state.waveSegs) {
    state.waveSegs = state.segments
      .filter((s) => s.label)
      .map((s) => ({
        p0: s.start / state.duration,
        p1: s.end / state.duration,
        root: chordByLabel(s.label)?.root ?? 0,
      }));
  }
  return state.waveSegs;
}
function redrawWave() {
  const prog = state.duration ? Math.min(1, audio.currentTime / state.duration) : 0;
  drawWaveform(waveform, state.peaks, prog, chordMarkers(), waveSegments());
  waveform.setAttribute('aria-valuenow', String(Math.round(prog * 100)));
  waveform.setAttribute('aria-valuetext', `${fmtTime(audio.currentTime)} of ${fmtTime(state.duration)}`);
}

function startPlayer() {
  show('player-view');
  renderMeta();
  renderSheet();
  // 节拍脉动周期
  if (state.tempo && state.tempo.beat) {
    document.getElementById('player-view').style.setProperty('--beat-dur', (state.tempo.beat * 2).toFixed(3) + 's');
  }
  updateNow(0);
  requestAnimationFrame(redrawWave);
  viz.start();
  announce(`Analysis ready: ${state.key?.name || 'key unknown'}, ${state.tempo?.bpm || 'tempo unknown'} BPM.`);
}

// Key / BPM 徽章
function renderMeta() {
  const el = document.getElementById('song-meta');
  if (!el) return;
  const songTitle = document.getElementById('song-title');
  if (songTitle) songTitle.textContent = state.fileName ? state.fileName.replace(/\.[^.]+$/, '') : 'Untitled track';
  const parts = [];
  if (state.key) parts.push(`<span class="meta-badge"><span class="meta-k">Key</span> ${state.key.name}</span>`);
  if (state.tempo && state.tempo.bpm) parts.push(`<span class="meta-badge"><span class="meta-k">Tempo</span> ${state.tempo.bpm} BPM</span>`);
  parts.push(`<span class="meta-badge"><span class="meta-k">Chords</span> ${new Set(state.segments.filter((s) => s.label).map((s) => s.label)).size}</span>`);
  el.innerHTML = parts.join('');
}

function fmtTime(s) {
  if (!isFinite(s)) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// 把和弦段按估计速度分成小节:[{start,end,chips:[{seg,idx}]}]
function buildBars() {
  const tempo = state.tempo;
  const useBars = tempo && tempo.bpm && tempo.confidence > 0.05;
  if (!useBars) { state.bars = null; state.barLen = null; return; }
  const barLen = 4 * tempo.beat; // 4/4
  state.barLen = barLen;
  const nBars = Math.max(1, Math.ceil(state.duration / barLen));
  const bars = [];
  for (let b = 0; b < nBars; b++) {
    const bs = b * barLen;
    const be = Math.min((b + 1) * barLen, state.duration);
    const chips = [];
    state.segments.forEach((seg, idx) => {
      if (!seg.label) return;
      const os = Math.max(seg.start, bs);
      const oe = Math.min(seg.end, be);
      if (oe - os > 0.12) {
        const last = chips[chips.length - 1];
        if (!last || state.segments[last.idx].label !== seg.label) chips.push({ seg, idx });
      }
    });
    bars.push({ start: bs, end: be, chips });
  }
  state.bars = bars;
}

function renderSheet() {
  buildBars();
  sheet.innerHTML = '';
  if (state.bars) {
    sheet.className = 'sheet bars';
    state.bars.forEach((bar, bi) => {
      const cell = document.createElement('div');
      cell.className = 'bar-cell';
      cell.dataset.bar = bi;
      cell.style.setProperty('--bar-i', Math.min(bi, 12));
      if (state.sheetRendered) cell.style.animation = 'none';
      let chords = '';
      if (!bar.chips.length) {
        chords = '<span class="chip nc">·</span>';
      } else {
        for (const ch of bar.chips) {
          chords += `<button class="chip" data-seg="${ch.idx}">${effDisplay(ch.seg)}</button>`;
        }
      }
      cell.innerHTML = `<span class="bar-num">${bi + 1}</span><div class="bar-chords">${chords}</div>`;
      sheet.appendChild(cell);
    });
  } else {
    // 回退:分段块布局(速度不可靠时)
    sheet.className = 'sheet flat';
    state.segments.forEach((seg, i) => {
      const tile = document.createElement('button');
      tile.className = 'chord-tile';
      tile.dataset.seg = i;
      const label = effDisplay(seg);
      tile.innerHTML = `<span class="tile-name ${label ? '' : 'tile-nc'}">${label || 'N.C.'}</span>`;
      sheet.appendChild(tile);
    });
  }
  state.sheetRendered = true;
}

function segIndexAt(t) {
  let idx = -1;
  for (let i = 0; i < state.segments.length; i++) {
    if (state.segments[i].start <= t) idx = i;
    else break;
  }
  return idx;
}

function updateNow(t) {
  nowTime.textContent = `${fmtTime(t)} / ${fmtTime(state.duration)}`;
  const idx = segIndexAt(t);
  if (idx !== state.activeIdx) {
    state.activeIdx = idx;
    const seg = state.segments[idx];
    // 跟弹和弦:弹原调检测和弦(匹配未变调的原曲音频)
    if (state.playChords && !audio.paused) playCurrentChord();
    const canon = seg ? effCanonical(seg) : null;
    nowLabel.textContent = (seg && effDisplay(seg)) || '—';
    nowLabel.classList.remove('changing');
    requestAnimationFrame(() => nowLabel.classList.add('changing'));
    nowDiagram.innerHTML = canon ? diagramSVG(state.instrument, canon) : '';
    // Up next:预告下一个不同的和弦(显示文案随转调/变调夹)
    let nextTxt = '';
    for (let i = idx + 1; i < state.segments.length; i++) {
      const label = state.segments[i] && effDisplay(state.segments[i]);
      if (label && label !== nowLabel.textContent) { nextTxt = `→ ${label}`; break; }
    }
    nowNext.textContent = nextTxt;
    // 高亮:小节里的当前和弦 chip + 所在小节
    const chips = sheet.querySelectorAll('.chip[data-seg]');
    let activeEl = null;
    chips.forEach((el) => {
      const on = Number(el.dataset.seg) === idx;
      el.classList.toggle('active', on);
      if (on) el.setAttribute('aria-current', 'true'); else el.removeAttribute('aria-current');
      if (on) activeEl = el;
    });
    const tiles = sheet.querySelectorAll('.chord-tile');
    tiles.forEach((el, i) => {
      el.classList.toggle('active', i === idx);
      el.classList.toggle('past', i < idx);
    });
    if (state.bars) {
      const bi = state.barLen ? Math.floor(t / state.barLen) : -1;
      sheet.querySelectorAll('.bar-cell').forEach((el, i) => el.classList.toggle('active-bar', i === bi));
    }
    if (state.autoscroll && !audio.paused) {
      const target = activeEl ? activeEl.closest('.bar-cell') || activeEl : tiles[idx];
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

// 点击 chip/tile 跳转;shift+点击小节设 A-B 循环端点
sheet.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip[data-seg], .chord-tile[data-seg]');
  const barCell = e.target.closest('.bar-cell');
  if (e.shiftKey && barCell) {
    setLoopPoint(Number(barCell.dataset.bar));
    return;
  }
  if (chip) {
    const seg = state.segments[Number(chip.dataset.seg)];
    if (seg) { audio.currentTime = seg.start + 0.02; if (audio.paused) audio.play().catch(() => {}); }
  } else if (barCell) {
    const bar = state.bars[Number(barCell.dataset.bar)];
    if (bar) { audio.currentTime = bar.start + 0.02; if (audio.paused) audio.play().catch(() => {}); }
  }
});

// ---------- A-B 循环 ----------
function setLoopPoint(barIdx) {
  if (!state.bars) return;
  if (!state.loopRange || state.loopRange.b != null) {
    state.loopRange = { a: barIdx, b: null };
  } else {
    const a = Math.min(state.loopRange.a, barIdx);
    const b = Math.max(state.loopRange.a, barIdx);
    state.loopRange = { a, b };
    state.loop = true;
    const loopBtn = document.getElementById('loop-btn');
    loopBtn.classList.add('active');
    loopBtn.setAttribute('aria-pressed', 'true');
    announce(`Loop set from bar ${a + 1} through bar ${b + 1}.`);
  }
  renderLoopRange();
}
function renderLoopRange() {
  const cells = sheet.querySelectorAll('.bar-cell');
  cells.forEach((el, i) => {
    const r = state.loopRange;
    const inRange = r && r.b != null && i >= r.a && i <= r.b;
    const isAnchor = r && r.b == null && i === r.a;
    el.classList.toggle('loop-range', !!inRange);
    el.classList.toggle('loop-anchor', !!isAnchor);
  });
}
function loopBounds() {
  if (state.loopRange && state.loopRange.b != null && state.barLen) {
    return { start: state.loopRange.a * state.barLen, end: Math.min((state.loopRange.b + 1) * state.barLen, state.duration) };
  }
  return { start: 0, end: state.duration };
}

// ---------- animation loop ----------
let wavePlayerVisible = false;
function tick() {
  const playerOn = document.getElementById('player-view').classList.contains('active');
  if (playerOn && !audio.paused) {
    const t = audio.currentTime;
    updateNow(t);
    redrawWave();
    if (state.loop) {
      const { start, end } = loopBounds();
      if (t >= end - 0.04) audio.currentTime = start;
    }
  } else if (playerOn && !wavePlayerVisible) {
    redrawWave(); // 暂停时也画一次静态波形
  }
  wavePlayerVisible = playerOn;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---------- transport controls ----------
playBtn.addEventListener('click', () => {
  ensureMediaGraph();
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
});
audio.addEventListener('play', () => {
  playBtn.classList.add('playing');
  playBtn.querySelector('.play-icon').textContent = '❚❚';
  playBtn.setAttribute('aria-label', 'Pause');
  document.getElementById('player-view').classList.add('is-playing');
  viz.setPlaying(true);
  if (state.playChords) { chordPlayer.ensure(); playCurrentChord(); }
});
audio.addEventListener('pause', () => {
  playBtn.classList.remove('playing');
  playBtn.querySelector('.play-icon').textContent = '▶';
  playBtn.setAttribute('aria-label', 'Play');
  document.getElementById('player-view').classList.remove('is-playing');
  viz.setPlaying(false);
  chordPlayer.silence();
});
audio.addEventListener('loadedmetadata', () => {
  if (!state.duration || !isFinite(state.duration)) state.duration = audio.duration;
});

// 波形进度条:点击/拖动定位
let scrubbing = false;
function seekFromEvent(e) {
  const rect = waveform.getBoundingClientRect();
  const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
  const frac = Math.max(0, Math.min(1, x / rect.width));
  audio.currentTime = frac * state.duration;
  updateNow(audio.currentTime);
  redrawWave();
}
waveform.addEventListener('pointerdown', (e) => { scrubbing = true; waveform.setPointerCapture(e.pointerId); waveTip.hidden = true; seekFromEvent(e); });
waveform.addEventListener('pointermove', (e) => {
  if (scrubbing) { seekFromEvent(e); return; }
  if (!state.duration) return;
  // 悬停显示该位置的和弦
  const rect = waveform.getBoundingClientRect();
  const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * state.duration;
  const seg = state.segments[segIndexAt(t)];
  const label = seg && effDisplay(seg);
  if (!label) { waveTip.hidden = true; return; }
  waveTip.textContent = label;
  waveTip.hidden = false;
  const wrapRect = waveform.parentElement.getBoundingClientRect();
  const x = Math.min(Math.max(e.clientX - wrapRect.left, 20), wrapRect.width - 20);
  waveTip.style.left = x + 'px';
});
waveform.addEventListener('pointerleave', () => { waveTip.hidden = true; });
waveform.addEventListener('pointerup', () => { scrubbing = false; });
waveform.addEventListener('keydown', (e) => {
  if (!state.duration) return;
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  if (e.key === 'Home') audio.currentTime = 0;
  if (e.key === 'End') audio.currentTime = Math.max(0, state.duration - 0.05);
  if (e.key === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - 5);
  if (e.key === 'ArrowRight') audio.currentTime = Math.min(state.duration, audio.currentTime + 5);
  updateNow(audio.currentTime);
  redrawWave();
});
window.addEventListener('resize', () => { redrawWave(); });

// instrument tabs
document.getElementById('instrument-tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.inst-tab');
  if (!btn) return;
  state.instrument = btn.dataset.inst;
  state.voicing = 0;
  document.querySelectorAll('.inst-tab').forEach((b) => {
    const active = b === btn;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', String(active));
  });
  const seg = state.segments[state.activeIdx];
  const canon = seg ? effCanonical(seg) : null;
  nowDiagram.innerHTML = canon ? diagramSVG(state.instrument, canon) : '';
  announce(`${btn.textContent.trim()} chord diagram selected.`);
});

// steppers (transpose / capo)
const transposeVal = document.getElementById('transpose-val');
const capoVal = document.getElementById('capo-val');
document.querySelector('.ctrl-cluster').addEventListener('click', (e) => {
  const act = e.target.dataset.act;
  if (!act) return;
  if (act === 'transpose-up') state.transpose = Math.min(11, state.transpose + 1);
  if (act === 'transpose-down') state.transpose = Math.max(-11, state.transpose - 1);
  if (act === 'capo-up') state.capo = Math.min(11, state.capo + 1);
  if (act === 'capo-down') state.capo = Math.max(0, state.capo - 1);
  transposeVal.textContent = (state.transpose > 0 ? '+' : '') + state.transpose;
  capoVal.textContent = state.capo;
  refreshLabels();
  announce(`Transpose ${state.transpose >= 0 ? '+' : ''}${state.transpose}; capo ${state.capo}.`);
});

function refreshLabels() {
  renderSheet();
  renderLoopRange();
  state.activeIdx = -1; // force diagram + highlight refresh
  updateNow(audio.currentTime);
}

// speed
const speed = document.getElementById('speed');
const speedVal = document.getElementById('speed-val');
speed.addEventListener('input', () => {
  const r = speed.value / 100;
  audio.playbackRate = r;
  audio.preservesPitch = true;
  audio.mozPreservesPitch = true;
  audio.webkitPreservesPitch = true;
  speedVal.textContent = `${speed.value}%`;
});

// 跟弹和弦
function playCurrentChord() {
  const seg = state.segments[state.activeIdx];
  if (seg && seg.label) {
    chordPlayer.playChord(voicingFor(chordByLabel(seg.label)));
  } else {
    chordPlayer.silence();
  }
}
document.getElementById('chords-btn').addEventListener('click', (e) => {
  state.playChords = !state.playChords;
  e.currentTarget.classList.toggle('active', state.playChords);
  e.currentTarget.setAttribute('aria-pressed', String(state.playChords));
  if (state.playChords) {
    chordPlayer.ensure();
    if (!audio.paused) playCurrentChord();
  } else {
    chordPlayer.silence();
  }
  announce(state.playChords ? 'Chord accompaniment on.' : 'Chord accompaniment off.');
});

// loop / autoscroll / new
document.getElementById('loop-btn').addEventListener('click', (e) => {
  state.loop = !state.loop;
  if (!state.loop) { state.loopRange = null; renderLoopRange(); }
  audio.loop = false; // 由 tick() 手动处理循环(支持 A-B 段)
  e.currentTarget.classList.toggle('active', state.loop);
  e.currentTarget.setAttribute('aria-pressed', String(state.loop));
  announce(state.loop ? 'Loop enabled.' : 'Loop cleared.');
});
document.getElementById('autoscroll-btn').addEventListener('click', (e) => {
  state.autoscroll = !state.autoscroll;
  e.currentTarget.classList.toggle('active', state.autoscroll);
  e.currentTarget.setAttribute('aria-pressed', String(state.autoscroll));
  announce(state.autoscroll ? 'Following the current chord.' : 'Automatic follow paused.');
});
document.getElementById('new-btn').addEventListener('click', () => {
  analysisRun += 1;
  audio.pause();
  viz.stop();
  if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
  audio.removeAttribute('src');
  audio.load();
  show('upload-view');
  fileInput.value = '';
  announce('Ready for a new song.');
});

// header 里的"New song"(播放/分析页显示)复用 new-btn 的完整重置逻辑
document.getElementById('header-new').addEventListener('click', () => document.getElementById('new-btn').click());

// 全局导航在播放器/分析页保持可用：先回到落地页，再定位对应内容。
document.querySelectorAll('.brand, .site-nav a[href^="#"]').forEach((link) => {
  link.addEventListener('click', (event) => {
    if (document.getElementById('upload-view').classList.contains('active')) return;
    event.preventDefault();
    const target = link.getAttribute('href');
    document.getElementById('new-btn').click();
    requestAnimationFrame(() => {
      if (target === '#app') window.scrollTo({ top: 0, behavior: 'smooth' });
      else document.querySelector(target)?.scrollIntoView({ behavior: 'smooth' });
    });
  });
});

// keyboard: space = play/pause; ←/→ = 上一/下一个和弦
document.addEventListener('keydown', (e) => {
  if (!document.getElementById('player-view').classList.contains('active')) return;
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
  } else if (e.code === 'ArrowRight') {
    e.preventDefault();
    const next = state.segments[Math.min(state.segments.length - 1, state.activeIdx + 1)];
    if (next) audio.currentTime = next.start + 0.02;
  } else if (e.code === 'ArrowLeft') {
    e.preventDefault();
    const prev = state.segments[Math.max(0, state.activeIdx - 1)];
    if (prev) audio.currentTime = prev.start + 0.02;
  }
});

// 和弦图 3D 倾斜跟随鼠标
const diagramWrap = document.querySelector('.now-diagram-wrap');
if (diagramWrap && !reduceMotion && window.matchMedia('(pointer: fine)').matches) {
  diagramWrap.addEventListener('pointermove', (e) => {
    const r = diagramWrap.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    nowDiagram.style.transform = `rotateY(${px * 22}deg) rotateX(${-py * 22}deg)`;
  });
  diagramWrap.addEventListener('pointerleave', () => {
    nowDiagram.style.transform = 'rotateY(0) rotateX(0)';
  });
}

// 点当前和弦图切换替代把位(吉他/尤克)
nowDiagram.addEventListener('click', () => {
  const seg = state.segments[state.activeIdx];
  const canon = seg ? effCanonical(seg) : null;
  if (!canon || state.instrument === 'piano') return;
  state.voicing = (state.voicing || 0) + 1;
  nowDiagram.innerHTML = diagramSVG(state.instrument, canon, state.voicing);
});

// ---------- 导出和弦谱 ----------
function chordSheetText() {
  const lines = [];
  const title = state.fileName ? state.fileName.replace(/\.[^.]+$/, '') : 'Chord sheet';
  lines.push(title);
  if (state.key) lines.push(`Key: ${state.key.name}${state.tempo && state.tempo.bpm ? '   Tempo: ' + state.tempo.bpm + ' BPM' : ''}`);
  lines.push('');
  if (state.bars) {
    let row = [];
    state.bars.forEach((bar, i) => {
      const names = bar.chips.length ? bar.chips.map((c) => effDisplay(c.seg)).join(' ') : '-';
      row.push(names.padEnd(10));
      if ((i + 1) % 4 === 0) { lines.push('| ' + row.join('| ') + '|'); row = []; }
    });
    if (row.length) lines.push('| ' + row.join('| ') + '|');
  } else {
    lines.push(state.segments.filter((s) => s.label).map((s) => effDisplay(s)).join('  '));
  }
  lines.push('');
  lines.push('Made with ChordSnap');
  return lines.join('\n');
}
document.getElementById('export-btn').addEventListener('click', async () => {
  const text = chordSheetText();
  try {
    await navigator.clipboard.writeText(text);
    const btn = document.getElementById('export-btn');
    const orig = btn.textContent;
    btn.textContent = '✓ Copied';
    setTimeout(() => { btn.textContent = orig; }, 1500);
    announce('Chord sheet copied to the clipboard.');
  } catch {
    // 回退:下载 .txt
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'chords.txt';
    a.click();
    announce('Chord sheet downloaded as text.');
  }
});

// ---------- theme ----------
const themeToggle = document.getElementById('theme-toggle');
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('cs-theme', t);
}
themeToggle.addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = cur === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  announce(`${next === 'dark' ? 'Dark' : 'Light'} theme enabled.`);
});
applyTheme(localStorage.getItem('cs-theme') || 'dark');

window.addEventListener('pagehide', () => {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
});
