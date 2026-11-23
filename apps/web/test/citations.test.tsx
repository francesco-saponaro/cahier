import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { AnswerBody, viewerHref } from "../src/screens/chat/Citations";

describe("citations in an answer", () => {
  test("the viewer link carries the document, the span and the version", () => {
    expect(viewerHref({ documentId: "doc_1", startChar: 344, endChar: 465, documentVersion: 1 })).toBe("/documents/view?id=doc_1&from=344&to=465&v=1");
  });

  test("each [n] in the text becomes a chip; a line without one stays plain text", () => {
    const citations = [{ id: "c1", messageId: "a", index: 1, chunkId: null, documentId: "doc_1", documentTitle: "Leave", documentVersion: 1, startChar: 0, endChar: 5, quote: "q" }];
    render(<AnswerBody text={"First line. [1]\nA line the model wrote without a source.\nSecond line. [1]"} citations={citations} />);
    expect(screen.getAllByRole("link", { name: "Citation 1: Leave" })).toHaveLength(2);
    expect(screen.getByText("A line the model wrote without a source.")).toBeInTheDocument();
    // The mark is the chip's text, not part of the line's text any more.
    expect(screen.getByText("First line.")).toBeInTheDocument();
    for (const chip of screen.getAllByRole("link")) expect(chip).toHaveTextContent("[1]");
  });

  test("a [n] with no citation yet (still streaming) renders as plain text", () => {
    render(<AnswerBody text="First line. [1]" citations={[]} />);
    expect(screen.getByText("First line. [1]")).toBeInTheDocument();
  });
});
