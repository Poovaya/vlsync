import mqtt, { type MqttClient } from "mqtt";
import { decode, deviceId, encode, type PlaybackMessage } from "./protocol.ts";

export type SyncStatus = "offline" | "connecting" | "connected" | "error";

export interface SyncClientOptions {
  url: string;
  topic: string;
  onMessage(message: PlaybackMessage): void;
  onStatusChange(status: SyncStatus, detail: string | null): void;
}

/** Rolling window for the broker round-trip estimate. */
const RTT_SAMPLES = 8;

/**
 * MQTT-over-WebSocket transport.
 *
 * Latency is measured through the broker rather than the wall clock: we
 * subscribe to the topic we publish on, so our own messages come back to us,
 * and the delay is a true round trip. That keeps the position compensation
 * independent of how badly two devices' clocks disagree — which matters,
 * because nothing guarantees they are NTP-synced.
 */
export class SyncClient {
  readonly id = deviceId();

  private client: MqttClient | null = null;
  private status: SyncStatus = "offline";
  private readonly rttSamples: number[] = [];
  /** publish timestamp keyed by a token echoed back in our own message. */
  private pendingEcho = new Map<string, number>();

  constructor(private readonly options: SyncClientOptions) {}

  get currentStatus(): SyncStatus {
    return this.status;
  }

  /** One-way latency estimate to the broker, in milliseconds. */
  get oneWayLatencyMs(): number {
    if (this.rttSamples.length === 0) return 0;
    const total = this.rttSamples.reduce((sum, value) => sum + value, 0);
    // Half the average round trip, matching vlsync's pinger.get_average().
    return total / (2 * this.rttSamples.length);
  }

  connect(): void {
    if (this.client) return;

    this.setStatus("connecting", null);

    let client: MqttClient;
    try {
      client = mqtt.connect(this.options.url, {
        // A duplicate client id makes the broker kick the other session, which
        // looks exactly like a flapping connection. Keep it unique per tab.
        clientId: `${this.id}-${Math.random().toString(36).slice(2, 8)}`,
        reconnectPeriod: 4000,
        connectTimeout: 10_000,
        clean: true,
      });
    } catch (err) {
      this.setStatus("error", err instanceof Error ? err.message : "Could not connect.");
      return;
    }

    this.client = client;

    client.on("connect", () => {
      client.subscribe(this.options.topic, { qos: 0 }, (err) => {
        if (err) this.setStatus("error", `Could not subscribe to ${this.options.topic}.`);
        else this.setStatus("connected", null);
      });
    });

    client.on("reconnect", () => this.setStatus("connecting", null));
    client.on("close", () => {
      if (this.status !== "offline") this.setStatus("connecting", null);
    });
    client.on("error", (err: Error) => this.setStatus("error", err.message));

    client.on("message", (_topic: string, payload: Uint8Array) => {
      this.handlePayload(new TextDecoder().decode(payload));
    });
  }

  disconnect(): void {
    const client = this.client;
    this.client = null;
    this.rttSamples.length = 0;
    this.pendingEcho.clear();
    this.setStatus("offline", null);
    client?.end(true);
  }

  publish(message: Omit<PlaybackMessage, "sender" | "pingMs">): void {
    if (!this.client || this.status !== "connected") return;

    const full: PlaybackMessage = {
      ...message,
      sender: this.id,
      pingMs: Math.round(this.oneWayLatencyMs),
    };

    // Remember when this went out so the echo can time the round trip. Keyed on
    // the exact position we sent, which is unique enough at millisecond scale.
    this.pendingEcho.set(echoKey(full), Date.now());
    if (this.pendingEcho.size > 32) {
      const oldest = this.pendingEcho.keys().next().value;
      if (oldest !== undefined) this.pendingEcho.delete(oldest);
    }

    this.client.publish(this.options.topic, encode(full), { qos: 0 });
  }

  private handlePayload(payload: string): void {
    const message = decode(payload);
    if (!message) return;

    if (message.sender === this.id) {
      // Our own message coming back: use it purely as a latency probe.
      const sentAt = this.pendingEcho.get(echoKey(message));
      if (sentAt !== undefined) {
        this.pendingEcho.delete(echoKey(message));
        this.recordRtt(Date.now() - sentAt);
      }
      return;
    }

    this.options.onMessage(message);
  }

  private recordRtt(rtt: number): void {
    if (!Number.isFinite(rtt) || rtt < 0 || rtt > 10_000) return;
    this.rttSamples.push(rtt);
    if (this.rttSamples.length > RTT_SAMPLES) this.rttSamples.shift();
  }

  private setStatus(status: SyncStatus, detail: string | null): void {
    if (this.status === status && detail === null) return;
    this.status = status;
    this.options.onStatusChange(status, detail);
  }
}

function echoKey(message: PlaybackMessage): string {
  return `${message.event}:${message.position.toFixed(3)}`;
}
