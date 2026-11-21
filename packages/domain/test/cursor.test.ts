import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { decodeCursor, encodeCursor, keysetPage, pageQuery, type Page } from "../src/cursor.js";

describe("cursors", () => {
  test("round-trip a key and an id through an opaque string", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.integer()), fc.string(), (key, id) => {
        const cursor = encodeCursor({ key, id });
        expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(decodeCursor(cursor)).toEqual({ key, id });
      }),
    );
  });

  test("a cursor nobody produced decodes to null, never to an exception", () => {
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("not a cursor")).toBeNull();
    expect(decodeCursor(Buffer.from("[1,2]").toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from('{"key":{"deep":true},"id":"x"}').toString("base64url"))).toBeNull();
  });

  test("a page request is clamped to between one and fifty items, twenty by default", () => {
    expect(pageQuery(undefined)).toEqual({ limit: 20, cursor: null });
    expect(pageQuery({ limit: 0 })).toEqual({ limit: 1, cursor: null });
    expect(pageQuery({ limit: 500, cursor: "abc" })).toEqual({ limit: 50, cursor: "abc" });
    expect(pageQuery({ limit: 7.9 })).toEqual({ limit: 7, cursor: null });
  });
});

describe("keysetPage", () => {
  const items = Array.from({ length: 7 }, (_, i) => ({ id: `i${i}`, name: ["b", "a", "c", "a", "b", "d", "a"][i]!, at: 100 - i }));

  test("walks a list sorted by a key and then by id, a page at a time, until the cursor is null", () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const page: Page<(typeof items)[number]> = keysetPage(items, { key: (x) => x.name, direction: "asc" }, { limit: 3, cursor });
      seen.push(...page.items.map((x) => `${x.name}:${x.id}`));
      cursor = page.nextCursor;
      if (cursor === null) break;
    }
    expect(seen).toEqual(["a:i1", "a:i3", "a:i6", "b:i0", "b:i4", "c:i2", "d:i5"]);
  });

  test("walks a descending numeric key the same way, with ids descending inside a tie", () => {
    const tied = [...items, { id: "i9", name: "z", at: 100 }];
    const first = keysetPage(tied, { key: (x) => x.at, direction: "desc" }, { limit: 2, cursor: null });
    expect(first.items.map((x) => x.id)).toEqual(["i9", "i0"]);
    const second = keysetPage(tied, { key: (x) => x.at, direction: "desc" }, { limit: 2, cursor: first.nextCursor });
    expect(second.items.map((x) => x.id)).toEqual(["i1", "i2"]);
  });

  test("the last page is exactly full when the list divides evenly, and still ends with a null cursor", () => {
    const page = keysetPage(items.slice(0, 6), { key: (x) => x.name, direction: "asc" }, { limit: 6, cursor: null });
    expect(page.items).toHaveLength(6);
    expect(page.nextCursor).toBeNull();
  });
});
