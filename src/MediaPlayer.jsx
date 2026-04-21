import { useRef, useEffect, useState } from 'react';

export default function MediaPlayer() {
  const [videoSrc, setVideoSrc] = useState('');
  const videoRef = useRef(null);

  async function handleOpen() {
    const filePath = await window.electronAPI.openFile();
    if (!filePath) return;
    setVideoSrc(`media://app/${encodeURIComponent(filePath)}`);
  }

  useEffect(() => {
    function onKeyDown(e) {
      const video = videoRef.current;
      if (!video) return;
      switch (e.key) {
        case 'ArrowRight': video.currentTime += 5;                         e.preventDefault(); break;
        case 'ArrowLeft':  video.currentTime -= 5;                         e.preventDefault(); break;
        case 'ArrowUp':    video.volume = Math.min(1, video.volume + 0.1); e.preventDefault(); break;
        case 'ArrowDown':  video.volume = Math.max(0, video.volume - 0.1); e.preventDefault(); break;
        case ' ':          video.paused ? video.play() : video.pause();    e.preventDefault(); break;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <button onClick={handleOpen}>Open video</button>

      {videoSrc && (
        <div style={{ marginTop: 12 }}>
          <video
            ref={videoRef}
            key={videoSrc}
            src={videoSrc}
            controls
            autoPlay
            width="900"
            onError={(e) => console.log('video error', e.currentTarget.error)}
          />
        </div>
      )}
    </div>
  );
}
