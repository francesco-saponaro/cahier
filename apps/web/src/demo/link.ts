import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { callTRPCProcedure, getErrorShape, getTRPCErrorFromUnknown, type AnyTRPCRouter, type inferRouterContext } from "@trpc/server";
import { observable } from "@trpc/server/observable";

/*
 * A tRPC link that calls the router in the same process instead of over HTTP: the demo's whole
 * transport. Each operation gets a context from `createContext` (the use cases over PGlite and
 * the actor behind the stored token), the procedure runs, and its answer is put in the envelope
 * the client expects. A subscription's async iterable becomes the same started, data and stopped
 * envelopes the server-sent-events link produces, so the chat folds the events it already knows.
 * An error goes through the router's own formatter, so `data.code` and `data.reason` are what
 * the server would have sent.
 */

export interface InProcessOptions<TRouter extends AnyTRPCRouter> {
  router: TRouter;
  createContext: () => Promise<inferRouterContext<TRouter>>;
}

export function inProcessLink<TRouter extends AnyTRPCRouter>({ router, createContext }: InProcessOptions<TRouter>): TRPCLink<TRouter> {
  return () =>
    ({ op }) =>
      observable((observer) => {
        const abort = new AbortController();
        let ctx: inferRouterContext<TRouter> | undefined;

        const run = async () => {
          ctx = await createContext();
          // One call at a time here; the batch index only matters to the HTTP batch handler.
          const output: unknown = await callTRPCProcedure({ router, path: op.path, getRawInput: async () => op.input, ctx, type: op.type, signal: abort.signal, batchIndex: 0 });
          if (op.type !== "subscription") {
            observer.next({ result: { type: "data", data: output } });
            return;
          }
          observer.next({ result: { type: "started" } });
          for await (const data of output as AsyncIterable<unknown>) {
            if (abort.signal.aborted) break;
            observer.next({ result: { type: "data", data } });
          }
          if (!abort.signal.aborted) observer.next({ result: { type: "stopped" } });
        };

        run().then(
          () => observer.complete(),
          (cause: unknown) => {
            if (abort.signal.aborted) return;
            const error = getTRPCErrorFromUnknown(cause);
            const shape = getErrorShape({ config: router._def._config, error, type: op.type, path: op.path, input: op.input, ctx });
            observer.error(TRPCClientError.from({ error: shape }));
          },
        );

        return () => abort.abort();
      });
}
