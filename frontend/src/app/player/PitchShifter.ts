export class PitchShifter {
  ctx: AudioContext;
  input: GainNode;
  output: GainNode;
  
  private delay1: DelayNode;
  private delay2: DelayNode;
  private fade1: GainNode;
  private fade2: GainNode;
  private mod1: AudioBufferSourceNode | null = null;
  private mod2: AudioBufferSourceNode | null = null;
  private mod1Gain: GainNode;
  private mod2Gain: GainNode;
  private fade1Source: AudioBufferSourceNode | null = null;
  private fade2Source: AudioBufferSourceNode | null = null;
  
  private fadeTime: number = 0.025;
  private bufferTime: number = 0.050;
  
  private pitchRatio: number = 1.0;
  
  constructor(context: AudioContext) {
    this.ctx = context;
    this.input = context.createGain();
    this.output = context.createGain();
    
    this.mod1Gain = context.createGain();
    this.mod2Gain = context.createGain();
    
    this.delay1 = context.createDelay(1);
    this.delay2 = context.createDelay(1);
    
    this.fade1 = context.createGain();
    this.fade2 = context.createGain();
    
    // Fix default gains
    this.fade1.gain.value = 0;
    this.fade2.gain.value = 0;
    this.mod1Gain.gain.value = 1;
    this.mod2Gain.gain.value = 1;
    
    this.input.connect(this.delay1);
    this.input.connect(this.delay2);
    
    this.delay1.connect(this.fade1);
    this.delay2.connect(this.fade2);
    
    this.fade1.connect(this.output);
    this.fade2.connect(this.output);
    
    this.mod1Gain.connect(this.delay1.delayTime);
    this.mod2Gain.connect(this.delay2.delayTime);
    
    this.setPitchOffset(0); // Initialize bypassing
  }
  
  public setPitchOffset(semitones: number) {
    if (semitones === 0) {
      this.pitchRatio = 1.0;
      this.input.disconnect();
      this.input.connect(this.output);
      this.stop();
      return;
    }
    
    // Re-route if it was bypassed
    this.input.disconnect();
    this.input.connect(this.delay1);
    this.input.connect(this.delay2);
    
    this.pitchRatio = Math.pow(2, semitones / 12);
    this.stop();
    this.play();
  }
  
  private stop() {
    if (this.mod1) { this.mod1.stop(); this.mod1.disconnect(); this.mod1 = null; }
    if (this.mod2) { this.mod2.stop(); this.mod2.disconnect(); this.mod2 = null; }
    if (this.fade1Source) { this.fade1Source.stop(); this.fade1Source.disconnect(); this.fade1Source = null; }
    if (this.fade2Source) { this.fade2Source.stop(); this.fade2Source.disconnect(); this.fade2Source = null; }
  }
  
  private play() {
    const shiftUp = this.pitchRatio > 1;
    const timeRatio = shiftUp ? (1 - 1 / this.pitchRatio) : (1 / this.pitchRatio - 1);
    const activeTime = this.bufferTime / timeRatio;
    
    // If activeTime is too small or invalid, gracefully fallback
    if (activeTime <= this.fadeTime * 2 || !isFinite(activeTime)) return;
    
    const fadeBuffer = this.createFadeBuffer(activeTime, this.fadeTime);
    const delayBuffer = this.createDelayTimeBuffer(activeTime, this.fadeTime, shiftUp);
    
    const t = this.ctx.currentTime + 0.050; // slight start delay
    
    this.mod1 = this.ctx.createBufferSource();
    this.mod2 = this.ctx.createBufferSource();
    this.mod1.buffer = delayBuffer;
    this.mod2.buffer = delayBuffer;
    this.mod1.loop = true;
    this.mod2.loop = true;
    this.mod1.connect(this.mod1Gain);
    this.mod2.connect(this.mod2Gain);
    
    this.fade1Source = this.ctx.createBufferSource();
    this.fade2Source = this.ctx.createBufferSource();
    this.fade1Source.buffer = fadeBuffer;
    this.fade2Source.buffer = fadeBuffer;
    this.fade1Source.loop = true;
    this.fade2Source.loop = true;
    this.fade1Source.connect(this.fade1.gain);
    this.fade2Source.connect(this.fade2.gain);
    
    const length1 = Math.floor(activeTime * this.ctx.sampleRate);
    const length2 = Math.floor((activeTime - 2 * this.fadeTime) * this.ctx.sampleRate);
    const halfCycle = (length1 + length2) / (2 * this.ctx.sampleRate);
    
    this.mod1.start(t);
    this.fade1Source.start(t);
    
    this.mod2.start(t + halfCycle, halfCycle);
    this.fade2Source.start(t + halfCycle, halfCycle);
  }
  
  private createFadeBuffer(activeTime: number, fadeTime: number) {
    const length1 = Math.floor(activeTime * this.ctx.sampleRate);
    const length2 = Math.floor((activeTime - 2 * fadeTime) * this.ctx.sampleRate);
    const length = length1 + length2;
    if (length <= 0) return this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const p = buffer.getChannelData(0);
    
    const fadeLength = Math.floor(fadeTime * this.ctx.sampleRate);
    
    for (let i = 0; i < length1; ++i) {
      if (i < fadeLength) p[i] = Math.sqrt(i / fadeLength);
      else if (i >= length1 - fadeLength) p[i] = Math.sqrt(1 - (i - (length1 - fadeLength)) / fadeLength);
      else p[i] = 1;
    }
    for (let i = length1; i < length; ++i) p[i] = 0;
    return buffer;
  }
  
  private createDelayTimeBuffer(activeTime: number, fadeTime: number, shiftUp: boolean) {
    const length1 = Math.floor(activeTime * this.ctx.sampleRate);
    const length2 = Math.floor((activeTime - 2 * fadeTime) * this.ctx.sampleRate);
    const length = length1 + length2;
    if (length <= 0) return this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const p = buffer.getChannelData(0);
    
    for (let i = 0; i < length1; ++i) {
      p[i] = shiftUp ? (length1 - i) / length1 : i / length1;
      p[i] *= this.bufferTime; // Scale to buffer time
    }
    for (let i = length1; i < length; ++i) p[i] = 0;
    return buffer;
  }
}
