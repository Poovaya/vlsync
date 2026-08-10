# vsync

A web-based video player for files on your local drive, with a Netflix-style
play screen. TypeScript throughout — Vite for the frontend, a small `node:http`
server for streaming.

The brief was the play screen only, so that is the part that is designed. The
file chooser in front of it is deliberately plain.

## Running it

Needs **Node 22.18+** (the server runs its TypeScript directly, via the type
stripping Node enables by default from that version). Works on macOS, Windows
and Linux.

```bash
npm install
npm run dev
```

Then open <http://localhost:5173>.

`npm run dev` starts two processes: the media server on `127.0.0.1:8787` and
Vite on `5173`, with `/api/*` proxied to the server.

### On macOS

Nothing platform-specific to do — paths, media roots and the traversal guard all
go through Node's `path`, and `~` expands.

Browser choice matters more than the OS:

- **Chrome / Firefox on macOS** behave exactly as on Windows, since it is the
  same engine. Everything documented here applies unchanged.
- **Safari** decodes more than Chrome does, so files that are silent or black in
  Chrome often just work — notably **AC-3 / E-AC-3 (`DDP5.1`) audio and HEVC**,
  which macOS supports natively. It is also the one browser here that exposes
  `audioTracks`, so the audio column in the subtitles menu actually appears and
  can switch tracks. It has no MKV or WebM/VP9 support to speak of, though, so
  those go the other way.

Because that support genuinely differs per browser, the player asks *your*
browser what it can decode rather than assuming — the same file can be fine in
Safari and silent in Chrome on the same Mac.

### Pointing it at your media

By default it scans `./media`. Any of these override that:

```bash
# CLI arguments (multiple roots are fine, they can be on different drives)
npm run dev:server -- "D:/Movies" "E:/Shows"

# environment variable, semicolon-separated
MEDIA_DIRS="D:/Movies;E:/Shows" npm run dev

# or vsync.config.json in the project root
{ "roots": ["D:/Movies", "E:/Shows"], "port": 8787, "maxDepth": 8 }
```

You can also skip the server entirely for a one-off file: drag it anywhere onto
the window, or use **Open file**.

### Production build

```bash
npm run build
npm start          # serves the built app and the media API from :8787
```

## The play screen

| | |
|---|---|
| Scrubber | Red progress + buffered range, draggable handle, hover card with a **generated thumbnail** and timestamp |
| Controls | Play/pause, ±10s, volume with slide-out slider, playback speed, audio/subtitles, previous/next, miniplayer, full screen |
| Behaviour | Controls and cursor fade after 3s idle (never while paused, scrubbing, or with a menu open), centre icon flash on play/pause/skip, loading spinner, error screen |
| Memory | Resume position per file, plus volume, speed and subtitle language |

Thumbnails are produced on the fly by a second hidden `<video>` seeked to the
hovered time and painted to a canvas — there is no sprite sheet to precompute,
which is the point for arbitrary files on a local drive.

### Keyboard

| Key | |
|---|---|
| `Space` / `K` | Play / pause |
| `←` `→` or `J` `L` | Back / forward 10s |
| `↑` `↓` | Volume |
| `0`–`9` | Jump to 0%–90% |
| `,` `.` | Step one frame (pauses) |
| `<` `>` | Playback speed down / up |
| `M` | Mute |
| `C` | Cycle subtitle tracks |
| `F` | Full screen |
| `P` | Miniplayer |
| `N` | Next video |
| `Esc` | Leave full screen, else back to the library |

## Syncing across devices

Playback state is shared over MQTT, so several screens can watch the same thing
together. Click the broadcast icon in the control bar and turn it on — it is
**off by default**, since it means talking to an external broker, and the choice
is remembered.

Defaults point at the same Mosquitto instance the existing vlsync client uses:

| | |
|---|---|
| Broker | `wss://sync.drish-shel.com:443/mqtt` |
| Topic | `vlsync/test` |

Both are editable in the sync menu. Browsers can only speak MQTT over
WebSockets, which is exactly what that Cloudflare tunnel already exposes, so no
extra server is involved — the page talks to the broker directly.

### What gets sent

