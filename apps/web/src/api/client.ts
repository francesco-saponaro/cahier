import { createTRPCClient, httpBatchLink, httpSubscriptionLink, splitLink, type TRPCLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@cahier/api";
import { demoLinksFor } from "../demo";

/*
 * The tRPC client: the batch link for queries and mutations with the bearer header, and the
 * subscription link (server-sent events, the browser's own EventSource) for `messages.send`
 * with the token in the connection params, since an EventSource cannot send a header. The links
 * are a function of the API's URL and the token; with no URL the demo's link calls the router
 * in-process on PostgreSQL in the page, and nothing above this file can tell the difference.
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

export function createApiClient(links: ApiLinks): ApiClient {
  return createTRPCClient<AppRouter>({ links });
}

/** The API's URL from the environment; empty means the demo. */
export const API_URL: string = process.env["NEXT_PUBLIC_API_URL"] ?? "";

/** True when the app runs on its own, with the database in the page. */
export const IS_DEMO: boolean = API_URL === "";

export function linksFor(token: string | null): ApiLinks {
  return IS_DEMO ? demoLinksFor(token) : httpLinks({ url: API_URL, token });
}
