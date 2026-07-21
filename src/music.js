// 乐理分析:调性检测(Krumhansl-Schmuckler)、速度估计、升降号拼写。

export const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// K-S 调性剖面(major/minor 各 12 权重,C 为起点)
const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// 用降号拼写的调(及其关系小调)——决定 UI 里 A#/Bb 的选择
const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm']);

function pearson(a, b) {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return num / (Math.sqrt(da * db) || 1);
}

// 从音符事件构建全局 chroma 直方图(按时长×振幅加权)
export function globalChroma(notes) {
  const c = new Float64Array(12);
  for (const n of notes) {
    c[n.pitchMidi % 12] += (n.durationSeconds || 0.1) * (n.amplitude || 1);
  }
  return c;
}

// 由 (tonic, mode, 相关度) 构建完整调性对象
export function makeKey(tonic, mode, corr) {
  const name = SHARP[tonic] + (mode === 'minor' ? 'm' : '');
  const isFlat = FLAT_KEYS.has(name) || (tonic === 5 && mode === 'major'); // F 大调用降号
  // 音阶音级
  const majSteps = [0, 2, 4, 5, 7, 9, 11];
  const minSteps = [0, 2, 3, 5, 7, 8, 10];
  const steps = mode === 'major' ? majSteps : minSteps;
  const scale = new Set(steps.map((s) => (tonic + s) % 12));
  const nameFlat = (isFlat ? FLAT : SHARP)[tonic] + (mode === 'minor' ? 'm' : '');
  return { tonic, mode, name: nameFlat, isFlat, scale, confidence: corr };
}

// 24 个候选调(0-11 大调、12-23 小调)对给定 chroma 的 K-S 相关度
function keyCorrelations(chroma, out) {
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotMaj = KS_MAJOR.map((_, i) => KS_MAJOR[(i - tonic + 12) % 12]);
    const rotMin = KS_MINOR.map((_, i) => KS_MINOR[(i - tonic + 12) % 12]);
    out[tonic] = pearson(chroma, rotMaj);
    out[12 + tonic] = pearson(chroma, rotMin);
  }
  return out;
}

// 返回 {tonic, mode:'major'|'minor', name, isFlat, scale:Set(pc)}
export function detectKey(notes) {
  const corrs = keyCorrelations(globalChroma(notes), new Float64Array(24));
  let best = 0;
  for (let i = 1; i < 24; i++) if (corrs[i] > corrs[best]) best = i;
  return makeKey(best % 12, best < 12 ? 'major' : 'minor', corrs[best]);
}

// ---- 分段调性跟踪 ----
// 转调歌(C→D、F→G)在全局单一调性假设下会被"折中"成中间调(F#),
// 且后半段的调内先验全错。这里用滑动窗 K-S 相关度做发射分、
// 24 个调状态 + 五度圈转移先验做 Viterbi 解码,得到随时间变化的调性路径,
// 供和弦识别按帧取局部调内先验(与和弦 HMM 同一套思路,见 chords.js)。
const KEY_WIN = 12;      // 局部调性窗口(秒):覆盖若干小节,稳定又跟得上转调
const KEY_HOP = 3;       // 调性帧移(秒)
const KEY_EMIT_GAIN = 3; // 相关度 -> log 发射分的放大系数
const KEY_P_STAY = 0.85; // 调性自环概率:转调是稀有事件
const KEY_FIFTH_W = [1.0, 0.55, 0.3, 0.16, 0.09, 0.05, 0.04];

function keyFifthDistance(a, b) {
  const d = (((b - a) * 7) % 12 + 12) % 12;
  return Math.min(d, 12 - d);
}

// 同音阶的关系大小调互为搭档(C 大调 <-> A 小调),互相切换代价低
function relativePartner(state) {
  return state < 12 ? 12 + ((state + 9) % 12) : (state - 12 + 3) % 12;
}