Outbound messages come from the **media element's own events** (`play`, `pause`,
`seeked`, `ratechange`) rather than from the buttons. Every route that can move
the playhead — a click, a keyboard shortcut, dragging the scrubber, ±10s, or a
remote command — ends up setting properties on that element, so listening there
catches all of them and cannot fall out of step with the UI. Scrubbing fires
`seeked` continuously, so seeks are debounced into one message per drag.

While playing, a heartbeat every 10s catches gradual drift. A receiver only
corrects if it is more than 1s out, and then waits 3s before correcting again,
so two devices settle instead of chasing each other.

### Wire format

Compatible with the existing Python client (`vlsync/backend/mqtt_client.py`),
which reads `action` (play=true, pause=false, seek=null) and `media_time`:

```json
{
  "sender": "vsync-web-a1b2c3d4",
  "action": true, "media_time": 42, "ping": 9,

  "event": "play", "position": 42.512, "paused": false,
  "rate": 1.5, "media": "Episode.mkv"
}
```

The first row is what existing devices read; the second is added detail they
ignore. Inbound, `position` is preferred over `media_time` when present, so old
and new clients interoperate at whatever precision each supports.

`media` is the bare filename — a device refuses to sync against a different
video rather than seeking your film to a position from someone else's.

### Latency

A message describes where the sender *was*, so a receiver advances it by the
time spent in flight before seeking.

That delay is deliberately **not** computed from timestamps in the message:
nothing guarantees two machines' clocks agree, and a few seconds of skew would
corrupt every correction. Instead each device measures its own round trip to the
broker — we subscribe to the topic we publish on, so our own messages come back
and the delay is directly observable — and publishes half of it as `ping`,
matching what vlsync's `pinger.py` reports. Compensation is the sender's `ping`
plus the receiver's own estimate, clamped to 5s.

### Untrusted input

The topic is a shared room with no authentication, and vlsync's own test scripts
publish plain strings to it, so **every inbound message is treated as hostile**.
Anything unparseable is dropped; anything parseable is clamped before it reaches
the media element:

- Non-JSON, JSON scalars/arrays, missing `sender` or position — ignored outright
- Position clamped to `[0, duration]`; a negative one would otherwise be stored
  and leave the playhead somewhere it can never play from
- Rate clamped to `[0.0625, 16]`; outside that Chrome throws `NotSupportedError`
- Latency compensation clamped to 5s regardless of the sender's `ping`
- The whole apply step is wrapped, so one bad message cannot take down the loop
- `media` is truncated before it reaches the UI

Anyone on the topic can still control playback — use a private topic if that
matters. The clamping bounds what a bad message can do, not who can send one.

### Testing without a second screen

```bash
node scripts/sync-monitor.ts                 # watch the topic
node scripts/sync-monitor.ts pause 123.5     # act as another device
node scripts/sync-monitor.ts play 45 --rate 1.5
node scripts/sync-fuzz.ts                    # 19 malformed/hostile payloads
```

## Subtitles

Sidecar files next to the video are picked up automatically:

```
Movie.mkv
Movie.srt                 -> "Subtitles"
Movie.en.srt              -> "English"
Movie.pt.forced.vtt       -> "Portuguese (Forced)"
Movie.en.sdh.srt          -> "English (CC)"
```

SRT is converted to WebVTT on the fly, since `<track>` only accepts VTT.

Audio track switching only appears when the browser actually exposes more than
one track. Chromium and Firefox generally do not expose `audioTracks` at all, so
the menu stays subtitles-only rather than advertising a control that cannot
work.

## Formats, and why a file plays silently

The player is limited by what the *browser* can decode, not by the server.
MP4 (H.264 + AAC) and WebM always work. MKV plays only when its streams happen
to be H.264/AAC. AVI, WMV, MPEG-TS and similar are listed but flagged
**may not play**.

The nastiest case is not a file that fails outright — it is one that plays
perfectly with **no sound**. Most WEB-DL releases ship Dolby Digital Plus
(`DDP5.1` / E-AC-3) audio, which Chrome and Firefox will not decode, so you get
picture and silence and no error anywhere.

