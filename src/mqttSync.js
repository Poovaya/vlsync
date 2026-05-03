import mqtt from 'mqtt';
import os from 'node:os';

const BROKER_URL = 'wss://sync.drish-shel.com:443/mqtt';
const TOPIC = 'vlsync/test';
const SENDER_ID = os.homedir();

let client = null;
let onRemoteAction = null;
let statusCallback = null;
let currentStatus = 'connecting';

export function getStatus() { return currentStatus; }

export function init(onAction, onStatus) {
  onRemoteAction = onAction;
  statusCallback = onStatus;

  console.log('[mqtt] connecting to', BROKER_URL);
  client = mqtt.connect(BROKER_URL, {
    protocolVersion: 4,   // broker uses MQTT 3.1.1; mqtt pkg v5 defaults to 5
    reconnectPeriod: 3000,
    connectTimeout: 10000,
  });

  const setStatus = (s) => {
    currentStatus = s;
    statusCallback?.(s);
  };

  client.on('connect', () => {
    console.log('[mqtt] connected, subscribing to', TOPIC);
    setStatus('connected');
    client.subscribe(TOPIC, (err) => {
      if (err) console.error('[mqtt] subscribe error:', err.message);
      else console.log('[mqtt] subscribed to', TOPIC);
    });
  });

  client.on('reconnect', () => {
    console.log('[mqtt] reconnecting to', BROKER_URL);
    setStatus('connecting');
  });
  client.on('offline', () => {
    console.log('[mqtt] offline');
    setStatus('disconnected');
  });
  client.on('error', (err) => {
    console.error('[mqtt] error:', err.message);
    setStatus('error');
  });
  client.on('close', () => console.log('[mqtt] connection closed'));

  client.on('message', (_topic, payload) => {
    try {
      const data = JSON.parse(payload.toString());
      if (data.sender === SENDER_ID) {
        console.log('[mqtt] ignored own message');
        return;
      }
      const label = data.action === true ? 'play' : data.action === false ? 'pause' : 'seek';
      console.log(`[mqtt] remote action received: ${label} @ ${(data.media_time / 1000).toFixed(2)}s (sender ping ${data.ping}ms)`);
      onRemoteAction?.(data);
    } catch (e) {
      console.error('[mqtt] failed to parse message:', e.message);
    }
  });
}

// action: true=play, false=pause, null=seek
export function publish(action, mediaTimeMs, pingMs) {
  if (!client?.connected) {
    console.warn('[mqtt] publish skipped — not connected');
    return;
  }
  const label = action === true ? 'play' : action === false ? 'pause' : 'seek';
  console.log(`[mqtt] publishing: ${label} @ ${(mediaTimeMs / 1000).toFixed(2)}s (ping ${pingMs}ms)`);
  client.publish(TOPIC, JSON.stringify({
    sender: SENDER_ID,
    action,
    media_time: Math.round(mediaTimeMs),
    ping: pingMs ?? 0,
  }));
}
