// 和弦识别:音符事件 -> 时间轴上的和弦序列。
// 模板匹配逻辑移植自已验证的 Python 版(合成音频 20/20 精确匹配)。

import { detectKey, detectKeyTrack, estimateTempo, makeKey } from './music.js';

export const PC_NAME = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// 和弦类型 -> 相对根音的音级(pitch classes),按"越常见排越前"排序,
// 匹配平手时优先常见和弦(避免把 C 误报成更冷门的同音集合和弦)。
// prior:对常见和弦的先验偏好(加性),抑制过渡处对 sus/dim/aug 等的误报。
const QUALITIES = [
  { suffix: '', pcs: [0, 4, 7], intervals: [0, 4, 7], prior: 0.06 },        // major
  { suffix: 'm', pcs: [0, 3, 7], intervals: [0, 3, 7], prior: 0.06 },       // minor
  { suffix: '7', pcs: [0, 4, 7, 10], intervals: [0, 4, 7, 10], prior: 0.03, ext: [10] },
  { suffix: 'maj7', pcs: [0, 4, 7, 11], intervals: [0, 4, 7, 11], prior: 0.025, ext: [11] },
  { suffix: 'm7', pcs: [0, 3, 7, 10], intervals: [0, 3, 7, 10], prior: 0.03, ext: [10] },
  { suffix: 'sus4', pcs: [0, 5, 7], intervals: [0, 5, 7], prior: -0.03 },
  { suffix: 'sus2', pcs: [0, 2, 7], intervals: [0, 2, 7], prior: -0.03 },
  { suffix: 'dim', pcs: [0, 3, 6], intervals: [0, 3, 6], prior: -0.04 },
  { suffix: 'aug', pcs: [0, 4, 8], intervals: [0, 4, 8], prior: -0.05 },
  { suffix: '6', pcs: [0, 4, 7, 9], intervals: [0, 4, 7, 9], prior: -0.03, ext: [9] },
  { suffix: 'm6', pcs: [0, 3, 7, 9], intervals: [0, 3, 7, 9], prior: -0.03, ext: [9] },
  { suffix: 'add9', pcs: [0, 2, 4, 7], intervals: [0, 2, 4, 7], prior: -0.03, ext: [2] },
];

// 预生成所有 12 根音 × 类型的模板
const CHORD_DB = [];
for (let root = 0; root < 12; root++) {
  for (const q of QUALITIES) {
    CHORD_DB.push({
      label: PC_NAME[root] + q.suffix,
      root,
      suffix: q.suffix,
      pcSet: new Set(q.pcs.map((iv) => (root + iv) % 12)),
      intervals: q.intervals,
      size: q.pcs.length,
      prior: q.prior,
      ext: (q.ext || []).map((iv) => (root + iv) % 12),
    });
  }
}

export function chordByLabel(label) {
  return CHORD_DB.find((c) => c.label === label) || null;
}

// 把音符事件在 [start,end) 窗口内聚合成 12 维 chroma 向量
// (按重叠时长 × 振幅加权,低音区加权,因为根音通常在低音)。
// 同时返回 bassPc:窗口内最低音的音级(用于区分同音集合和弦,如 Am7 vs C6)。
function windowChroma(notes, start, end) {
  const chroma = new Float64Array(12);
  let bassPc = null;
  let bassMidi = Infinity;
  let maxW = 0;
  const ws = [];
  for (const n of notes) {
    const s = n.startTimeSeconds;
    const e = s + n.durationSeconds;
    const ov = Math.min(e, end) - Math.max(s, start);
    if (ov <= 0.03) continue;
    const w = ov * (n.amplitude || 1);
    ws.push({ midi: n.pitchMidi, w });
    if (w > maxW) maxW = w;
    const pc = n.pitchMidi % 12;
    const bassBoost = n.pitchMidi < 52 ? 1.4 : 1.0;
    chroma[pc] += w * bassBoost;
  }
  // 最低音:权重不能太小(避免拾到一闪而过的装饰低音)
  for (const { midi, w } of ws) {
    if (w >= 0.3 * maxW && midi < bassMidi) {
      bassMidi = midi;
      bassPc = midi % 12;
    }
  }
  return { chroma, bassPc };
}

