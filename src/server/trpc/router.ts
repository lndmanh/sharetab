import { createTRPCRouter } from './init';
import { profileRouter } from './routers/profile';
import { groupsRouter } from './routers/groups';
import { expensesRouter } from './routers/expenses';
import { balancesRouter } from './routers/balances';
import { settlementsRouter } from './routers/settlements';
import { activityRouter } from './routers/activity';
import { receiptsRouter } from './routers/receipts';
import { guestRouter } from './routers/guest';
import { adminRouter } from './routers/admin';

export const appRouter = createTRPCRouter({
  profile: profileRouter,
  groups: groupsRouter,
  expenses: expensesRouter,
  balances: balancesRouter,
  settlements: settlementsRouter,
  activity: activityRouter,
  receipts: receiptsRouter,
  guest: guestRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;
