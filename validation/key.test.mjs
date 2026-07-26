// 调性判定回归网:对已人工核对的真实歌曲(含关系大小调易混的硬骨头)跑生产路径,
// 断言准确率不低于校准基线。notes 缓存在 validation/keytest_notes/(不入库,
// 用 `node validation/keytest.mjs --prepare` 生成);缓存不存在时自动跳过。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectChords } from '../src/chords.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'keytest_notes');

// 等音调视为相同(Ab==G#),大小调后缀保留
const EQ = { Ab: 'G#', Db: 'C#', Bb: 'A#', Eb: 'D#', Gb: 'F#', Cb: 'B' };
function norm(n) {
  const m = String(n).match(/^([A-G][#b]?)(m?)$/);
  return m ? (EQ[m[1]] || m[1]) + m[2] : String(n);
}

// 来源本身有分歧的曲目不计入(Dust in the Wind:C 大调/A 小调两说并存;
// Iris:BDDDDD 特殊调弦导致整首音符检测崩坏,非调性逻辑问题)
const AMBIGUOUS = new Set(['Dust in the Wind', 'Iris']);
const FLOOR = 0.8; // 已核对曲目上的调性准确率下限(当前实测 8/8 = 100%)

test('调性判定:已核对真实歌曲的准确率不低于基线(关系大小调回归网)', (t) => {
  if (!existsSync(CACHE)) return t.skip('无 notes 缓存,跳过(见 validation/keytest.mjs --prepare)');
  const files = readdirSync(CACHE).filter((f) => f.endsWith('.json'));
  if (!files.length) return t.skip('notes 缓存为空,跳过');

  let ok = 0, n = 0;
  const fails = [];
  for (const f of files) {
    const { title, expect, notes } = JSON.parse(readFileSync(join(CACHE, f), 'utf8'));
    if (AMBIGUOUS.has(title)) continue;
    let dur = 0;
    for (const nt of notes) {
      const e = (nt.startTimeSeconds || 0) + (nt.durationSeconds || 0);
      if (e > dur) dur = e;
    }
    const got = detectChords(notes, dur).key.name;
    n++;
    if (norm(got) === norm(expect)) ok++;
    else fails.push(`${title}: got ${got}, expect ${expect}`);
  }
  if (!n) return t.skip('缓存里没有可评分曲目');
  console.log(`  调性准确率 ${ok}/${n}(下限 ${Math.round(FLOOR * 100)}%)`);
  if (fails.length) console.log(fails.map((x) => '    ✗ ' + x).join('\n'));
  assert.ok(ok / n >= FLOOR, `调性准确率 ${ok}/${n} 低于下限 ${FLOOR}`);
});
