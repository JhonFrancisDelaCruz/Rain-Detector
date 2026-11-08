import { Platform, Vibration } from 'react-native';

class AlarmService {
  private ringing: boolean = false;
  private audioCtx: any = null;
  private ringInterval: any = null;

  public startRinging() {
    if (this.ringing) return;
    this.ringing = true;

    // 1. Phone Vibration pattern (ring 1000ms, pause 500ms, repeat)
    try {
      if (Platform.OS !== 'web') {
        Vibration.vibrate([0, 1000, 500, 1000, 500], true);
      }
    } catch {
      // vibration not supported on device
    }

    // 2. Audio Ringing Tone (Classic telephone bell / alert siren)
    try {
      if (typeof window !== 'undefined') {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          if (!this.audioCtx) {
            this.audioCtx = new AudioContextClass();
          }
          if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
          }
          this.playRingToneCycle();
          this.ringInterval = setInterval(() => {
            if (this.ringing) {
              this.playRingToneCycle();
            }
          }, 3000);
        }
      }
    } catch {
      // audio context not available
    }
  }

  private playRingToneCycle() {
    if (!this.audioCtx || !this.ringing) return;

    try {
      // Traditional dual-tone telephone ring (440Hz + 480Hz)
      const now = this.audioCtx.currentTime;

      // Pulse 1: 0.0s to 0.8s
      this.playDualBeep(now, 0.8);
      // Pulse 2: 1.2s to 2.0s
      this.playDualBeep(now + 1.2, 0.8);
    } catch {
      // audio error
    }
  }

  private playDualBeep(startTime: number, duration: number) {
    if (!this.audioCtx) return;

    const osc1 = this.audioCtx.createOscillator();
    const osc2 = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(440, startTime); // 440 Hz

    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(480, startTime); // 480 Hz

    // Volume envelope
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(0.35, startTime + 0.05);
    gain.gain.setValueAtTime(0.35, startTime + duration - 0.05);
    gain.gain.linearRampToValueAtTime(0, startTime + duration);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.audioCtx.destination);

    osc1.start(startTime);
    osc2.start(startTime);
    osc1.stop(startTime + duration);
    osc2.stop(startTime + duration);
  }

  public stopRinging() {
    this.ringing = false;

    // Stop vibration
    try {
      Vibration.cancel();
    } catch {}

    // Stop audio
    if (this.ringInterval) {
      clearInterval(this.ringInterval);
      this.ringInterval = null;
    }
  }

  public isRinging(): boolean {
    return this.ringing;
  }
}

export const alarmService = new AlarmService();
