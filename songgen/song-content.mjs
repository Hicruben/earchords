// 从分析数据推导每首歌的实质内容(不是灌水模板):和弦构成、难度、变调夹建议、
// 段落结构、FAQ。全部由这首歌自己的 key / tempo / segments 算出,所以每页文字不同。
import { chordByLabel } from '../src/chords.js';

const PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// 吉他上不用横按就能按的开放和弦(新手友好度判断的依据)
const OPEN_SHAPES = new Set([
  'C', 'A', 'G', 'E', 'D', 'Am', 'Em', 'Dm',
  'C7', 'A7', 'G7', 'E7', 'D7', 'B7', 'Am7', 'Em7', 'Dm7',
  'Cmaj7', 'Amaj7', 'Gmaj7', 'Emaj7', 'Dmaj7',
  'Asus2', 'Asus4', 'Dsus2', 'Dsus4', 'Esus4', 'Cadd9', 'Gadd9', 'G6', 'D6',
]);

const isBarre = (label) => !OPEN_SHAPES.has(label);

// 统计:每个和弦的出现次数与总时长占比
export function chordStats(segments, duration) {
  const map = new Map();
  for (const s of segments) {
    if (!s.label || s.label === 'N.C.') continue;
    const cur = map.get(s.label) || { label: s.label, count: 0, time: 0 };
    cur.count += 1;
    cur.time += (s.end - s.start);
    map.set(s.label, cur);
  }
  const list = [...map.values()].sort((a, b) => b.time - a.time);
  const total = list.reduce((n, c) => n + c.time, 0) || 1;
  return list.map((c) => ({ ...c, pct: Math.round((c.time / total) * 100) }));
}

// 找最常出现的连续走向(4 和弦一组),这才是用户想要的"进行"
export function topProgression(segments) {
  const seq = [];
  for (const s of segments) {
    if (!s.label || s.label === 'N.C.') continue;
    if (seq[seq.length - 1] !== s.label) seq.push(s.label);
  }
  const counts = new Map();
  for (let i = 0; i + 4 <= seq.length; i++) {
    const k = seq.slice(i, i + 4).join(' – ');
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let best = null;
  for (const [k, n] of counts) if (!best || n > best.n) best = { k, n };
  return best && best.n >= 2 ? best : null;
}

// 变调夹建议:找一个品位,使歌里主要和弦都变成开放和弦形状
export function capoSuggestion(stats) {
  const mains = stats.slice(0, 4).map((c) => c.label);
  if (!mains.length) return null;
  if (mains.every((l) => !isBarre(l))) return null; // 本来就好按,不用建议
  for (let fret = 1; fret <= 7; fret++) {
    const shapes = mains.map((l) => transposeDown(l, fret));
    if (shapes.every((s) => s && !isBarre(s))) {
      return { fret, shapes };
    }
  }
  return null;
}

function transposeDown(label, semis) {
  const c = chordByLabel(label);
  if (!c) return null;
  const root = ((c.root - semis) % 12 + 12) % 12;
  return PC[root] + c.suffix;
}

// 难度:横按数量 + 和弦总数 + 速度
export function difficulty(stats, bpm) {
  const barres = stats.filter((c) => isBarre(c.label));
  const n = stats.length;
  let level, why;
  if (!barres.length && n <= 5) {
    level = 'Beginner';
    why = `all ${n} chords are open shapes — no barre chords`;
  } else if (barres.length <= 1 && n <= 7) {
    level = 'Easy';
    why = barres.length
      ? `mostly open chords, with ${barres[0].label} as the one tricky shape`
      : `${n} chords, all open shapes`;
  } else if (barres.length <= 3) {
    level = 'Intermediate';
    why = `${n} chords including ${barres.slice(0, 3).map((c) => c.label).join(', ')}`;
  } else {
    level = 'Advanced';
    why = `${n} different chords, ${barres.length} of them barre or extended shapes`;
  }
  if (bpm && bpm > 140) why += `, and it moves quickly at ${bpm} BPM`;
  return { level, why, barres: barres.map((c) => c.label) };
}

// 和弦怎么按(文字描述,配合已有指法图)
export function howToPlay(label) {
  const c = chordByLabel(label);
  if (!c) return '';
  const quality = c.suffix === '' ? 'major'
    : c.suffix === 'm' ? 'minor'
    : c.suffix === '7' ? 'dominant seventh'
    : c.suffix === 'maj7' ? 'major seventh'
    : c.suffix === 'm7' ? 'minor seventh'
    : c.suffix === 'sus4' ? 'suspended fourth'
    : c.suffix === 'sus2' ? 'suspended second'
    : c.suffix === 'add9' ? 'added ninth'
    : c.suffix === '6' ? 'sixth'
    : c.suffix === 'dim' ? 'diminished'
    : c.suffix === 'aug' ? 'augmented'
    : c.suffix;
  const notes = c.intervals.map((iv) => PC[(c.root + iv) % 12]).join(', ');
  const shape = isBarre(label) ? 'a barre or moveable shape' : 'an open shape';
  return `${label} is ${PC[c.root % 12]} ${quality} (${notes}) — ${shape} on guitar.`;
}

// 段落数(粗略结构信息:和弦变化次数 / 时长)
export function structureNote(segments, duration, bpm) {
  const changes = segments.filter((s) => s.label && s.label !== 'N.C.').length;
  const mins = Math.floor(duration / 60);
  const secs = Math.round(duration % 60);
  const barsApprox = bpm ? Math.round((duration / 60) * bpm / 4) : null;
  return { changes, length: `${mins}:${String(secs).padStart(2, '0')}`, barsApprox };
}
