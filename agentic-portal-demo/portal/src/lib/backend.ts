/** The hosted portal uses Rork's same-origin backend forwarding; the Python reference keeps its own routes. */
export const BACKEND_PREFIX = import.meta.env.VITE_HOSTED_LINDEN === 'true' ? '/~api' : '';
export const PORTAL_API = `${BACKEND_PREFIX}/portal/api`;
