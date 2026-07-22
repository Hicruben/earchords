import { writeFileSync } from 'node:fs';
import { analyzeFile } from './lib_analyze.mjs';

const [, , inputPath, outputPath] = process.argv;

if (!inputPath) {
  console.error('Usage: node validation/analyze_song.mjs <audio-file> [output.json]');
  process.exit(1);
}

console.error(`Analyzing ${inputPath} with the EarChords browser model…`);
const result = await analyzeFile(inputPath, {
  onProgress: (progress) => process.stderr.write(`\rPitch inference ${Math.round(progress * 100)}%`),
});
process.stderr.write('\n');

const json = JSON.stringify(result, null, 2);
if (outputPath) {
  writeFileSync(outputPath, json);
  console.error(`Saved ${outputPath}`);
} else {
  console.log(json);
}
