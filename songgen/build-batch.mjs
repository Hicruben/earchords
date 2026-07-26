// 批量为 pipeline-songs.json 的每首歌构建"同源原声"互动页数据:
//   搜 YouTube → 选一条(优先 "Artist - Topic" 音轨版:官方/非 DRM/几乎必可嵌/纯音频 t=0)
//   → 下载音频(临时,不入库)→ 扒和弦(同源)→ 写 songgen/analysis/<slug>.json。
// 可续跑:已存在 analysis/<slug>.json 的跳过。
// 用法:
//   node songgen/build-batch.mjs --resolve-only   # 只打印每首选中的视频(便宜、先审)
//   node songgen/build-batch.mjs [N]              # 实跑:下载+分析,最多处理 N 首(默认全部)
// 需要:本地模型服务(EARCHORDS_MODEL_URL,默认指向 http://127.0.0.1:8780/model/model.json)
//       + yt-dlp(带 deno 的 --remote-components ejs:github)+ ffmpeg。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SONGS = JSON.parse(readFileSync(join(HERE, 'pipeline-songs.json'), 'utf8'));
const ANALYSIS_DIR = join(HERE, 'analysis');
mkdirSync(ANALYSIS_DIR, { recursive: true });
const SCRATCH = process.env.EC_SCRATCH ||
  '/private/tmp/claude-501/-Users-jerry-Documents-anychord/d693c8ac-d11a-4028-80ee-e82e91794a2b/scratchpad/batch-audio';
mkdirSync(SCRATCH, { recursive: true });

const RESOLVE_ONLY = process.argv.includes('--resolve-only');
const LIMIT = (() => { const n = process.argv.find((a) => /^\d+$/.test(a)); return n ? +n : Infinity; })();

const BAD = /\b(live|cover|remix|reaction|karaoke|instrumental|8d|sped ?up|slowed|nightcore|tutorial|lesson|backing track|piano version|acoustic version|mashup|loop|1 hour|extended)\b/i;
// 翻唱/致敬/伴唱冒充原唱:标题或频道命中就重罚(编曲不同,不能当原声)
const IMPERSONATOR = /\b(tribute|karaoke|made famous|as made famous|originally performed|in the style of|cover version|re-?recorded|re-?record)\b/i;

// 用 yt-dlp 扁平搜索候选(不逐个深挖,快)
function search(query, n = 12) {
  const r = spawnSync('yt-dlp', [
    '--flat-playlist', '--no-warnings',
    '--print', '%(id)s\t%(channel)s\t%(duration)s\t%(title)s',
    `ytsearch${n}:${query}`,
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 60000 });
  if (r.status !== 0) return [];
  return (r.stdout || '').trim().split('\n').filter(Boolean).map((line) => {
    const [id, channel, dur, ...t] = line.split('\t');
    return { id, channel: channel || '', duration: +dur || 0, title: (t.join('\t') || '') };
  });
}

function score(cand, artist, title) {
  const ch = cand.channel.toLowerCase();
  const ti = cand.title.toLowerCase();
  const a = artist.toLowerCase();
  let s = 0;
  // 非 DRM + 几乎必可嵌的来源优先(Topic 音轨版 / 歌词版 / 官方音频)
  if (ch.endsWith(' - topic')) s += 140;               // 自动音轨版 = 最佳(纯音频 t=0)
  if (ti.includes('lyric')) s += 45;                   // 歌词版非 DRM,实测可嵌
  if (ti.includes('audio')) s += 40;                   // 官方音频版
  // 官方 MV 恰恰是 DRM(下不了),压低,别当首选
  if (/\b(official )?(music )?video\b/.test(ti)) s -= 55;
  if (/vevo/i.test(cand.channel)) s += 15;
  if (ch.includes(a)) s += 25;                          // 官方艺人频道
  if (ti.includes('official')) s += 12;
  if (ti.includes(title.toLowerCase())) s += 10;
  if (cand.duration >= 60 && cand.duration <= 480) s += 10; else s -= 60;
  if (BAD.test(cand.title)) s -= 300;
  if (IMPERSONATOR.test(cand.title) || IMPERSONATOR.test(cand.channel)) s -= 400;
  return s;
}

