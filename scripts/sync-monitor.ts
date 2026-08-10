/**
 * Watch or inject playback-sync messages from a terminal — the Node equivalent
 * of vlsync/testfiles/testSubscriber.py and testPublisher.py.
 *
 *   node scripts/sync-monitor.ts                    # watch the topic
 *   node scripts/sync-monitor.ts pause 123.5        # act as another device
 *   node scripts/sync-monitor.ts play 45 --rate 1.5
 *
 * Useful for testing sync without a second screen.
 */
import mqtt from "mqtt";

const URL = process.env["SYNC_URL"] ?? "wss://sync.drish-shel.com:443/mqtt";
const TOPIC = process.env["SYNC_TOPIC"] ?? "vlsync/test";

const args = process.argv.slice(2);
const event = args[0];
const position = Number(args[1] ?? 0);
const rateFlag = args.indexOf("--rate");
const rate = rateFlag === -1 ? 1 : Number(args[rateFlag + 1] ?? 1);

const client = mqtt.connect(URL, { clientId: `sync-monitor-${Math.random().toString(36).slice(2, 8)}` });

// MQTT.js re-emits "connect" on every reconnect; publishing again each time
// would turn one command into a stream of them.
let handled = false;

client.on("connect", () => {
  if (handled) return;
  handled = true;

  console.log(`connected to ${URL}`);

  if (!event) {
    client.subscribe(TOPIC, (err) => {
      if (err) {
        console.error("subscribe failed:", err.message);
        process.exit(1);
      }
      console.log(`watching ${TOPIC} — Ctrl+C to stop\n`);
    });
    return;
  }

  const payload = {
    sender: "sync-monitor",
    action: event === "play" ? true : event === "pause" ? false : null,
    media_time: Math.floor(position),
    ping: 0,
    event,
    position,
    paused: event !== "play",
    rate,
    media: null,
  };

  client.publish(TOPIC, JSON.stringify(payload), {}, () => {
    console.log("sent:", JSON.stringify(payload));
    client.end();
  });
});

client.on("message", (_topic, payload) => {
  const text = payload.toString();
  const stamp = new Date().toISOString().slice(11, 23);
  try {
    const data: unknown = JSON.parse(text);
    console.log(stamp, data);
  } catch {
    // The Python test scripts publish plain strings on this topic.
    console.log(stamp, `(non-JSON) ${text}`);
  }
});

client.on("error", (err: Error) => {
  console.error("mqtt error:", err.message);
  process.exit(1);
});