// chroma 向量 与 各和弦二值模板 的余弦相似度,取最高者。
// 这是和弦识别的标准做法,对分解和弦/噪音远比"阈值取集合"稳健。
// keyCtx(可选):{scale:Set(pc)} —— 调内和弦获得小幅先验加成,减少离调误报。

// 对全部 144 个和弦模板打分,写入 out(Float64Array,长度 = CHORD_DB.length)。
// 返回 chroma 的 L2 范数(用于静音/能量判断)。matchChroma 与 HMM 发射概率共用此函数。
// bassPc(可选):窗口最低音音级,命中根音的和弦额外加分(区分 Am7/C6 这类同音集合)。
function scoreAllChords(chroma, keyCtx, out, bassPc = null) {
  let norm = 0;
  for (let i = 0; i < 12; i++) norm += chroma[i] * chroma[i];
  norm = Math.sqrt(norm);
  for (let ci = 0; ci < CHORD_DB.length; ci++) {
    const c = CHORD_DB[ci];
    if (norm < 1e-6) { out[ci] = c.prior; continue; }
    let dot = 0;
    for (const pc of c.pcSet) dot += chroma[pc];
    const sim = dot / (norm * Math.sqrt(c.pcSet.size));
    // 轻微强调根音存在(区分同音集合的转位/近亲和弦)+ 常见和弦先验
    const rootEmphasis = (chroma[c.root] / norm) * 0.15;
    // 最低音 = 根音:低音声部是和弦根音最强的证据(结构化识别的核心思路)
    const bassEmphasis = bassPc !== null && bassPc === c.root ? 0.08 : 0;
    // 扩展音证据:七/六/加九等扩展和弦的额外音若有实际能量,给补偿分。
    // 二值模板的余弦对多一个音的扩展和弦有系统性劣势(音级被稀释),
    // 这里按扩展音的实际强度补回,避免把 A7 报成 A(长尾类别校准)。
    // 系数 0.24 用合成整曲精确真值校准(validation/synth_references):此值让
    // 12 小节布鲁斯(全属七)exact 25%→62%,而流行/卡农/doo-wop 三和弦零回归;
    // 因按扩展音实际能量加分(自门控),真三和弦无 b7 能量时不受影响。再高(0.30)
    // 会让异根四音和弦(如 C 段的 Am7,借 C 的五音当 b7)误胜,故封顶 0.24。
    let extBonus = 0;
    if (c.ext.length) {
      let s = 0;
      for (const pc of c.ext) s += chroma[pc];
      extBonus = 0.24 * (s / c.ext.length) / norm;
    }
    // 调内先验:根音在调内 +0.03,整个和弦都在调内再 +0.03
    let diatonic = 0;
    if (keyCtx) {
      if (keyCtx.scale.has(c.root)) diatonic += 0.03;
      let allIn = true;
      for (const pc of c.pcSet) if (!keyCtx.scale.has(pc)) { allIn = false; break; }
      if (allIn) diatonic += 0.03;
    }
    out[ci] = sim + rootEmphasis + bassEmphasis + extBonus + c.prior + diatonic;
  }
  return norm;
}

export function matchChroma(chroma, keyCtx) {
  const scores = new Float64Array(CHORD_DB.length);
  scoreAllChords(chroma, keyCtx, scores);
  let best = null;
  let bestScore = -1;
  for (let ci = 0; ci < CHORD_DB.length; ci++) {
    if (scores[ci] > bestScore) {
      bestScore = scores[ci];
      best = CHORD_DB[ci];
    }
  }
  // 相似度过低 -> 无明确和弦
  return bestScore < 0.52 ? null : best;
}

