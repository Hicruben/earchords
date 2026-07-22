// 批量流水线:歌名 -> yt-dlp 抓音频 -> 我们的引擎分析 -> 生成静态和弦页。
// 纯构建期(离线在本机跑),不托管音频、无运行时后端。
// 用法:CHORDSNAP_MODEL_URL=http://localhost:<port>/model/model.json node songgen/pipeline.mjs [歌单json]
//   歌单 json:[{title, artist?, key?, capo?, youtubeId?, slug?}]  (默认 songgen/pipeline-songs.json)
// 需要:dev server 在跑(提供模型)、yt-dlp、ffmpeg。
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSongPage, slugify, cleanChart } from './render.mjs';
import { analyzeFile, getModel } from '../validation/lib_analyze.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const env = { ...process.env, no_proxy: '*', NO_PROXY: '*', http_proxy: '', HTTP_PROXY: '' };

function fetchAudio(query, outBase) {
  const info = spawnSync('yt-dlp', ['--no-playlist', '--skip-download', '--print', '%(id)s\t%(uploader)s', query], { encoding: 'utf8', env, timeout: 90000 });
  if (info.status !== 0) throw new Error('yt-dlp resolve: ' + (info.stderr || '').slice(-200));
  const [id, uploader] = info.stdout.trim().split('\n').pop().split('\t');
  const audio = `${outBase}.m4a`;
  const dl = spawnSync('yt-dlp', ['-f', 'bestaudio', '--no-playlist', '-o', audio, `https://youtu.be/${id}`], { encoding: 'utf8', env, timeout: 120000 });
  if (dl.status !== 0) throw new Error('yt-dlp download: ' + (dl.stderr || '').slice(-200));
  return { id, uploader, audio };
}

const listPath = process.argv[2] || join(HERE, 'pipeline-songs.json');
const songs = JSON.parse(readFileSync(listPath, 'utf8'));
const model = getModel();
let ok = 0, fail = 0;
for (const song of songs) {
  const slug = song.slug || slugify(`${song.title} chords`);
  try {
    const query = song.youtubeId ? `https://youtu.be/${song.youtubeId}` : `ytsearch1:${song.title} ${song.artist || ''} official audio`;
    process.stderr.write(`→ ${song.title}: fetching… `);
    const { id, uploader, audio } = fetchAudio(query, `/tmp/sg_${slug}`);
    process.stderr.write(`analyzing… `);
    const analysis = await analyzeFile(audio, { model });
    const meta = { ...song, slug, youtubeId: song.youtubeId || id, artist: song.artist || uploader };
    writeFileSync(join(HERE, 'out', `${slug}.html`), renderSongPage(meta, analysis));
    const { main } = cleanChart(analysis.segments, analysis.duration);
    console.log(`\n✓ ${slug}.html — key ${meta.key || analysis.key?.name}, chords: ${main.join(' ')}`);
    ok++;
  } catch (e) {
    console.log(`\n✗ ${slug}: ${e.message}`);
    fail++;
  }
}
console.log(`\n完成:${ok} 页生成,${fail} 失败 -> songgen/out/`);
