/**
 * SoundSystem - Lightweight audio manager for game sounds
 *
 * Uses Web Audio API for efficient playback with procedural sound generation.
 * Singleton pattern - access via SoundSystem.getInstance()
 *
 * Usage:
 *   SoundSystem.getInstance().playLaserFire();
 *   SoundSystem.getInstance().playImpact();
 */

import { Howl } from 'howler';

export interface SoundSettings {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  enabled: boolean;
}

export class SoundSystem {
  private static instance: SoundSystem;
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;

  private settings: SoundSettings = {
    masterVolume: 0.5,
    musicVolume: 0.3,
    sfxVolume: 0.7,
    enabled: true
  };

  // Music state — Howler handles its own AudioContext independently from the SFX chain
  private musicHowl: Howl | null = null;
  private musicPlaying = false;

  // Beam sound throttle — prevent a new buffer from being created every frame (~60 fps)
  private lastBeamFireSoundAt = 0;
  private lastBeamHitSoundAt = 0;
  private static readonly BEAM_FIRE_SOUND_INTERVAL_MS = 50;
  private static readonly BEAM_HIT_SOUND_INTERVAL_MS = 55;

  private constructor() {
    // Audio context created on first user interaction
  }

  public static getInstance(): SoundSystem {
    if (!SoundSystem.instance) {
      SoundSystem.instance = new SoundSystem();
    }
    return SoundSystem.instance;
  }

  /**
   * Initialize audio context - must be called after user interaction
   */
  public init(): void {
    if (this.audioContext) return;

    try {
      this.audioContext = new AudioContext();

      // Create gain nodes for volume control
      this.masterGain = this.audioContext.createGain();
      this.masterGain.connect(this.audioContext.destination);
      this.masterGain.gain.value = this.settings.masterVolume;

      this.musicGain = this.audioContext.createGain();
      this.musicGain.connect(this.masterGain);
      this.musicGain.gain.value = this.settings.musicVolume;

      this.sfxGain = this.audioContext.createGain();
      this.sfxGain.connect(this.masterGain);
      this.sfxGain.gain.value = this.settings.sfxVolume;

      console.log('🔊 SoundSystem initialized, context state:', this.audioContext.state);
    } catch (e) {
      console.warn('SoundSystem: Failed to initialize audio context', e);
    }
  }

  /**
   * Resume audio context if suspended (browser autoplay policy)
   */
  public resume(): void {
    if (this.audioContext?.state === 'suspended') {
      this.audioContext.resume().then(() => {
        console.log('🔊 SoundSystem: SFX AudioContext resumed');
      });
    }
  }

  // ============ Volume Controls ============

  public setMasterVolume(volume: number): void {
    this.settings.masterVolume = Math.max(0, Math.min(1, volume));
    if (this.masterGain) {
      this.masterGain.gain.value = this.settings.masterVolume;
    }
    // Howler bypasses the Web Audio gain chain, so sync its volume manually
    this.musicHowl?.volume(this.settings.musicVolume * this.settings.masterVolume);
  }

  public setMusicVolume(volume: number): void {
    this.settings.musicVolume = Math.max(0, Math.min(1, volume));
    if (this.musicGain) {
      this.musicGain.gain.value = this.settings.musicVolume;
    }
    this.musicHowl?.volume(this.settings.musicVolume * this.settings.masterVolume);
  }

  public setSfxVolume(volume: number): void {
    this.settings.sfxVolume = Math.max(0, Math.min(1, volume));
    if (this.sfxGain) {
      this.sfxGain.gain.value = this.settings.sfxVolume;
    }
  }

  public setEnabled(enabled: boolean): void {
    this.settings.enabled = enabled;
    if (!enabled) {
      this.stopMusic();
    }
  }

  public getSettings(): SoundSettings {
    return { ...this.settings };
  }

  // ============ Music ============

  public startMusic(): void {
    if (!this.settings.enabled) return;
    if (this.musicPlaying) return;
    this.actuallyStartMusic();
  }