function resolve(song) {
  const q = `${song.artist} ${song.title}`;
  // 三路搜索:纯名(捞 Topic 音轨版)+ 官方音频 + 歌词版
  const cands = [...search(q, 8), ...search(`${q} official audio`), ...search(`${q} lyrics`)];
  // 去重(按 id),打分排序
  const seen = new Set();
  const ranked = cands.filter((c) => c.id && !seen.has(c.id) && seen.add(c.id))
    .map((c) => ({ ...c, s: score(c, song.artist, song.title) }))
    .sort((x, y) => y.s - x.s);
  return ranked.slice(0, 5); // 前 5 作为下载尝试队列(DRM/失败则顺延)
}

function download(id) {
  const out = join(SCRATCH, `${id}.wav`);
  if (existsSync(out)) return out;
  const r = spawnSync('yt-dlp', [
    '-x', '--audio-format', 'wav', '-f', 'bestaudio',
    '--remote-components', 'ejs:github', '--no-warnings',
    '-o', join(SCRATCH, `${id}.%(ext)s`),
    `https://www.youtube.com/watch?v=${id}`,
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120000 });
  return existsSync(out) ? out : null;
}

async function main() {
  let analyzeFile, getModel;
  if (!RESOLVE_ONLY) {
    ({ analyzeFile, getModel } = await import(join(HERE, '..', 'validation', 'lib_analyze.mjs')));
    getModel(); // 预热(加载一次,循环复用)
  }
  let done = 0, made = 0, failed = [];
  for (const song of SONGS) {
    if (made >= LIMIT) break;
    const outPath = join(ANALYSIS_DIR, `${song.slug}.json`);
    if (existsSync(outPath)) { console.log(`· skip (done): ${song.slug}`); continue; }

    const ranked = resolve(song);
    if (!ranked.length) { console.log(`✗ no candidates: ${song.slug}`); failed.push(song.slug); continue; }

    if (RESOLVE_ONLY) {
      console.log(`◆ ${song.slug}`);
      for (const c of ranked.slice(0, 3)) {
        console.log(`    [${String(c.s).padStart(4)}] ${c.id}  ${c.channel} · ${c.duration}s · ${c.title.slice(0, 52)}`);
      }
      done++;
      continue;
    }

    // 依次尝试候选下载(跳过 DRM/失败),第一条能下的就用
    let wav = null, used = null;
    for (const c of ranked) {
      process.stdout.write(`  try ${c.id} (${c.channel})… `);
      wav = download(c.id);
      if (wav) { used = c; console.log('ok'); break; }
      console.log('fail(DRM?)');
    }
    if (!wav) { console.log(`✗ all candidates failed: ${song.slug}`); failed.push(song.slug); continue; }

    try {
      const raw = await analyzeFile(wav, { model: getModel() });
      const analysis = {
        source: `youtube:${used.id}`,
        duration: raw.duration,
        key: raw.key,
        tempo: raw.tempo,
        segments: (raw.segments || []).map((s) => ({ start: s.start, end: s.end, label: s.label })),
      };
      const meta = {
        title: song.title, artist: song.artist, slug: song.slug,
        youtubeId: used.id, key: raw.key?.name || '',
      };
      writeFileSync(outPath, JSON.stringify({ meta, analysis }, null, 2));
      made++;
      console.log(`✓ ${song.slug}: ${analysis.segments.length} segs · key ${meta.key} · ${raw.duration?.toFixed(0)}s · yt=${used.id}`);
    } catch (e) {
      console.log(`✗ analyze failed ${song.slug}: ${e.message}`);
      failed.push(song.slug);
    }
  }
  console.log(`\n—— ${RESOLVE_ONLY ? `解析 ${done} 首` : `新建 ${made} 首`};失败 ${failed.length}${failed.length ? ': ' + failed.join(', ') : ''}`);
}

main();
