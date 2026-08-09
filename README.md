# vsync

A web-based video player for files on your local drive, with a Netflix-style
play screen. TypeScript throughout — Vite for the frontend, a small `node:http`
server for streaming.

The brief was the play screen only, so that is the part that is designed. The
file chooser in front of it is deliberately plain.

## Running it

```bash
npm install
npm run dev
```

Then open <http://localhost:5173>.

`npm run dev` starts two processes: the media server on `127.0.0.1:8787` and
Vite on `5173`, with `/api/*` proxied to the server.

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
  launcher/       file chooser
  storage.ts      resume positions + preferences
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

**Two elements, one URL.** The scrub-preview video must not share a URL with the
playing video: they end up sharing Chrome's media buffer for that resource, and
the preview's constant seeking can stall playback on a cold load. The preview
gets `?preview=1` (server-side files) or a second object URL (local files) so
each element has its own buffer.

### Security

Media ids are `base64url("<rootIndex>:<relPath>")` and are re-validated on every
request: the resolved path must stay inside its configured root, so a crafted id
cannot walk out of your media folders. The server binds to `127.0.0.1` and
serves `GET`/`HEAD` only.
