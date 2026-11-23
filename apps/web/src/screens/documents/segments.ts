/*
 * The page as the viewer draws it: segments cut at every chunk's first character and at the
 * cited span, so the margin can mark where each chunk starts and the span is one `mark`.
 * Joined back together the segments are the body, character for character.
 */

export interface Segment {
  start: number;
  end: number;
  text: string;
  /** The ordinals of the chunks that start at this segment's first character. */
  chunkStarts: number[];
  highlighted: boolean;
}

export interface Span {
  from: number;
  to: number;
}

export function segmentsOf(body: string, chunks: readonly { ordinal: number; startChar: number; endChar?: number }[], span: Span | null): Segment[] {
  const sound = span && span.from >= 0 && span.to > span.from && span.to <= body.length ? span : null;
  const cuts = new Set<number>([0, body.length]);
  for (const c of chunks) if (c.startChar >= 0 && c.startChar < body.length) cuts.add(c.startChar);
  if (sound) {
    cuts.add(sound.from);
    cuts.add(sound.to);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const segments: Segment[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const start = points[i]!;
    const end = points[i + 1]!;
    if (end <= start) continue;
    segments.push({
      start,
      end,
      text: body.slice(start, end),
      chunkStarts: chunks.filter((c) => c.startChar === start).map((c) => c.ordinal).sort((a, b) => a - b),
      highlighted: sound !== null && start >= sound.from && end <= sound.to,
    });
  }
  return segments;
}
