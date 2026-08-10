/**
 * Publishes deliberately malformed and hostile payloads to the sync topic.
 *
 * The topic is a shared room with no authentication, and vlsync's own test
 * scripts publish plain strings to it, so a player has to survive whatever
 * turns up. Run this with a player connected and watch that nothing breaks.
 *
 *   node scripts/sync-fuzz.ts
 */
import mqtt from "mqtt";

const URL = process.env["SYNC_URL"] ?? "wss://sync.drish-shel.com:443/mqtt";
const TOPIC = process.env["SYNC_TOPIC"] ?? "vlsync/test";

const payloads: Array<[string, string]> = [
  ["plain string (what testPublisher.py sends)", "msg 1 @ 2026-08-09"],
  ["empty string", ""],
  ["broken JSON", '{"sender": '],
  ["JSON null", "null"],
  ["JSON number", "42"],
  ["JSON array", "[1,2,3]"],
  ["object, no sender", JSON.stringify({ position: 10 })],
  ["sender only, no position", JSON.stringify({ sender: "junk" })],
  ["negative position", JSON.stringify({ sender: "junk", position: -999, paused: false, rate: 1 })],
  ["absurd position", JSON.stringify({ sender: "junk", position: 1e15, paused: true, rate: 1 })],
  ["NaN-ish position", JSON.stringify({ sender: "junk", position: "abc", paused: true })],
  ["rate 1000", JSON.stringify({ sender: "junk", position: 50, paused: false, rate: 1000 })],
  ["rate 0", JSON.stringify({ sender: "junk", position: 50, paused: false, rate: 0 })],
  ["rate negative", JSON.stringify({ sender: "junk", position: 50, paused: false, rate: -4 })],
  ["wrong types everywhere", JSON.stringify({ sender: "junk", position: 50, paused: "yes", rate: "fast" })],
  ["huge ping", JSON.stringify({ sender: "junk", position: 50, paused: false, rate: 1, ping: 1e12 })],
  ["negative ping", JSON.stringify({ sender: "junk", position: 50, paused: false, rate: 1, ping: -9999 })],
  ["giant media name", JSON.stringify({ sender: "junk", position: 50, paused: true, rate: 1, media: "x".repeat(5000) })],
  ["legacy-only (valid, should apply)", JSON.stringify({ sender: "junk", action: true, media_time: 30 })],
];

const client = mqtt.connect(URL, { clientId: `sync-fuzz-${Math.random().toString(36).slice(2, 8)}` });

// MQTT.js re-emits "connect" on every reconnect; without this guard a dropped
// connection replays the whole batch.
let started = false;

client.on("connect", async () => {
  if (started) return;
  started = true;

  console.log(`connected — sending ${payloads.length} hostile payloads\n`);

  for (const [label, payload] of payloads) {
    await new Promise<void>((resolve) => {
      client.publish(TOPIC, payload, {}, () => {
        console.log(`  sent: ${label}`);
        resolve();
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  console.log("\ndone");
  client.end();
});

client.on("error", (err: Error) => {
  console.error("mqtt error:", err.message);
  process.exit(1);
});
