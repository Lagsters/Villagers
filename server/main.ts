/**
 * Uruchomienie serwera sygnalizacyjnego z ustawieniami ze zmiennych srodowiskowych (docs/DEPLOY.md).
 * Na serwerze dziala jako jeden plik zbudowany przez `npm run build:server`.
 */
import { startServer } from './signal.ts';

const env = process.env;
const list = (v: string | undefined): string[] => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

startServer({
  port: Number(env.PORT ?? 8787),
  host: env.HOST ?? '0.0.0.0',
  turnSecret: env.TURN_SECRET ?? '',
  turnUrls: list(env.TURN_URLS),
  allowedOrigins: list(env.ALLOWED_ORIGINS),
  trustProxy: env.TRUST_PROXY === '1',
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
