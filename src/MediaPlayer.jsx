import { useRef, useEffect, useState } from 'react';

export default function MediaPlayer() {
  const [videoSrc, setVideoSrc] = useState('');
  const videoRef = useRef(null);

  async function handleOpen() {
    const filePath = await window.electronAPI.openFile();
    if (!filePath) return;
    setVideoSrc(`media://app/${encodeURIComponent(filePath)}`);
  }
  
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
