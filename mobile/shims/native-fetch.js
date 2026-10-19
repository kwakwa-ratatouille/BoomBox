// fetch() des modules embarqués : passe par le HTTP natif de Capacitor (pas de restriction CORS),
// sans toucher au réseau du reste de l'appli (Firebase garde le fetch normal de la WebView).
import { CapacitorHttp } from '@capacitor/core';

const toObject = (h) => {
  const o = {};
  if (!h) return o;
  if (typeof h.forEach === 'function') h.forEach((v, k) => (o[k] = v));
  else Object.assign(o, h);
  return o;
};

export async function nativeFetch(input, init = {}) {
  let url = input;
  let method = init.method || 'GET';
  let headers = toObject(init.headers);
  let body = init.body;
  if (typeof Request !== 'undefined' && input instanceof Request) {
    url = input.url;
    method = input.method;
    headers = { ...toObject(input.headers), ...headers };
    if (method !== 'GET' && method !== 'HEAD') body = body ?? (await input.text());
  }
  url = String(url);
  if (body instanceof Uint8Array || body instanceof ArrayBuffer) body = new TextDecoder().decode(body);
  const res = await CapacitorHttp.request({ url, method, headers, data: body, responseType: init.binary ? 'blob' : 'text', connectTimeout: 15000, readTimeout: 30000 });
  let data = res.data;
  if (init.binary) {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    data = bytes;
  } else if (typeof data !== 'string') data = JSON.stringify(data);
  const r = new Response(data, { status: res.status, headers: res.headers });
  Object.defineProperty(r, 'url', { value: res.url || url });
  return r;
}
export { nativeFetch as fetch };