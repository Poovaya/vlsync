import { syncStore, type SyncSettings } from "../storage.ts";
import type { SyncStatus } from "../sync/SyncClient.ts";
import { clear, el } from "../util/dom.ts";
import { icons } from "./icons.ts";
import { Popover } from "./Popover.ts";

export interface SyncMenuCallbacks {
  onToggle(enabled: boolean): void;
  onSettingsChange(settings: SyncSettings): void;
  onOpenChange(open: boolean): void;
}

const STATUS_LABEL: Record<SyncStatus, string> = {
  offline: "Off",
  connecting: "Connecting…",
  connected: "In sync",
  error: "Error",
};

/** Connection state and broker settings for cross-device playback sync. */
export class SyncMenu {
  readonly popover: Popover;

  private settings: SyncSettings;
  private status: SyncStatus = "offline";
  private detail: string | null = null;
  private latencyMs = 0;
  private deviceId = "";

  constructor(private readonly callbacks: SyncMenuCallbacks) {
    this.settings = syncStore.load();

    this.popover = new Popover({
      icon: icons.sync,
      label: "Sync across devices",
      panelClass: "menu--sync",
      onOpenChange: callbacks.onOpenChange,
    });

    this.render();
  }

  setStatus(status: SyncStatus, detail: string | null, latencyMs: number, deviceId: string): void {
    this.status = status;
    this.detail = detail;
    this.latencyMs = latencyMs;
    this.deviceId = deviceId;

    // The button itself carries the state, so you can see it without opening.
    this.popover.button.dataset["state"] = status;
    this.popover.button.dataset["label"] = `Sync: ${STATUS_LABEL[status]}`;

    this.render();
  }

  private render(): void {
    clear(this.popover.panel);

    const toggle = el("button", {
      class: "sync__toggle",
      type: "button",
      text: this.settings.enabled ? "Turn off" : "Turn on",
      on: {
        click: () => {
          this.settings = { ...this.settings, enabled: !this.settings.enabled };
          syncStore.patch({ enabled: this.settings.enabled });
          this.callbacks.onToggle(this.settings.enabled);
          this.render();
        },
      },
    });

    this.popover.panel.append(
      el("div", { class: "menu__title", text: "Sync across devices" }),
      el(
        "div",
        { class: "sync__row" },
        el("span", { class: "sync__dot", data: { state: this.status } }),
        el("span", { class: "sync__status", text: STATUS_LABEL[this.status] }),
        toggle,
      ),
    );

    if (this.detail) {
      this.popover.panel.appendChild(el("p", { class: "sync__detail", text: this.detail }));
    }

    if (this.status === "connected") {
      this.popover.panel.appendChild(
        el("p", {
          class: "sync__detail",
          text: `Latency ${Math.round(this.latencyMs)} ms · this device is ${this.deviceId}`,
        }),
      );
    }

    this.popover.panel.append(
      this.field("Broker", this.settings.url, (value) => {
        this.settings = { ...this.settings, url: value };
        syncStore.patch({ url: value });
        this.callbacks.onSettingsChange(this.settings);
      }),
      this.field("Topic", this.settings.topic, (value) => {
        this.settings = { ...this.settings, topic: value };
        syncStore.patch({ topic: value });
        this.callbacks.onSettingsChange(this.settings);
      }),
      el("p", {
        class: "sync__detail",
        text: "Play, pause, seek and speed changes are shared with every device on this topic.",
      }),
    );
  }

  private field(label: string, value: string, onCommit: (value: string) => void): HTMLElement {
    const input = el("input", {
      class: "sync__input",
      type: "text",
      value,
      aria: { label },
      on: {
        // Commit on blur/Enter rather than per keystroke, so we do not tear the
        // connection down and back up on every character.
        change: () => onCommit(input.value.trim()),
        keydown: (ev: KeyboardEvent) => {
          if (ev.key === "Enter") input.blur();
          ev.stopPropagation();
        },
      },
    });

    return el("label", { class: "sync__field" }, el("span", { text: label }), input);
  }
}
