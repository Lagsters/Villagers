/**
 * Konfiguracja klienta. Adres serwera sygnalizacyjnego to jedyne ustawienie,
 * ktore wlasciciel wpisuje recznie: tutaj albo przez zmienna builda VITE_SIGNAL_URL.
 */
const envUrl = (import.meta.env.VITE_SIGNAL_URL as string | undefined) ?? '';

export const SIGNAL_URL: string =
  envUrl ||
  (typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? `ws://${location.hostname}:8787`
    : 'wss://osadnicy.duckdns.org');
