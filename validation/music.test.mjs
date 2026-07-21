import test from 'node:test';
import assert from 'node:assert/strict';
import { matchChroma, detectChords } from '../src/chords.js';
import { detectKey, estimateTempo } from '../src/music.js';

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
