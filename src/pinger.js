import ping from 'ping';

export const state = { ping: null };

const WINDOW = 10;
let samples = [];

async function sample() {
  const res = await ping.promise.probe('sync.drish-shel.com');
  const t = parseFloat(res.time);
  if (!isFinite(t)) return;

  samples.push(t);
  if (samples.length > WINDOW) samples.shift();

  // Divide by 2 to get one-way latency estimate, matching Python pinger logic
  const avg = samples.reduce((a, b) => a + b, 0) / (2 * samples.length);
  state.ping = Math.ceil(avg);
}

sample();
setInterval(sample, 3000);
