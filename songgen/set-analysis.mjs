// 把一份 analyzeFile 产出的分析 JSON 精简后写入 songgen/analysis/<slug>.json。
// 只保留驱动互动页所需的字段(segments/key/tempo/duration),丢弃原始 notes 音符
// 转录(体积大、且是版权歌曲的逐音转录,不入库)。和弦标签+时间是事实性数据(和
// 弦谱),可安全保存。
// 用法: node songgen/set-analysis.mjs <slug> <analysis.json> <youtubeId> [title] [artist] [displayKey]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const [, , slug, analysisPath, youtubeId, title, artist, displayKey] = process.argv;
if (!slug || !analysisPath || !youtubeId) {
  console.error('Usage: node songgen/set-analysis.mjs <slug> <analysis.json> <youtubeId> [title] [artist] [displayKey]');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(analysisPath, 'utf8'));
const outPath = join(HERE, 'analysis', `${slug}.json`);

// 沿用已有 meta(如果存在),仅覆盖传入字段
let meta = { slug };
try { meta = { ...JSON.parse(readFileSync(outPath, 'utf8')).meta, slug }; } catch { /* new */ }
meta.youtubeId = youtubeId;
if (title) meta.title = title;
if (artist) meta.artist = artist;
if (displayKey) meta.key = displayKey;

const analysis = {
  source: raw.source || 'youtube-audio',
  duration: raw.duration,
  key: raw.key,
  tempo: raw.tempo,
  segments: (raw.segments || []).map((s) => ({ start: s.start, end: s.end, label: s.label })),
};

writeFileSync(outPath, JSON.stringify({ meta, analysis }, null, 2));
console.log(`✓ ${slug}: ${analysis.segments.length} segs · key ${analysis.key} · ${analysis.duration?.toFixed(1)}s · yt=${youtubeId}`);
