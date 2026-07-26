// 调性检测验证集:对已知正确答案的真实歌曲跑 detectKey,报告准确率。
// 用途:改 music.js 的调性判定后,验证是否修好了关系大小调混淆且没有倒退。
// 用法:
//   node validation/keytest.mjs --prepare   # 从已下载音频抽 notes(慢,只需跑一次)
//   node validation/keytest.mjs             # 用缓存的 notes 跑 detectKey 并评分(秒级)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectKey, detectKeyTrack } from '../src/music.js';

// 与 chords.js:248 的生产路径一致:优先分段跟踪的主调,短曲回退全局 K-S
function productionKey(notes) {
  let dur = 0;
  for (const n of notes) {
    const t = (n.startTimeSeconds || 0) + (n.durationSeconds || 0);
    if (t > dur) dur = t;
  }
  const track = detectKeyTrack(notes, dur);
  return track ? track.dominant : detectKey(notes);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'keytest_notes');
const SET = JSON.parse(readFileSync(
  process.env.EC_KEYTEST || '/private/tmp/claude-501/-Users-jerry-Documents-anychord/d693c8ac-d11a-4028-80ee-e82e91794a2b/scratchpad/keytest.json',
  'utf8',
));
const AUDIO_DIR = process.env.EC_AUDIO ||
  '/private/tmp/claude-501/-Users-jerry-Documents-anychord/d693c8ac-d11a-4028-80ee-e82e91794a2b/scratchpad/batch-audio';

if (process.argv.includes('--prepare')) {
  mkdirSync(CACHE, { recursive: true });
  const { analyzeFile, getModel } = await import('./lib_analyze.mjs');
  getModel();
  for (const s of SET) {
    const out = join(CACHE, `${s.vid}.json`);
    if (existsSync(out)) { console.log('· skip', s.title); continue; }
    const wav = join(AUDIO_DIR, `${s.vid}.wav`);
    if (!existsSync(wav)) { console.log('✗ 缺音频', s.title, s.vid); continue; }
    const r = await analyzeFile(wav, { model: getModel(), keepNotes: true });
    writeFileSync(out, JSON.stringify({ title: s.title, expect: s.expect, notes: r.notes }));
    console.log('✓', s.title, r.notes.length, 'notes');
  }
  console.log('\nnotes 已缓存 -> validation/keytest_notes/');
  process.exit(0);
}

// 评分:比较 detectKey 与已核对答案
let ok = 0, bad = [];
for (const s of SET) {
  const p = join(CACHE, `${s.vid}.json`);
  if (!existsSync(p)) { console.log('· 无缓存(先跑 --prepare):', s.title); continue; }
  const { notes, expect } = JSON.parse(readFileSync(p, 'utf8'));
  const got = productionKey(notes).name;
  const same = norm(got) === norm(expect);
  if (same) ok++; else bad.push(`${s.title}: got ${got}, expect ${expect}`);
  console.log(`${same ? '✓' : '✗'} ${s.title.padEnd(26)} got ${String(got).padEnd(5)} expect ${expect}`);
}
const total = ok + bad.length;
console.log(`\n调性准确率: ${ok}/${total} = ${total ? Math.round(ok / total * 100) : 0}%`);
if (bad.length) console.log(bad.map((b) => '  ' + b).join('\n'));

// Ab==G#, Db==C#, Bb==A#, Eb==D# 视为相同
function norm(n) {
  const EQ = { Ab: 'G#', Db: 'C#', Bb: 'A#', Eb: 'D#', Gb: 'F#', Cb: 'B' };
  const m = String(n).match(/^([A-G][#b]?)(m?)$/);
  if (!m) return String(n);
  return (EQ[m[1]] || m[1]) + m[2];
}