  private actuallyStartMusic(): void {
    this.musicHowl = new Howl({
      src: ['/music/background.mp3', '/music/background.ogg'],
      loop: true,
      html5: true, // Use HTML5 Audio element — avoids Web Audio decodeAudioData codec restrictions
      volume: this.settings.musicVolume * this.settings.masterVolume,
      onload: () => {
        console.log('🎵 SoundSystem: background music file loaded');
      },
      onloaderror: (_id, err) => {
        console.warn(
          '🎵 SoundSystem: failed to load music file.',
          'Place your track at public/music/background.ogg (or .mp3).',
          err
        );
        this.musicPlaying = false;
        this.musicHowl = null;
      },
      onplay: () => {
        console.log('🎵 SoundSystem: background music playing, volume:',
          (this.settings.musicVolume * this.settings.masterVolume).toFixed(2));
      },
    });
    this.musicHowl.play();
    this.musicPlaying = true;
  }

  public stopMusic(): void {
    if (this.musicHowl) {
      this.musicHowl.stop();
      this.musicHowl.unload();
      this.musicHowl = null;
    }
    this.musicPlaying = false;
  }

  // ============ Sound Effects ============

  public playLaserFire(): void {
    if (!this.canPlaySound()) return;
    this.playProceduralLaser();
  }

  public playLaserImpact(): void {
    if (!this.canPlaySound()) return;
    this.playProceduralImpact();
  }

  public playBlockDestroyed(): void {
    if (!this.canPlaySound()) return;
    this.playProceduralDestruction(0.3);
  }

  public playShipBreakApart(): void {
    if (!this.canPlaySound()) return;
    this.playProceduralDestruction(0.6);
  }

  public playMissileLaunch(): void {
    if (!this.canPlaySound()) return;
    this.playProceduralMissileLaunch();
  }

  public playMissileExplosion(): void {
    if (!this.canPlaySound()) return;
    this.playProceduralExplosion();
  }

  /** Sustained beam-firing hum — throttled so it plays at most every BEAM_FIRE_SOUND_INTERVAL_MS. */
  public playBeamFire(): void {
    if (!this.canPlaySound()) return;
    const now = Date.now();
    if (now - this.lastBeamFireSoundAt < SoundSystem.BEAM_FIRE_SOUND_INTERVAL_MS) return;
    this.lastBeamFireSoundAt = now;
    this.playProceduralBeamFire();
  }

  /** Sizzle/crackle sound when a beam is actively hitting a target — throttled. */
  public playBeamHit(): void {
    if (!this.canPlaySound()) return;
    const now = Date.now();
    if (now - this.lastBeamHitSoundAt < SoundSystem.BEAM_HIT_SOUND_INTERVAL_MS) return;
    this.lastBeamHitSoundAt = now;
    this.playProceduralBeamHit();
  }

  // ============ Helper Methods ============

  private canPlaySound(): boolean {
    if (!this.settings.enabled) {
      console.warn('🔇 SoundSystem: canPlaySound=false (disabled)');
      return false;
    }
    if (!this.audioContext) {
      console.warn('🔇 SoundSystem: canPlaySound=false (no AudioContext — init() not called yet?)');
      return false;
    }
    if (this.audioContext.state !== 'running') {
      console.warn(`🔇 SoundSystem: canPlaySound=false (AudioContext state="${this.audioContext.state}" — waiting for user interaction?)`);
      return false;
    }
    if (!this.sfxGain) {
      console.warn('🔇 SoundSystem: canPlaySound=false (sfxGain is null)');
      return false;
    }
    return true;
  }

  // ============ Procedural Sound Generation ============

