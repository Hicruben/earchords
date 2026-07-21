"""跑 Basic Pitch 扒音符,做和弦匹配,和 ground truth 对比算准确率。

这是整个方案的核心风险测试:audio -> notes(Basic Pitch)-> chord(模板匹配)
的准确率。评分用已知的时间分段(我们自己合成的,时间已知),因此隔离掉了
"节拍/分段检测"这一独立风险,只测和弦识别本身。真实产品还需自动分段,
那是另一个风险,本测试不覆盖(会在结论里说明)。
"""
import json
from collections import Counter
from pathlib import Path

BASE = Path(__file__).parent

# 12 个音级的和弦模板(pitch-class set,以根音为 0)
TEMPLATES = {
    "": [0, 4, 7], "m": [0, 3, 7], "7": [0, 4, 7, 10],
    "maj7": [0, 4, 7, 11], "m7": [0, 3, 7, 10],
    "dim": [0, 3, 6], "aug": [0, 4, 8], "sus4": [0, 5, 7], "sus2": [0, 2, 7],
}
PC_NAME = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def all_chord_templates():
    """生成所有 (标签, pitch-class 集合)。"""
    out = []
    for root in range(12):
        for suffix, intervals in TEMPLATES.items():
            pcs = frozenset((root + iv) % 12 for iv in intervals)
            out.append((PC_NAME[root] + suffix, pcs))
    return out


CHORD_DB = all_chord_templates()


def match_chord(active_pcs):
    """给定活跃音级集合,返回最佳匹配和弦标签。
    评分:交集 - 0.5*模板缺失 - 0.3*多余音(惩罚假阳性和噪音)。"""
    active = set(active_pcs)
    if not active:
        return "N.C."  # no chord
    best, best_score = "N.C.", -99
    for label, pcs in CHORD_DB:
        inter = len(active & pcs)
        missing = len(pcs - active)
        extra = len(active - pcs)
        score = inter - 0.5 * missing - 0.3 * extra
        if score > best_score:
            best, best_score = label, score
    return best


def notes_in_window(notes, start, end):
    """收集窗口内出现的音级,按总时长加权取显著的。"""
    dur_by_pc = Counter()
    for n in notes:
        ov = min(n["end"], end) - max(n["start"], start)
        if ov > 0.15:  # 至少持续 150ms 才算
            dur_by_pc[n["pitch"] % 12] += ov
    if not dur_by_pc:
        return []
    # 取时长 >= 最长音 30% 的音级(滤掉瞬时噪音音)
    peak = max(dur_by_pc.values())
    return [pc for pc, d in dur_by_pc.items() if d >= 0.3 * peak]


def run_basic_pitch(wav_path):
    """调用 basic-pitch 得到音符事件 [{pitch, start, end}]。"""
    from basic_pitch.inference import predict
    from basic_pitch import ICASSP_2022_MODEL_PATH
    _, _, note_events = predict(str(wav_path), ICASSP_2022_MODEL_PATH)
    # note_events: (start_s, end_s, pitch_midi, amplitude, [pitch_bends])
    return [{"start": e[0], "end": e[1], "pitch": e[2]} for e in note_events]


def pc_set_label(pcs):
    return "{" + ",".join(PC_NAME[p] for p in sorted(pcs)) + "}"


def main():
    truth = json.loads((BASE / "truth.json").read_text())
    audio = BASE / "audio"
    total, exact, pc_correct = 0, 0, 0
    rows = []
    for name, segments in truth.items():
        notes = run_basic_pitch(audio / f"{name}.wav")
        for seg in segments:
            active = notes_in_window(notes, seg["start"], seg["end"])
            pred = match_chord(active)
            gold = seg["label"]
            # 精确匹配(标签一致)
            is_exact = (pred == gold)
            # 音级集合匹配(检测到的音级是否覆盖了真实和弦的音级)
            is_pc = set(seg["pitch_classes"]).issubset(set(active))
            total += 1
            exact += is_exact
            pc_correct += is_pc
            rows.append((name, gold, pred, pc_set_label(active),
                         "✓" if is_exact else "✗", "✓" if is_pc else "✗"))

    print(f"\n{'用例':<20}{'标准':<8}{'识别':<8}{'检测到的音级':<22}{'和弦':<5}{'音级'}")
    print("-" * 72)
    cur = None
    for name, gold, pred, active, ok, pcok in rows:
        tag = name if name != cur else ""
        cur = name
        print(f"{tag:<20}{gold:<8}{pred:<8}{active:<22}{ok:<5}{pcok}")
    print("-" * 72)
    print(f"\n和弦精确匹配率:  {exact}/{total} = {100*exact/total:.0f}%")
    print(f"音级召回率(检测到的音级覆盖真实和弦): {pc_correct}/{total} = {100*pc_correct/total:.0f}%")
    print("\n解读:精确匹配率 = 直接给用户的和弦对不对;音级召回率高但精确率")
    print("低,说明音符检测没问题、是和弦命名/滤噪逻辑可优化(工程可解)。")
    print("两个都低才说明 Basic Pitch 本身扒不准这类音频(方案级风险)。")


if __name__ == "__main__":
    main()
