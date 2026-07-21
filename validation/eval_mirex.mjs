// 标准 MIREX 和弦识别评测:对公开数据集(GuitarSet .jams / Isophonics .lab)算
// WCSR(Weighted Chord Symbol Recall,时间重叠加权的正确率)——和弦识别领域的
// 通用对外指标。内部自建语料只能自证;要判定"最准"必须跑这个。
//
// 用法:
//   node validation/eval_mirex.mjs <analysisDir> <refDir>
//   refDir 里放 .jams(GuitarSet)或 .lab(Isophonics)标注,按 basename 与
//   analysisDir/<name>.json 配对(自动去掉 GuitarSet 的 _mic/_comp 等音轨后缀)。
// 输出:Root-WCSR 与 MajMin-WCSR(标准两档),逐曲 + 加权总。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const [analysisDir, refDir] = process.argv.slice(2);
if (!analysisDir || !refDir) {
  console.error('用法: node validation/eval_mirex.mjs <analysisDir> <refDir(.jams/.lab)>');
  process.exit(1);
}

const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, 'E#': 5, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11, 'B#': 0 };

// MIREX 标签 "root:quality"(或我方 "C"/"Am"/"G7")-> {root, third}
// third: 'maj' | 'min' | 'none'(sus/N/无三度)。用于 MajMin 归约。
const MIN_QUALS = new Set(['min', 'minor', 'm', 'min7', 'm7', 'min6', 'm6', 'dim', 'dim7', 'min9', 'minmaj7', 'hdim7', 'min11', 'min13']);
const MAJ_QUALS = new Set(['maj', 'major', '', 'maj7', '7', 'dom', 'maj6', '6', '9', 'add9', 'aug', 'maj9', '11', '13', 'maj13']);
const NONE_QUALS = new Set(['sus2', 'sus4', 'sus', '1', '5', 'N', 'X']);

function parseLabel(label) {
  if (!label || label === 'N' || label === 'X' || label === 'None') return { root: null, third: label === 'X' ? 'X' : 'N' };
  // 我方格式: C / Am / G7 / F#maj7 / Bbsus4 ...  MIREX: C:maj / A:min / E:7 / N
  let root, qual;
  if (label.includes(':')) {
    [root, qual] = label.split(':');
    qual = qual.replace(/\(.*\)/, '').replace(/\/.*/, ''); // 去掉扩展音列/转位
  } else {
    const m = /^([A-G][#b]?)(.*)$/.exec(label);
    if (!m) return { root: null, third: 'N' };
    root = m[1];
    qual = m[2];
  }
  const rpc = PC[root];
  if (rpc === undefined) return { root: null, third: 'N' };
  let third = 'none';
  if (MIN_QUALS.has(qual)) third = 'min';
  else if (MAJ_QUALS.has(qual)) third = 'maj';
  else if (NONE_QUALS.has(qual)) third = 'none';
  else third = 'maj'; // 未知性质默认按大三(保守)
  return { root: rpc, third };
}

// 解析 GuitarSet .jams:取 namespace 含 "chord" 的标注 -> [{start,end,label}]
function parseJams(text) {
  const j = JSON.parse(text);
  const ann = (j.annotations || []).find((a) => (a.namespace || '').includes('chord'));
  if (!ann) return null;
  return ann.data.map((d) => ({ start: d.time, end: d.time + d.duration, label: d.value }));
}

// 解析 Isophonics .lab:每行 "start end label"
function parseLab(text) {
  return text.trim().split('\n').map((line) => {
    const [s, e, ...rest] = line.trim().split(/\s+/);
    return { start: +s, end: +e, label: rest.join(' ') };
  }).filter((x) => Number.isFinite(x.start) && Number.isFinite(x.end));
}

// 我方分析 segments(升号拼写)转成参照打分用的时间轴
function ourSegments(analysis) {
  return (analysis.segments || []).map((s) => ({ start: s.start, end: s.end, label: s.label || 'N' }));
}

// 单曲 WCSR:遍历参考段,按时间重叠找我方标签,统计 root/majmin 命中时长。
// 参考为 N -> 我方也须为 N 才算命中;参考为 X(未知)-> 跳过不计分(MIREX 惯例)。
function scoreSong(ours, ref) {
  let total = 0, rootHit = 0, mmHit = 0;
  for (const rs of ref) {
    const rl = parseLabel(rs.label);
    if (rl.third === 'X') continue; // 不可判,跳过
    const dur = rs.end - rs.start;
    if (dur <= 0) continue;
    total += dur;
    for (const as of ours) {
      const ov = Math.min(rs.end, as.end) - Math.max(rs.start, as.start);
      if (ov <= 0) continue;
      const al = parseLabel(as.label);
      // Root
      if (rl.root === null) { if (al.root === null) rootHit += ov; }
      else if (al.root === rl.root) rootHit += ov;
      // MajMin
      if (rl.root === null) { if (al.root === null) mmHit += ov; }
      else if (al.root === rl.root && al.third !== 'none' && al.third === rl.third) mmHit += ov;
      else if (rl.third === 'none' && al.root === rl.root) mmHit += ov; // 参考无三度(sus)按 root 命中即可
    }
  }
  return { total, root: total ? rootHit / total : 0, majmin: total ? mmHit / total : 0 };
}

const refFiles = readdirSync(refDir).filter((f) => f.endsWith('.jams') || f.endsWith('.lab')).sort();
if (!refFiles.length) { console.error(`${refDir} 无 .jams/.lab 标注`); process.exit(1); }

let wRoot = 0, wMM = 0, wTot = 0, matched = 0;
const rows = [];
for (const rf of refFiles) {
  const stem = basename(rf).replace(/\.(jams|lab)$/, '');
  // 去掉常见音轨后缀,匹配分析文件名
  const cand = [stem, stem.replace(/_(mic|comp|solo|mix|pickup)$/i, ''), stem.replace(/_[a-z]+$/i, '')];
  let analysisPath = null;
  for (const c of cand) { const p = join(analysisDir, c + '.json'); if (existsSync(p)) { analysisPath = p; break; } }
  if (!analysisPath) continue;
  const ref = rf.endsWith('.jams') ? parseJams(readFileSync(join(refDir, rf), 'utf8')) : parseLab(readFileSync(join(refDir, rf), 'utf8'));
  if (!ref || !ref.length) continue;
  const analysis = JSON.parse(readFileSync(analysisPath));
  const s = scoreSong(ourSegments(analysis), ref);
  if (!s.total) continue;
  matched++;
  wRoot += s.root * s.total; wMM += s.majmin * s.total; wTot += s.total;
  rows.push({ stem, ...s });
}

rows.sort((a, b) => a.majmin - b.majmin);
console.log(`MIREX WCSR — ${matched} 曲配对(${analysisDir} vs ${refDir}):`);
for (const r of rows.slice(0, 40)) {
  console.log(`  ${r.stem}: Root ${(r.root * 100).toFixed(1)}%  MajMin ${(r.majmin * 100).toFixed(1)}%  (${r.total.toFixed(0)}s)`);
}
console.log('—'.repeat(24));
console.log(`加权总(${wTot.toFixed(0)}s): Root-WCSR ${(100 * wRoot / wTot).toFixed(1)}%  ·  MajMin-WCSR ${(100 * wMM / wTot).toFixed(1)}%`);
