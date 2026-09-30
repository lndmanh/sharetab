import createIntlMiddleware from 'next-intl/middleware';
import { routing } from '@/i18n/routing';

// Cloudflare Access gates the Worker before this locale proxy runs.
export default createIntlMiddleware(routing);

export const config = {
  matcher: ['/((?!api|_next|_vercel|favicon\\.png|icon\\.svg|icons|manifest\\.json|.*\\..*).*)'],
};
