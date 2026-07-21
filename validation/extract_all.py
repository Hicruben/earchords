import json, sys
from pathlib import Path
from basic_pitch.inference import predict
from basic_pitch import ICASSP_2022_MODEL_PATH
songs = Path(__file__).parent / 'songs'
out = Path('/private/tmp/claude-501/-Users-jerry/7e13a0ee-9e45-470a-acef-e0270bc3ff30/scratchpad')
for wav in sorted(songs.glob('*.wav')):
    _, _, ne = predict(str(wav), ICASSP_2022_MODEL_PATH)
    notes = [{"startTimeSeconds": e[0], "durationSeconds": e[1]-e[0], "pitchMidi": int(e[2]), "amplitude": float(e[3])} for e in ne]
    json.dump(notes, open(out / f'{wav.stem}_notes.json', 'w'))
    print(f'{wav.stem}: {len(notes)} notes')
