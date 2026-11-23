import { createTRPCClient, httpBatchLink, httpSubscriptionLink, splitLink, TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import superjson from "superjson";
import type { AppRouter } from "@cahier/api";

/*
 * The tRPC client: the batch link for queries and mutations with the bearer header, and the
 * subscription link (server-sent events, the browser's own EventSource) for `messages.send`
 * with the token in the connection params, since an EventSource cannot send a header. The links
 * are a function of the API's URL and the token, so the demo can swap in a link that calls the
 * router in-process instead.
 */

export type ApiClient = ReturnType<typeof createTRPCClient<AppRouter>>;
export type ApiLinks = TRPCLink<AppRouter>[];

export interface HttpOptions {
  url: string;
  token: string | null;
}

export function httpLinks({ url, token }: HttpOptions): ApiLinks {
  return [
    splitLink({
      condition: (op) => op.type === "subscription",
      true: httpSubscriptionLink({ url: `${url}/trpc`, transformer: superjson, connectionParams: () => (token ? { token } : {}) }),
      false: httpBatchLink({ url: `${url}/trpc`, transformer: superjson, headers: () => (token ? { authorization: `Bearer ${token}` } : {}) }),
    }),
  ];
}

/** With no API configured and no demo yet, every call answers the same explanation. */
export function unavailableLinks(reason: string): ApiLinks {
  return [
    () => () =>
      observable((observer) => {
        observer.error(new TRPCClientError(reason));
      }),
  ];
}

export function createApiClient(links: ApiLinks): ApiClient {
  return createTRPCClient<AppRouter>({ links });
}

/** The API's URL from the environment; empty means the demo (session five) or nothing. */
export const API_URL: string = process.env["NEXT_PUBLIC_API_URL"] ?? "";

export function linksFor(token: string | null): ApiLinks {
  if (API_URL) return httpLinks({ url: API_URL, token });
  return unavailableLinks("Demo mode is not available yet. Set NEXT_PUBLIC_API_URL to the server's URL.");
}
