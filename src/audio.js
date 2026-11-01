export class AudioBus {
  constructor(enabled = true) {
    this.enabled = enabled;
    this.context = null;
  }

  unlock() {
    if (!this.enabled) return;
    if (!this.context) this.context = new (window.AudioContext || window.webkitAudioContext)();
    if (this.context.state === 'suspended') this.context.resume();
  }

  tone(frequency, duration = 0.08, type = 'square', volume = 0.035, slide = 0) {
    if (!this.enabled) return;
    this.unlock();
    if (!this.context) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.linearRampToValueAtTime(Math.max(30, frequency + slide), now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  event(type) {
    if (type === 'attack') this.tone(145, 0.07, 'square', 0.022, -45);
    if (type === 'blast') this.tone(80, 0.18, 'sawtooth', 0.04, -35);
    if (type === 'repair') this.tone(510, 0.16, 'sine', 0.035, 190);
    if (type === 'disabled') this.tone(180, 0.35, 'sawtooth', 0.045, -130);
    if (type === 'order') this.tone(350, 0.09, 'square', 0.03, 120);
    if (type === 'victory') [0, 100, 210].forEach((delay, index) => setTimeout(() => this.tone([330, 440, 660][index], 0.22, 'triangle', 0.05), delay));
  }
}
