import ReactDOM from 'react-dom/client';
import MediaPlayer from './MediaPlayer';

function App() {
  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>vlsync</h1>
      <p>Electron + React + preload is working.</p>
      <MediaPlayer />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
