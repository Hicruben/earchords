// 和弦指法图:钢琴(完全由音程计算)+ 吉他/尤克里里(可移动把位形状计算)。
// 返回 SVG 字符串。设计与配色跟随 CSS 变量,浅深色自适应。

import { chordByLabel, PC_NAME } from './chords.js';

// ---------- 钢琴 ----------
// 画约两个八度,高亮和弦音级。完全可计算,任意和弦都能画。
export function pianoSVG(label) {
  const c = chordByLabel(label);
  const active = c ? new Set(c.intervals.map((iv) => (c.root + iv) % 12)) : new Set();
  const rootPc = c ? c.root : -1;
  const whiteOrder = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
  const octaves = 2;
  const wW = 22, wH = 92, bW = 13, bH = 58;
  const whites = [];
  const blacks = [];
  let x = 0;
  for (let o = 0; o < octaves; o++) {
    for (const pc of whiteOrder) {
      whites.push({ pc, x });
      x += wW;
    }
  }
  const totalW = x;
  // 黑键位置:C# D# _ F# G# A#(E、B 后无黑键)
  const blackAfter = { 0: 1, 2: 3, 5: 6, 7: 8, 9: 10 };
  let wx = 0;
  for (let o = 0; o < octaves; o++) {
    for (const pc of whiteOrder) {
      if (blackAfter[pc] !== undefined) {
        blacks.push({ pc: blackAfter[pc], x: wx + wW - bW / 2 });
      }
      wx += wW;
    }
  }
  const ROOT = 'var(--accent)';
  const TONE = '#f3c088'; // 非根音和弦音:亮琥珀,清晰可辨
  const TONE_DARK = '#e79a3d'; // 黑键非根音
  const rects = [];
  for (const w of whites) {
    const on = active.has(w.pc);
    const isRoot = w.pc === rootPc;
    const fill = on ? (isRoot ? ROOT : TONE) : 'var(--key-white)';
    rects.push(
      `<rect x="${w.x}" y="0" width="${wW - 1}" height="${wH}" rx="3" fill="${fill}" stroke="var(--key-stroke)" stroke-width="1"/>`,
    );
  }
  for (const b of blacks) {
    const on = active.has(b.pc);
    const isRoot = b.pc === rootPc;
    const fill = on ? (isRoot ? 'var(--accent-strong)' : TONE_DARK) : 'var(--key-black)';
    rects.push(
      `<rect x="${b.x}" y="0" width="${bW}" height="${bH}" rx="2.5" fill="${fill}"/>`,
    );
  }
  return `<svg viewBox="-1 -1 ${totalW + 1} ${wH + 2}" class="diagram-svg piano" preserveAspectRatio="xMidYMid meet">${rects.join('')}</svg>`;
}

// ---------- 吉他 / 尤克里里 ----------
// 用可移动把位形状:把某个基础形状按根音平移到相应品格。
// 每根弦的开放音级(低->高)。吉他标准调弦 EADGBE,尤克 GCEA(high-G)。
const TUNINGS = {
  guitar: [4, 9, 2, 7, 11, 4], // E A D G B E
  ukulele: [7, 0, 4, 9],       // G C E A
};

