import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const [, , analysisPath, referencePath = 'validation/references/ni-buzhidao.json'] = process.argv;

if (!analysisPath) {
  console.error('Usage: node validation/verify_reference.mjs <analysis.json> [reference.json]');
  process.exit(1);
}

const analysis = JSON.parse(readFileSync(analysisPath));
const reference = JSON.parse(readFileSync(referencePath));
const labels = new Set(analysis.segments.map((segment) => segment.label).filter(Boolean));

assert.ok(
  analysis.duration >= reference.durationSeconds[0] && analysis.duration <= reference.durationSeconds[1],
  `duration ${analysis.duration.toFixed(2)}s is outside the reference range`,
);
assert.equal(analysis.key.tonic, reference.key.tonic, 'tonic does not match the reference');
assert.equal(analysis.key.mode, reference.key.mode, 'mode does not match the reference');
assert.ok(
  analysis.tempo.bpm >= reference.bpm[0] && analysis.tempo.bpm <= reference.bpm[1],
  `tempo ${analysis.tempo.bpm} BPM is outside the reference range`,
);
assert.ok(
  analysis.segments.length >= reference.segmentCount[0] && analysis.segments.length <= reference.segmentCount[1],
  `segment count ${analysis.segments.length} is outside the reference range`,
);
reference.requiredChords.forEach((chord) => assert.ok(labels.has(chord), `missing core chord ${chord}`));
assert.ok(analysis.segments.every((segment) => segment.end > segment.start), 'found an invalid segment');
assert.ok(analysis.segments.at(-1).end >= analysis.duration - 0.1, 'timeline does not cover the song');

console.log(`${reference.title}: reference verification passed`);
console.log(`Key ${analysis.key.name} · ${analysis.tempo.bpm} BPM · ${analysis.segments.length} chord segments`);
console.log(`Core chords: ${reference.requiredChords.join(' · ')}`);
