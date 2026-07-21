// 用 Web Audio 合成"跟弹和弦":播放原曲时同步弹出检测到的和弦。
// 声音是柔和的电钢/pad 音色,音量适中,与原曲混在一起。
// 目的:让不懂乐理的用户靠"和谐 / 打架"直接听出扒得对不对。

export class ChordPlayer {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.voices = [];
  }

  // 需在用户手势(点击)内调用以解锁音频
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.85;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  _stopVoices(at) {
    for (const v of this.voices) {
      try {
        v.gain.gain.cancelScheduledValues(at);
        v.gain.gain.setTargetAtTime(0.0001, at, 0.06);
        v.osc.stop(at + 0.5);
        v.osc2 && v.osc2.stop(at + 0.5);
      } catch { /* already stopped */ }
    }
    this.voices = [];
  }

  // 弹一个和弦(midis:MIDI 音高数组),持续到下一个和弦
  playChord(midis) {
    this.ensure();
    const t = this.ctx.currentTime;
    this._stopVoices(t);
    if (!midis || !midis.length) return;
    // 每个音两个振荡器(三角+正弦微失谐)做出温暖的电钢感;总音量按音数归一
    const per = 0.14 / Math.sqrt(midis.length);
    for (const m of midis) {
      const f = 440 * 2 ** ((m - 69) / 12);
      const g = this.ctx.createGain();
      g.gain.value = 0.0001;
      g.connect(this.master);
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      osc.connect(g);
      const osc2 = this.ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = f * 1.003; // 微失谐,更饱满
      osc2.connect(g);
      // 柔和起音 + 轻微衰减到持续电平
      g.gain.setTargetAtTime(per, t, 0.02);
      g.gain.setTargetAtTime(per * 0.7, t + 0.15, 0.5);
      osc.start(t);
      osc2.start(t);
      this.voices.push({ osc, osc2, gain: g });
    }
  }

  silence() {
    if (this.ctx) this._stopVoices(this.ctx.currentTime);
  }
}

// 由和弦标签构造一个悦耳的中音区voicing(含低八度根音)
export function voicingFor(chord) {
  if (!chord) return [];
  const root = chord.root % 12;
  const mids = chord.intervals.map((iv) => 48 + root + iv); // C3 区三/四和弦音
  mids.push(36 + root); // 低八度根音(贝斯)
  return mids;
}
