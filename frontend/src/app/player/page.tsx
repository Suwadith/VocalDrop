"use client";

import { useEffect, useState, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Play, Pause, Mic2, Loader2, ArrowLeft, Languages, Home, Rewind, FastForward, Circle, Video, Mic, StopCircle, Music2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { PitchShifter } from './PitchShifter';
import { getNoSleep } from '@/utils/noSleep';
import styles from './player.module.css';

class ChunkPlayer {
  ctx: AudioContext;
  masterGain: GainNode;
  vocGain: GainNode;
  instGain: GainNode;
  pitchShifter: PitchShifter;
  
  buffers = new Map<number, {inst: AudioBuffer, voc: AudioBuffer, start: number, end: number}>();
  scheduledSources: {inst: AudioBufferSourceNode, voc: AudioBufferSourceNode, idx: number, instGain: GainNode, vocGain: GainNode}[] = [];
  
  startTime: number = 0; 
  pauseTime: number = 0;
  isPlaying: boolean = false;
  isBuffering: boolean = false;
  
  constructor() {
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.vocGain = this.ctx.createGain();
    this.instGain = this.ctx.createGain();
    this.pitchShifter = new PitchShifter(this.ctx);
    
    this.instGain.connect(this.pitchShifter.input);
    this.vocGain.connect(this.pitchShifter.input);
    
    this.pitchShifter.output.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);
  }

  async loadChunk(chunk: any) {
    if (this.buffers.has(chunk.index)) return;
    try {
      const [instRes, vocRes] = await Promise.all([
        fetch(`${chunk.instrumentalUrl}`).then(r => r.arrayBuffer()),
        fetch(`${chunk.vocalsUrl}`).then(r => r.arrayBuffer())
      ]);
      const instBuf = await this.ctx.decodeAudioData(instRes);
      const vocBuf = await this.ctx.decodeAudioData(vocRes);
      this.buffers.set(chunk.index, { 
        inst: instBuf, 
        voc: vocBuf, 
        start: chunk.start, 
        end: chunk.end 
      });
    } catch (e) {
      console.error("Failed to load chunk", e);
    }
  }

  setVocalsMuted(muted: boolean) {
    const now = this.ctx.currentTime;
    this.vocGain.gain.cancelScheduledValues(now);
    this.vocGain.gain.setValueAtTime(this.vocGain.gain.value, now);
    this.vocGain.gain.linearRampToValueAtTime(muted ? 0.0 : 1.0, now + 0.5);
  }

  setPitchOffset(semitones: number) {
    this.pitchShifter.setPitchOffset(semitones);
  }

  getCurrentTime(): number {
    if (this.isPlaying) {
      return this.pauseTime + (this.ctx.currentTime - this.startTime);
    }
    return this.pauseTime;
  }

  play() {
    if (this.isPlaying) return;
    this.ctx.resume();
    
    this.startTime = this.ctx.currentTime;
    this.isPlaying = true;
    
    this.scheduleFrom(this.pauseTime);
  }

  pause() {
    if (!this.isPlaying) return;
    this.pauseTime += (this.ctx.currentTime - this.startTime);
    this.isPlaying = false;
    
    this.scheduledSources.forEach(s => {
      try { s.inst.stop(); s.voc.stop(); } catch(e){}
    });
    this.scheduledSources = [];
  }

  seek(time: number) {
    const wasPlaying = this.isPlaying;
    if (wasPlaying) this.pause();
    this.pauseTime = time;
    if (wasPlaying) this.play();
  }

  checkBuffering(): boolean {
    if (!this.isPlaying) return false;
    
    const time = this.getCurrentTime();
    let hasCoverage = false;
    
    for (const chunk of this.buffers.values()) {
      if (time >= chunk.start && time <= chunk.end - 0.1) {
        hasCoverage = true;
        break;
      }
    }
    
    if (!hasCoverage) {
      this.pause();
      this.isBuffering = true;
      return true;
    }
    return false;
  }

  scheduleFrom(timeOffset: number) {
    let now = this.ctx.currentTime;
    
    const sortedIdx = Array.from(this.buffers.keys()).sort((a,b) => a-b);
    
    for (let idx of sortedIdx) {
      const chunk = this.buffers.get(idx)!;
      if (chunk.end <= timeOffset) continue;
      
      const chunkOffset = Math.max(0, timeOffset - chunk.start);
      const playStart = now + Math.max(0, chunk.start - timeOffset);
      
      const instSrc = this.ctx.createBufferSource();
      const vocSrc = this.ctx.createBufferSource();
      
      instSrc.buffer = chunk.inst;
      vocSrc.buffer = chunk.voc;
      
      const instGain = this.ctx.createGain();
      const vocGain = this.ctx.createGain();
      
      instSrc.connect(instGain);
      vocSrc.connect(vocGain);
      
      instGain.connect(this.instGain);
      vocGain.connect(this.vocGain);
      
      const fadeDuration = 1.0;
      let initialGain = 1.0;
      
      if (idx > 0) {
        if (timeOffset < chunk.start) initialGain = 0.0;
        else if (timeOffset < chunk.start + fadeDuration) initialGain = (timeOffset - chunk.start) / fadeDuration;
        else initialGain = 1.0;
      }
      if (timeOffset >= chunk.end - fadeDuration) {
        if (timeOffset >= chunk.end) initialGain = 0.0;
        else initialGain = 1.0 - (timeOffset - (chunk.end - fadeDuration)) / fadeDuration;
      }
      
      instGain.gain.setValueAtTime(initialGain, now);
      vocGain.gain.setValueAtTime(initialGain, now);
      
      if (idx > 0 && chunk.start > timeOffset) {
        instGain.gain.setValueAtTime(0, now + (chunk.start - timeOffset));
        instGain.gain.linearRampToValueAtTime(1, now + (chunk.start + fadeDuration - timeOffset));
        vocGain.gain.setValueAtTime(0, now + (chunk.start - timeOffset));
        vocGain.gain.linearRampToValueAtTime(1, now + (chunk.start + fadeDuration - timeOffset));
      } else if (idx > 0 && timeOffset < chunk.start + fadeDuration) {
        instGain.gain.linearRampToValueAtTime(1, now + (chunk.start + fadeDuration - timeOffset));
        vocGain.gain.linearRampToValueAtTime(1, now + (chunk.start + fadeDuration - timeOffset));
      }
      
      if (timeOffset < chunk.end - fadeDuration) {
        instGain.gain.setValueAtTime(1, now + (chunk.end - fadeDuration - timeOffset));
        instGain.gain.linearRampToValueAtTime(0, now + (chunk.end - timeOffset));
        vocGain.gain.setValueAtTime(1, now + (chunk.end - fadeDuration - timeOffset));
        vocGain.gain.linearRampToValueAtTime(0, now + (chunk.end - timeOffset));
      } else if (timeOffset < chunk.end) {
        instGain.gain.linearRampToValueAtTime(0, now + (chunk.end - timeOffset));
        vocGain.gain.linearRampToValueAtTime(0, now + (chunk.end - timeOffset));
      }
      
      instSrc.start(playStart, chunkOffset);
      vocSrc.start(playStart, chunkOffset);
      
      this.scheduledSources.push({inst: instSrc, voc: vocSrc, idx, instGain, vocGain});
    }
  }
}

function PlayerContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const id = searchParams.get('id');
  const title = searchParams.get('title');
  const artist = searchParams.get('artist');
  const coverParam = searchParams.get('cover') || '';
  const mode = searchParams.get('mode') || 'karaoke';
  
  let cover = coverParam.includes('=w') ? coverParam.replace(/=w\d+-h\d+(?:-[a-zA-Z0-9\-]+)?/, '=s0') : coverParam;
  if (cover.includes('i.ytimg.com')) {
    cover = cover.split('?')[0];
  }

  useEffect(() => {
    return () => {
      if (id) {
        navigator.sendBeacon(`/api/cancel/${id}`);
      }
    };
  }, [id]);

  const [lyrics, setLyrics] = useState<{time: number, text: string}[]>([]);
  const [englishLyrics, setEnglishLyrics] = useState<{time: number, text: string}[]>([]);
  const [lyricsLang, setLyricsLang] = useState<'original' | 'english'>('original');
  const [currentLine, setCurrentLine] = useState(0);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const isUserScrolling = useRef(false);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasStartedPlaying, setHasStartedPlaying] = useState(false);
  
  useEffect(() => {
    if (isPlaying && !hasStartedPlaying) {
      setHasStartedPlaying(true);
    }
  }, [isPlaying, hasStartedPlaying]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  
  const [karaokeMode, setKaraokeMode] = useState(false);
  const [karaokeReady, setKaraokeReady] = useState(mode === 'listen');
  const [separationLoading, setSeparationLoading] = useState(mode === 'karaoke');

  const originalAudio = useRef<HTMLAudioElement | null>(null);
  const chunkPlayer = useRef<ChunkPlayer | null>(null);
  
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingMode, setRecordingMode] = useState<'audio' | 'video' | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);

  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioDevice, setSelectedAudioDevice] = useState<string>('');
  const [selectedVideoDevice, setSelectedVideoDevice] = useState<string>('');
  const [latencyMs, setLatencyMs] = useState<number>(80);
  const [videoLatencyMs, setVideoLatencyMs] = useState<number>(0);
  const [videoAspectRatio, setVideoAspectRatio] = useState<'portrait' | 'landscape' | 'portrait_43' | 'landscape_43' | 'auto'>('auto');
  const [reverbAmount, setReverbAmount] = useState<number>(0.05);
  const [micVolume, setMicVolume] = useState<number>(0.7);
  const [pitchOffset, setPitchOffset] = useState<number>(0);
  const [showPitchSlider, setShowPitchSlider] = useState(false);

  useEffect(() => {
    const savedMode = localStorage.getItem('vd_recording_mode');
    if (savedMode === 'audio' || savedMode === 'video') setRecordingMode(savedMode);
    
    const savedLatency = localStorage.getItem('vd_latency_ms');
    if (savedLatency) setLatencyMs(Number(savedLatency));
    
    const savedVideoLatency = localStorage.getItem('vd_video_latency_ms');
    if (savedVideoLatency) setVideoLatencyMs(Number(savedVideoLatency));
    
    const savedAspectRatio = localStorage.getItem('vd_video_aspect_ratio');
    if (savedAspectRatio === 'portrait' || savedAspectRatio === 'landscape' || savedAspectRatio === 'portrait_43' || savedAspectRatio === 'landscape_43' || savedAspectRatio === 'auto') {
      setVideoAspectRatio(savedAspectRatio as any);
    }
    
    const savedReverb = localStorage.getItem('vd_reverb_amount');
    if (savedReverb) setReverbAmount(Number(savedReverb));
    
    const savedVolume = localStorage.getItem('vd_mic_volume');
    if (savedVolume) setMicVolume(Number(savedVolume));
  }, []);

  useEffect(() => {
    if (showRecordModal) {
      const loadDevices = async () => {
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }).catch(() => null);
          if (audioStream) audioStream.getTracks().forEach(t => t.stop());

          const videoStream = await navigator.mediaDevices.getUserMedia({ video: true }).catch(() => null);
          if (videoStream) videoStream.getTracks().forEach(t => t.stop());

          const devices = await navigator.mediaDevices.enumerateDevices();
          const audio = devices.filter(d => d.kind === 'audioinput');
          const video = devices.filter(d => d.kind === 'videoinput');
          setAudioDevices(audio);
          setVideoDevices(video);
          const savedAudio = localStorage.getItem('vd_audio_device');
          const savedVideo = localStorage.getItem('vd_video_device');
          if (audio.length > 0) setSelectedAudioDevice(savedAudio && audio.find(d => d.deviceId === savedAudio) ? savedAudio : audio[0].deviceId);
          if (video.length > 0) setSelectedVideoDevice(savedVideo && video.find(d => d.deviceId === savedVideo) ? savedVideo : video[0].deviceId);
        } catch (err) {
          console.error("Device enumeration failed:", err);
        }
      };
      loadDevices();
    }
  }, [showRecordModal]);

  useEffect(() => {
    if (!showRecordModal || videoDevices.length === 0) {
      if (previewStreamRef.current) {
        previewStreamRef.current.getTracks().forEach(t => t.stop());
        previewStreamRef.current = null;
      }
      return;
    }

    let isCancelled = false;
    const startPreview = async () => {
      if (previewStreamRef.current) {
        previewStreamRef.current.getTracks().forEach(t => t.stop());
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            ...(videoAspectRatio === 'portrait' ? { width: { ideal: 480 }, height: { ideal: 853 }, aspectRatio: { ideal: 0.5625 } } : 
                videoAspectRatio === 'landscape' ? { width: { ideal: 853 }, height: { ideal: 480 }, aspectRatio: { ideal: 1.7777 } } : 
                videoAspectRatio === 'portrait_43' ? { width: { ideal: 640 }, height: { ideal: 853 }, aspectRatio: { ideal: 0.75 } } : 
                videoAspectRatio === 'landscape_43' ? { width: { ideal: 853 }, height: { ideal: 640 }, aspectRatio: { ideal: 1.3333 } } : 
                { width: { ideal: 1920 }, height: { ideal: 1440 } }),
            deviceId: selectedVideoDevice ? { exact: selectedVideoDevice } : undefined
          }
        });
        if (isCancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        previewStreamRef.current = stream;
        if (previewVideoRef.current) {
          previewVideoRef.current.srcObject = stream;
          previewVideoRef.current.play().catch(() => {});
        }
      } catch (err) {
        console.error("Preview failed:", err);
      }
    };

    startPreview();

    return () => {
      isCancelled = true;
      if (previewStreamRef.current) {
        previewStreamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, [showRecordModal, selectedVideoDevice, videoAspectRatio, videoDevices]);

  useEffect(() => {
    if (isRecording && recordingMode === 'video' && videoRef.current && videoStreamRef.current) {
      videoRef.current.srcObject = videoStreamRef.current;
      videoRef.current.play().catch(console.error);
    }
  }, [recordingMode, isRecording]);
  
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const lyricsWrapperRef = useRef<HTMLDivElement>(null);
  const activeAudio = useRef<'original' | 'stems'>('original');

  const lyricsRef = useRef(lyrics);
  const displayedLyrics = lyricsLang === 'english' && englishLyrics.length > 0 ? englishLyrics : lyrics;
  useEffect(() => {
    lyricsRef.current = displayedLyrics;
  }, [displayedLyrics]);

  const animationRef = useRef<number | null>(null);
  
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  const isScrubbingTimeline = useRef(false);

  const updateTime = () => {
    let t = 0;
    const currentDur = originalAudio.current?.duration || 0;

    if (activeAudio.current === 'original' && originalAudio.current) {
      t = originalAudio.current.currentTime;
    } else if (activeAudio.current === 'stems' && chunkPlayer.current) {
      chunkPlayer.current.checkBuffering();
      t = chunkPlayer.current.getCurrentTime();
    }
    
    if (currentDur > 0 && t >= currentDur) {
      t = currentDur;
      stopRecording();
      setIsPlaying(prev => {
        if (prev) {
          if (activeAudio.current === 'stems' && chunkPlayer.current) {
            chunkPlayer.current.pause();
          }
          return false;
        }
        return prev;
      });
    }
    
    if (!isScrubbingTimeline.current) {
      setCurrentTime(t);
    }
    
    const currentLyrics = lyricsRef.current;
    if (currentLyrics.length > 0) {
      let activeIdx = 0;
      for (let i = 0; i < currentLyrics.length; i++) {
        if (t >= currentLyrics[i].time) {
          activeIdx = i;
        } else {
          break;
        }
      }
      setCurrentLine(prev => activeIdx);
    }
    animationRef.current = requestAnimationFrame(updateTime);
  };

  useEffect(() => {
    if (isUserScrolling.current) return;
    
    if (lyricsContainerRef.current && lyricsWrapperRef.current && currentLine >= 0 && displayedLyrics.length > 0) {
      const activeEl = lyricsWrapperRef.current.children[currentLine] as HTMLElement;
      if (activeEl) {
        const containerHeight = lyricsContainerRef.current.clientHeight;
        const elCenter = activeEl.offsetTop + (activeEl.clientHeight / 2);
        lyricsContainerRef.current.scrollTo({
          top: elCenter - (containerHeight / 2),
          behavior: 'smooth'
        });
      }
    }
  }, [currentLine, displayedLyrics.length]);

  useEffect(() => {
    if (!id) {
      router.push('/');
      return;
    }
    
    let isCancelled = false;
    let pollInterval: NodeJS.Timeout | null = null;
    
    animationRef.current = requestAnimationFrame(updateTime);

    fetch(`/api/lyrics/${id}?title=${encodeURIComponent(title || '')}&artist=${encodeURIComponent(artist || '')}`)
      .then(res => res.json())
      .then(data => {
        if (data.lrc) {
          const lines = data.lrc.split('\n');
          const parsed = lines.map((line: string) => {
            const match = line.match(/\[(\d{2}):(\d{2}\.\d{2,3})\](.*)/);
            if (match) {
              return {
                time: parseInt(match[1]) * 60 + parseFloat(match[2]),
                text: match[3].trim()
              };
            }
            return null;
          }).filter(Boolean);
          setLyrics(parsed);
        }
        if (data.lrc_english) {
          const lines = data.lrc_english.split('\n');
          const parsed = lines.map((line: string) => {
            const match = line.match(/\[(\d{2}):(\d{2}\.\d{2,3})\](.*)/);
            if (match) {
              return {
                time: parseInt(match[1]) * 60 + parseFloat(match[2]),
                text: match[3].trim()
              };
            }
            return null;
          }).filter(Boolean);
          setEnglishLyrics(parsed);
        }
      });

    fetch(`/api/prepare/${id}?title=${encodeURIComponent(title || '')}&artist=${encodeURIComponent(artist || '')}&mode=${mode}`, { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        if (isCancelled) return;
        
        if (!originalAudio.current) {
          const audio = new Audio(`${data.originalUrl}`);
          audio.crossOrigin = "anonymous";
          audio.addEventListener('loadedmetadata', () => setDuration(audio.duration));
          audio.addEventListener('ended', () => setIsPlaying(false));
          
          originalAudio.current = audio;
          
          if (mode === 'listen') {
            audio.play().then(() => setIsPlaying(true)).catch(() => console.log('Autoplay blocked'));
          }
        }
        
        if (mode === 'listen') return;
        
        let downloadedChunks = new Set();
        
        pollInterval = setInterval(() => {
          fetch(`/api/chunks/${id}`)
            .then(res => res.json())
            .then(async status => {
              if (isCancelled) return;
              
              if (!chunkPlayer.current) {
                chunkPlayer.current = new ChunkPlayer();
              }
              
              let newChunksFound = false;
              for (const chunk of status.chunks) {
                if (!downloadedChunks.has(chunk.index)) {
                  downloadedChunks.add(chunk.index);
                  newChunksFound = true;
                  await chunkPlayer.current.loadChunk(chunk);
                  
                  if (downloadedChunks.size === 1) {
                    setSeparationLoading(false);
                    setKaraokeReady(true);
                    
                    setKaraokeMode(true);
                    chunkPlayer.current.setVocalsMuted(true);
                    
                    if (activeAudio.current === 'original') {
                      const ct = originalAudio.current?.currentTime || 0;
                      
                      if (originalAudio.current) {
                        originalAudio.current.pause();
                      }
                      
                      chunkPlayer.current.pauseTime = ct;
                      activeAudio.current = 'stems';
                      
                      if (chunkPlayer.current.ctx.state === 'suspended') {
                          chunkPlayer.current.ctx.resume();
                      }
                      chunkPlayer.current.play();
                      setIsPlaying(true);
                    }
                  }
                }
              }
              
              if (newChunksFound && activeAudio.current === 'stems' && (chunkPlayer.current.isPlaying || chunkPlayer.current.isBuffering)) {
                 if (chunkPlayer.current.isPlaying) chunkPlayer.current.pause();
                 chunkPlayer.current.isBuffering = false;
                 chunkPlayer.current.play();
              }
              
              if (status.done) {
                if (pollInterval) clearInterval(pollInterval);
              }
            });
        }, 2000);
      });

    return () => {
      isCancelled = true;
      if (pollInterval) clearInterval(pollInterval);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (originalAudio.current) {
        originalAudio.current.pause();
        originalAudio.current.src = "";
        originalAudio.current = null;
      }
      if (chunkPlayer.current) {
        chunkPlayer.current.pause();
        chunkPlayer.current = null;
      }
    };
  }, [id]);

  const togglePlay = () => {
    const noSleep = getNoSleep();
    if (!isPlaying) {
      if (noSleep) noSleep.enable();
    } else {
      if (noSleep) noSleep.disable();
    }

    setIsPlaying(prev => {
      const playing = !prev;
      const currentDur = originalAudio.current?.duration || 0;
      if (!playing) {
        if (originalAudio.current) originalAudio.current.pause();
        if (activeAudio.current === 'stems' && chunkPlayer.current) chunkPlayer.current.pause();
      } else {
        if (activeAudio.current === 'original' && originalAudio.current) {
          if (currentDur > 0 && originalAudio.current.currentTime >= currentDur - 0.1) {
            originalAudio.current.currentTime = 0;
          }
          originalAudio.current.play();
        } else if (activeAudio.current === 'stems' && chunkPlayer.current) {
          if (currentDur > 0 && chunkPlayer.current.getCurrentTime() >= currentDur - 0.1) {
            chunkPlayer.current.seek(0);
          }
          chunkPlayer.current.play();
        }
      }
      return playing;
    });
  };

  const toggleKaraoke = () => {
    if (!karaokeReady || !chunkPlayer.current) return;
    
    const newMode = !karaokeMode;
    setKaraokeMode(newMode);
    chunkPlayer.current.setVocalsMuted(newMode);
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return "0:00";
    const m = Math.floor(time / 60);
    const s = Math.floor(time % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const performSeek = (newTime: number) => {
    isScrubbingTimeline.current = false;
    if (activeAudio.current === 'original' && originalAudio.current) {
      originalAudio.current.currentTime = newTime;
    } else if (activeAudio.current === 'stems' && chunkPlayer.current) {
      chunkPlayer.current.seek(newTime);
    }
    
    fetch(`/api/seek/${id}?time=${newTime}`, { method: 'POST' }).catch(() => {});
    setCurrentTime(newTime);
  };

  const handleLyricClick = (time: number) => {
    isUserScrolling.current = false;
    if (activeAudio.current === 'original' && originalAudio.current) {
      originalAudio.current.currentTime = time;
    } else if (activeAudio.current === 'stems' && chunkPlayer.current) {
      chunkPlayer.current.seek(time);
    }
    fetch(`/api/seek/${id}?time=${time}`, { method: 'POST' }).catch(() => {});
  };

  const hasScrolled = useRef(false);

  const handleLyricsTouchStart = () => {
    isUserScrolling.current = true;
    hasScrolled.current = false;
  };

  const handleLyricsTouchEnd = () => {
    if (!hasScrolled.current) {
      isUserScrolling.current = false;
    }
  };

  const handleLyricsScroll = () => {
    if (!isUserScrolling.current) return;
    hasScrolled.current = true;
    
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      if (lyricsContainerRef.current && lyricsWrapperRef.current) {
        const container = lyricsContainerRef.current;
        const center = container.scrollTop + container.clientHeight / 2;
        
        const lines = Array.from(lyricsWrapperRef.current.children) as HTMLElement[];
        let minDiff = Infinity;
        let closestIdx = -1;
        
        lines.forEach((line, idx) => {
          const lineCenter = line.offsetTop + line.offsetHeight / 2;
          const diff = Math.abs(lineCenter - center);
          if (diff < minDiff) {
            minDiff = diff;
            closestIdx = idx;
          }
        });
        
        if (closestIdx !== -1 && displayedLyrics[closestIdx]) {
          const time = displayedLyrics[closestIdx].time;
          handleLyricClick(time);
        }
      }
      isUserScrolling.current = false;
    }, 400);
  };

  const skipBackward = () => {
    const newTime = Math.max(0, currentTime - 10);
    if (activeAudio.current === 'original' && originalAudio.current) {
      originalAudio.current.currentTime = newTime;
    } else if (activeAudio.current === 'stems' && chunkPlayer.current) {
      chunkPlayer.current.seek(newTime);
    }
    fetch(`/api/seek/${id}?time=${newTime}`, { method: 'POST' }).catch(() => {});
  };

  const skipForward = () => {
    const newTime = Math.min(duration, currentTime + 10);
    if (activeAudio.current === 'original' && originalAudio.current) {
      originalAudio.current.currentTime = newTime;
    } else if (activeAudio.current === 'stems' && chunkPlayer.current) {
      chunkPlayer.current.seek(newTime);
    }
    fetch(`/api/seek/${id}?time=${newTime}`, { method: 'POST' }).catch(() => {});
  };

  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title || 'Unknown Title',
        artist: artist || 'Unknown Artist',
        artwork: cover ? [{ src: cover, sizes: '512x512', type: 'image/jpeg' }] : []
      });
      navigator.mediaSession.setActionHandler('play', togglePlay);
      navigator.mediaSession.setActionHandler('pause', togglePlay);
      navigator.mediaSession.setActionHandler('seekbackward', skipBackward);
      navigator.mediaSession.setActionHandler('seekforward', skipForward);
    }
  });

  const startRecording = async (recMode: 'audio' | 'video') => {
    try {
      if (previewStreamRef.current) {
        previewStreamRef.current.getTracks().forEach(t => t.stop());
        previewStreamRef.current = null;
      }

      localStorage.setItem('vd_recording_mode', recMode);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(selectedAudioDevice ? { deviceId: { exact: selectedAudioDevice } } : {}),
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        },
        video: recMode === 'video' ? {
          ...(videoAspectRatio === 'portrait' ? { width: { ideal: 1080 }, height: { ideal: 1920 }, aspectRatio: { ideal: 0.5625 } } : 
              videoAspectRatio === 'landscape' ? { width: { ideal: 1920 }, height: { ideal: 1080 }, aspectRatio: { ideal: 1.7777 } } : 
              videoAspectRatio === 'portrait_43' ? { width: { ideal: 1440 }, height: { ideal: 1920 }, aspectRatio: { ideal: 0.75 } } : 
              videoAspectRatio === 'landscape_43' ? { width: { ideal: 1920 }, height: { ideal: 1440 }, aspectRatio: { ideal: 1.3333 } } : 
              { width: { ideal: 3840 }, height: { ideal: 2880 } }),
          deviceId: selectedVideoDevice ? { exact: selectedVideoDevice } : undefined
        } : false
      });
      videoStreamRef.current = stream;
      setRecordingMode(recMode);
      setShowRecordModal(false);
      setIsRecording(true);

      if (!chunkPlayer.current) return;
      const ctx = chunkPlayer.current.ctx;
      const destNode = ctx.createMediaStreamDestination();
      
      const instDelayNode = ctx.createDelay(3.0);
      const micDelayNode = ctx.createDelay(3.0);
      
      let baseInstDelay = 0;
      let baseMicDelay = 0;

      if (latencyMs >= 0) {
        baseInstDelay = latencyMs / 1000.0;
      } else {
        baseMicDelay = Math.abs(latencyMs) / 1000.0;
      }

      const videoDelaySec = (recMode === 'video' ? videoLatencyMs : 0) / 1000.0;
      instDelayNode.delayTime.value = baseInstDelay + videoDelaySec;
      micDelayNode.delayTime.value = baseMicDelay + videoDelaySec;
      
      const instRecordingGain = ctx.createGain();
      instRecordingGain.gain.value = 0.50;

      chunkPlayer.current.masterGain.connect(instDelayNode);
      instDelayNode.connect(instRecordingGain);
      instRecordingGain.connect(destNode);
      
      const micSource = ctx.createMediaStreamSource(stream);
      const micGainNode = ctx.createGain();
      micGainNode.gain.value = micVolume;
      
      const delayedMicGain = ctx.createGain();
      micSource.connect(micGainNode);
      micGainNode.connect(micDelayNode);
      micDelayNode.connect(delayedMicGain);

      const convolver = ctx.createConvolver();
      const length = ctx.sampleRate * 1.5;
      const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const channel = buffer.getChannelData(c);
        let lastOut = 0;
        for (let i = 0; i < length; i++) {
          const noise = (Math.random() * 2 - 1);
          lastOut = lastOut + 0.15 * (noise - lastOut);
          channel[i] = lastOut * Math.pow(1 - i / length, 5.0);
        }
      }
      convolver.buffer = buffer;

      const dryGain = ctx.createGain();
      dryGain.gain.value = 1.0;
      
      const wetGain = ctx.createGain();
      wetGain.gain.value = reverbAmount;

      delayedMicGain.connect(dryGain);
      dryGain.connect(destNode);

      delayedMicGain.connect(convolver);
      convolver.connect(wetGain);
      wetGain.connect(destNode);

      const tracks: MediaStreamTrack[] = [];
      let animationFrameId: number | null = null;
      let hiddenVideo: HTMLVideoElement | null = null;

      if (recMode === 'video') {
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack && videoAspectRatio !== 'auto') {
          let targetW = 1920;
          let targetH = 1080;
          if (videoAspectRatio === 'portrait') { targetW = 1080; targetH = 1920; }
          else if (videoAspectRatio === 'portrait_43') { targetW = 1440; targetH = 1920; }
          else if (videoAspectRatio === 'landscape') { targetW = 1920; targetH = 1080; }
          else if (videoAspectRatio === 'landscape_43') { targetW = 1920; targetH = 1440; }

          const canvas = document.createElement('canvas');
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx2d = canvas.getContext('2d');

          hiddenVideo = document.createElement('video');
          hiddenVideo.srcObject = stream;
          hiddenVideo.muted = true;
          hiddenVideo.playsInline = true;
          await hiddenVideo.play().catch(() => {});

          const drawLoop = () => {
            if (ctx2d && hiddenVideo && hiddenVideo.readyState >= 2) {
              const vw = hiddenVideo.videoWidth;
              const vh = hiddenVideo.videoHeight;
              const scale = Math.max(targetW / vw, targetH / vh);
              const x = (targetW / 2) - (vw / 2) * scale;
              const y = (targetH / 2) - (vh / 2) * scale;
              ctx2d.fillStyle = '#000';
              ctx2d.fillRect(0, 0, targetW, targetH);
              ctx2d.drawImage(hiddenVideo, x, y, vw * scale, vh * scale);
            }
            animationFrameId = requestAnimationFrame(drawLoop);
          };
          drawLoop();

          const canvasStream = canvas.captureStream(30);
          const croppedTrack = canvasStream.getVideoTracks()[0];
          if (croppedTrack) tracks.push(croppedTrack);
        } else if (videoTrack) {
          tracks.push(videoTrack);
        }
      }
      destNode.stream.getAudioTracks().forEach((t: MediaStreamTrack) => tracks.push(t));

      const mixedStream = new MediaStream(tracks);
      const options: MediaRecorderOptions = { mimeType: recMode === 'video' ? 'video/webm' : 'audio/webm' };
      if (recMode === 'video') {
        options.videoBitsPerSecond = 8000000;
        options.audioBitsPerSecond = 320000;
      } else {
        options.audioBitsPerSecond = 320000;
      }

      mediaRecorderRef.current = new MediaRecorder(mixedStream, options);
      recordedChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      mediaRecorderRef.current.onstop = () => {
        if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
        if (hiddenVideo) {
          hiddenVideo.pause();
          hiddenVideo.srcObject = null;
        }
        const blob = new Blob(recordedChunksRef.current, { type: recMode === 'video' ? 'video/webm' : 'audio/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `VocalDrop-Performance-${Date.now()}.${recMode === 'video' ? 'webm' : 'webm'}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      };

      mediaRecorderRef.current.start();
      
      if (!isPlaying) {
        togglePlay();
      }

    } catch (err) {
      console.error("Recording failed:", err);
      alert("Microphone/Camera permission denied or unsupported.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach(t => t.stop());
    }
    setIsRecording(false);
    setRecordingMode(null);
  };


  return (
    <div className={styles.playerContainer}>
      <img src={cover || ''} className={styles.bgImage} alt="Background" />
      
      {showRecordModal && (
        <div style={{position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
          <div style={{background: '#1a1a1a', padding: '2rem', borderRadius: '24px', textAlign: 'center', maxWidth: '90%', width: '400px', border: '1px solid rgba(255,255,255,0.1)'}}>
            <h2 style={{color: 'white', marginBottom: '1.5rem', fontSize: '1.5rem'}}>Recording Studio</h2>
            
            <div style={{textAlign: 'left', marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem'}}>
              {audioDevices.length > 0 && (
                <div>
                  <label style={{color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem', marginBottom: '0.5rem', display: 'block'}}>Microphone</label>
                  <select value={selectedAudioDevice} onChange={e => { setSelectedAudioDevice(e.target.value); localStorage.setItem('vd_audio_device', e.target.value); }} style={{width: '100%', padding: '0.75rem', borderRadius: '8px', background: 'rgba(255,255,255,0.1)', color: 'white', border: 'none', outline: 'none'}}>
                    {audioDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Unknown Microphone'}</option>)}
                  </select>
                </div>
              )}
              {videoDevices.length > 0 && (
                <>
                  <div>
                    <label style={{color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem', marginBottom: '0.5rem', display: 'block'}}>Live Camera Preview</label>
                    <div style={{
                      width: '100%', 
                      display: 'flex', 
                      justifyContent: 'center', 
                      alignItems: 'center',
                      marginBottom: '1rem'
                    }}>
                      <div style={{
                        background: 'rgba(0,0,0,0.5)', 
                        borderRadius: '8px', 
                        overflow: 'hidden', 
                        border: '1px solid rgba(255,255,255,0.1)',
                        aspectRatio: videoAspectRatio === 'portrait' ? '9/16' : videoAspectRatio === 'landscape' ? '16/9' : videoAspectRatio === 'portrait_43' ? '3/4' : videoAspectRatio === 'landscape_43' ? '4/3' : 'auto',
                        width: (videoAspectRatio === 'landscape' || videoAspectRatio === 'landscape_43') ? '100%' : 'auto',
                        height: (videoAspectRatio === 'portrait' || videoAspectRatio === 'portrait_43' || videoAspectRatio === 'auto') ? '250px' : 'auto',
                        maxHeight: '250px'
                      }}>
                        <video 
                          ref={previewVideoRef} 
                          muted 
                          playsInline 
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover'
                          }} 
                        />
                      </div>
                    </div>
                  </div>
                  <div>
                    <label style={{color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem', marginBottom: '0.5rem', display: 'block'}}>Camera</label>
                    <select value={selectedVideoDevice} onChange={e => { setSelectedVideoDevice(e.target.value); localStorage.setItem('vd_video_device', e.target.value); }} style={{width: '100%', padding: '0.75rem', borderRadius: '8px', background: 'rgba(255,255,255,0.1)', color: 'white', border: 'none', outline: 'none'}}>
                      {videoDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Unknown Camera'}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem', marginBottom: '0.5rem', display: 'block'}}>Camera Video Delay ({videoLatencyMs}ms)</label>
                    <input type="range" min="0" max="1000" value={videoLatencyMs} onChange={e => { setVideoLatencyMs(parseInt(e.target.value)); localStorage.setItem('vd_video_latency_ms', e.target.value); }} style={{width: '100%', marginBottom: '1rem'}} />
                  </div>
                  <div>
                    <label style={{color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem', marginBottom: '0.5rem', display: 'block'}}>Video Aspect Ratio</label>
                    <select value={videoAspectRatio} onChange={e => { setVideoAspectRatio(e.target.value as any); localStorage.setItem('vd_video_aspect_ratio', e.target.value); }} style={{width: '100%', padding: '0.75rem', borderRadius: '8px', background: 'rgba(255,255,255,0.1)', color: 'white', border: 'none', outline: 'none'}}>
                      <option value="auto">Auto-detect (Max Resolution)</option>
                      <option value="portrait">Portrait (9:16)</option>
                      <option value="landscape">Landscape (16:9)</option>
                      <option value="portrait_43">Portrait (3:4 High-Res)</option>
                      <option value="landscape_43">Landscape (4:3 High-Res)</option>
                    </select>
                  </div>
                </>
              )}
              <div>
                <label style={{color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem', marginBottom: '0.5rem', display: 'block'}}>Mic Input Delay Compensation ({latencyMs}ms)</label>
                <input type="range" min="-500" max="500" value={latencyMs} onChange={e => { setLatencyMs(parseInt(e.target.value)); localStorage.setItem('vd_latency_ms', e.target.value); }} style={{width: '100%'}} />
                <p style={{color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem', marginTop: '0.5rem'}}>Increase if your voice is recorded slightly earlier than the music.</p>
              </div>
              <div style={{display: 'flex', gap: '1rem'}}>
                <div style={{flex: 1}}>
                  <label style={{color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem', marginBottom: '0.5rem', display: 'block'}}>Microphone Volume ({Math.round(micVolume * 100)}%)</label>
                  <input type="range" min="0" max="400" value={Math.round(micVolume * 100)} onChange={e => { const val = parseInt(e.target.value) / 100; setMicVolume(val); localStorage.setItem('vd_mic_volume', val.toString()); }} style={{width: '100%'}} />
                </div>
                <div style={{flex: 1}}>
                  <label style={{color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem', marginBottom: '0.5rem', display: 'block'}}>Studio Reverb ({Math.round(reverbAmount * 100)}%)</label>
                  <input type="range" min="0" max="100" value={Math.round(reverbAmount * 100)} onChange={e => { const val = parseInt(e.target.value) / 100; setReverbAmount(val); localStorage.setItem('vd_reverb_amount', val.toString()); }} style={{width: '100%'}} />
                </div>
              </div>
            </div>

            <div style={{display: 'flex', gap: '1rem', justifyContent: 'center'}}>
              <button onClick={() => startRecording('audio')} style={{background: 'rgba(255,255,255,0.1)', color: 'white', padding: '1rem 1.5rem', borderRadius: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', border: 'none', cursor: 'pointer', flex: 1}}>
                <Mic size={32} color="var(--apple-red)" />
                Voice Only
              </button>
              <button onClick={() => startRecording('video')} style={{background: 'rgba(255,255,255,0.1)', color: 'white', padding: '1rem 1.5rem', borderRadius: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', border: 'none', cursor: 'pointer', flex: 1}}>
                <Video size={32} color="var(--apple-red)" />
                Voice + Video
              </button>
            </div>
            <button onClick={() => {setShowRecordModal(false); if(!isPlaying) togglePlay();}} style={{marginTop: '1.5rem', color: 'rgba(255,255,255,0.5)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer'}}>Cancel</button>
          </div>
        </div>
      )}

      
      {separationLoading && (
        <div className={styles.karaokeLoader}>
          <Loader2 size={16} className="animate-spin" />
          Preparing Karaoke...
        </div>
      )}

      <div style={{position:'absolute', top:'2rem', left:'2rem', zIndex: 100, display: 'flex', gap: '1rem'}}>
        <button 
          onClick={() => {
            if (mode === 'karaoke' && !hasStartedPlaying) return;
            const noSleep = getNoSleep();
            if (noSleep) {
              noSleep.disable();
            }
            stopRecording();
            router.back();
          }} 
          style={{
            color: 'white', 
            background: 'rgba(0,0,0,0.5)', 
            padding: '0.75rem', 
            borderRadius: '50%', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            cursor: (mode === 'karaoke' && !hasStartedPlaying) ? 'not-allowed' : 'pointer', 
            opacity: (mode === 'karaoke' && !hasStartedPlaying) ? 0.5 : 1, 
            transition: 'background 0.2s ease', 
            border: '1px solid rgba(255,255,255,0.2)'
          }}
          title="Back to Search"
          disabled={mode === 'karaoke' && !hasStartedPlaying}
        >
          <ArrowLeft size={24} />
        </button>
      </div>

      <div style={{ position: 'absolute', top: '2rem', right: '2rem', zIndex: 100, display: 'flex', gap: '1rem', alignItems: 'center' }}>
        {/* Lyrics Translation Toggle */}
        {englishLyrics.length > 0 && (
          <button 
            onClick={() => setLyricsLang(prev => prev === 'original' ? 'english' : 'original')}
            style={{ color: 'white', background: 'rgba(0,0,0,0.5)', padding: '0.75rem', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'background 0.2s ease', border: '1px solid rgba(255,255,255,0.2)' }}
            title="Toggle Romanized Lyrics"
          >
            <Languages size={24} />
          </button>
        )}
      </div>

      <div className={styles.leftPane}>
        {isRecording && recordingMode === 'video' ? (
          <div className={`${styles.videoWrapper} ${isPlaying ? styles.playing : ''}`}
               style={{ 
                 aspectRatio: videoAspectRatio === 'portrait' ? '9/16' : videoAspectRatio === 'landscape' ? '16/9' : videoAspectRatio === 'portrait_43' ? '3/4' : videoAspectRatio === 'landscape_43' ? '4/3' : 'auto',
                 width: videoAspectRatio === 'auto' ? 'auto' : undefined
               }}>
            <video 
              ref={videoRef}
              className={styles.cover}
              muted
              playsInline
              style={{ objectFit: 'cover' }}
            />
          </div>
        ) : (
          <div className={`${styles.coverWrapper} ${isPlaying ? styles.playing : ''}`}>
            <img src={cover || ''} alt={title || 'Cover'} className={styles.cover} />
          </div>
        )}
      </div>
      
      <div className={styles.rightPane}>
        <div 
          className={styles.lyricsContainer} 
          ref={lyricsContainerRef}
          onTouchStart={handleLyricsTouchStart}
          onTouchEnd={handleLyricsTouchEnd}
          onWheel={handleLyricsTouchStart}
          onScroll={handleLyricsScroll}
        >
          <div 
            className={styles.lyricsWrapper} 
            ref={lyricsWrapperRef}
          >
            {displayedLyrics.length > 0 ? (
              displayedLyrics.map((line, idx) => {
                const isActive = idx === currentLine;
                const isPassed = idx < currentLine;
                return (
                  <motion.div 
                    key={idx} 
                    className={styles.lyricLine}
                    onClick={() => handleLyricClick(line.time)}
                    style={{cursor: 'pointer'}}
                    animate={{
                      scale: isActive ? 1.05 : 0.95,
                      opacity: isActive ? 1 : (isPassed ? 0.5 : 0.3),
                      filter: isActive ? 'blur(0px)' : (isPassed ? 'blur(1px)' : 'blur(2px)'),
                      color: isActive ? '#fff' : 'rgba(255, 255, 255, 0.5)'
                    }}
                    transition={{ type: "spring", stiffness: 200, damping: 20 }}
                  >
                    {line.text}
                  </motion.div>
                );
              })
            ) : (
              <div className={styles.lyricLine} style={{opacity: 0.5}}>No lyrics available.</div>
            )}
          </div>
        </div>
      </div>

      <div className={styles.controls}>
        <div className={styles.info}>
          <div className={styles.songTitle}>{title}</div>
          <div className={styles.songArtist}>{artist}</div>
        </div>

        <div className={styles.timeline}>
          <span>{formatTime(currentTime)}</span>
          <input 
            type="range"
            className={styles.rangeSlider}
            min={0}
            max={duration || 100}
            step="0.1"
            value={currentTime || 0}
            onMouseDown={() => { isScrubbingTimeline.current = true; }}
            onTouchStart={() => { isScrubbingTimeline.current = true; }}
            onPointerDown={() => { isScrubbingTimeline.current = true; }}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setCurrentTime(val);
              const currentLyrics = lyricsRef.current;
              if (currentLyrics.length > 0) {
                let activeIdx = 0;
                for (let i = 0; i < currentLyrics.length; i++) {
                  if (val >= currentLyrics[i].time) activeIdx = i;
                  else break;
                }
                setCurrentLine(activeIdx);
              }
            }}
            onMouseUp={(e) => {
              isScrubbingTimeline.current = false;
              const val = parseFloat((e.currentTarget as HTMLInputElement).value);
              if (!isNaN(val)) performSeek(val);
            }}
            onTouchEnd={(e) => {
              isScrubbingTimeline.current = false;
              const val = parseFloat((e.currentTarget as HTMLInputElement).value);
              if (!isNaN(val)) performSeek(val);
            }}
            onPointerUp={(e) => {
              isScrubbingTimeline.current = false;
              const val = parseFloat((e.currentTarget as HTMLInputElement).value);
              if (!isNaN(val)) performSeek(val);
            }}
            onPointerCancel={() => { isScrubbingTimeline.current = false; }}
            style={{ 
              background: `linear-gradient(to right, #fff ${duration > 0 ? (currentTime/duration)*100 : 0}%, rgba(255,255,255,0.2) ${duration > 0 ? (currentTime/duration)*100 : 0}%)` 
            }}
          />
          <span>{formatTime(duration)}</span>
        </div>

        <div className={styles.buttons}>
          {mode === 'karaoke' && (
            <div style={{ position: 'relative' }}>
              <button 
                className={`${styles.karaokeBtn} ${pitchOffset !== 0 ? styles.active : ''}`} 
                onClick={() => setShowPitchSlider(!showPitchSlider)} 
                disabled={!karaokeReady}
                title="Adjust Pitch"
              >
                <Music2 size={24} />
              </button>
              {showPitchSlider && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 90 }} onClick={() => setShowPitchSlider(false)} />
                  <div style={{
                    position: 'absolute',
                    bottom: 'calc(100% + 1rem)',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: 'rgba(20,20,20,0.95)',
                    backdropFilter: 'blur(20px)',
                    padding: '1rem',
                    borderRadius: '16px',
                    border: '1px solid rgba(255,255,255,0.15)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem',
                    width: '240px',
                    boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
                    zIndex: 100
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.9)', fontWeight: 500 }}>Key Adjust</span>
                      <span style={{ fontSize: '0.9rem', fontVariantNumeric: 'tabular-nums', color: '#ff2d55', fontWeight: 600 }}>
                        {pitchOffset > 0 ? '+' : ''}{pitchOffset.toFixed(1)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)' }}>-6</span>
                      <input
                        type="range"
                        min="-6"
                        max="6"
                        step="0.1"
                        value={pitchOffset}
                        onChange={(e) => setPitchOffset(parseFloat(e.target.value))}
                        onPointerUp={(e) => chunkPlayer.current?.setPitchOffset(parseFloat(e.currentTarget.value))}
                        style={{ flex: 1, accentColor: '#ff2d55' }}
                      />
                      <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)' }}>+6</span>
                    </div>
                    {pitchOffset !== 0 && (
                      <button 
                        onClick={() => { setPitchOffset(0); chunkPlayer.current?.setPitchOffset(0); }}
                        style={{ background: 'rgba(255,45,85,0.1)', border: '1px solid rgba(255,45,85,0.3)', color: '#ff2d55', fontSize: '0.8rem', padding: '0.5rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 500 }}
                      >
                        Reset to Original
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {mode === 'karaoke' && (
            <button className={`${styles.karaokeBtn} ${karaokeMode ? styles.active : ''}`} onClick={toggleKaraoke} disabled={!karaokeReady}>
              <Mic2 size={24} />
            </button>
          )}

          {mode === 'karaoke' && karaokeMode && !isRecording && (
            <button className={`${styles.karaokeBtn} ${styles.desktopOnly}`} style={{background: 'rgba(255,255,255,0.1)'}} onClick={() => { if(isPlaying) togglePlay(); setShowRecordModal(true); }} disabled={!karaokeReady}>
              <Circle size={24} fill="var(--apple-red)" color="var(--apple-red)" />
            </button>
          )}

          {isRecording && (
            <button className={`${styles.karaokeBtn} ${styles.active} ${styles.desktopOnly}`} onClick={stopRecording}>
              <StopCircle size={24} fill="white" color="var(--apple-red)" className="animate-pulse" />
            </button>
          )}
          
          <button className={styles.skipBtn} onClick={skipBackward}>
            <Rewind size={24} />
          </button>

          <button className={styles.playBtn} onClick={togglePlay} disabled={!karaokeReady}>
            {isPlaying ? <Pause size={32} fill="black" /> : <Play size={32} fill="black" className="ml-1" />}
          </button>

          <button className={styles.skipBtn} onClick={skipForward}>
            <FastForward size={24} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PlayerPage() {
  return (
    <Suspense fallback={<div>Loading Player...</div>}>
      <PlayerContent />
    </Suspense>
  );
}
