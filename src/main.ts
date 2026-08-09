import "./styles/tokens.css";
import "./styles/player.css";
import "./styles/launcher.css";

import type { MediaItem } from "../shared/types.ts";
import { Launcher } from "./launcher/Launcher.ts";
import { Player } from "./player/Player.ts";
import { sourceFromFile, sourceFromMediaItem, type PlaybackSource } from "./types.ts";
import { clear } from "./util/dom.ts";

/**
 * Two screens: the launcher (choose a file) and the player (the Netflix play
 * screen). The app owns the playlist and therefore the lifetime of any object
 * URLs in it; the player only ever borrows a source.
 */
class App {
  private readonly launcher: Launcher;
  private player: Player | null = null;

  private playlist: PlaybackSource[] = [];
  private index = -1;

  constructor(private readonly mount: HTMLElement) {
    this.launcher = new Launcher({
      onPlayLibrary: (items, index) => this.startLibrary(items, index),
      onPlayFiles: (files, index) => this.startFiles(files, index),
    });
  }

  start(): void {
    this.showLauncher();
    void this.launcher.refresh();
  }

  /* ------------------------------------------------------------ playlist -- */

  private startLibrary(items: MediaItem[], index: number): void {
    this.setPlaylist(items.map(sourceFromMediaItem));
    this.playAt(index);
  }

  private startFiles(files: File[], index: number): void {
    this.setPlaylist(files.map(sourceFromFile));
    this.playAt(index);
  }

  private setPlaylist(sources: PlaybackSource[]): void {
    // Release the previous playlist's object URLs before dropping the array.
    for (const source of this.playlist) source.dispose();
    this.playlist = sources;
    this.index = -1;
  }

  private playAt(index: number): void {
    const source = this.playlist[index];
    if (!source) return;

    this.index = index;

    if (!this.player) {
      this.player = new Player({
        onExit: () => this.exitToLauncher(),
        onNext: () => this.playAt(this.index + 1),
        onPrevious: () => this.playAt(this.index - 1),
      });

      clear(this.mount);
      this.mount.appendChild(this.player.root);
    }

    this.player.load({
      source,
      hasNext: index < this.playlist.length - 1,
      hasPrevious: index > 0,
    });
  }

  /* -------------------------------------------------------------- screens -- */

  private showLauncher(): void {
    clear(this.mount);
    this.mount.appendChild(this.launcher.root);
  }

  private exitToLauncher(): void {
    this.player?.dispose();
    this.player = null;

    this.setPlaylist([]);
    this.showLauncher();

    // Re-scan so "Resume" badges and any newly added files are current.
    void this.launcher.refresh();
  }
}

const mount = document.getElementById("app");
if (!mount) throw new Error("#app is missing from index.html");

new App(mount).start();
