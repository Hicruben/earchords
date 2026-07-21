// 快速重解码:对已保存 notes 的分析 JSON 重跑 detectChords(不重新跑 Basic Pitch)。
// 改识别/解码逻辑后用它秒级迭代:npm run redecode -- [目录]
// 用法:npm run redecode -- validation/real_analysis
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectChords } from '../src/chords.js';

const [dir = 'validation/real_analysis'] = process.argv.slice(2);

let done = 0;
let skipped = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const path = join(dir, f);
  const data = JSON.parse(readFileSync(path));
  if (!Array.isArray(data.notes)) { skipped++; continue; }
  const analysis = detectChords(data.notes, data.duration);
  data.key = analysis.key ? {
    name: analysis.key.name,
    tonic: analysis.key.tonic,
    mode: analysis.key.mode,
    confidence: analysis.key.confidence,
  } : null;
  data.tempo = analysis.tempo;
  data.segments = analysis.segments;
  writeFileSync(path, JSON.stringify(data, null, 2));
  done++;
}
console.log(`redecoded ${done} file(s) in ${dir}${skipped ? ` (${skipped} without notes, skipped)` : ''}.`);
