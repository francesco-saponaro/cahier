import type { MessageWithCitations, RefusedReason } from "@cahier/domain";
import { tokens } from "../../lib/format";
import { Initial } from "../../ui/Initial";
import { Mark } from "../../ui/Mark";
import { AnswerBody, viewerHref } from "./Citations";
import type { StreamState } from "./stream";
import Link from "next/link";

/*
 * The thread: the person's questions and the agent's answers in order, each answer's lines with
 * their citation chips and its sources listed under it; then the answer being streamed, if any.
 * A refusal is the reason in words, set grey, so it never reads as an answer.
 */

const REASONS: Record<RefusedReason, string> = {
  budget_exhausted: "budget exhausted",
  rate_limited: "rate limited",
  tool_off: "grounded answers are off",
  no_sources: "nothing found",
  no_price: "no price in force",
};

export interface Person {
  id: string;
  name: string;
}

export function MessageList({ messages, me, agentName, stream }: { messages: MessageWithCitations[]; me: Person; agentName: string; stream: StreamState }) {
  return (
    <div className="messages">
      {messages.map((m) => (m.role === "user" ? <UserMessage key={m.id} body={m.body} me={me} /> : <AssistantMessage key={m.id} message={m} agentName={agentName} />))}
      {stream.phase === "sending" ? (
        <>
          <UserMessage body={stream.question} me={me} />
          <article className="msg" aria-live="polite">
            <Mark size={28} />
            <div>
              <span className="who">{agentName}</span>
              <div className="body">
                <span className="cursor" />
              </div>
            </div>
          </article>
        </>
      ) : null}
      {stream.phase === "streaming" ? (
        <>
          <UserMessage body={stream.userMessage.body} me={me} />
          <article className="msg" aria-live="polite">
            <Mark size={28} />
            <div>
              <span className="who">{agentName}</span>
              <div className="body">
                <span className="cursor">{stream.text}</span>
              </div>
            </div>
          </article>
        </>
      ) : null}
      {stream.phase === "done" ? (
        <>
          <UserMessage body={stream.userMessage.body} me={me} />
          <AssistantMessage message={stream.message} agentName={agentName} />
        </>
      ) : null}
      {stream.phase === "error" ? (
        <>
          <UserMessage body={stream.question} me={me} />
          <article className="msg failed">
            <Mark size={28} />
            <div>
              <span className="who">{agentName}</span>
              <div className="body">Could not send the question: {stream.message}</div>
            </div>
          </article>
        </>
      ) : null}
    </div>
  );
}

function UserMessage({ body, me }: { body: string; me: Person }) {
  return (
    <article className="msg">
      <Initial id={me.id} name={me.name} />
      <div>
        <span className="who">{me.name}</span>
        <div className="body">{body}</div>
      </div>
    </article>
  );
}

function AssistantMessage({ message, agentName }: { message: MessageWithCitations; agentName: string }) {
  const total = message.promptTokens + message.contextTokens + message.completionTokens;
  const status = message.status === "refused" ? `Refused: ${REASONS[message.refusedReason ?? "no_sources"]}` : message.status === "failed" ? "Failed" : message.status === "streaming" ? "Interrupted" : null;
  return (
    <article className={`msg ${message.status === "refused" ? "refused" : message.status === "failed" ? "failed" : ""}`.trim()}>
      <Mark size={28} />
      <div style={{ minWidth: 0 }}>
        <span className="who">{agentName}</span>
        {message.status === "complete" ? (
          <span className="meta">
            {message.modelId} · {tokens(total)}
          </span>
        ) : null}
        {status ? <span className="meta">{status}</span> : null}
        <div className="body">{message.status === "refused" || message.status === "failed" ? message.body : <AnswerBody text={message.body} citations={message.citations} />}</div>
        {message.citations.length > 0 ? (
          <ol className="sources" aria-label="Sources">
            {message.citations.map((c) => (
              <li key={c.id} className="source">
                <span>[{c.index}]</span>
                {c.documentId ? (
                  <Link href={viewerHref({ ...c, documentId: c.documentId })}>
                    {c.documentTitle}
                  </Link>
                ) : (
                  <span>{c.documentTitle}</span>
                )}
                <span>
                  v{c.documentVersion} · characters {c.startChar}–{c.endChar}
                </span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </article>
  );
}
