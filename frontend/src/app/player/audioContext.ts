export const globalAudioState = {
  ctx: null as AudioContext | null,
  analyser: null as AnalyserNode | null
};

export function getSharedAudioContext() {
  if (typeof window === 'undefined') return globalAudioState;
  
  if (!globalAudioState.ctx) {
    globalAudioState.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    globalAudioState.analyser = globalAudioState.ctx.createAnalyser();
    globalAudioState.analyser.fftSize = 64; // Small bin count for smooth level meter
    globalAudioState.analyser.smoothingTimeConstant = 0.8;
  }
  
  return globalAudioState;
}
