# Vocaldrop 🎤

Vocaldrop is a modern, web-based Karaoke and vocal recording application built with Next.js and the Web Audio API. It allows users to sing along to their favorite tracks with synchronized lyrics, high-quality camera recording, and real-time audio effects.

## Features

### 🎥 High-Resolution Video Recording
- **Continuity Camera Support:** Optimized to bypass the default 1080p clamping on macOS Continuity Camera, enforcing a 4:3 aspect ratio (`3840x2880`) to guarantee maximum native resolution.
- **Audio/Video Muxing:** Synchronously captures the user's camera feed alongside their vocal performance, merging them into a high-quality WebM container via `MediaRecorder`.
- **Hardware Acceleration:** Uses optimal `videoBitsPerSecond` and codec configurations for smooth, lag-free recording.

### 🎛️ Real-Time Pitch Correction (Key Shifter)
- **Granular Synthesis Engine:** Features a custom-built Web Audio API `PitchShifter` node using Jungle.js granular synthesis.
- **Real-Time Key Adjustment:** Shift the backing track's key up or down by up to 6 semitones (in 0.1 increments) in real-time, allowing singers to comfortably match their vocal range.
- **Artifact-Free Playback:** Uses a locked grain size (120ms) and phase-staggered delay buffers to eliminate audio dropouts, volume stuttering, and tempo fluctuation.
- **Recording Integration:** The shifted backing track is flawlessly routed into the master recording node, ensuring the final exported video matches the pitch the user heard while singing.

### 🎵 Dynamic Karaoke Mode
- **Synchronized Lyrics:** Apple Music style animated, scrolling lyrics that highlight exactly to the beat.
- **Audio Ducking:** Isolate the vocal track or sing along with the original vocals.
- **Responsive UI:** A sleek, glassmorphic player interface that scales perfectly across desktop and mobile devices.

## Getting Started

First, install the dependencies:

```bash
npm install
# or
yarn install
# or
pnpm install
```

Then, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the application.

## Technologies Used
- Next.js (React 19)
- Web Audio API & MediaRecorder API
- Tailwind CSS v4
- Framer Motion
- Lucide React Icons
