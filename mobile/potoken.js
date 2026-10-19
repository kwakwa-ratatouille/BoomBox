// Jetons « PO token » (preuve d'origine) exigés par YouTube pour les clients web : générés dans le téléphone
// avec BotGuard (bgutils-js). L'appli tourne dans un vrai moteur de navigateur (WKWebView / WebView), ce que
// BotGuard vérifie. Fragile par nature : si YouTube change son système, la récupération directe échoue et
// l'appli se rabat sur le PC ou les sons déjà téléchargés.
import { BotGuardClient } from 'bgutils-js/botguard';
import { WebPoMinter } from 'bgutils-js/webpo';
import { buildURL, GOOG_API_KEY } from 'bgutils-js/utils';

const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo'; // clé utilisée par le lecteur web de YouTube
let minter = null;
let minterAt = 0;
let pending = null;

async function createMinter(yt) {
  const ch = await yt.getAttestationChallenge('ENGAGEMENT_TYPE_UNBOUND');
  const bg = ch?.bg_challenge;
  if (!bg) throw new Error('défi BotGuard indisponible');
  const url = bg.interpreter_url?.private_do_not_access_or_else_trusted_resource_url_wrapped_value;
  const js = await (await fetch(url.startsWith('http') ? url : `https:${url}`)).text();
  new Function(js)(); // charge la machine virtuelle BotGuard dans la page
  const client = await BotGuardClient.create({ program: bg.program, globalName: bg.global_name, globalObject: globalThis });
  const webPoSignalOutput = [];
  const snapshot = await client.snapshot({ webPoSignalOutput });
  const res = await fetch(buildURL('GenerateIT', true), {
    method: 'POST',
    headers: { 'content-type': 'application/json+protobuf', 'x-goog-api-key': GOOG_API_KEY, 'x-user-agent': 'grpc-web-javascript/0.1' },
    body: JSON.stringify([REQUEST_KEY, snapshot]),
  });
  const it = await res.json();
  if (!it?.[0]) throw new Error('jeton d’intégrité refusé');
  return WebPoMinter.create({ integrityToken: it[0] }, webPoSignalOutput);
}

// Fabrique de jetons, gardée 6 h
async function getMinter(yt) {
  if (minter && Date.now() - minterAt < 6 * 3600e3) return minter;
  pending ??= createMinter(yt)
    .then((m) => ((minter = m), (minterAt = Date.now()), m))
    .finally(() => (pending = null));
  return pending;
}

// Jeton pour la demande du son (lié à la vidéo) et jeton pour le téléchargement (lié à la session)
export async function poTokens(yt, videoId) {
  const m = await getMinter(yt);
  const visitor = yt.session?.context?.client?.visitorData || '';
  const [player, gvs] = await Promise.all([m.mintAsWebsafeString(videoId), m.mintAsWebsafeString(visitor)]);
  return { player, gvs };
}