  private playProceduralLaser(): void {
    if (!this.audioContext || !this.sfxGain) return;

    const duration = 0.1;
    const ctx = this.audioContext;
    const now = ctx.currentTime;

    // Create oscillator for laser "pew" sound
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + duration);

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + duration);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(now);
    osc.stop(now + duration);
  }

  private playProceduralImpact(): void {
    if (!this.audioContext || !this.sfxGain) return;

    const duration = 0.12;
    const ctx = this.audioContext;
    const now = ctx.currentTime;

    // Use oscillator for reliable playback - low thump sound
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + duration);

    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + duration);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(now);
    osc.stop(now + duration);

    // Add a click/snap overlay
    const click = ctx.createOscillator();
    const clickGain = ctx.createGain();
    click.type = 'square';
    click.frequency.setValueAtTime(400, now);
    click.frequency.exponentialRampToValueAtTime(100, now + 0.05);
    clickGain.gain.setValueAtTime(0.15, now);
    clickGain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
    click.connect(clickGain);
    clickGain.connect(this.sfxGain);
    click.start(now);
    click.stop(now + 0.05);
  }

  private playProceduralDestruction(intensity: number): void {
    if (!this.audioContext || !this.sfxGain) return;

    const duration = 0.25 + intensity * 0.3;
    const ctx = this.audioContext;
    const now = ctx.currentTime;

    // Low rumble oscillator - main explosion sound
    const rumble = ctx.createOscillator();
    const rumbleGain = ctx.createGain();
    rumble.type = 'sine';
    rumble.frequency.setValueAtTime(80, now);
    rumble.frequency.exponentialRampToValueAtTime(25, now + duration);
    rumbleGain.gain.setValueAtTime(0.5 * intensity, now);
    rumbleGain.gain.exponentialRampToValueAtTime(0.01, now + duration);

    rumble.connect(rumbleGain);
    rumbleGain.connect(this.sfxGain);
    rumble.start(now);
    rumble.stop(now + duration);

    // Crunch/crackle layer
    const crunch = ctx.createOscillator();
    const crunchGain = ctx.createGain();
    crunch.type = 'sawtooth';
    crunch.frequency.setValueAtTime(200 * intensity, now);
    crunch.frequency.exponentialRampToValueAtTime(50, now + duration * 0.5);
    crunchGain.gain.setValueAtTime(0.2 * intensity, now);
    crunchGain.gain.exponentialRampToValueAtTime(0.01, now + duration * 0.5);

    crunch.connect(crunchGain);
    crunchGain.connect(this.sfxGain);
    crunch.start(now);
    crunch.stop(now + duration * 0.5);

    // High frequency snap
    const snap = ctx.createOscillator();
    const snapGain = ctx.createGain();
    snap.type = 'square';
    snap.frequency.setValueAtTime(600, now);
    snap.frequency.exponentialRampToValueAtTime(100, now + 0.08);
    snapGain.gain.setValueAtTime(0.15 * intensity, now);
    snapGain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);

    snap.connect(snapGain);
    snapGain.connect(this.sfxGain);
    snap.start(now);
    snap.stop(now + 0.08);
  }

  private playProceduralMissileLaunch(): void {
    if (!this.audioContext || !this.sfxGain) return;

    const duration = 0.4;
    const ctx = this.audioContext;
    const now = ctx.currentTime;

    // Whoosh sound with rising pitch
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(100, now);
    osc.frequency.exponentialRampToValueAtTime(400, now + duration * 0.3);
    osc.frequency.exponentialRampToValueAtTime(200, now + duration);

    gain.gain.setValueAtTime(0.1, now);
    gain.gain.linearRampToValueAtTime(0.2, now + duration * 0.1);
    gain.gain.exponentialRampToValueAtTime(0.01, now + duration);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 300;
    filter.Q.value = 2;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(now);
    osc.stop(now + duration);
  }

  private playProceduralExplosion(): void {
    if (!this.audioContext || !this.sfxGain) return;

    const duration = 0.5;
    const ctx = this.audioContext;
    const now = ctx.currentTime;

    // Deep bass boom
    const boom = ctx.createOscillator();
    const boomGain = ctx.createGain();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(100, now);
    boom.frequency.exponentialRampToValueAtTime(20, now + duration);
    boomGain.gain.setValueAtTime(0.6, now);
    boomGain.gain.exponentialRampToValueAtTime(0.01, now + duration);

    boom.connect(boomGain);
    boomGain.connect(this.sfxGain);
    boom.start(now);
    boom.stop(now + duration);

    // Mid-range crackle
    const crackle = ctx.createOscillator();
    const crackleGain = ctx.createGain();
    crackle.type = 'sawtooth';
    crackle.frequency.setValueAtTime(300, now);
    crackle.frequency.exponentialRampToValueAtTime(60, now + duration * 0.6);
    crackleGain.gain.setValueAtTime(0.3, now);
    crackleGain.gain.exponentialRampToValueAtTime(0.01, now + duration * 0.6);

    crackle.connect(crackleGain);
    crackleGain.connect(this.sfxGain);
    crackle.start(now);
    crackle.stop(now + duration * 0.6);

    // Initial sharp attack
    const attack = ctx.createOscillator();
    const attackGain = ctx.createGain();
    attack.type = 'square';
    attack.frequency.setValueAtTime(800, now);
    attack.frequency.exponentialRampToValueAtTime(150, now + 0.1);
    attackGain.gain.setValueAtTime(0.25, now);
    attackGain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);

    attack.connect(attackGain);
    attackGain.connect(this.sfxGain);
    attack.start(now);
    attack.stop(now + 0.1);
  }

  /**
   * Sustained high-frequency sine tone — sounds like a continuous sci-fi laser beam.
   * Duration is slightly longer than the throttle interval so successive calls overlap
   * and blend into a smooth hum rather than a staccato pulse.
   */
  private playProceduralBeamFire(): void {
    if (!this.audioContext || !this.sfxGain) return;

    const DURATION = 0.075; // s — slightly longer than the 50 ms throttle interval
    const ctx = this.audioContext;
    const now = ctx.currentTime;

    // Carrier: high-pitched sine, slight downward pitch drift to give it texture
    const carrier = ctx.createOscillator();
    const carrierGain = ctx.createGain();
    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(2400, now);
    carrier.frequency.linearRampToValueAtTime(2200, now + DURATION);

    // Soft envelope — fast attack, smooth release so overlapping instances blend
    carrierGain.gain.setValueAtTime(0, now);
    carrierGain.gain.linearRampToValueAtTime(0.09, now + 0.005);
    carrierGain.gain.setValueAtTime(0.09, now + DURATION - 0.012);
    carrierGain.gain.linearRampToValueAtTime(0, now + DURATION);

    // Thin harmonic layer at 3× frequency to add brightness without bulk
    const harmonic = ctx.createOscillator();
    const harmonicGain = ctx.createGain();
    harmonic.type = 'sine';
    harmonic.frequency.setValueAtTime(7200, now);
    harmonicGain.gain.setValueAtTime(0.025, now);
    harmonicGain.gain.linearRampToValueAtTime(0, now + DURATION);

    carrier.connect(carrierGain);
    carrierGain.connect(this.sfxGain);
    carrier.start(now);
    carrier.stop(now + DURATION);

    harmonic.connect(harmonicGain);
    harmonicGain.connect(this.sfxGain);
    harmonic.start(now);
    harmonic.stop(now + DURATION);
  }

  /**
   * Sizzle/crackle burst — played on top of the beam-fire hum when the beam is
   * actively cutting through a target.  White noise through a high bandpass filter
   * gives it a burning/scorching character distinct from the base beam tone.
   */
  private playProceduralBeamHit(): void {
    if (!this.audioContext || !this.sfxGain) return;

    const DURATION = 0.065;
    const ctx = this.audioContext;
    const now = ctx.currentTime;

    // White-noise sizzle through a high-frequency bandpass
    const bufferSize = Math.floor(ctx.sampleRate * DURATION);
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 4500;
    noiseFilter.Q.value = 2.5;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.18, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, now + DURATION);

    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.sfxGain);
    noiseSource.start(now);
    noiseSource.stop(now + DURATION);

    // Short sawtooth overtone — rises in pitch like material being cut
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1400, now);
    osc.frequency.exponentialRampToValueAtTime(3000, now + DURATION * 0.35);
    osc.frequency.exponentialRampToValueAtTime(1000, now + DURATION);
    oscGain.gain.setValueAtTime(0.055, now);
    oscGain.gain.exponentialRampToValueAtTime(0.01, now + DURATION);

    osc.connect(oscGain);
    oscGain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + DURATION);
  }

  /**
   * Cleanup - call when game is destroyed
   */
  public dispose(): void {
    this.stopMusic();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.masterGain = null;
    this.musicGain = null;
    this.sfxGain = null;
  }
}
