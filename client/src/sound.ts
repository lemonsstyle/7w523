type SoundName =
  | "lead"
  | "beat"
  | "draw"
  | "pass"
  | "special"
  | "button"
  | "start"
  | "dice"
  | "tick"
  | "deadline"
  | "penalty"
  | "release";
type WaveType = OscillatorType;

interface ToneOptions {
  frequency: number;
  start: number;
  duration: number;
  gain: number;
  wave?: WaveType;
  endFrequency?: number;
  attack?: number;
  filterFrequency?: number;
  filterType?: BiquadFilterType;
}

let audioContext: AudioContext | null = null;

export function playSound(name: SoundName, muted: boolean, repeat = 1): void {
  if (muted) {
    return;
  }

  const context = getAudioContext();
  if (!context) {
    return;
  }

  void context.resume();

  for (let index = 0; index < repeat; index += 1) {
    const start = context.currentTime + index * 0.15;

    if (name === "draw") {
      drawCard(context, start, index);
    } else if (name === "lead") {
      leadPlay(context, start);
    } else if (name === "beat") {
      beatPlay(context, start);
    } else if (name === "pass") {
      defeatedPass(context, start);
    } else if (name === "special") {
      royalReturn(context, start);
    } else if (name === "start") {
      startGame(context, start);
    } else if (name === "dice") {
      diceRoll(context, start);
    } else if (name === "tick") {
      countdownTick(context, start);
    } else if (name === "deadline") {
      deadlineTone(context, start);
    } else if (name === "penalty") {
      penaltyCue(context, start);
    } else if (name === "release") {
      releaseCue(context, start);
    } else {
      smallClick(context, start);
    }
  }
}

function getAudioContext(): AudioContext | null {
  if (audioContext) {
    return audioContext;
  }

  const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContextClass) {
    return null;
  }

  audioContext = new AudioContextClass();
  return audioContext;
}

function drawCard(context: AudioContext, start: number, index: number): void {
  noise(context, start, 0.055, 0.045, 1700, "bandpass");
  tone(context, {
    frequency: 430 + index * 18,
    endFrequency: 500 + index * 16,
    start: start + 0.018,
    duration: 0.08,
    gain: 0.08,
    wave: "triangle",
    filterFrequency: 1800
  });
}

function leadPlay(context: AudioContext, start: number): void {
  noise(context, start, 0.045, 0.04, 900, "lowpass");
  tone(context, {
    frequency: 185,
    endFrequency: 205,
    start,
    duration: 0.12,
    gain: 0.13,
    wave: "triangle",
    filterFrequency: 900
  });
  tone(context, {
    frequency: 277,
    start: start + 0.055,
    duration: 0.11,
    gain: 0.08,
    wave: "sine",
    filterFrequency: 1200
  });
}

function beatPlay(context: AudioContext, start: number): void {
  noise(context, start, 0.035, 0.04, 2400, "highpass");
  tone(context, {
    frequency: 247,
    endFrequency: 392,
    start,
    duration: 0.18,
    gain: 0.13,
    wave: "triangle",
    filterFrequency: 1800
  });
  tone(context, {
    frequency: 494,
    endFrequency: 740,
    start: start + 0.065,
    duration: 0.18,
    gain: 0.09,
    wave: "sine",
    filterFrequency: 2600
  });
  tone(context, {
    frequency: 988,
    start: start + 0.15,
    duration: 0.08,
    gain: 0.035,
    wave: "sine",
    filterFrequency: 4200
  });
}

function defeatedPass(context: AudioContext, start: number): void {
  tone(context, {
    frequency: 220,
    endFrequency: 115,
    start,
    duration: 0.24,
    gain: 0.11,
    wave: "sine",
    filterFrequency: 650
  });
  tone(context, {
    frequency: 165,
    endFrequency: 82,
    start: start + 0.08,
    duration: 0.26,
    gain: 0.08,
    wave: "triangle",
    filterFrequency: 520
  });
  noise(context, start + 0.13, 0.18, 0.035, 360, "lowpass");
}

function royalReturn(context: AudioContext, start: number): void {
  const notes = [196, 247, 330, 392, 523, 784];
  notes.forEach((frequency, index) => {
    tone(context, {
      frequency,
      endFrequency: frequency * 1.015,
      start: start + index * 0.07,
      duration: 0.28,
      gain: index < 3 ? 0.12 : 0.09,
      wave: index % 2 === 0 ? "triangle" : "sine",
      filterFrequency: 2400
    });
  });
  noise(context, start + 0.34, 0.12, 0.055, 3200, "highpass");
}

