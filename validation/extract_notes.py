import sys, json
from basic_pitch.inference import predict
from basic_pitch import ICASSP_2022_MODEL_PATH
path = sys.argv[1]
_, _, note_events = predict(path, ICASSP_2022_MODEL_PATH)
# note_events: (start_s, end_s, pitch_midi, amplitude, [pitch_bends])
notes = [{"startTimeSeconds": e[0], "durationSeconds": e[1]-e[0], "pitchMidi": int(e[2]), "amplitude": float(e[3])} for e in note_events]
out = sys.argv[2]
json.dump(notes, open(out, "w"))
print(f"notes: {len(notes)}")
