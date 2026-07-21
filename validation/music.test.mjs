import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchChroma, detectChords } from '../src/chords.js';
import { detectKey, estimateTempo, estimateBeats } from '../src/music.js';

function chroma(...pitchClasses) {
  const vector = new Float64Array(12);
  pitchClasses.forEach((pc) => { vector[pc] = 1; });
  return vector;
}

function pulseNotes(bpm, beats = 96) {
  const beat = 60 / bpm;
  return Array.from({ length: beats }, (_, index) => ({
    startTimeSeconds: index * beat,
    durationSeconds: 0.12,
    pitchMidi: index % 4 === 0 ? 48 : 60,
    amplitude: index % 4 === 0 ? 1 : 0.65,
  }));
}

test('matches clear major and minor triads', () => {
  assert.equal(matchChroma(chroma(0, 4, 7)).label, 'C');
  assert.equal(matchChroma(chroma(9, 0, 4)).label, 'Am');
});

test('detects a C major tonal center', () => {
  const notes = [48, 52, 55, 60, 64, 67].map((pitchMidi, index) => ({
    pitchMidi,
    startTimeSeconds: index * 0.2,
    durationSeconds: 1,
    amplitude: 1,
  }));
  const key = detectKey(notes);
  assert.equal(key.tonic, 0);
  assert.equal(key.mode, 'major');
});

test('tempo interpolation resolves 87 BPM without snapping to 88', () => {
  const notes = pulseNotes(87);
  const duration = notes.at(-1).startTimeSeconds + 1;
  const tempo = estimateTempo(notes, duration);
  assert.equal(tempo.bpm, 87);
  assert.ok(Math.abs(tempo.beat - 60 / 87) < 0.012);
});

test('estimateBeats 恢复合成曲的节拍网格并对齐小节线', () => {
  // 合成曲为 120 BPM(拍长 0.5s)、4/4、和弦每 2s(每小节)换。
  // 节拍跟踪器应恢复 0.5s 网格,且小节线(2s 整数倍)有节拍点落在其附近。
  // 这是 beat-synchronous 解码(消除固定 hop 边界滞后)的前置能力。
  const HERE = dirname(fileURLToPath(import.meta.url));
  const path = join(HERE, 'synth_analysis', 'canon_d.json');
  if (!existsSync(path)) return; // 缺合成语料时跳过
  const a = JSON.parse(readFileSync(path));
  const { beats, beat, bpm } = estimateBeats(a.notes, a.duration);
  assert.equal(bpm, 120);
  assert.ok(Math.abs(beat - 0.5) < 0.02, `拍长 ${beat} 应≈0.5s`);
  assert.ok(beats.length >= 30, '应恢复整曲的节拍序列');
  // 每条小节线(0,2,4,…)都应有节拍点在 60ms 内
  for (let bar = 0; bar + 2 <= a.duration; bar += 2) {
    const nearest = Math.min(...beats.map((b) => Math.abs(b - bar)));
    assert.ok(nearest < 0.06, `小节线 ${bar}s 无节拍对齐(最近 ${(nearest * 1000).toFixed(0)}ms)`);
  }
});

test('干净输入下识别副属/调外属七(解码器能力,防调内先验过强)', () => {
  // C 大调里的副属进行 C - D7(V/V,含调外 F#) - G7(V,含调外 F) - C。
  // 诊断意义:证实真实歌(如"美人鱼")漏副属 D 是上游提取的 F#/F 歧义、而非解码器——
  // 音符干净时解码器报对。也守护:未来加强调内先验不得把调外属七压成三和弦。
  const CHORDS = [
    ['C', [60, 64, 67]],
    ['D7', [62, 66, 69, 72]], // D F# A C(F# 调外)
    ['G7', [67, 71, 74, 77]], // G B D F(F 调外)
    ['C', [60, 64, 67]],
  ];
  const notes = [];
  CHORDS.forEach(([, midis], bar) => {
    for (const m of midis) {
      for (let beat = 0; beat < 4; beat++) {
        notes.push({ pitchMidi: m, startTimeSeconds: bar * 2 + beat * 0.5, durationSeconds: 0.45, amplitude: 1 });
      }
    }
  });
  const { segments } = detectChords(notes, 8);
  const labels = segments.map((s) => s.label);
  assert.ok(labels.includes('D7'), `应识别副属 D7,实得 ${labels.join(',')}`);
  assert.ok(labels.includes('G7'), `应识别属七 G7,实得 ${labels.join(',')}`);
});

test('stable triads produce a compact chord timeline', () => {
  const notes = [];
  const pitches = [48, 52, 55];
  for (let start = 0; start < 8; start += 0.5) {
    pitches.forEach((pitchMidi) => notes.push({
      pitchMidi,
      startTimeSeconds: start,
      durationSeconds: 0.48,
      amplitude: 1,
    }));
  }
  const result = detectChords(notes, 8, { smoothRadius: 2 });
  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0].label, 'C');
});
