import React, { useRef, useEffect } from 'react';
import { getSharedAudioContext } from './audioContext';
import { motion } from 'framer-motion';

export const AudioVisualizer = ({ cover, isPlaying, isActive }: { cover: string, isPlaying: boolean, isActive: boolean }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const isPlayingRef = useRef(isPlaying);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    if (cover) {
      const img = new Image();
      img.src = cover;
      imgRef.current = img;
    }
  }, [cover]);

  useEffect(() => {
    const shared = getSharedAudioContext();
    const analyser = shared.analyser;
    if (!analyser || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let animationId: number;

    const draw = () => {
      animationId = requestAnimationFrame(draw);
      
      if (!isPlayingRef.current) return; // Freeze exactly where it is when paused

      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const barCount = 16;
      const barWidth = (canvas.width / barCount) * 0.8;
      const spacing = (canvas.width / barCount) * 0.2;
      let x = 0;
      
      let sum = 0;
      for(let i = 0; i < barCount; i++) sum += dataArray[i];
      const avg = sum / barCount;
      
      if (avg < 2) return;

      // Draw the bars in solid white
      ctx.globalCompositeOperation = 'source-over';
      ctx.filter = 'none';
      for (let i = 0; i < barCount; i++) {
        const dataIndex = Math.floor(i * (dataArray.length / barCount) * 0.5); 
        const value = dataArray[dataIndex];
        const barHeight = Math.max(4, (value / 255) * canvas.height);
        
        ctx.fillStyle = 'white';
        ctx.beginPath();
        const y = (canvas.height - barHeight) / 2;
        ctx.roundRect(x, y, barWidth, barHeight, 4);
        ctx.fill();

        x += barWidth + spacing;
      }

      // Tint the bars using the album art image
      if (imgRef.current && imgRef.current.complete) {
        ctx.globalCompositeOperation = 'source-in';
        ctx.filter = 'saturate(200%)';
        // Draw the image stretched across the canvas to act as a gradient fill
        ctx.drawImage(imgRef.current, 0, -canvas.height * 2, canvas.width, canvas.height * 5);
      }
    };

    draw();
    return () => cancelAnimationFrame(animationId);
  }, []);

  return (
    <motion.div 
      initial={{ height: 0, opacity: 0, marginTop: 0, marginBottom: 0 }}
      animate={{ 
        height: isActive ? 'auto' : 0, 
        opacity: isActive ? 1 : 0,
        marginTop: isActive ? '0.5rem' : 0,
        marginBottom: isActive ? '1.5rem' : 0
      }}
      style={{ width: '100%', display: 'flex', justifyContent: 'center', overflow: 'hidden' }}
    >
      <canvas 
        ref={canvasRef} 
        width={160} 
        height={30} 
        style={{
          width: '100%',
          maxWidth: '160px',
          height: '30px',
          pointerEvents: 'none',
          opacity: 0.9
        }} 
      />
    </motion.div>
  );
};
