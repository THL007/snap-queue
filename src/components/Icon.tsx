// Snap Queue's one icon set: custom inline SVG, 24px grid, 2px round strokes in currentColor (Hum ink).
// Decorative by default (aria-hidden); the text beside each icon carries the meaning.

const P: Record<string, string> = {
  plus: "M12 5v14M5 12h14",
  sliders: "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4",
  sync: "M20 11a8 8 0 0 0-14.6-4.4L4 8M4 3.5V8h4.5M4 13a8 8 0 0 0 14.6 4.4L20 16M20 20.5V16h-4.5",
  reply: "M9 15 4 10l5-5M4 10h10a6 6 0 0 1 6 6v3",
  hourglass: "M7 3h10M7 21h10M8 3c0 6 8 6 8 9s-8 3-8 9M16 3c0 6-8 6-8 9s8 3 8 9",
  calendar: "M6 5h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3zM3 10h18M8 3v4M16 3v4",
  pause: "M9 6v12M15 6v12",
  list: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  search: "M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4",
  chat: "M6 4h12a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-7l-5 4v-4a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z",
  snap: "M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z",
  call: "M6 4h3l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v3a2 2 0 0 1-2 2A15 15 0 0 1 4 6a2 2 0 0 1 2-2z",
  send: "M4 12 20 4l-5 16-3-7-8-1zM12 13l8-9",
  flame: "M12 3c.8 3.6 6 6 6 11a6 6 0 0 1-12 0c0-2.6 1.4-4 2-6.5 1.5 1 2.6 2.6 2.8 4.5C12.4 10.6 12.6 7 12 3z",
  clock: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7v5l3 2",
  pin: "M9 3h6l-1 6 4 3v2H6v-2l4-3-1-6zM12 14v7",
  x: "M6 6l12 12M18 6 6 18",
  copy: "M11 9h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM5 15a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3",
  sparkle: "M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9L11 3zM19 15v5M16.5 17.5h5",
  flag: "M5 21V4M5 4h12l-2.5 4.5L17 13H5",
  pencil: "M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4",
  arrow: "M5 12h14M13 6l6 6-6 6",
  check: "M5 12.5l4.5 4.5L19 7",
  key: "M8 11a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM11 12l9-9M16.5 6.5l3 3",
  undo: "M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
  alert: "M12 3 2 20h20L12 3zM12 10v4M12 17h.01",
  inbox: "M4 13l2.5-8h11L20 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6zM4 13h5l1 3h4l1-3h5",
};
export type IconName = keyof typeof P;

export function Icon({ name, filled, size, label }: { name: IconName; filled?: boolean; size?: number; label?: string }) {
  return (
    <svg
      className="icon"
      data-fill={filled ? "true" : undefined}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      focusable="false"
    >
      <path d={P[name]} />
    </svg>
  );
}
