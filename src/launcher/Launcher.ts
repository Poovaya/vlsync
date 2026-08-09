import type { LibraryResponse, MediaItem } from "../../shared/types.ts";
import { ApiUnavailableError, fetchLibrary } from "../api.ts";
import { icons } from "../player/icons.ts";
import { progressStore } from "../storage.ts";
import { clear, el, on } from "../util/dom.ts";
import { formatBytes, formatTime } from "../util/format.ts";

export interface LauncherCallbacks {
  /** Play `items[index]`, using the whole filtered list as the playlist. */
  onPlayLibrary(items: MediaItem[], index: number): void;
  onPlayFiles(files: File[], index: number): void;
}

const VIDEO_MIME = /^video\//;
const VIDEO_EXT = /\.(mp4|m4v|webm|ogv|ogg|mov|mkv|avi|wmv|flv|mpe?g|m2ts|mts|ts|3gp|divx)$/i;

/**
 * A plain file chooser. The brief was the Netflix play screen, so this stays
 * deliberately utilitarian rather than imitating the browse rows too.
 */
export class Launcher {
  readonly root: HTMLElement;

  private readonly listEl: HTMLElement;
  private readonly rootsEl: HTMLElement;
  private readonly searchEl: HTMLInputElement;
  private readonly fileInput: HTMLInputElement;
  private readonly disposers: Array<() => void> = [];

  private library: LibraryResponse | null = null;
  private loadError: string | null = null;
  private query = "";
  private dragDepth = 0;

  constructor(private readonly callbacks: LauncherCallbacks) {
    this.listEl = el("div", { class: "launcher__list" });
    this.rootsEl = el("div", { class: "launcher__roots" });

    this.searchEl = el("input", {
      class: "launcher__search",
      type: "search",
      placeholder: "Search your library",
      aria: { label: "Search your library" },
      on: {
        input: () => {
          this.query = this.searchEl.value.trim().toLowerCase();
          this.renderList();
        },
      },
    });

    this.fileInput = el("input", {
      type: "file",
      style: { display: "none" },
      on: {
        change: () => {
          const files = Array.from(this.fileInput.files ?? []);
          if (files.length > 0) this.callbacks.onPlayFiles(files, 0);
          this.fileInput.value = "";
        },
      },
    });
    this.fileInput.multiple = true;
    this.fileInput.accept = "video/*";

    this.root = el(
      "div",
      { class: "launcher", data: { dragging: "false" } },
      el(
        "div",
        { class: "launcher__head" },
        el("div", { class: "launcher__brand", text: "vsync" }),
        el("div", { class: "launcher__hint", text: "Pick something to play" }),
        el(
          "div",
          { class: "launcher__actions" },
          this.searchEl,
          el("button", {
            class: "btn-ghost",
            type: "button",
            text: "Open file",
            on: { click: () => this.fileInput.click() },
          }),
          el("button", {
            class: "btn-ghost",
            type: "button",
            text: "Rescan",
            on: { click: () => void this.refresh(true) },
          }),
        ),
      ),
      this.rootsEl,
      this.listEl,
      el("div", { class: "launcher__drop" }, el("span", { text: "Drop a video to play it" })),
      this.fileInput,
    );

    this.bindDragAndDrop();
  }

  async refresh(force = false): Promise<void> {
    try {
      this.library = await fetchLibrary({ refresh: force });
      this.loadError = null;
    } catch (err) {
      this.library = null;
      this.loadError =
        err instanceof ApiUnavailableError
          ? "The media server is not running."
          : err instanceof Error
            ? err.message
            : "Could not load the library.";
    }

    this.renderRoots();
    this.renderList();
  }

  focusSearch(): void {
    this.searchEl.focus();
  }

  dispose(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
  }

  /* --------------------------------------------------------------- view -- */

  private renderRoots(): void {
    clear(this.rootsEl);
    if (!this.library) return;

    for (const root of this.library.roots) {
      this.rootsEl.appendChild(
        el("span", {
          class: "root-chip",
          data: { missing: String(!root.exists) },
          text: root.exists ? `${root.path} · ${root.fileCount}` : `${root.path} · missing`,
        }),
      );
    }

    if (this.library.truncated) {
      this.rootsEl.appendChild(
        el("span", { class: "root-chip", text: "list truncated — raise MAX_FILES" }),
      );
    }
  }

