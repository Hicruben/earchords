// 工具落地页生成器:为可争取的工具意图词(chord identifier / piano chord finder …)
// 生成 SEO 落地页,导流到 app。纯静态。 用法:node songgen/landing.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE, esc } from './render.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function landing(p) {
  const url = `${SITE}/${p.slug}`;
  const related = (p.related || []).map(([slug, name]) => `<li><a href="${SITE}/${slug}">${esc(name)} chords</a></li>`).join('');
  const faq = [
    ['Is it free?', 'Yes — EarChords is free and runs entirely in your browser. There’s no sign-up and nothing is uploaded to a server.'],
    ['How does it find the chords?', 'It uses on-device neural pitch detection plus harmony modelling to hear the notes and work out the chord at each moment — the same way a musician does by ear, in seconds.'],
    ['Do I need the audio file?', 'No. You can play the song out loud, capture a tab that’s playing it, or upload a file. Whatever you use, the audio never leaves your device.'],
  ];
  const faqHtml = faq.map(([q, a]) => `<div class="faq"><h3>${esc(q)}</h3><p>${esc(a)}</p></div>`).join('');
  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebApplication', name: `EarChords ${p.h1}`, url, applicationCategory: 'MultimediaApplication', operatingSystem: 'Web browser', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, description: p.lead },
      { '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    ],
  };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(p.title)} | EarChords</title>
<meta name="description" content="${esc(p.lead)}" />
<link rel="canonical" href="${esc(url)}" />
<meta property="og:title" content="${esc(p.title)}" />
<meta property="og:description" content="${esc(p.lead)}" />
<meta property="og:url" content="${esc(url)}" />
<script type="application/ld+json">${JSON.stringify(schema)}</script>
<style>
  :root{--bg:#0a0d12;--panel:#12161d;--line:#232a34;--ink:#eef2f6;--dim:#9aa6b2;--accent:#c9f24d;--ink2:#0a1404}
  *{box-sizing:border-box}body{margin:0;font-family:Manrope,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink);line-height:1.65}
  a{color:var(--accent)}
  .wrap{max-width:820px;margin:0 auto;padding:1.2rem clamp(1rem,4vw,2rem) 4rem}
  header{display:flex;align-items:center;justify-content:space-between;padding:.6rem 0 2.2rem}
  .brand{font-weight:800;color:var(--ink);text-decoration:none;font-size:1.05rem}.brand span{color:var(--accent)}
  h1{font-size:clamp(2rem,6vw,3rem);margin:.4rem 0 .6rem;letter-spacing:-.02em}
  .lead{color:var(--dim);font-size:1.12rem;max-width:60ch;margin:0 0 1.6rem}
  .cta{display:inline-block;background:linear-gradient(135deg,var(--accent),#a6e02a);color:var(--ink2);font-weight:800;padding:.95rem 1.5rem;border-radius:14px;text-decoration:none;font-size:1.05rem}
  h2{font-size:1.3rem;margin:2.6rem 0 1rem}
  .steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem;padding:0;list-style:none}
  .steps li{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:1.1rem}
  .steps b{display:block;margin-bottom:.3rem}
  .steps small{color:var(--dim)}
  ul.why{list-style:none;padding:0}ul.why li{padding:.4rem 0 .4rem 1.6rem;position:relative;color:var(--dim)}
  ul.why li::before{content:'✓';position:absolute;left:0;color:var(--accent);font-weight:800}
  ul.why li b{color:var(--ink)}
  ul.links{columns:2;padding-left:1.1rem;color:var(--dim)}
  .faq{border-top:1px solid var(--line);padding:1rem 0}.faq h3{margin:0 0 .3rem;font-size:1.02rem}.faq p{margin:0;color:var(--dim)}
  footer{margin-top:3rem;padding-top:1.4rem;border-top:1px solid var(--line);font-size:.85rem;color:var(--dim)}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <a class="brand" href="${SITE}/">Ear<span>Chords</span></a>
    <a class="cta" style="padding:.5rem .9rem;font-size:.85rem;border-radius:999px" href="${SITE}/">Open EarChords →</a>
  </header>

  <h1>${esc(p.h1)}</h1>
  <p class="lead">${esc(p.lead)}</p>
  <a class="cta" href="${SITE}/">${esc(p.h1)} — start free →</a>

  <h2>How it works</h2>
  <ul class="steps">
    <li><b>1 · Play or capture</b><small>Play the song out loud, capture a tab that’s playing it, or upload a file.</small></li>
    <li><b>2 · EarChords listens</b><small>On-device AI hears the notes and resolves the chord at every moment.</small></li>
    <li><b>3 · Get a chord sheet</b><small>Key, tempo and the full progression — transpose, capo, slow down, loop.</small></li>
  </ul>

  <h2>Why EarChords</h2>
  <ul class="why">
    <li><b>Free & instant</b> — no sign-up, no upload, no waiting.</li>
    <li><b>Private by design</b> — audio is analysed on your device and never leaves it.</li>
    <li><b>Most accurate on ${esc(p.strength)}</b> — clean, playable chord sheets you can actually use.</li>
    <li><b>Made to play</b> — transpose, add a capo, slow it down, and A-B loop any section.</li>
  </ul>

  <h2>Popular chords</h2>
  <ul class="links">${related}</ul>

  <h2>FAQ</h2>
  ${faqHtml}

  <a class="cta" href="${SITE}/" style="margin-top:1.5rem">Try it on a song now →</a>
  <footer>EarChords — get the chords from any song, free & private, in your browser.
    · <a href="${SITE}/chord-identifier">Chord identifier</a> · <a href="${SITE}/piano-chord-finder">Piano chord finder</a> · <a href="${SITE}/">Home</a></footer>
</div>
</body>
</html>`;
}

const pages = JSON.parse(readFileSync(join(HERE, 'landing.json'), 'utf8'));
for (const p of pages) {
  writeFileSync(join(HERE, 'out', `${p.slug}.html`), landing(p));
  console.log(`✓ ${p.slug}.html  (target: "${p.kw}")`);
}
