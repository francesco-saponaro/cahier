import type { Citation, Message, MessageWithCitations, SendEvent } from "@cahier/domain";

/*
 * The streamed answer, folded from the same events the server emits (`started`, `delta`…,
 * `citations`, `done`; or `refused`; or `failed`) into one state. The message list renders the
 * thread it has, then this state after it; when the stream closes the thread is re-read and the
 * state goes back to idle.
 */

export type StreamState =
  | { phase: "idle" }
  | { phase: "sending"; question: string }
  | { phase: "streaming"; userMessage: Message; assistantMessageId: string; text: string; citations: Citation[] }
  | { phase: "done"; userMessage: Message; message: MessageWithCitations }
  | { phase: "error"; question: string; message: string };

export type StreamEvent = SendEvent | { type: "error"; message: string };

export const IDLE: StreamState = { phase: "idle" };

export function reduce(state: StreamState, event: StreamEvent): StreamState {
  switch (event.type) {
    case "started":
      return { phase: "streaming", userMessage: event.userMessage, assistantMessageId: event.assistantMessageId, text: "", citations: [] };
    case "delta":
      return state.phase === "streaming" ? { ...state, text: state.text + event.text } : state;
    case "citations":
      return state.phase === "streaming" ? { ...state, citations: event.citations } : state;
    case "done":
      return state.phase === "streaming" ? { phase: "done", userMessage: state.userMessage, message: { ...event.message, citations: state.citations } } : state;
    case "refused":
    case "failed":
      return state.phase === "streaming" ? { phase: "done", userMessage: state.userMessage, message: { ...event.message, citations: [] } } : state;
    case "error": {
      const question = state.phase === "sending" || state.phase === "error" ? state.question : state.phase === "streaming" ? state.userMessage.body : "";
      return { phase: "error", question, message: event.message };
    }
  }
}