// —— 常用开放和弦(手工校准,低E->高E,-1=闷音,0=空弦)——
// 覆盖真实流行歌里绝大多数和弦,给出吉他手熟悉的标准把位。
const GUITAR_OPEN = {
  C: [-1, 3, 2, 0, 1, 0], Cmaj7: [-1, 3, 2, 0, 0, 0], C7: [-1, 3, 2, 3, 1, 0], Cm7: [-1, 3, 1, 3, 1, -1],
  D: [-1, -1, 0, 2, 3, 2], Dm: [-1, -1, 0, 2, 3, 1], D7: [-1, -1, 0, 2, 1, 2], Dmaj7: [-1, -1, 0, 2, 2, 2], Dm7: [-1, -1, 0, 2, 1, 1],
  E: [0, 2, 2, 1, 0, 0], Em: [0, 2, 2, 0, 0, 0], E7: [0, 2, 0, 1, 0, 0], Emaj7: [0, 2, 1, 1, 0, 0], Em7: [0, 2, 0, 0, 0, 0],
  F: [1, 3, 3, 2, 1, 1], Fmaj7: [-1, -1, 3, 2, 1, 0], Fm: [1, 3, 3, 1, 1, 1],
  G: [3, 2, 0, 0, 0, 3], G7: [3, 2, 0, 0, 0, 1], Gmaj7: [3, 2, 0, 0, 0, 2], Gm: [3, 5, 5, 3, 3, 3],
  A: [-1, 0, 2, 2, 2, 0], Am: [-1, 0, 2, 2, 1, 0], A7: [-1, 0, 2, 0, 2, 0], Amaj7: [-1, 0, 2, 1, 2, 0], Am7: [-1, 0, 2, 0, 1, 0],
  B: [-1, 2, 4, 4, 4, 2], Bm: [-1, 2, 4, 4, 3, 2], B7: [-1, 2, 1, 2, 0, 2], Bm7: [-1, 2, 0, 2, 0, 2],
  'C#m': [-1, 4, 6, 6, 5, 4], 'F#m': [2, 4, 4, 2, 2, 2], 'F#': [2, 4, 4, 3, 2, 2], 'G#m': [4, 6, 6, 4, 4, 4],
  'A#': [-1, 1, 3, 3, 3, 1], 'D#': [-1, -1, 1, 3, 4, 3], 'A#m': [-1, 1, 3, 3, 2, 1],
};

// 可移动形状(E 型根音在6弦 / A 型根音在5弦),base=按品平移,含 barre 品。
const E_SHAPE = { '': [0, 2, 2, 1, 0, 0], m: [0, 2, 2, 0, 0, 0], '7': [0, 2, 0, 1, 0, 0], maj7: [0, 2, 1, 1, 0, 0], m7: [0, 2, 0, 0, 0, 0], sus4: [0, 2, 2, 2, 0, 0], sus2: [0, 0, -1, -1, 0, 0], dim: [0, 1, 2, 0, -1, -1], aug: [0, -1, -1, 1, 1, 0], '6': [0, 2, 2, 1, 2, 0], m6: [0, 2, 2, 0, 2, 0], add9: [0, 2, 4, 1, 0, 0] };
const A_SHAPE = { '': [-1, 0, 2, 2, 2, 0], m: [-1, 0, 2, 2, 1, 0], '7': [-1, 0, 2, 0, 2, 0], maj7: [-1, 0, 2, 1, 2, 0], m7: [-1, 0, 2, 0, 1, 0], sus4: [-1, 0, 2, 2, 3, 0], sus2: [-1, 0, 2, 2, 0, 0], dim: [-1, 0, 1, 2, 1, -1], aug: [-1, 0, 3, 2, 2, -1], '6': [-1, 0, 2, 2, 2, 2], m6: [-1, 0, 2, 2, 1, 2], add9: [-1, 0, 2, 4, 2, 0] };

// 替代把位:同一和弦的第二种常用按法(空则回退到主把位)
const GUITAR_ALT = {
  C: [-1, 3, 5, 5, 5, 3], G: [3, 5, 5, 4, 3, 3], D: [-1, 5, 4, 2, 3, 2],
  A: [5, 7, 7, 6, 5, 5], E: [-1, 7, 6, 4, 5, 4], F: [-1, -1, 3, 2, 1, 1],
  Am: [5, 7, 7, 5, 5, 5], Em: [-1, 7, 5, 4, 5, 3], Dm: [-1, 5, 7, 7, 6, 5],
  G7: [3, -1, 3, 4, 3, -1], C7: [-1, 3, 5, 3, 5, 3], D7: [-1, 5, 4, 5, 3, -1],
};

