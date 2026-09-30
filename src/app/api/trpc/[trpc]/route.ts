import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from '@/server/trpc/router';
import { createTRPCContext } from '@/server/trpc/init';
import { isSameOriginWrite } from '@/server/lib/same-origin';

const handler = (req: Request) => {
  if (!isSameOriginWrite(req)) return new Response('Forbidden', { status: 403 });
  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: () => createTRPCContext({ req }),
  });
};

export { handler as GET, handler as POST };
