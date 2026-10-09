/**
 * Konfiguracja klienta: adres serwera sygnalizacyjnego. Na localhost - serwer z `npm run server`,
 * poza nim - serwer na api.kwasnypp.ovh (docs/DEPLOY.md); zmienna builda VITE_SIGNAL_URL go zastepuje.
 */
const envUrl = (import.meta.env.VITE_SIGNAL_URL as string | undefined) ?? '';

export const SIGNAL_URL: string =
  envUrl ||
  (typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? `ws://${location.hostname}:8787`
    : 'wss://api.kwasnypp.ovh/osada/');
