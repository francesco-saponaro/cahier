import { createTRPCContext } from "@trpc/tanstack-react-query";
import type { AppRouter } from "@cahier/api";

/* The query-options proxy over the router's types: `useQuery(trpc.libraries.list.queryOptions(input))`. */
export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();
