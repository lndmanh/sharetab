import { env } from 'cloudflare:workers';

/** The predicate is trusted static SQL; values must be bound separately. */
export function requireD1Row(predicate: string, ...values: (string | number | null)[]) {
  return env.DB.prepare(
    `INSERT INTO "__WriteGuard" ("ok") SELECT CASE WHEN EXISTS (${predicate}) THEN 1 ELSE 0 END`,
  ).bind(...values);
}

export function clearD1Guard() {
  return env.DB.prepare('DELETE FROM "__WriteGuard"');
}
