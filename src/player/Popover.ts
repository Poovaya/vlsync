import { el, on } from "../util/dom.ts";

export interface PopoverOptions {
  icon: string;
  label: string;
  panelClass?: string;
  onOpenChange?: (open: boolean) => void;
}

/**
 * An icon button with a panel anchored above it. Handles the fiddly parts:
 * outside-click dismissal, Escape, and reporting open state so the player can
 * keep the control bar from fading out while a menu is up.
 */
export class Popover {
  readonly root: HTMLElement;
  readonly button: HTMLButtonElement;
  readonly panel: HTMLElement;

  private open = false;
  private readonly disposers: Array<() => void> = [];

  constructor(private readonly options: PopoverOptions) {
    this.button = el("button", {
      class: "ctl",
      type: "button",
      data: { label: options.label },
      aria: { label: options.label, haspopup: "true", expanded: "false" },
      html: options.icon,
      on: {
        click: (ev: MouseEvent) => {
          ev.stopPropagation();
          this.toggle();
        },
      },
    });

    this.panel = el("div", {
      class: options.panelClass ? `menu ${options.panelClass}` : "menu",
      role: "menu",
      data: { open: "false" },
      // Clicks inside the panel must not bubble to the document dismissal
      // handler, which would close the menu before a row's own click runs.
      on: { click: (ev: MouseEvent) => ev.stopPropagation() },
    });

    this.root = el("div", { class: "popover" }, this.button, this.panel);

    this.disposers.push(
      on<Document, MouseEvent>(document, "click", () => {
        if (this.open) this.setOpen(false);
      }),
      on<Document, KeyboardEvent>(document, "keydown", (ev) => {
        if (ev.key === "Escape" && this.open) {
          ev.stopPropagation();
          this.setOpen(false);
          this.button.focus();
        }
      }),
    );
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    this.setOpen(!this.open);
  }

  setOpen(open: boolean): void {
    if (this.open === open) return;
    this.open = open;
    this.panel.dataset["open"] = String(open);
    this.button.setAttribute("aria-expanded", String(open));
    this.options.onOpenChange?.(open);
  }

  setDisabled(disabled: boolean): void {
    this.button.disabled = disabled;
    if (disabled) this.setOpen(false);
  }

  dispose(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
  }
}
