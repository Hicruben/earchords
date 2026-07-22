// 合成整曲 fixtures 评估:对 validation/songs/*.wav 跑完整 JS 分析管线
// (Basic Pitch + detectChords),对照 songs_manifest.json 的逐小节标准答案,
// 输出时间重叠加权的精确/根音匹配率。改 src/chords.js 后用它确认 fixtures 不回归。
// 需要模型服务(EARCHORDS_MODEL_URL,默认 4173 端口的 vite preview)。
// 用法:EARCHORDS_MODEL_URL=http://localhost:4173/model/model.json node validation/eval_songs.mjs
import { readFileSync } from 'node:fs';
import { analyzeFile } from './lib_analyze.mjs';
import { chordByLabel } from '../src/chords.js';

const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const rootOf = (label) => {
  const m = /^([A-G][#b]?)/.exec(label || '');
  return m ? PC[m[1]] : null;
};

const manifest = JSON.parse(readFileSync(new URL('./songs_manifest.json', import.meta.url)));
const audioTruth = JSON.parse(readFileSync(new URL('./truth.json', import.meta.url)));

function score(segments, truth, duration) {
  let exact = 0, root = 0, total = 0;
  for (const rs of truth) {
    const end = rs.end ?? duration;
    const dur = end - rs.start;
    if (dur <= 0) continue;
    total += dur;
    for (const as of segments) {
      const ov = Math.min(end, as.end) - Math.max(rs.start, as.start);
      if (ov <= 0 || !as.label) continue;
      // MIREX 等价:共享 ≥3 音级算精确(谱面三和弦 vs 录音七和弦)
      const rc = chordByLabel(rs.label);
      const ac = chordByLabel(as.label);
      let isExact = as.label === rs.label;
      if (!isExact && rc && ac && rc.root === ac.root) {
        let shared = 0;
        for (const pc of rc.pcSet) if (ac.pcSet.has(pc)) shared++;
        isExact = shared >= 3;
      }
      if (isExact) exact += ov;
      if (rootOf(as.label) === rootOf(rs.label)) root += ov;
    }
  }
  return { exact, root, total };
}

let wExact = 0, wRoot = 0, wTotal = 0;
const report = (name, s) => {
  wExact += s.exact; wRoot += s.root; wTotal += s.total;
  console.log(`${name}: exact ${(100 * s.exact / s.total).toFixed(1)}% · root ${(100 * s.root / s.total).toFixed(1)}% (${s.total.toFixed(0)}s)`);
};

// 1) 短 fixtures(validation/audio + truth.json)
for (const [name, truth] of Object.entries(audioTruth)) {
  const wav = new URL(`./audio/${name}.wav`, import.meta.url).pathname;
  const { segments, duration } = await analyzeFile(wav);
  report(name, score(segments, truth, duration));
}

// 2) 整曲 fixtures(validation/songs + songs_manifest.json)
for (const [name, info] of Object.entries(manifest)) {
  const wav = new URL(`./songs/${name}.wav`, import.meta.url).pathname;
  const { segments, duration } = await analyzeFile(wav);
  const truth = info.truth.map((t, i) => ({
    start: t.start,
    end: i + 1 < info.truth.length ? info.truth[i + 1].start : duration,
    label: t.chord,
  }));
  report(name, score(segments, truth, duration));
}
console.log('—'.repeat(20));
console.log(`加权: exact ${(100 * wExact / wTotal).toFixed(1)}% · root ${(100 * wRoot / wTotal).toFixed(1)}% (${wTotal.toFixed(0)}s)`);
