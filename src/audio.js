// 音频管线:解码上传文件 -> 22050Hz 单声道 -> Basic Pitch 推理出音符事件。
// 全部在浏览器内完成,音频不离开用户设备(隐私卖点 + 零服务器成本)。

import {
  BasicPitch,
  noteFramesToTime,
  outputToNotesPoly,
  addPitchBendsToNoteEvents,
} from '@spotify/basic-pitch';

const TARGET_RATE = 22050; // Basic Pitch 模型训练采样率

let _basicPitch = null;
function getModel() {
  if (!_basicPitch) {
    // 模型静态资源在 /model/model.json(见 public/model)
    _basicPitch = new BasicPitch(import.meta.env.BASE_URL + 'model/model.json');
  }
  return _basicPitch;
}

// 解码任意音频文件 -> 22050Hz 单声道 Float32Array
export async function decodeToMono22050(arrayBuffer) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const tmp = new AC();
  let decoded;
  try {
    decoded = await tmp.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    tmp.close();
  }
  const frames = Math.ceil(decoded.duration * TARGET_RATE);
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const offline = new OAC(1, frames, TARGET_RATE); // 1 声道 -> 自动下混为单声道
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return { data: rendered.getChannelData(0), duration: decoded.duration };
}

// 跑 Basic Pitch 推理,onProgress(0..1)
export async function runBasicPitch(mono22050, onProgress) {
  const model = getModel();
  const frames = [];
  const onsets = [];
  const contours = [];
  await model.evaluateModel(
    mono22050,
    (f, o, c) => {
      for (const row of f) frames.push(row);
      for (const row of o) onsets.push(row);
      for (const row of c) contours.push(row);
    },
    (p) => onProgress && onProgress(p),
  );
  // 阈值:onsetThresh=0.5, frameThresh=0.3, minNoteLen≈11 帧(~127ms)
  const rawNotes = outputToNotesPoly(frames, onsets, 0.5, 0.3, 11, true);
  const withBends = addPitchBendsToNoteEvents(contours, rawNotes);
  return noteFramesToTime(withBends); // [{startTimeSeconds,durationSeconds,pitchMidi,amplitude}]
}

// 从单声道样本算出 N 段峰值包络(用于波形图)
export function computePeaks(data, N = 900) {
  const peaks = new Float32Array(N);
  const step = Math.max(1, Math.floor(data.length / N));
  for (let i = 0; i < N; i++) {
    let mx = 0;
    const s = i * step;
    const e = Math.min(data.length, s + step);
    for (let j = s; j < e; j++) {
      const v = Math.abs(data[j]);
      if (v > mx) mx = v;
    }
    peaks[i] = mx;
  }
  // 归一化到 0..1
  let max = 0;
  for (const p of peaks) if (p > max) max = p;
  if (max > 0) for (let i = 0; i < N; i++) peaks[i] /= max;
  return peaks;
}

// 完整流程:file -> {notes, duration, peaks}
export async function analyzeFile(file, onStage) {
  onStage && onStage('decode', 0);
  const buf = await file.arrayBuffer();
  const { data, duration } = await decodeToMono22050(buf);
  const peaks = computePeaks(data);
  onStage && onStage('infer', 0);
  const notes = await runBasicPitch(data, (p) => onStage && onStage('infer', p));
  return { notes, duration, peaks: Array.from(peaks) };
}
