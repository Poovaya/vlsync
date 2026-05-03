import mqtt from 'mqtt';
import os from 'node:os';

const BROKER_URL = 'wss://sync.drish-shel.com:443/mqtt';
const TOPIC = 'vlsync/test';
const SENDER_ID = os.homedir();

let client = null;
let onRemoteAction = null;
let statusCallback = null;

export function init(onAction, onStatus) {
  onRemoteAction = onAction;
  statusCallback = onStatus;

  client = mqtt.connect(BROKER_URL, {
    protocolVersion: 4,   // broker uses MQTT 3.1.1; mqtt pkg v5 defaults to 5
    reconnectPeriod: 3000,
    connectTimeout: 10000,
  });

  client.on('connect', () => {
    statusCallback?.('connected');
    client.subscribe(TOPIC);
  });

  client.on('reconnect', () => statusCallback?.('connecting'));
  client.on('offline', () => statusCallback?.('disconnected'));
  client.on('error', (err) => {
    console.error('MQTT error:', err.message);
    statusCallback?.('error');
  });

  client.on('message', (_topic, payload) => {
    try {
      const data = JSON.parse(payload.toString());
      if (data.sender === SENDER_ID) return;
      onRemoteAction?.(data);
    } catch {
      // ignore malformed messages
    }
  });
}

// action: true=play, false=pause, null=seek
export function publish(action, mediaTimeMs, pingMs) {
  if (!client?.connected) return;
  client.publish(TOPIC, JSON.stringify({
    sender: SENDER_ID,
    action,
    media_time: Math.round(mediaTimeMs),
    ping: pingMs ?? 0,
  }));
}
