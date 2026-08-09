/** Tiny hyperscript helper. Keeps view code declarative without a framework. */

type Child = Node | string | number | null | undefined | false | Child[];

export interface ElProps {
  class?: string;
  text?: string;
  html?: string;
  title?: string;
  type?: string;
  role?: string;
  tabIndex?: number;
  disabled?: boolean;
  placeholder?: string;
  value?: string;
  data?: Record<string, string>;
  aria?: Record<string, string>;
  style?: Partial<CSSStyleDeclaration>;
  on?: Partial<Record<keyof HTMLElementEventMap, (ev: never) => void>>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.html !== undefined) node.innerHTML = props.html;
  if (props.title !== undefined) node.title = props.title;
  if (props.role !== undefined) node.setAttribute("role", props.role);
  if (props.tabIndex !== undefined) node.tabIndex = props.tabIndex;

  if (props.type !== undefined && "type" in node) {
    (node as HTMLElement & { type: string }).type = props.type;
  }
  if (props.disabled !== undefined && "disabled" in node) {
    (node as HTMLElement & { disabled: boolean }).disabled = props.disabled;
  }
  if (props.placeholder !== undefined && "placeholder" in node) {
    (node as HTMLElement & { placeholder: string }).placeholder = props.placeholder;
  }
  if (props.value !== undefined && "value" in node) {
    (node as HTMLElement & { value: string }).value = props.value;
  }

  if (props.data) {
    for (const [key, value] of Object.entries(props.data)) node.dataset[key] = value;
  }
  if (props.aria) {
    for (const [key, value] of Object.entries(props.aria)) node.setAttribute(`aria-${key}`, value);
  }
  if (props.style) Object.assign(node.style, props.style);

  if (props.on) {
    for (const [event, handler] of Object.entries(props.on)) {
      if (handler) node.addEventListener(event, handler as EventListener);
    }
  }

  append(node, children);
  return node;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  }
}

/** Remove every child without touching the parent itself. */
export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * Attach a listener and get back a disposer. Collecting these makes teardown a
 * single loop instead of a mirror-image list of removeEventListener calls.
 */
export function on<T extends EventTarget, E extends Event = Event>(
  target: T,
  event: string,
  handler: (ev: E) => void,
  options?: AddEventListenerOptions,
): () => void {
  const listener = handler as EventListener;
  target.addEventListener(event, listener, options);
  return () => target.removeEventListener(event, listener, options);
}

/** Fraction (0..1) of where `clientX` falls across an element's box. */
export function ratioFromPointer(element: HTMLElement, clientX: number): number {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0) return 0;
  return clamp((clientX - rect.left) / rect.width, 0, 1);
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
