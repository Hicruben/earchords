// 歌曲页渲染(可复用):分析结果 + 歌曲元数据 -> SEO 优化的静态和弦页 HTML。
// 被 generate.mjs(手工列表)与 pipeline.mjs(yt-dlp 批量)共用。
export const SITE = 'https://earchords.com'; // 部署域名占位,替换成真实域名
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const slugify = (s) => s.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// 从分析段落提炼干净的谱:按时长聚合过滤噪声,得到主和弦 + 可读进行
export function cleanChart(segments, duration) {
  const dur = new Map();
  for (const s of segments) {
    if (!s.label) continue;
    dur.set(s.label, (dur.get(s.label) || 0) + (s.end - s.start));
  }
  const main = [...dur.entries()].filter(([, d]) => d >= duration * 0.04).sort((a, b) => b[1] - a[1]).map(([l]) => l);
  const mainSet = new Set(main);
  const seq = [];
  for (const s of segments) {
    if (!s.label || !mainSet.has(s.label)) continue;
    if (seq[seq.length - 1] !== s.label) seq.push(s.label);
  }
  return { main, sequence: seq };
}

export function renderSongPage(meta, analysis) {
  const key = meta.key || (analysis.key ? analysis.key.name : '—');
  const bpm = analysis.tempo?.bpm || null;
  const { main, sequence } = cleanChart(analysis.segments || [], analysis.duration || 1);
  const progression = sequence.slice(0, 32);
  const titleTag = `${meta.title} Chords by ${meta.artist}`;
  const desc = `${meta.title} chords by ${meta.artist}. Key of ${key}${bpm ? `, ${bpm} BPM` : ''}. Uses ${main.slice(0, 6).join(', ')}. Free interactive chord sheet — play along, transpose, capo.`;
  const url = `${SITE}/${meta.slug}`;
  const bars = progression.map((c, i) => `<div class="bar"><span class="n">${i + 1}</span><b>${esc(c)}</b></div>`).join('');
  const chips = main.map((c) => `<span class="chip">${esc(c)}</span>`).join('');
  const schema = { '@context': 'https://schema.org', '@type': 'WebPage', name: titleTag, description: desc, url, about: { '@type': 'MusicComposition', name: meta.title, composer: { '@type': 'MusicGroup', name: meta.artist } } };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(titleTag)} | EarChords</title>
<meta name="description" content="${esc(desc)}" />
<link rel="canonical" href="${esc(url)}" />
<meta property="og:title" content="${esc(titleTag)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:type" content="music.song" />
<meta property="og:url" content="${esc(url)}" />
<script type="application/ld+json">${JSON.stringify(schema)}</script>
<style>
  :root{--bg:#0a0d12;--panel:#12161d;--line:#232a34;--ink:#eef2f6;--dim:#9aa6b2;--accent:#c9f24d;--ink2:#0a1404}
  *{box-sizing:border-box}body{margin:0;font-family:Manrope,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink);line-height:1.6}
  a{color:var(--accent)}
  .wrap{max-width:860px;margin:0 auto;padding:1.2rem clamp(1rem,4vw,2rem) 4rem}
  header{display:flex;align-items:center;justify-content:space-between;padding:.6rem 0 1.4rem}
  .brand{font-weight:800;letter-spacing:-.01em;color:var(--ink);text-decoration:none;font-size:1.05rem}
  .brand span{color:var(--accent)}
  .cta-top{font-size:.85rem;font-weight:700;color:var(--ink2);background:var(--accent);padding:.5rem .9rem;border-radius:999px;text-decoration:none}
  h1{font-size:clamp(1.8rem,5vw,2.6rem);margin:.2rem 0 .3rem;letter-spacing:-.02em}
  .sub{color:var(--dim);margin:0 0 1.2rem}
  .meta{display:flex;flex-wrap:wrap;gap:.5rem;margin:0 0 1.4rem}
  .pill{font-size:.82rem;color:var(--dim);border:1px solid var(--line);border-radius:999px;padding:.3rem .8rem}
  .pill b{color:var(--ink)}
  .chips{display:flex;flex-wrap:wrap;gap:.5rem;margin:.2rem 0 1.6rem}
  .chip{font-weight:800;font-size:1.05rem;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:.45rem .8rem}
  h2{font-size:1.15rem;margin:2rem 0 .8rem}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:.5rem}
  .bar{position:relative;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:1rem .6rem;text-align:center}
  .bar .n{position:absolute;top:.35rem;left:.5rem;font-size:.6rem;color:var(--dim)}
  .bar b{font-size:1.25rem}
  .yt{position:relative;padding-bottom:56.25%;height:0;border-radius:14px;overflow:hidden;border:1px solid var(--line);margin:.4rem 0}
  .yt iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
  .cta{display:block;text-align:center;margin:2rem 0 .5rem;background:linear-gradient(135deg,var(--accent),#a6e02a);color:var(--ink2);font-weight:800;padding:1rem;border-radius:14px;text-decoration:none;font-size:1.05rem}
  .note{font-size:.82rem;color:var(--dim);margin:.6rem 0 0}
  .intro{color:var(--dim);max-width:60ch}
  footer{margin-top:3rem;padding-top:1.4rem;border-top:1px solid var(--line);font-size:.85rem;color:var(--dim)}
  footer a{margin-right:1rem}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <a class="brand" href="${esc(SITE)}/">Ear<span>Chords</span></a>
    <a class="cta-top" href="${esc(SITE)}/">Get chords from any song →</a>
  </header>
  <h1>${esc(meta.title)} Chords</h1>
  <p class="sub">by ${esc(meta.artist)}</p>
  <div class="meta">
    <span class="pill">Key <b>${esc(key)}</b></span>
    ${bpm ? `<span class="pill">Tempo <b>${bpm} BPM</b></span>` : ''}
    ${meta.capo ? `<span class="pill">${esc(meta.capo)}</span>` : ''}
    <span class="pill"><b>${main.length}</b> chords</span>
  </div>
  <p class="intro">Chords for <b>${esc(meta.title)}</b> by ${esc(meta.artist)}, in the key of <b>${esc(key)}</b>. This song is built around ${esc(main.slice(0, 4).join(', '))}. Play along with the video below, then open it in EarChords to transpose, add a capo, slow it down, and follow the chords in real time.</p>
  <h2>Chords used</h2>
  <div class="chips">${chips}</div>
  <h2>Play along</h2>
  <div class="yt"><iframe loading="lazy" src="https://www.youtube-nocookie.com/embed/${esc(meta.youtubeId)}" title="${esc(meta.title)} — ${esc(meta.artist)}" allow="encrypted-media" allowfullscreen></iframe></div>
  <h2>Chord progression</h2>
  <div class="grid">${bars}</div>
  <p class="note">AI-detected from the recording — verify by ear with the play-along. Want it exact and interactive (capo / transpose / A-B loop)? Open it in EarChords.</p>
  <a class="cta" href="${esc(SITE)}/">Open “${esc(meta.title)}” in the interactive player →</a>
  <footer>
    <div>More chords: <a href="${esc(SITE)}/piano-chord-finder">Piano chord finder</a> <a href="${esc(SITE)}/chord-identifier">Chord identifier</a> <a href="${esc(SITE)}/">Any song → chords</a></div>
    <p>EarChords detects chords from any song — in your browser, free, private. Audio never leaves your device.</p>
  </footer>
</div>
</body>
</html>`;
}
