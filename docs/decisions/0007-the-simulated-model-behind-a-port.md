# 7. The answer is composed by an extractive stand-in behind an `Answerer` port, not by a model

Date: 2026-11-22

## Context

A grounded assistant ends with a model turning the retrieved passages into an answer. This project cannot call one: a paid API is out of bounds, and the demo must run as a static site in the browser with no server behind it. The answer still has to be produced, streamed, cited and metered, and the citations have to be exact, because the viewer highlights the span they name.

## Options considered

1. **Call a real model from the server, and mock it in the demo.** Two code paths, one of them a mock, and the demo would show something the server does not do. It also needs a key and a bill.
2. **Bundle a small open model in the browser with WebGPU.** Hundreds of megabytes, slow on a laptop, impossible on a phone, and the citations would still have to be checked after the fact because a generated sentence can misquote.
3. **An extractive composer behind a port.** The `Answerer` port takes the question, the instructions and the packed chunks, and answers text with citations. The adapter quotes the sentences that cover the most terms of the question, in reading order, one line per passage with its `[n]`. A real client is one adapter away and gets the same input.

## Decision

Option 3. `packages/domain/src/grounding/compose.ts` defines the port and `extractiveAnswerer`, which is deterministic: the same question over the same chunks gives the same answer. Every line is a substring of a packed chunk, so a citation's `quote` is exactly `document.slice(start, end)` and the viewer can highlight it; a question whose terms no sentence covers is refused with `no_sources` rather than answered with something unrelated. The README says plainly that the model is simulated and what the stand-in does.

## Consequences

The pipeline around the model is real and tested as hard as it would be with a model in it: retrieval under the member's rights, packing under the budget, the citations, the streaming, the metering at the price in force. What is lost is paraphrase: the answer reads as a list of quoted sentences, which is honest about what it is. Swapping the adapter for a model client would keep every test above the port, and the citation test would become the check that the model did not misquote.
