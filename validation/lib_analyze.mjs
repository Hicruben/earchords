// 共享音频分析管线:ffmpeg 解码 -> Basic Pitch 推理 -> 和弦识别。
// analyze_song.mjs(单曲 CLI)与 batch_analyze.mjs(批量)共用,保证参数不发散。
import { spawnSync } from 'node:child_process';
import {
  BasicPitch,
  addPitchBendsToNoteEvents,
  noteFramesToTime,
  outputToNotesPoly,
} from '@spotify/basic-pitch';
import { detectChords } from '../src/chords.js';

export const SAMPLE_RATE = 22050;
const MODEL_URL = process.env.CHORDSNAP_MODEL_URL || 'http://127.0.0.1:5173/model/model.json';

let sharedModel = null;
export function getModel() {
  if (!sharedModel) sharedModel = new BasicPitch(MODEL_URL);
  return sharedModel;
}

export function decodeToPcm(inputPath) {
  const decoded = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-i', inputPath, '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', 'pipe:1'],
    { encoding: null, maxBuffer: 256 * 1024 * 1024 },
  );
  if (decoded.status !== 0) {
    throw new Error(decoded.stderr?.toString() || 'ffmpeg could not decode the file');
  }
  const pcm = decoded.stdout;
  const audio = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4);
  return { audio, duration: audio.length / SAMPLE_RATE };
}

// model 可传入复用(批量时只加载一次);onProgress(0..1) 可选;
// keepNotes=true 时返回原始音符事件(调试用)
export async function analyzeFile(inputPath, { model = getModel(), onProgress = () => {}, keepNotes = false } = {}) {
  const { audio, duration } = decodeToPcm(inputPath);
  const frames = [];
  const onsets = [];
  const contours = [];
  await model.evaluateModel(
    audio,
    (frameBatch, onsetBatch, contourBatch) => {
      for (const row of frameBatch) frames.push(row);
      for (const row of onsetBatch) onsets.push(row);
      for (const row of contourBatch) contours.push(row);
    },
    onProgress,
  );
  const rawNotes = outputToNotesPoly(frames, onsets, 0.5, 0.3, 11, true);
  const notes = noteFramesToTime(addPitchBendsToNoteEvents(contours, rawNotes));
  const analysis = detectChords(notes, duration);
  const result = {
    source: inputPath,
    duration,
    noteCount: notes.length,
    key: analysis.key ? {
      name: analysis.key.name,
      tonic: analysis.key.tonic,
      mode: analysis.key.mode,
      confidence: analysis.key.confidence,
    } : null,
    tempo: analysis.tempo,
    segments: analysis.segments,
  };
  if (keepNotes) result.notes = notes;
  return result;
}