So when you open an MP4 the player reads the container's real codec ids and
asks *this* browser whether it can decode each one (`canPlayType`), because the
answer genuinely differs — Safari and Edge often handle E-AC-3 where Chrome does
not. If something is undecodable you get a notice naming the codec and the
exact ffmpeg command to fix it, rather than silence with no explanation.

Fixing a file is a manual step by design — the player tells you exactly which
command to run and you run it. Re-encode only what is broken; copying the video
stream keeps this fast and lossless for the picture:

```bash
# no sound: E-AC-3 / DTS audio -> stereo AAC, video untouched
ffmpeg -i input.mp4 -c:v copy -c:a aac -ac 2 -b:a 256k output.mp4

# wrong container, codecs already fine: remux, near-instant
ffmpeg -i input.mkv -c copy output.mp4
```

Embedded subtitles (`tx3g` in MP4, or MKV's internal tracks) cannot be rendered
by browsers at all. Extract them next to the video and they get picked up as
sidecars:

```bash
ffmpeg -i input.mp4 -map 0:s:0 "input.en.srt"
```

To see what is inside a file without playing it:

```bash
node scripts/probe.ts "C:/path/to/file.mp4"
# container:  isom
# faststart:  no (moov after mdat)
# video:      H.264 [avc1] 1920x1080
# audio:      Dolby Digital Plus (E-AC-3) [ec-3] 6ch 48000 Hz
# subtitles:  7 embedded (browsers cannot display these)
```

Transcoding on the fly would mean supervising an ffmpeg process per stream,
which is a different project.

## Layout

```
server/
  index.ts        routes, range streaming, static hosting
  library.ts      recursive scan -> MediaItem[]
  media.ts        extensions, MIME types, filename -> title parsing
  subtitles.ts    sidecar discovery, SRT -> VTT
  range.ts        Range header parsing
  paths.ts        opaque media ids + traversal guard
  config.ts       roots from CLI / env / config file
shared/types.ts   the contract between the two halves
src/
  player/         Player, Scrubber, ThumbnailPreview, VolumeControl, menus
  sync/           MQTT transport, wire format, playback sync controller
  launcher/       file chooser
  storage.ts      resume positions + preferences
scripts/
  probe.ts        print a file's real codecs
  sync-monitor.ts watch or inject sync messages
```

### Notes on two things that are easy to get wrong

**Range requests.** Seeking a 4 GB file only works if the server answers
`Range` properly: `206` with `Content-Range`, `416` with `bytes */size` when
unsatisfiable, and support for the suffix form (`bytes=-500`). Multi-range
requests are answered as a normal `200` on purpose — media elements never send
them, and a real `multipart/byteranges` body would be complexity for no gain.

**Large files must be uncacheable.** Streams are served `Cache-Control:
no-store`, and that is load-bearing. Chrome routes media range requests through
its HTTP cache, and a *cacheable* multi-gigabyte response exceeds the per-entry
size limit — the media element then sits at `readyState 0` forever, emitting
`stalled` with no bytes and no error, while `fetch()` on the same URL returns
206 instantly. It reproduces on any file past the limit and looks exactly like a
server bug, which is what makes it expensive to chase. The data is on local disk
anyway, so re-reading costs nothing.

**Two elements, one URL.** No two media elements may share a URL. Chrome keys
its media buffer on the URL and shares it across the whole profile, so the
player and its scrub preview — or the same file open in two tabs, which is
routine once you are syncing — fight over one buffer and can wedge at
`readyState 0` with no error. Each element therefore gets a unique `?c=<nonce>`
per load; the server ignores the parameter, so it only separates cache entries.

**Wedged media state looks like a server bug.** If video stalls at
`readyState 0` with no error while `fetch()` of the same URL returns 206
instantly, check Chrome's own player by opening the stream URL directly. If that
also hangs, the browser's media stack is exhausted — usually from many media
elements created and never torn down — and only a restart clears it. Nothing
server-side will fix it.

### Security

Media ids are `base64url("<rootIndex>:<relPath>")` and are re-validated on every
request: the resolved path must stay inside its configured root, so a crafted id
cannot walk out of your media folders. The server binds to `127.0.0.1` and
serves `GET`/`HEAD` only.
