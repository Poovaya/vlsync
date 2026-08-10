/**
 * Inline SVG icons on a 24x24 grid, sized by CSS and coloured with
 * currentColor. Inlining keeps them themeable and avoids a sprite fetch.
 */

const wrap = (body: string, extra = ""): string =>
  `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" ${extra}>${body}</svg>`;

const stroke = (body: string, width = 2): string =>
  wrap(body, `fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`);

const fill = (body: string): string => wrap(body, `fill="currentColor"`);

export const icons = {
  play: fill('<path d="M6.5 4.2a.8.8 0 0 1 1.2-.7l11.4 7.1a.8.8 0 0 1 0 1.4L7.7 19.1a.8.8 0 0 1-1.2-.7V4.2Z"/>'),

  pause: fill('<path d="M6.5 4h3.6v16H6.5zM13.9 4h3.6v16h-3.6z"/>'),

  /**
   * Skip icons reuse one arc and mirror it, so the two always stay visually
   * symmetrical instead of drifting apart as separate hand-drawn paths.
   */
  back10: wrap(
    `<g fill="currentColor">
       <path d="M12 5.2V1.6L6.8 6.4 12 11.2V7.6a5.9 5.9 0 1 1-5.9 5.9H3.7A8.3 8.3 0 1 0 12 5.2Z"/>
     </g>
     <text x="12" y="17" text-anchor="middle" font-size="7.4" font-weight="700" font-family="inherit" fill="currentColor">10</text>`,
  ),

  forward10: wrap(
    `<g fill="currentColor" transform="translate(24 0) scale(-1 1)">
       <path d="M12 5.2V1.6L6.8 6.4 12 11.2V7.6a5.9 5.9 0 1 1-5.9 5.9H3.7A8.3 8.3 0 1 0 12 5.2Z"/>
     </g>
     <text x="12" y="17" text-anchor="middle" font-size="7.4" font-weight="700" font-family="inherit" fill="currentColor">10</text>`,
  ),

  volumeHigh: wrap(
    `<path d="M11.4 4.3 6.6 8.4H3.2a.8.8 0 0 0-.8.8v5.6c0 .44.36.8.8.8h3.4l4.8 4.1a.7.7 0 0 0 1.15-.53V4.83a.7.7 0 0 0-1.15-.53Z" fill="currentColor"/>
     <path d="M16.2 9.1a4 4 0 0 1 0 5.8M18.9 6.3a7.8 7.8 0 0 1 0 11.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>`,
  ),

  volumeLow: wrap(
    `<path d="M11.4 4.3 6.6 8.4H3.2a.8.8 0 0 0-.8.8v5.6c0 .44.36.8.8.8h3.4l4.8 4.1a.7.7 0 0 0 1.15-.53V4.83a.7.7 0 0 0-1.15-.53Z" fill="currentColor"/>
     <path d="M16.2 9.1a4 4 0 0 1 0 5.8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>`,
  ),

  volumeMuted: wrap(
    `<path d="M11.4 4.3 6.6 8.4H3.2a.8.8 0 0 0-.8.8v5.6c0 .44.36.8.8.8h3.4l4.8 4.1a.7.7 0 0 0 1.15-.53V4.83a.7.7 0 0 0-1.15-.53Z" fill="currentColor"/>
     <path d="m16.3 9.4 5.4 5.4m0-5.4-5.4 5.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>`,
  ),

  subtitles: wrap(
    `<rect x="2.2" y="4.6" width="19.6" height="14.8" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.8"/>
     <path d="M6 11.2h5.2M13.4 11.2h4.6M6 14.9h3.2M11.4 14.9h6.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  ),

  speed: wrap(
    `<path d="M3.6 17.4a9.2 9.2 0 1 1 16.8 0" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
     <path d="M12 16.2 16.1 9.8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
     <circle cx="12" cy="16.9" r="1.7" fill="currentColor"/>`,
  ),

  next: fill('<path d="M5.2 4.4a.7.7 0 0 1 1.08-.6l9.5 6.9a.85.85 0 0 1 0 1.4l-9.5 6.9a.7.7 0 0 1-1.08-.6V4.4Z"/><path d="M17.4 4h2.6v16h-2.6z"/>'),

  previous: fill('<path d="M18.8 4.4a.7.7 0 0 0-1.08-.6l-9.5 6.9a.85.85 0 0 0 0 1.4l9.5 6.9a.7.7 0 0 0 1.08-.6V4.4Z"/><path d="M4 4h2.6v16H4z"/>'),

  fullscreenEnter: stroke(
    '<path d="M4 9.2V5.4a1.4 1.4 0 0 1 1.4-1.4h3.8M14.8 4h3.8A1.4 1.4 0 0 1 20 5.4v3.8M20 14.8v3.8a1.4 1.4 0 0 1-1.4 1.4h-3.8M9.2 20H5.4A1.4 1.4 0 0 1 4 18.6v-3.8"/>',
  ),

  fullscreenExit: stroke(
    '<path d="M9.4 4v3.9a1.5 1.5 0 0 1-1.5 1.5H4M14.6 4v3.9a1.5 1.5 0 0 0 1.5 1.5H20M9.4 20v-3.9a1.5 1.5 0 0 0-1.5-1.5H4M14.6 20v-3.9a1.5 1.5 0 0 1 1.5-1.5H20"/>',
  ),

  pip: wrap(
    `<rect x="2.4" y="4.6" width="19.2" height="14.8" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/>
     <rect x="12.2" y="11.6" width="7.6" height="5.8" rx="1.1" fill="currentColor"/>`,
  ),

  back: stroke('<path d="M20 12H4.6M11.4 4.8 4.2 12l7.2 7.2"/>', 2.1),

  /** Broadcast rings: reads as "this screen is talking to other screens". */
  sync: wrap(
    `<circle cx="12" cy="17.6" r="2.1" fill="currentColor"/>
     <path d="M8.1 14.3a5.5 5.5 0 0 1 7.8 0M5 11.1a10 10 0 0 1 14 0" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>`,
  ),

  check: stroke('<path d="M20 6.5 9.3 17.2 4 11.9"/>', 2.4),

  warning: wrap(
    `<path d="M12 3.4 22 20.6H2L12 3.4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
     <path d="M12 9.6v4.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
     <circle cx="12" cy="17.4" r="1.05" fill="currentColor"/>`,
  ),
} as const;

export type IconName = keyof typeof icons;
