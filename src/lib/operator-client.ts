'use client';

import { trpc } from './trpc';

export function useOperator() {
  const query = trpc.profile.getOperator.useQuery();
  return { data: query.data, status: query.isPending ? ('loading' as const) : ('ready' as const) };
}
