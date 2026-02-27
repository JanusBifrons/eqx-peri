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

  // Music state
  private musicSource: AudioBufferSourceNode | null = null;
  private musicPlaying: boolean = false;
  private musicPending: boolean = false; // Track if music should start when context resumes

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
        console.log('🔊 Audio context resumed');
        // Start music if it was pending
        if (this.musicPending && !this.musicPlaying) {
          this.actuallyStartMusic();
        }
      });
    }
  }

  // ============ Volume Controls ============

  public setMasterVolume(volume: number): void {
    this.settings.masterVolume = Math.max(0, Math.min(1, volume));
    if (this.masterGain) {
      this.masterGain.gain.value = this.settings.masterVolume;
    }
  }

  public setMusicVolume(volume: number): void {
    this.settings.musicVolume = Math.max(0, Math.min(1, volume));
    if (this.musicGain) {
      this.musicGain.gain.value = this.settings.musicVolume;
    }
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

    this.musicPending = true;

    // If context is running, start immediately
    if (this.audioContext?.state === 'running') {
      this.actuallyStartMusic();
    }
    // Otherwise, music will start when resume() is called
  }

  private actuallyStartMusic(): void {
    if (!this.audioContext || !this.musicGain) return;
    if (this.musicPlaying) return;

    // Use oscillators for ambient drone instead of buffer (more reliable)
    const ctx = this.audioContext;

    // Create drone oscillators
    const drone1 = ctx.createOscillator();
    const drone1Gain = ctx.createGain();
    drone1.type = 'sine';
    drone1.frequency.value = 55; // Low A
    drone1Gain.gain.value = 0.15;
    drone1.connect(drone1Gain);
    drone1Gain.connect(this.musicGain);
    drone1.start();

    const drone2 = ctx.createOscillator();
    const drone2Gain = ctx.createGain();
    drone2.type = 'sine';
    drone2.frequency.value = 82.5; // Low E
    drone2Gain.gain.value = 0.1;
    drone2.connect(drone2Gain);
    drone2Gain.connect(this.musicGain);
    drone2.start();

    const drone3 = ctx.createOscillator();
    const drone3Gain = ctx.createGain();
    drone3.type = 'triangle';
    drone3.frequency.value = 110; // A2
    drone3Gain.gain.value = 0.05;
    drone3.connect(drone3Gain);
    drone3Gain.connect(this.musicGain);
    drone3.start();

    // Store references for stopping later
    (this as any).musicOscillators = [drone1, drone2, drone3];

    this.musicPlaying = true;
    console.log('🎵 Music started (oscillator-based drone)');
  }

  public stopMusic(): void {
    this.musicPending = false;

    // Stop oscillator-based music
    const oscillators = (this as any).musicOscillators as OscillatorNode[] | undefined;
    if (oscillators) {
      oscillators.forEach(osc => {
        try {
          osc.stop();
        } catch {
          // Ignore if already stopped
        }
      });
      (this as any).musicOscillators = null;
    }

    // Stop buffer-based music (legacy)
    if (this.musicSource) {
      try {
        this.musicSource.stop();
      } catch {
        // Ignore if already stopped
      }
      this.musicSource = null;
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

  // ============ Helper Methods ============

  private canPlaySound(): boolean {
    return this.settings.enabled &&
           this.audioContext !== null &&
           this.audioContext.state === 'running' &&
           this.sfxGain !== null;
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
