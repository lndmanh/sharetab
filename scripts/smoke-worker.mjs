import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const base = new URL(process.env.SHARETAB_SMOKE_URL ?? 'http://localhost:8787');
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) {
  throw new Error('Refusing to mutate a non-local Worker');
}

async function query(path, input) {
  const url = new URL(`/api/trpc/${path}`, base);
  if (input !== undefined) url.searchParams.set('input', JSON.stringify({ json: input }));
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(`${path}: ${JSON.stringify(payload.error ?? response.status)}`);
  return payload.result.data.json;
}

async function mutate(path, input) {
  const response = await fetch(new URL(`/api/trpc/${path}`, base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input }),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(`${path}: ${JSON.stringify(payload.error ?? response.status)}`);
  return payload.result.data.json;
}

const health = await fetch(new URL('/api/health', base));
if (!health.ok) throw new Error(`D1 health check failed: ${health.status}`);
const owner = (await query('profile.getOperator')).user;
let groupId;
let expenseId;
let receiptId;
let splitId;

try {
  const group = await mutate('groups.create', { name: `Worker smoke ${randomUUID()}` });
  groupId = group.id;
  const expense = await mutate('expenses.create', {
    groupId,
    title: 'Smoke expense',
    amount: 1000,
    paidById: owner.id,
    splitMode: 'EQUAL',
    shares: [{ userId: owner.id, amount: 1000 }],
  });
  expenseId = expense.id;
  const updated = await mutate('expenses.update', {
    groupId,
    expenseId,
    amount: 1500,
    shares: [{ userId: owner.id, amount: 1500 }],
  });
  if (updated.amount !== 1500 || updated.shares?.[0]?.amount !== 1500)
    throw new Error('Expense update did not persist');

  const before = (await query('expenses.list', { groupId })).expenses.length;
  try {
    await mutate('expenses.create', {
      groupId,
      title: 'Must roll back',
      amount: 500,
      paidById: owner.id,
      splitMode: 'EQUAL',
      receiptId: randomUUID(),
      shares: [{ userId: owner.id, amount: 500 }],
    });
    throw new Error('Invalid receipt unexpectedly created an expense');
  } catch (error) {
    if (error.message === 'Invalid receipt unexpectedly created an expense') throw error;
  }
  const after = (await query('expenses.list', { groupId })).expenses.length;
  if (before !== after) throw new Error('Failed D1 batch left a partial expense');

  const image = await readFile(new URL('../public/icons/icon-192.png', import.meta.url));
  const form = new FormData();
  form.set('file', new Blob([image], { type: 'image/png' }), 'icon.png');
  const upload = await fetch(new URL('/api/upload', base), { method: 'POST', body: form });
  if (!upload.ok) throw new Error(`R2 upload failed: ${upload.status} ${await upload.text()}`);
  const created = await upload.json();
  receiptId = created.receiptId;
  const downloaded = await fetch(new URL(`/api/uploads/${created.imagePath}`, base));
  if (!downloaded.ok || (await downloaded.arrayBuffer()).byteLength !== image.byteLength) {
    throw new Error('Private R2 receipt read did not match the upload');
  }

  const crossSite = await fetch(new URL('/api/trpc/expenses.create', base), {
    method: 'POST',
    headers: { Origin: 'https://not-sharetab.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: {} }),
  });
  if (crossSite.status !== 403) throw new Error('Cross-site write was not rejected');

  const claim = await mutate('guest.createClaimSession', {
    receiptData: { subtotal: 1000, tax: 80, tip: 0, total: 1080, currency: 'VND' },
    items: [{ name: 'Food', quantity: 1, unitPrice: 1000, totalPrice: 1000 }],
    creatorName: 'Owner',
    paidByName: 'Owner',
  });
  const split = await query('guest.getSession', { token: claim.shareToken });
  splitId = split.id;
  const joined = await mutate('guest.joinSession', { token: claim.shareToken, name: 'Owner' });
  await mutate('guest.claimItems', {
    token: claim.shareToken,
    personIndex: joined.personIndex,
    personToken: joined.personToken,
    claimedItemIndices: [0],
  });
  const finalized = await mutate('guest.finalizeSession', {
    token: claim.shareToken,
    personIndex: joined.personIndex,
    personToken: joined.personToken,
  });
  if (finalized.shareToken !== claim.shareToken) throw new Error('Quick split did not finalize');

  process.stdout.write('Private Worker smoke passed: D1 writes/rollback, R2, quick split, same-origin guard.\n');
} finally {
  if (splitId) await mutate('guest.deleteSplit', { id: splitId });
  if (receiptId) await mutate('receipts.deletePending', { receiptId });
  if (expenseId && groupId) await mutate('expenses.delete', { groupId, expenseId });
  if (groupId) await mutate('groups.delete', { groupId });
}
