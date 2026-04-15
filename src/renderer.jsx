import React, { useState } from "react";
import ReactDOM from "react-dom/client";

function App() {
  const [platform, setPlatform] = useState("");

  function handlePing() {
    window.electronAPI.ping();
  }

  async function handleGetPlatform() {
    const value = await window.electronAPI.getPlatform();
    setPlatform(value);
  }

  return (
    <div style={{ padding: 24, fontFamily: "sans-serif" }}>
      <h1>vlsync</h1>
      <p>Electron + React + preload is working.</p>

      <button onClick={handlePing}>Send ping to Electron</button>

      <div style={{ marginTop: 16 }}>
        <button onClick={handleGetPlatform}>Get platform</button>
      </div>

      <p style={{ marginTop: 16 }}>
        Platform: {platform || "not loaded yet"}
      </p>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);