// 细粒度 segments 标注脚手架:把"从零标注"变成"改一份草稿"。
//
// 为什么需要人工:真实歌曲的和弦真值只能靠耳朵定,脚本无法凭空生成(用模型
// 自己的输出当真值是自证,会污染验证)。但从零逐秒标注太慢。此脚本用已入库的
// notes 重算每段的候选和弦与"置信裕度"(top1 与 top2 得分差),把模型自己都
// 拿不准的段落标 "review": true —— 你只需重点听这些段,改对标签即可。
//
// 用法:
//   npm run seed:reference -- <歌名>            # 歌名 = real_analysis/<歌名>.json 去扩展名
//   npm run seed:reference -- <歌名> [输出目录]
// 产出:validation/reference_drafts/<歌名>.json(草稿,不参与评分)。
// 校对完成后:把 segments 数组连同 title/key 合并进 validation/references/<歌名>.json,
// 删掉 _* 辅助字段,score:batch 会自动按时间重叠加权算 exact/root 匹配率。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { debugWindow } from '../src/chords.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const [name, outDir = join(HERE, 'reference_drafts')] = process.argv.slice(2);

if (!name) {
  console.error('用法: npm run seed:reference -- <歌名> [输出目录]');
  console.error('  <歌名> = validation/real_analysis/<歌名>.json 去掉 .json');
  process.exit(1);
}

const analysisPath = join(HERE, 'real_analysis', name + '.json');
if (!existsSync(analysisPath)) {
  console.error(`找不到分析结果 ${analysisPath} —— 先跑 npm run analyze:batch。`);
  process.exit(1);
}
const analysis = JSON.parse(readFileSync(analysisPath));
if (!Array.isArray(analysis.notes) || !analysis.notes.length) {
  console.error(`${analysisPath} 不含 notes,无法重算候选(用较新的 analyze 结果)。`);
  process.exit(1);
}

// 由分析出的调性构建调内音级集合(scoreAllChords 期望 keyCtx={scale:Set})
const MAJ = [0, 2, 4, 5, 7, 9, 11];
const MIN = [0, 2, 3, 5, 7, 8, 10];
let keyCtx = null;
if (analysis.key && typeof analysis.key.tonic === 'number') {
  const steps = analysis.key.mode === 'minor' ? MIN : MAJ;
  keyCtx = { scale: new Set(steps.map((s) => (analysis.key.tonic + s) % 12)) };
}

// 裕度低于此值 → 标记 review(经验值:低裕度段多为过渡/经过音/复杂混音)
const MARGIN_REVIEW = 0.04;

let flagged = 0;
const segments = analysis.segments.map((seg) => {
  const out = { start: seg.start, end: seg.end, label: seg.label };
  if (!seg.label) { out.label = 'N.C.'; return out; }
  const dbg = debugWindow(analysis.notes, seg.start, seg.end, keyCtx, 4);
  const [t0, t1] = dbg.top;
  const margin = t1 ? +(t0.score - t1.score).toFixed(4) : 1;
  const needsReview = margin < MARGIN_REVIEW || (seg.end - seg.start) < 0.9;
  if (needsReview) {
    flagged++;
    out._review = true;
    out._margin = margin;
    out._alt = dbg.top.slice(0, 4).map((c) => `${c.label}(${c.score.toFixed(3)})`);
  }
  return out;
});

const draft = {
  title: name,
  verified: false,
  _instructions:
    '这是从模型输出生成的草稿,不是真值。请逐段核对(重点听 "_review": true 的段,' +
    '它们模型自己拿不准),改对 label,删掉全部 _ 开头字段,把 verified 改为 true,' +
    '再把本文件(含 title/key/segments)合并进 references/ 同名文件。',
  key: analysis.key ? { tonic: analysis.key.tonic, mode: analysis.key.mode, name: analysis.key.name } : null,
  segments,
};

mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, name + '.json');
writeFileSync(outPath, JSON.stringify(draft, null, 2) + '\n');

console.log(`草稿已写入 ${outPath}`);
console.log(`  共 ${segments.length} 段,其中 ${flagged} 段需重点核对(_review: true)。`);
console.log('  下一步:听音频逐段校对 → 删 _ 字段 → verified:true → 合并进 references/。');
