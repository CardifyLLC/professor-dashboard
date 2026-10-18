const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PENDING = 'tcgp-dashboard-pending-order';

export const validOrderId = (value) => typeof value === 'string' && UUID.test(value);
export function orderLink(id, href = window.location.href) {
  const url = new URL(href);
  url.hash = '';
  url.searchParams.delete('code');
  if (validOrderId(id)) url.searchParams.set('order', id);
  else url.searchParams.delete('order');
  return url.toString();
}

export function rememberOrderForSignIn() {
  const id = new URL(window.location.href).searchParams.get('order');
  try {
    if (validOrderId(id)) sessionStorage.setItem(PENDING, JSON.stringify({ id, expires: Date.now() + 30 * 60 * 1000 }));
    else sessionStorage.removeItem(PENDING);
  } catch { /* A direct link still works if browser storage is unavailable. */ }
}

export function restoreOrderAfterSignIn() {
  try {
    const pending = JSON.parse(sessionStorage.getItem(PENDING) || 'null');
    sessionStorage.removeItem(PENDING);
    if (!new URL(window.location.href).searchParams.has('order') && validOrderId(pending?.id) && pending.expires > Date.now()) {
      window.history.replaceState(null, '', orderLink(pending.id));
    }
  } catch { /* Ignore expired or malformed navigation state. */ }
}