// 返回 {frets:[6], barreFret:number|0}
function guitarShape(chord, voicing = 0) {
  if (voicing > 0 && GUITAR_ALT[chord.label]) {
    const alt = GUITAR_ALT[chord.label];
    const played = alt.filter((f) => f > 0);
    const minF = played.length ? Math.min(...played) : 0;
    const isBarre = alt[alt.length - 1] === minF && alt.filter((f) => f === minF).length >= 2;
    return { frets: alt, barreFret: isBarre ? minF : 0 };
  }
  const open = GUITAR_OPEN[chord.label];
  if (open) {
    // 判定横按:最高弦(第1弦)按在最低品,且该品出现在 >=2 根弦上
    const played = open.filter((f) => f > 0);
    const minF = played.length ? Math.min(...played) : 0;
    const count = open.filter((f) => f === minF).length;
    const isBarre = open[open.length - 1] === minF && count >= 2;
    return { frets: open, barreFret: isBarre ? minF : 0 };
  }
  // 可移动:E 型(6弦根,空弦E=4)与 A 型(5弦根,空弦A=9),取更低把位
  const eBase = ((chord.root - 4) % 12 + 12) % 12 || 12;
  const aBase = ((chord.root - 9) % 12 + 12) % 12 || 12;
  const useA = aBase < eBase;
  const shape = (useA ? A_SHAPE : E_SHAPE)[chord.suffix] || (useA ? A_SHAPE : E_SHAPE)[''];
  const base = useA ? aBase : eBase;
  const frets = shape.map((s) => (s < 0 ? -1 : s + base));
  return { frets, barreFret: base };
}

// 尤克(GCEA)常用开放形状 + 贪心兜底
const UKE_OPEN = {
  C: [0, 0, 0, 3], Cmaj7: [0, 0, 0, 2], C7: [0, 0, 0, 1], Cm: [0, 3, 3, 3], Cm7: [3, 3, 3, 3],
  D: [2, 2, 2, 0], Dm: [2, 2, 1, 0], D7: [2, 2, 2, 3], Dm7: [2, 2, 1, 3],
  E: [4, 4, 4, 2], Em: [0, 4, 3, 2], E7: [1, 2, 0, 2], Em7: [0, 2, 0, 2],
  F: [2, 0, 1, 0], Fmaj7: [2, 4, 1, 3], Fm: [1, 0, 1, 3],
  G: [0, 2, 3, 2], G7: [0, 2, 1, 2], Gmaj7: [0, 2, 2, 2], Gm: [0, 2, 3, 1],
  A: [2, 1, 0, 0], Am: [2, 0, 0, 0], A7: [0, 1, 0, 0], Amaj7: [1, 1, 0, 0], Am7: [0, 0, 0, 0],
  B: [4, 3, 2, 2], Bm: [4, 2, 2, 2], B7: [2, 3, 2, 2],
};
function ukuleleShape(chord) {
  const open = UKE_OPEN[chord.label];
  if (open) return { frets: open, barreFret: 0 };
  const tuning = TUNINGS.ukulele;
  const pcs = new Set(chord.intervals.map((iv) => (chord.root + iv) % 12));
  const frets = tuning.map((openPc) => {
    for (let f = 0; f <= 4; f++) if (pcs.has((openPc + f) % 12)) return f;
    return -1;
  });
  return { frets, barreFret: 0 };
}