  private renderList(): void {
    clear(this.listEl);

    if (this.loadError) {
      this.listEl.appendChild(this.renderServerHelp());
      return;
    }

    const items = this.filteredItems();

    if (items.length === 0) {
      this.listEl.appendChild(
        el("div", {
          class: "launcher__empty",
          html: this.query
            ? `Nothing matches <strong>${escapeHtml(this.query)}</strong>.`
            : "No video files found in the configured folders.<br>Point the server somewhere else, or drop a file onto this window.",
        }),
      );
      return;
    }

    for (const [index, item] of items.entries()) {
      this.listEl.appendChild(this.renderRow(item, () => this.callbacks.onPlayLibrary(items, index)));
    }
  }

  private renderRow(item: MediaItem, onPlay: () => void): HTMLElement {
    const resume = progressStore.resumePoint(`server:${item.id}`);

    const meta = [item.relPath, formatBytes(item.size)].filter(Boolean).join("  ·  ");

    const badges = el("span", { class: "file-row__badges" });
    if (resume !== null) {
      badges.appendChild(
        el("span", { class: "badge badge--resume", text: `Resume ${formatTime(resume)}` }),
      );
    }
    badges.appendChild(el("span", { class: "badge", text: item.ext }));
    if (item.subtitles.length > 0) {
      badges.appendChild(el("span", { class: "badge", text: `CC ${item.subtitles.length}` }));
    }
    if (!item.likelyPlayable) {
      badges.appendChild(el("span", { class: "badge badge--warn", text: "may not play" }));
    }

    return el(
      "button",
      { class: "file-row", type: "button", on: { click: onPlay } },
      el("span", { class: "file-row__play", html: icons.play }),
      el(
        "span",
        { class: "file-row__body" },
        el("span", {
          class: "file-row__title",
          text: item.subtitle ? `${item.title} — ${item.subtitle}` : item.title,
        }),
        el("span", { class: "file-row__meta", text: meta }),
      ),
      badges,
    );
  }

  private renderServerHelp(): HTMLElement {
    return el("div", {
      class: "launcher__empty",
      html:
        `<p><strong>${escapeHtml(this.loadError ?? "")}</strong></p>` +
        `<p>Start it with <code>npm run dev</code>, or point it at your folders:</p>` +
        `<p><code>npm run dev:server -- "D:/Movies" "E:/Shows"</code></p>` +
        `<p style="margin-top:1.5rem">You can still play a single file — drop it anywhere on this window, or use <strong>Open file</strong>.</p>`,
    });
  }

  private filteredItems(): MediaItem[] {
    const items = this.library?.items ?? [];
    if (!this.query) return items;

    return items.filter((item) => {
      const haystack = `${item.title} ${item.subtitle ?? ""} ${item.relPath}`.toLowerCase();
      return haystack.includes(this.query);
    });
  }

  /* ----------------------------------------------------------- dragdrop -- */

  private bindDragAndDrop(): void {
    const setDragging = (active: boolean): void => {
      this.root.dataset["dragging"] = String(active);
    };

    this.disposers.push(
      on<HTMLElement, DragEvent>(this.root, "dragenter", (ev) => {
        ev.preventDefault();
        this.dragDepth += 1;
        setDragging(true);
      }),

      on<HTMLElement, DragEvent>(this.root, "dragover", (ev) => {
        // Without this the browser navigates to the dropped file instead.
        ev.preventDefault();
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
      }),

      on<HTMLElement, DragEvent>(this.root, "dragleave", (ev) => {
        ev.preventDefault();
        // dragleave also fires when crossing between child elements, so track
        // depth rather than clearing on the first one.
        this.dragDepth = Math.max(0, this.dragDepth - 1);
        if (this.dragDepth === 0) setDragging(false);
      }),

      on<HTMLElement, DragEvent>(this.root, "drop", (ev) => {
        ev.preventDefault();
        this.dragDepth = 0;
        setDragging(false);

        const files = Array.from(ev.dataTransfer?.files ?? []).filter(
          (file) => VIDEO_MIME.test(file.type) || VIDEO_EXT.test(file.name),
        );

        if (files.length > 0) this.callbacks.onPlayFiles(files, 0);
      }),

      // Safety net: if a drag ends outside the window, the matching dragleave
      // can go missing and the full-screen overlay would swallow every click
      // from then on. Reset unconditionally rather than trusting the count.
      on(window, "dragend", () => {
        this.dragDepth = 0;
        setDragging(false);
      }),
      on(window, "blur", () => {
        this.dragDepth = 0;
        setDragging(false);
      }),
    );
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