function startGame(context: AudioContext, start: number): void {
  tone(context, {
    frequency: 146,
    endFrequency: 196,
    start,
    duration: 0.28,
    gain: 0.12,
    wave: "triangle",
    filterFrequency: 900
  });
  tone(context, {
    frequency: 392,
    endFrequency: 523,
    start: start + 0.08,
    duration: 0.2,
    gain: 0.08,
    wave: "sine",
    filterFrequency: 2600
  });
  noise(context, start + 0.18, 0.08, 0.045, 2800, "highpass");
}

function diceRoll(context: AudioContext, start: number): void {
  for (let index = 0; index < 5; index += 1) {
    const offset = index * 0.045;
    noise(context, start + offset, 0.035, 0.035, 900 + index * 260, "bandpass");
    tone(context, {
      frequency: 150 + index * 34,
      start: start + offset,
      duration: 0.04,
      gain: 0.045,
      wave: "square",
      filterFrequency: 1200
    });
  }
  tone(context, {
    frequency: 330,
    start: start + 0.24,
    duration: 0.09,
    gain: 0.07,
    wave: "triangle",
    filterFrequency: 1800
  });
}

function countdownTick(context: AudioContext, start: number): void {
  tone(context, {
    frequency: 860,
    start,
    duration: 0.075,
    gain: 0.06,
    wave: "sine",
    filterFrequency: 2200
  });
}

function deadlineTone(context: AudioContext, start: number): void {
  tone(context, {
    frequency: 860,
    endFrequency: 620,
    start,
    duration: 0.55,
    gain: 0.075,
    wave: "sine",
    filterFrequency: 1800,
    attack: 0.01
  });
}

function penaltyCue(context: AudioContext, start: number): void {
  tone(context, {
    frequency: 180,
    endFrequency: 120,
    start,
    duration: 0.18,
    gain: 0.12,
    wave: "sawtooth",
    filterFrequency: 900
  });
  noise(context, start + 0.04, 0.13, 0.05, 1400, "bandpass");
}

function releaseCue(context: AudioContext, start: number): void {
  tone(context, {
    frequency: 330,
    endFrequency: 660,
    start,
    duration: 0.18,
    gain: 0.1,
    wave: "triangle",
    filterFrequency: 2200
  });
  tone(context, {
    frequency: 880,
    start: start + 0.1,
    duration: 0.09,
    gain: 0.05,
    wave: "sine",
    filterFrequency: 3200
  });
}

function smallClick(context: AudioContext, start: number): void {
  tone(context, {
    frequency: 560,
    start,
    duration: 0.045,
    gain: 0.045,
    wave: "triangle",
    filterFrequency: 1800
  });
}

function tone(context: AudioContext, options: ToneOptions): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const filter = context.createBiquadFilter();
  const attack = options.attack ?? 0.012;
  const startGain = 0.0001;
  const end = options.start + options.duration;

  oscillator.type = options.wave ?? "sine";
  oscillator.frequency.setValueAtTime(options.frequency, options.start);
  if (options.endFrequency) {
    oscillator.frequency.exponentialRampToValueAtTime(options.endFrequency, end);
  }

  filter.type = options.filterType ?? "lowpass";
  filter.frequency.setValueAtTime(options.filterFrequency ?? 1600, options.start);

  gain.gain.setValueAtTime(startGain, options.start);
  gain.gain.exponentialRampToValueAtTime(options.gain, options.start + attack);
  gain.gain.exponentialRampToValueAtTime(startGain, end);

  oscillator.connect(filter);
  filter.connect(gain);
  gain.connect(context.destination);
  oscillator.start(options.start);
  oscillator.stop(end + 0.03);
}

function noise(
  context: AudioContext,
  start: number,
  duration: number,
  gainValue: number,
  filterFrequency: number,
  filterType: BiquadFilterType
): void {
  const sampleCount = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, sampleCount, context.sampleRate);
  const data = buffer.getChannelData(0);

  for (let index = 0; index < sampleCount; index += 1) {
    data[index] = (Math.random() * 2 - 1) * (1 - index / sampleCount);
  }

  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();

  source.buffer = buffer;
  filter.type = filterType;
  filter.frequency.setValueAtTime(filterFrequency, start);
  gain.gain.setValueAtTime(gainValue, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(context.destination);
  source.start(start);
  source.stop(start + duration);
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