// 兼容旧接口:从加权 map 匹配(部分调用仍用)
export function matchChord(pcWeights) {
  const chroma = new Float64Array(12);
  for (const [pc, w] of pcWeights) chroma[pc] += w;
  return matchChroma(chroma);
}

// ---- HMM / Viterbi 序列解码 ----
// 业界主流做法(Chordino 一系至今在 MIREX 有竞争力):逐格发射概率 +
// 和弦转移先验(自环 + 五度圈近关系转移),用 Viterbi 求全局最优和弦路径。
// 相比贪心众数平滑,它利用整首歌的上下文,能消除孤立误报同时保留真实快换。
const NC_INDEX = CHORD_DB.length; // N.C.(无和弦)状态 = 第 145 个状态
const MATCH_FLOOR = 0.52;         // 与 matchChroma 的"无明确和弦"阈值一致
const EMIT_GAIN = 5;              // 发射分放大系数(log 域)
const P_STAY = 0.88;              // 自环概率:hop=0.25s 时和弦期望持续约 2s
// 五度圈距离 -> 转移权重(近关系和弦互转更常见)
const FIFTH_W = [1.0, 0.55, 0.3, 0.16, 0.09, 0.05, 0.04];

function fifthDistance(r1, r2) {
  const d = (((r2 - r1) * 7) % 12 + 12) % 12;
  return Math.min(d, 12 - d);
}

// 构建 145×145 的 log 转移矩阵(每行归一化为概率和 1)
function buildTransitions() {
  const S = NC_INDEX + 1;
  const m = new Float64Array(S * S);
  for (let a = 0; a < S; a++) {
    let rowSum = 0;
    for (let b = 0; b < S; b++) {
      let w;
      if (a === b) w = P_STAY;
      else if (a === NC_INDEX || b === NC_INDEX) w = (1 - P_STAY) * 0.25;
      else {
        const ca = CHORD_DB[a];
        const cb = CHORD_DB[b];
        w = FIFTH_W[fifthDistance(ca.root, cb.root)];
        if (ca.suffix === cb.suffix) w *= 1.5;
        w *= (1 - P_STAY) * 0.75;
      }
      m[a * S + b] = w;
      rowSum += w;
    }
    for (let b = 0; b < S; b++) m[a * S + b] = Math.log(m[a * S + b] / rowSum);
  }
  return m;
}

// 单帧发射 log 分:和弦 = EMIT_GAIN × (模板分 - 阈值),N.C. 恒为 0。
// 即:没有任何和弦模板超过阈值时 N.C. 自然胜出(与旧逐帧行为一致)。
function emissionLog(chroma, keyCtx, out, bassPc = null) {
  scoreAllChords(chroma, keyCtx, out, bassPc);
  for (let i = 0; i < NC_INDEX; i++) out[i] = EMIT_GAIN * (out[i] - MATCH_FLOOR);
  out[NC_INDEX] = 0;
  return out;
}

// 标准 Viterbi:emissions 为 T × (NC_INDEX+1) 的 log 发射分,返回最优状态路径
function viterbi(emissions, logT) {
  const T = emissions.length;
  const S = NC_INDEX + 1;
  const back = new Uint16Array(T * S);
  let dp = new Float64Array(emissions[0]);
  for (let t = 1; t < T; t++) {
    const e = emissions[t];
    const ndp = new Float64Array(S);
    for (let b = 0; b < S; b++) {
      let best = -Infinity;
      let arg = 0;
      for (let a = 0; a < S; a++) {
        const v = dp[a] + logT[a * S + b];
        if (v > best) { best = v; arg = a; }
      }
      ndp[b] = best + e[b];
      back[t * S + b] = arg;
    }
    dp = ndp;
  }
  let arg = 0;
  let best = -Infinity;
  for (let s = 0; s < S; s++) if (dp[s] > best) { best = dp[s]; arg = s; }
  const path = new Array(T);
  for (let t = T - 1; t >= 0; t--) {
    path[t] = arg;
    arg = back[t * S + arg];
  }
  return path;
}

