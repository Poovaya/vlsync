import { useRef, useEffect, useState } from 'react';

const STATUS_COLOR = {
  connected: '#4caf50',
  connecting: '#ff9800',
  disconnected: '#9e9e9e',
  error: '#f44336',
};

export default function MediaPlayer() {
  const [videoSrc, setVideoSrc] = useState('');
  const [ping, setPing] = useState(null);
  const [mqttStatus, setMqttStatus] = useState('connecting');
  const videoRef = useRef(null);

  // When true, events triggered by applying a remote action are suppressed
  const suppressRef = useRef(false);
  const seekTimerRef = useRef(null);

  async function handleOpen() {
    const filePath = await window.electronAPI.openFile();
    if (!filePath) return;
    setVideoSrc(`media://app/${encodeURIComponent(filePath)}`);
  }

  useEffect(() => {
    const cleanRemote = window.electronAPI.onRemoteAction((data) => {
      const video = videoRef.current;
      if (!video) return;

      const { action, media_time, ping: senderPing } = data;

      // Compensate for sender's one-way network latency
      const adjustedSec = (media_time + (senderPing ?? 0)) / 1000;

      suppressRef.current = true;

      video.currentTime = adjustedSec;

      if (action === true) {
        video.play()
          .catch(() => {})
          .finally(() => { suppressRef.current = false; });
      } else {
        // pause or seek-only — reset suppress after current event loop tick
        Promise.resolve().then(() => { suppressRef.current = false; });
        if (action === false) video.pause();
      }
    });

    const cleanStatus = window.electronAPI.onMqttStatus(setMqttStatus);

    // Poll ping display every 3 s
    const pingTimer = setInterval(async () => {
      const p = await window.electronAPI.getPing();
      setPing(p);
    }, 3000);

    return () => {
      cleanRemote?.();
      cleanStatus?.();
      clearInterval(pingTimer);
    };
  }, []);

  function handlePlay(e) {
    if (suppressRef.current) return;
    window.electronAPI.sendAction('play', e.currentTarget.currentTime * 1000);
  }

  function handlePause(e) {
    if (suppressRef.current) return;
    window.electronAPI.sendAction('pause', e.currentTarget.currentTime * 1000);
  }

  function handleSeeked(e) {
    if (suppressRef.current) return;
    const timeMs = e.currentTarget.currentTime * 1000;
    clearTimeout(seekTimerRef.current);
    seekTimerRef.current = setTimeout(() => {
      window.electronAPI.sendAction('seek', timeMs);
    }, 300);
  }

  const statusDot = {
    display: 'inline-block',
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: STATUS_COLOR[mqttStatus] ?? '#9e9e9e',
    marginRight: 6,
  };

  return (
    <div style={{ padding: 20 }}>
      <div style={{ marginBottom: 10, fontSize: 12, color: '#aaa', display: 'flex', gap: 20, alignItems: 'center' }}>
        <span>
          <span style={statusDot} />
          {mqttStatus}
        </span>
        <span>ping: {ping !== null ? `${ping} ms` : '—'}</span>
      </div>

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
            onError={(e) => console.error('video error', e.currentTarget.error)}
            onPlay={handlePlay}
            onPause={handlePause}
            onSeeked={handleSeeked}
          />
        </div>
      )}
    </div>
  );
}