function buildKeyTransitions() {
  const S = 24;
  const m = new Float64Array(S * S);
  for (let a = 0; a < S; a++) {
    let rowSum = 0;
    for (let b = 0; b < S; b++) {
      let w;
      if (a === b) w = KEY_P_STAY;
      else {
        w = KEY_FIFTH_W[keyFifthDistance(a % 12, b % 12)];
        if (b === relativePartner(a)) w = Math.max(w, 0.8);
        else if ((a < 12) !== (b < 12)) w *= 0.3; // 非同音阶的大小调切换
        w *= 1 - KEY_P_STAY;
      }
      m[a * S + b] = w;
      rowSum += w;
    }
    for (let b = 0; b < S; b++) m[a * S + b] = Math.log(m[a * S + b] / rowSum);
  }
  return m;
}

// 窗口内的 chroma(按重叠时长 × 振幅加权)
function windowedChroma(notes, start, end) {
  const c = new Float64Array(12);
  for (const n of notes) {
    const s = n.startTimeSeconds;
    const e = s + (n.durationSeconds || 0.1);
    const ov = Math.min(e, end) - Math.max(s, start);
    if (ov <= 0) continue;
    c[n.pitchMidi % 12] += ov * (n.amplitude || 1);
  }
  return c;
}

// 返回 {keys: 每帧调性对象数组, hopSec, dominant: 持续帧数最多的调性};
// 歌曲太短(< 1.5 窗)时返回 null,调用方退回全局 detectKey。
export function detectKeyTrack(notes, duration) {
  if (!notes.length || duration < KEY_WIN * 1.5) return null;
  const frames = Math.ceil(duration / KEY_HOP);
  const emissions = [];
  for (let i = 0; i < frames; i++) {
    const s = i * KEY_HOP;
    const e = Math.min(duration, s + KEY_WIN);
    emissions.push(keyCorrelations(windowedChroma(notes, s, e), new Float64Array(24)));
  }
  const logT = buildKeyTransitions();
  // Viterbi(24 状态,与 chords.js 的和弦解码同构)
  const S = 24;
  const back = new Uint8Array(frames * S);
  let dp = new Float64Array(S);
  for (let s = 0; s < S; s++) dp[s] = KEY_EMIT_GAIN * emissions[0][s];
  for (let t = 1; t < frames; t++) {
    const ndp = new Float64Array(S);
    for (let b = 0; b < S; b++) {
      let best = -Infinity;
      let arg = 0;
      for (let a = 0; a < S; a++) {
        const v = dp[a] + logT[a * S + b];
        if (v > best) { best = v; arg = a; }
      }
      ndp[b] = best + KEY_EMIT_GAIN * emissions[t][b];
      back[t * S + b] = arg;
    }
    dp = ndp;
  }
  let arg = 0;
  let best = -Infinity;
  for (let s = 0; s < S; s++) if (dp[s] > best) { best = dp[s]; arg = s; }
  const path = new Array(frames);
  for (let t = frames - 1; t >= 0; t--) {
    path[t] = arg;
    arg = back[t * S + arg];
  }
  const keys = path.map((st, t) => makeKey(st % 12, st < 12 ? 'major' : 'minor', emissions[t][st]));
  // 主调:路径中持续帧数最多的调(对转调歌比全局 K-S 更有代表性)
  const count = new Map();
  for (const st of path) count.set(st, (count.get(st) || 0) + 1);
  let domState = path[0];
  let domCount = 0;
  for (const [st, n] of count) if (n > domCount) { domState = st; domCount = n; }
  let corrSum = 0;
  for (let t = 0; t < frames; t++) if (path[t] === domState) corrSum += emissions[t][domState];
  const dominant = makeKey(domState % 12, domState < 12 ? 'major' : 'minor', corrSum / domCount);
  return { keys, hopSec: KEY_HOP, dominant };
}

// 按调性把音级拼成音名(升/降)
export function spellRoot(pc, isFlat) {
  return (isFlat ? FLAT : SHARP)[((pc % 12) + 12) % 12];
}