/**
 * 主入口:notes(NoteEventTime[]) -> 和弦段 [{start,end,label,root,suffix,intervals}]
 * 策略:细粒度时间窗逐格打分 -> HMM/Viterbi 全局最优解码 -> 合并相邻同和弦
 * -> 吸收过短碎段。回避了对精确节拍检测的依赖,同时给出干净的和弦谱。
 */
export function detectChords(notes, duration, opts = {}) {
  const hop = opts.hop || 0.25;        // 分析步长
  const win = opts.win || 1.0;         // 分析窗宽(足够宽以覆盖分解和弦的三音)
  const minSeg = opts.minSeg || 0.7;   // 小于此长度的段会被并入邻段

  if (!notes.length || duration <= 0) return { segments: [], key: null, tempo: null };

  // 0) 调性 + 速度:长歌用分段调性跟踪(转调歌的全局单一调性会被折中成
  //    中间调,如 F→G 报成 F#);短歌退回全局 K-S。返回的主调取路径中持续
  //    最久的调。
  const keyTrack = detectKeyTrack(notes, duration);
  let key = keyTrack ? keyTrack.dominant : detectKey(notes);
  const tempo = estimateTempo(notes, duration);

  // 1) 逐格发射分(chroma + 模板匹配,带调内先验)
  //    窗口以 t 为中心(而非向前看),消除边界提前检测的偏差。
  const cells = [];
  for (let t = 0; t < duration; t += hop) {
    const s = Math.max(0, t - win / 2);
    const e = Math.min(duration, t + win / 2);
    const { chroma, bassPc } = windowChroma(notes, s, e);
    const keyCtx = keyTrack
      ? keyTrack.keys[Math.min(Math.floor(t / keyTrack.hopSec), keyTrack.keys.length - 1)]
      : key;
    cells.push({ t, emission: emissionLog(chroma, keyCtx, new Float64Array(NC_INDEX + 1), bassPc) });
  }

  // 1.5) Viterbi 全局最优解码(替代旧的时间维众数平滑)
  const logT = buildTransitions();
  const path = viterbi(cells.map((c) => c.emission), logT);
  const smoothed = cells.map((cell, i) => ({
    t: cell.t,
    label: path[i] === NC_INDEX ? null : CHORD_DB[path[i]].label,
  }));

  // 2) 合并相邻相同标签
  let segs = [];
  for (const cell of smoothed) {
    const last = segs[segs.length - 1];
    if (last && last.label === cell.label) {
      last.end = cell.t + hop;
    } else {
      segs.push({ start: cell.t, end: cell.t + hop, label: cell.label });
    }
  }

  // 3) 吸收过短碎段:并入较长的邻居(用其标签)
  const merged = [];
  for (const seg of segs) {
    const len = seg.end - seg.start;
    if (len < minSeg && merged.length) {
      // 并入前一段
      merged[merged.length - 1].end = seg.end;
    } else {
      merged.push({ ...seg });
    }
  }
  // 再合并一次相邻同标签(吸收后可能产生相邻相同)
  let final = [];
  for (const seg of merged) {
    const last = final[final.length - 1];
    if (last && last.label === seg.label) last.end = seg.end;
    else final.push({ ...seg });
  }

  // 复杂混音里旋律经过音会让同一根音短暂跳成 7/sus/add9。
  // 若短扩展段夹在两个完全相同的同根和弦之间,视为装饰音并吸收,
  // 保留真正持续的挂留/七和弦,同时让弹唱谱更稳定。
  const variantThreshold = Math.max(minSeg, Math.min(1.2, (tempo?.beat || 0.65) * 1.35));
  for (let i = 1; i < final.length - 1; i++) {
    const prev = final[i - 1];
    const cur = final[i];
    const next = final[i + 1];
    if (!prev.label || prev.label !== next.label || cur.end - cur.start >= variantThreshold) continue;
    const prevChord = chordByLabel(prev.label);
    const curChord = chordByLabel(cur.label);
    if (prevChord && curChord && prevChord.root === curChord.root) cur.label = prev.label;
  }
  const stabilized = [];
  for (const seg of final) {
    const last = stabilized[stabilized.length - 1];
    if (last && last.label === seg.label) last.end = seg.end;
    else stabilized.push({ ...seg });
  }
  final = stabilized;

  // 4) 丢弃开头/结尾的 N.C.(null)静音段但保留中间的
  const segments = final
    .map((s) => ({
      start: +s.start.toFixed(3),
      end: +s.end.toFixed(3),
      label: s.label, // 规范拼写(升号),供 diagrams/transpose 使用
    }))
    .filter((s) => s.end - s.start >= 0.15);

  // 5) 主调再判定:chroma 直方图容易把属调(G)误判为主调(C),
  //    用解码出的和弦序列做调级适配更准 —— F 大三和弦在 C 调内却不在 G 调内,
  //    这类"离调和弦"能一票否决错误的调候选。仅在有调性跟踪的长歌上重判,
  //    短歌维持全局 K-S 结果。
  if (keyTrack && segments.length) {
    key = dominantKeyFromChords(segments, key);
  }

  return { segments, key, tempo };
}

