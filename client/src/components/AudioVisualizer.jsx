import { useState, useEffect } from 'react';

function AudioVisualizer({ barCount = 7 }) {
  const [bars, setBars] = useState(Array(barCount).fill(0.5));

  useEffect(() => {
    const interval = setInterval(() => {
      setBars(prev => prev.map(() => 0.3 + Math.random() * 0.7));
    }, 150);

    return () => clearInterval(interval);
  }, [barCount]);

  return (
    <div className="flex items-center justify-center gap-1 h-16 mb-8">
      {bars.map((height, i) => (
        <div
          key={i}
          className="w-2 bg-gradient-to-t from-golden-500 to-golden-300 rounded-full
                     transition-all duration-150 ease-out"
          style={{
            height: `${height * 48}px`,
            animationDelay: `${i * 0.1}s`
          }}
        />
      ))}
    </div>
  );
}

export default AudioVisualizer;