// 估计节拍位置(不只是周期)。estimateTempo 给出拍长,这里在 [0,beat) 里用
// 梳状滤波搜相位,让节拍点尽量落在 onset 能量峰上,返回全曲节拍时刻数组。
// 用途:beat-synchronous 和弦解码——把 chroma 聚合到节拍/小节区间,让和弦边界
// 对齐真实节拍,消除固定 hop 网格的 ~0.25s 边界滞后(SOTA 和弦识别的标准做法)。
export function estimateBeats(notes, duration) {
  const tempo = estimateTempo(notes, duration);
  if (!notes.length || !tempo.beat || duration <= 0) return { beats: [], ...tempo };
  const beat = tempo.beat;
  const binSize = 0.02;
  const nBins = Math.ceil(duration / binSize) + 1;
  const env = new Float64Array(nBins);
  for (const n of notes) {
    const b = Math.floor(n.startTimeSeconds / binSize);
    if (b >= 0 && b < nBins) env[b] += (n.amplitude || 1);
  }
  // 相位搜索:节拍偏移 phi ∈ [0,beat),打分 = 各节拍点 ±1 bin 内 env 之和,取最大。
  const nPhi = 24;
  let bestPhi = 0;
  let bestScore = -1;
  for (let k = 0; k < nPhi; k++) {
    const phi = (k / nPhi) * beat;
    let score = 0;
    for (let t = phi; t < duration; t += beat) {
      const b = Math.round(t / binSize);
      for (let d = -1; d <= 1; d++) {
        const bb = b + d;
        if (bb >= 0 && bb < nBins) score += env[bb];
      }
    }
    if (score > bestScore) { bestScore = score; bestPhi = phi; }
  }
  const beats = [];
  for (let t = bestPhi; t < duration + 1e-9; t += beat) beats.push(+t.toFixed(3));
  return { beats, beat, bpm: tempo.bpm, confidence: tempo.confidence };
}

// 从音符起始估计速度(BPM)与节拍周期(秒)。
// 方法:构建 onset 强度包络 -> 自相关 -> 在 [0.3s,1.0s] 找主周期。
export function estimateTempo(notes, duration) {
  if (!notes.length || duration <= 0) return { bpm: null, beat: null, confidence: 0 };
  const binSize = 0.02; // 20ms
  const nBins = Math.ceil(duration / binSize) + 1;
  const env = new Float64Array(nBins);
  for (const n of notes) {
    const b = Math.floor(n.startTimeSeconds / binSize);
    if (b >= 0 && b < nBins) env[b] += (n.amplitude || 1);
  }
  // 自相关
  const minLag = Math.floor(0.3 / binSize); // 0.3s -> 200 BPM
  const maxLag = Math.floor(1.0 / binSize); // 1.0s -> 60 BPM
  const correlation = new Float64Array(maxLag + 1);
  let bestLag = -1, bestVal = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < nBins; i++) sum += env[i] * env[i + lag];
    correlation[lag] = sum;
    if (sum > bestVal) { bestVal = sum; bestLag = lag; }
  }
  if (bestLag < 0) return { bpm: null, beat: null, confidence: 0 };
  // 用峰值两侧做抛物线插值,避免 20ms 网格把 87 BPM 量化成 88 BPM。
  let refinedLag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const left = correlation[bestLag - 1];
    const center = correlation[bestLag];
    const right = correlation[bestLag + 1];
    const denominator = left - 2 * center + right;
    if (Math.abs(denominator) > 1e-9) {
      const offset = 0.5 * (left - right) / denominator;
      if (Math.abs(offset) <= 1) refinedLag += offset;
    }
  }
  let beat = refinedLag * binSize;
  // 归一化到常见节拍范围(避免锁到半拍/双拍)
  let bpm = 60 / beat;
  while (bpm < 70) { bpm *= 2; beat /= 2; }
  while (bpm > 160) { bpm /= 2; beat *= 2; }
  // 置信度:自相关峰值相对总能量
  let energy = 0;
  for (let i = 0; i < nBins; i++) energy += env[i] * env[i];
  const confidence = energy > 0 ? bestVal / energy : 0;
  return { bpm: Math.round(bpm), beat, confidence };
}