// 用解码后的和弦段给 24 个调候选打分:和弦音全在调内得满分、仅根音在调内
// 得部分分;主和弦(根音=主音且大小性质匹配)额外加权。返回得分最高的调。
function dominantKeyFromChords(segments, fallback) {
  const MAJ_STEPS = [0, 2, 4, 5, 7, 9, 11];
  const MIN_STEPS = [0, 2, 3, 5, 7, 8, 10];
  let total = 0;
  for (const seg of segments) if (seg.label) total += seg.end - seg.start;
  if (!total) return fallback;
  let best = null;
  let bestScore = -Infinity;
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const [mode, steps] of [['major', MAJ_STEPS], ['minor', MIN_STEPS]]) {
      const scale = new Set(steps.map((s) => (tonic + s) % 12));
      let score = 0;
      for (const seg of segments) {
        if (!seg.label) continue;
        const c = chordByLabel(seg.label);
        if (!c) continue;
        const dur = seg.end - seg.start;
        let allIn = true;
        for (const pc of c.pcSet) if (!scale.has(pc)) { allIn = false; break; }
        let w = allIn ? 1 : scale.has(c.root) ? 0.4 : 0;
        // 主和弦证据:性质匹配的主三和弦额外 +0.5
        if (c.root === tonic && ((mode === 'major' && c.suffix === '') || (mode === 'minor' && c.suffix === 'm'))) w += 0.5;
        score += dur * w;
      }
      if (score > bestScore) { bestScore = score; best = { tonic, mode }; }
    }
  }
  const key = makeKey(best.tonic, best.mode, Math.min(0.99, bestScore / total));
  return key;
}

// 调试用:返回某时间窗内得分最高的前 n 个候选和弦 [{label,score}]
export function debugWindow(notes, start, end, keyCtx = null, top = 5) {
  const { chroma, bassPc } = windowChroma(notes, start, end);
  const scores = new Float64Array(CHORD_DB.length);
  const norm = scoreAllChords(chroma, keyCtx, scores, bassPc);
  return {
    norm,
    bassPc,
    top: CHORD_DB.map((c, i) => ({ label: c.label, score: +scores[i].toFixed(4) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, top),
  };
}

// 转调:把和弦段的标签整体平移 n 个半音(用于 transpose / capo 显示)
export function transposeLabel(label, n) {
  const c = chordByLabel(label);
  if (!c) return label;
  const newRoot = ((c.root + n) % 12 + 12) % 12;
  return PC_NAME[newRoot] + c.suffix;
}
