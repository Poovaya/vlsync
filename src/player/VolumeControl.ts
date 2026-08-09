import { clamp, el, on, ratioFromPointer } from "../util/dom.ts";
import { icons } from "./icons.ts";

export interface VolumeCallbacks {
  onVolumeChange(volume: number): void;
  onToggleMute(): void;
}

/** Speaker button plus the slider that slides open on hover, as on Netflix. */
export class VolumeControl {
  readonly root: HTMLElement;

  private readonly button: HTMLButtonElement;
  private readonly bar: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly handle: HTMLElement;
  private readonly disposers: Array<() => void> = [];

  private dragging = false;

  constructor(private readonly callbacks: VolumeCallbacks) {
    this.button = el("button", {
      class: "ctl",
      type: "button",
      data: { label: "Volume" },
      aria: { label: "Mute" },
      html: icons.volumeHigh,
      on: { click: () => this.callbacks.onToggleMute() },
    });

    this.fill = el("div", { class: "volume__fill" });
    this.handle = el("div", { class: "volume__handle" });

    this.bar = el(
      "div",
      {
        class: "volume__bar",
        role: "slider",
        tabIndex: 0,
        aria: { label: "Volume", valuemin: "0", valuemax: "100", valuenow: "100" },
      },
      el("div", { class: "volume__track" }, this.fill),
      this.handle,
    );

    this.root = el(
      "div",
      { class: "volume" },
      this.button,
      el("div", { class: "volume__slider" }, this.bar),
    );

    this.bindPointer();
    this.bindKeyboard();
  }

  setState(volume: number, muted: boolean): void {
    const effective = muted ? 0 : volume;

    this.fill.style.transform = `scaleX(${effective})`;
    this.handle.style.left = `${effective * 100}%`;
    this.bar.setAttribute("aria-valuenow", Math.round(effective * 100).toString());

    this.button.innerHTML = muted || volume === 0
      ? icons.volumeMuted
      : volume < 0.5
        ? icons.volumeLow
        : icons.volumeHigh;

    const label = muted ? "Unmute" : "Mute";
    this.button.setAttribute("aria-label", label);
    this.button.dataset["label"] = label;
  }

  dispose(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
  }

  private bindPointer(): void {
    const apply = (clientX: number): void => {
      this.callbacks.onVolumeChange(ratioFromPointer(this.bar, clientX));
    };

    this.disposers.push(
      on<HTMLElement, PointerEvent>(this.bar, "pointerdown", (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        this.bar.setPointerCapture(ev.pointerId);
        this.dragging = true;
        this.root.dataset["open"] = "true";
        apply(ev.clientX);
      }),

      on<HTMLElement, PointerEvent>(this.bar, "pointermove", (ev) => {
        if (this.dragging) apply(ev.clientX);
      }),

      on<HTMLElement, PointerEvent>(this.bar, "pointerup", (ev) => {
        if (!this.dragging) return;
        this.bar.releasePointerCapture(ev.pointerId);
        this.dragging = false;
        // Let the slider collapse again once the pointer leaves.
        delete this.root.dataset["open"];
      }),

      on<HTMLElement, PointerEvent>(this.bar, "pointercancel", () => {
        this.dragging = false;
        delete this.root.dataset["open"];
      }),
    );
  }

  private bindKeyboard(): void {
    this.disposers.push(
      on<HTMLElement, KeyboardEvent>(this.bar, "keydown", (ev) => {
        const current = Number(this.bar.getAttribute("aria-valuenow") ?? "0") / 100;
        let next: number | null = null;

        if (ev.key === "ArrowRight" || ev.key === "ArrowUp") next = current + 0.05;
        else if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") next = current - 0.05;
        else if (ev.key === "Home") next = 0;
        else if (ev.key === "End") next = 1;

        if (next === null) return;
        ev.preventDefault();
        ev.stopPropagation();
        this.callbacks.onVolumeChange(clamp(next, 0, 1));
      }),
    );
  }
}
