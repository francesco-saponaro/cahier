/*
 * A person as themselves: a stable initial on a pale tint of their own hue. The hue comes from
 * the id, so Léa is the same colour on every screen, and the tint stays identity, never data.
 */

export function hueOf(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function Initial({ id, name, large }: { id: string; name: string; large?: boolean }) {
  const letter = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span className={large ? "initial lg" : "initial"} style={{ background: `hsl(${hueOf(id)} 45% 88%)` }} aria-hidden="true">
      {letter}
    </span>
  );
}