// 渲染品格图 SVG
function fretboardSVG(shape, opts) {
  const { frets, barreFret } = shape;
  const nStrings = frets.length;
  const played = frets.filter((f) => f > 0);
  const minFret = played.length ? Math.min(...played) : 1;
  const maxFret = played.length ? Math.max(...played) : 3;
  const span = 4;
  let startFret = 1;
  let showNut = true;
  if (maxFret > 4) {
    startFret = minFret;
    showNut = false;
  }
  const W = 120, H = 154;
  const padX = 17, padTop = 28, padBot = 18;
  const gridW = W - padX * 2;
  const gridH = H - padTop - padBot;
  const sSpace = gridW / (nStrings - 1);
  const fSpace = gridH / span;
  const el = [];
  const relFret = (f) => f - startFret + 1;

  // barre 横按条(先画,压在网格下)
  if (barreFret && barreFret >= startFret) {
    const rel = relFret(barreFret);
    const y = padTop + (rel - 0.5) * fSpace;
    // 找到该品被按的最外侧两根弦
    const idxs = frets.map((f, i) => (f === barreFret ? i : -1)).filter((i) => i >= 0);
    if (idxs.length >= 2) {
      const x1 = padX + Math.min(...idxs) * sSpace;
      const x2 = padX + Math.max(...idxs) * sSpace;
      el.push(`<rect x="${x1 - 7}" y="${y - 7}" width="${x2 - x1 + 14}" height="14" rx="7" fill="var(--accent-soft)"/>`);
    }
  }

  // 弦(竖线)
  for (let i = 0; i < nStrings; i++) {
    const x = padX + i * sSpace;
    el.push(`<line x1="${x}" y1="${padTop}" x2="${x}" y2="${padTop + gridH}" stroke="var(--fret-line)" stroke-width="1.3"/>`);
  }
  // 品(横线),0 品(nut)加粗
  for (let f = 0; f <= span; f++) {
    const y = padTop + f * fSpace;
    const wdt = f === 0 && showNut ? 4.5 : 1.3;
    el.push(`<line x1="${padX}" y1="${y}" x2="${padX + gridW}" y2="${y}" stroke="var(--fret-line)" stroke-width="${wdt}"/>`);
  }
  // 起始品标注
  if (!showNut) {
    el.push(`<text x="${padX - 7}" y="${padTop + fSpace * 0.72}" class="fret-num" text-anchor="end" fill="var(--ink-dim)" font-size="11" font-family="var(--font-mono)">${startFret}fr</text>`);
  }
  // 指位/空弦/闷音
  for (let i = 0; i < nStrings; i++) {
    const x = padX + i * sSpace;
    const f = frets[i];
    if (f < 0) {
      el.push(`<text x="${x}" y="${padTop - 9}" text-anchor="middle" fill="var(--ink-faint)" font-size="12" font-family="var(--font-ui)">×</text>`);
    } else if (f === 0) {
      el.push(`<circle cx="${x}" cy="${padTop - 13}" r="4.2" fill="none" stroke="var(--diagram-fg)" stroke-width="1.4"/>`);
    } else {
      const rel = relFret(f);
      const y = padTop + (rel - 0.5) * fSpace;
      const isRoot = ((TUNINGS[opts.instrument][i] + f) % 12) === opts.rootPc;
      el.push(`<circle cx="${x}" cy="${y}" r="6.6" fill="${isRoot ? 'var(--accent)' : 'var(--diagram-fg)'}" stroke="var(--panel)" stroke-width="0.5"/>`);
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" class="diagram-svg fretboard" preserveAspectRatio="xMidYMid meet">${el.join('')}</svg>`;
}

export function guitarSVG(label, voicing = 0) {
  const c = chordByLabel(label);
  if (!c) return '';
  return fretboardSVG(guitarShape(c, voicing), { instrument: 'guitar', rootPc: c.root });
}

export function ukuleleSVG(label) {
  const c = chordByLabel(label);
  if (!c) return '';
  return fretboardSVG(ukuleleShape(c), { instrument: 'ukulele', rootPc: c.root });
}

export function diagramSVG(instrument, label, voicing = 0) {
  if (instrument === 'piano') return pianoSVG(label);
  if (instrument === 'ukulele') return ukuleleSVG(label);
  return guitarSVG(label, voicing);
}
