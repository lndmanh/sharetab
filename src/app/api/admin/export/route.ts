import { getDb } from '@/server/db';

/** JSON backup of private application metadata. Receipt binaries live in R2. */
export async function GET() {
  const db = getDb();
  const [
    users,
    groups,
    groupMembers,
    expenses,
    expenseShares,
    settlements,
    receipts,
    receiptItems,
    activityLogs,
    guestSplits,
    systemSettings,
  ] = await Promise.all([
    db.user.findMany(),
    db.group.findMany(),
    db.groupMember.findMany(),
    db.expense.findMany(),
    db.expenseShare.findMany(),
    db.settlement.findMany(),
    db.receipt.findMany(),
    db.receiptItem.findMany(),
    db.activityLog.findMany(),
    db.guestSplit.findMany(),
    db.systemSetting.findMany(),
  ]);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return new Response(
    JSON.stringify({
      exportedAt: new Date().toISOString(),
      data: {
        users,
        groups,
        groupMembers,
        expenses,
        expenseShares,
        settlements,
        receipts,
        receiptItems,
        activityLogs,
        guestSplits,
        systemSettings,
      },
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="sharetab-${timestamp}.json"`,
        'Cache-Control': 'private, no-store',
      },
    },
  );
}
