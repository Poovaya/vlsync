import type { SubtitleTrack } from "../../shared/types.ts";
import { clear, el } from "../util/dom.ts";
import { icons } from "./icons.ts";
import { Popover } from "./Popover.ts";

/** The five rates Netflix offers, plus 2x — useful when it is your own file. */
export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export interface SpeedMenuOptions {
  onSelect(rate: number): void;
  onOpenChange(open: boolean): void;
}

export interface SpeedMenu {
  popover: Popover;
  setRate(rate: number): void;
}

/** Playback speed as a labelled track with detents, mirroring Netflix. */
export function createSpeedMenu(options: SpeedMenuOptions): SpeedMenu {
  const popover = new Popover({
    icon: icons.speed,
    label: "Playback speed",
    panelClass: "speed",
    onOpenChange: options.onOpenChange,
  });

  const fill = el("div", { class: "speed__fill" });
  const line = el("div", { class: "speed__line" }, fill);
  const track = el("div", { class: "speed__track" }, line);

  const stops = PLAYBACK_RATES.map((rate, index) => {
    const percent = (index / (PLAYBACK_RATES.length - 1)) * 100;
    const stop = el("button", {
      class: "speed__stop",
      type: "button",
      role: "menuitemradio",
      text: rate === 1 ? "1x (Normal)" : `${rate}x`,
      aria: { checked: "false" },
      style: { left: `${percent}%` },
      on: { click: () => options.onSelect(rate) },
    });
    track.appendChild(stop);
    return { rate, stop, percent };
  });

  popover.panel.append(el("div", { class: "menu__title", text: "Playback Speed" }), track);

  return {
    popover,
    setRate(rate: number): void {
      let matched = stops[stops.length - 1];
      for (const stop of stops) {
        const isCurrent = stop.rate === rate;
        stop.stop.setAttribute("aria-checked", String(isCurrent));
        if (isCurrent) matched = stop;
      }
      // The white fill runs from the left edge up to the selected detent.
      fill.style.width = `${matched?.percent ?? 0}%`;
    },
  };
}

export interface AudioOption {
  index: number;
  label: string;
}

export interface SubtitlesMenuOptions {
  onSelectSubtitle(index: number | null): void;
  onSelectAudio(index: number): void;
  onOpenChange(open: boolean): void;
}

export interface SubtitlesMenu {
  popover: Popover;
  update(state: {
    subtitles: SubtitleTrack[];
    activeSubtitle: number | null;
    audio: AudioOption[];
    activeAudio: number | null;
  }): void;
}

/**
 * Audio + subtitles picker. The audio column only appears when the browser
 * actually exposes more than one track (Chromium and Firefox generally do not
 * expose `audioTracks` at all), so the menu never advertises a control that
 * cannot work.
 */
export function createSubtitlesMenu(options: SubtitlesMenuOptions): SubtitlesMenu {
  const popover = new Popover({
    icon: icons.subtitles,
    label: "Audio and subtitles",
    panelClass: "menu--columns",
    onOpenChange: options.onOpenChange,
  });

  return {
    popover,
    update({ subtitles, activeSubtitle, audio, activeAudio }): void {
      clear(popover.panel);

      // Drives the grid: without an audio column the panel must collapse to
      // one column rather than leaving an empty half.
      popover.panel.dataset["columns"] = audio.length > 1 ? "2" : "1";

      if (audio.length > 1) {
        const column = el("div", {}, el("div", { class: "menu__title", text: "Audio" }));
        for (const option of audio) {
          column.appendChild(
            menuItem(option.label, option.index === activeAudio, () => options.onSelectAudio(option.index)),
          );
        }
        popover.panel.appendChild(column);
      }

      const subsColumn = el("div", {}, el("div", { class: "menu__title", text: "Subtitles" }));
      subsColumn.appendChild(menuItem("Off", activeSubtitle === null, () => options.onSelectSubtitle(null)));

      subtitles.forEach((track, index) => {
        subsColumn.appendChild(
          menuItem(track.label, activeSubtitle === index, () => options.onSelectSubtitle(index)),
        );
      });

      if (subtitles.length === 0) {
        subsColumn.appendChild(
          el("div", {
            class: "menu__item",
            text: "No sidecar subtitles found",
            style: { opacity: "0.55", cursor: "default" },
          }),
        );
      }

      popover.panel.appendChild(subsColumn);
    },
  };
}

function menuItem(label: string, checked: boolean, onClick: () => void): HTMLButtonElement {
  return el(
    "button",
    {
      class: "menu__item",
      type: "button",
      role: "menuitemradio",
      aria: { checked: String(checked) },
      on: { click: onClick },
    },
    el("span", { class: "menu__check", html: icons.check }),
    el("span", { text: label }),
  );
}
