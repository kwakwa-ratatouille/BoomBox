// Page de profil façon Spotify : grande photo ronde, nom, compteurs, tops du mois, playlists, abonnements.
import { html, raw, icon, plural, toast, modal, dominantColor, esc } from './ui.js';
import { state, getStats, updateProfile, publishProfile, unpublishProfile, publicProfileUrl, toggleFollow, ls } from './state.js';
import { card, cover, playlistCover, trackList, rememberTracks } from './components.js';

export const avatarHtml = (p, cls = '') =>
  p?.photo
    ? html`<span class="avatar-img ${cls}" style="background-image:url('${p.photo}')"></span>`
    : html`<span class="avatar-img ${cls}" style="background:${p?.color || '#2ef28b'}">${(p?.name || '?')[0].toUpperCase()}</span>`;

// Recadre l'image en carré 320 px (JPEG ~30 Ko, assez léger pour Firestore)
function squareImage(file, size = 320) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const s = Math.min(img.width, img.height);
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('Image illisible'));
    img.src = URL.createObjectURL(file);
  });
}

// Image choisie → réduite tout de suite (côté max 1600 px) : une photo de téléphone de 12 Mpx gardée en entier
// faisait planter l'appli iPhone (mémoire)
function loadSmall(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const r = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * r);
      c.height = Math.round(img.height * r);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      img.src = '';
      resolve(c);
    };
    img.onerror = () => (URL.revokeObjectURL(url), reject(new Error('Image illisible')));
    img.src = url;
  });
}

// Recadrage : on fait glisser l'image dans le cadre et on zoome. Bannière (3:1) ou photo de profil (carré, aperçu rond)
async function bannerCropper(box, file, { W = 900, H = 300, round = false } = {}) {
  const src = await loadSmall(file);
  let x = 50;
  let y = 50;
  let zoom = 1;
  const url = src.toDataURL('image/jpeg', 0.85);
  box.innerHTML = `<div class="pe-crop"><div class="${round ? 'pe-round' : 'pe-banner'} pe-crop-area" style="background-image:url('${url}')"></div>
    <div class="row-flex" style="gap:10px;margin-top:8px"><span class="muted" style="font-size:12px">Zoom</span><input type="range" class="range pe-zoom" min="1" max="3" step="0.01" value="1" style="flex:1"></div>
    <p class="muted" style="font-size:12px;margin:4px 0 0">Fais glisser l'image pour choisir la partie visible.</p></div>`;
  const area = box.querySelector('.pe-crop-area');
  const apply = () => {
    const base = Math.max(area.clientWidth / src.width, area.clientHeight / src.height) * zoom;
    area.style.backgroundSize = `${src.width * base}px ${src.height * base}px`;
    area.style.backgroundPosition = `${x}% ${y}%`;
  };
  requestAnimationFrame(apply);
  let start = null;
  area.addEventListener('pointerdown', (e) => {
    start = { px: e.clientX, py: e.clientY, x, y };
    area.setPointerCapture(e.pointerId);
  });
  area.addEventListener('pointermove', (e) => {
    if (!start) return;
    const base = Math.max(area.clientWidth / src.width, area.clientHeight / src.height) * zoom;
    const freeX = src.width * base - area.clientWidth;
    const freeY = src.height * base - area.clientHeight;
    // Glisser vers le bas montre le haut de l'image (comme une photo qu'on déplace)
    if (freeX > 0) x = Math.max(0, Math.min(100, start.x - ((e.clientX - start.px) / freeX) * 100));
    if (freeY > 0) y = Math.max(0, Math.min(100, start.y - ((e.clientY - start.py) / freeY) * 100));
    apply();
  });
  area.addEventListener('pointerup', () => (start = null));
  area.addEventListener('pointercancel', () => (start = null));
  area.style.touchAction = 'none';
  box.querySelector('.pe-zoom').oninput = (e) => ((zoom = Number(e.target.value)), apply());
  return {
    render() {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const s = Math.max(W / src.width, H / src.height) * zoom;
      const dw = src.width * s;
      const dh = src.height * s;
      c.getContext('2d').drawImage(src, ((W - dw) * x) / 100, ((H - dh) * y) / 100, dw, dh);
      return c.toDataURL('image/jpeg', round ? 0.85 : 0.72);
    },
  };
}

// GIF envoyé depuis l'appareil : gardé tel quel (le recadrage le figerait en image fixe). Fiche en ligne limitée :
// photo 45 Ko, bannière 180 Ko ; au-delà, la recherche GIF (simple lien, sans limite) fait l'affaire.
const readGif = (f, max) => new Promise((resolve, reject) => {
  if (f.size > max) return reject(new Error(`GIF trop lourd (${Math.round(f.size / 1024)} Ko, ${Math.round(max / 1024)} Ko max) : choisis-le plutôt avec « GIF animé »`));
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(new Error('GIF illisible'));
  r.readAsDataURL(f);
});
const pickGif = () => new Promise((resolve) => import('./views-social.js').then((m) => m.gifPicker(({ gif }) => resolve(gif)).then(() => resolve(null))));

export async function editProfile() {
  const p = state.profile;
  let photo = p.photo || null;
  let banner = p.banner || null;
  let crop = null;
  let pcrop = null; // recadrage de la photo de profil
  const bannerPrev = (b) => (b ? `<div class="pe-banner" style="background-image:url('${b}')"></div>` : '<div class="pe-banner empty">Aucune bannière</div>');
  const v = await modal({
    title: 'Détails du profil',
    body: String(html`<div class="profile-edit">
      <label class="pe-photo" title="Choisir une photo">${avatarHtml(p, 'xl')}<span>${icon('edit')}Choisir une photo</span><input type="file" accept="image/*" id="pe-file" hidden></label>
      <div style="flex:1;display:flex;flex-direction:column;gap:12px">
        <input class="input" id="pe-name" value="${p.name}" maxlength="40" placeholder="Nom">
        <button class="btn ghost" id="pe-gif" type="button">GIF animé</button>
        ${p.photo ? html`<button class="btn ghost" id="pe-rm" type="button">Retirer la photo</button>` : ''}
      </div></div>
      <div id="pe-pcrop"></div>
      <div class="pe-banner-box"><b>Bannière du profil</b><div id="pe-bprev">${raw(bannerPrev(banner))}</div>
        <div class="row-flex" style="gap:8px"><label class="btn ghost">Choisir une bannière<input type="file" accept="image/*" id="pe-bfile" hidden></label><button class="btn ghost" id="pe-bgif" type="button">GIF animé</button><button class="btn ghost" id="pe-brm" type="button">Retirer</button></div></div>`),
    actions: [{ label: 'Annuler' }, { label: 'Enregistrer', primary: true, value: (w) => ({ name: w.querySelector('#pe-name').value.trim() || p.name, photo: pcrop ? pcrop.render() : photo, banner: crop ? crop.render() : banner }) }],
    onMount: (w) => {
      const showPhoto = () => (w.querySelector('.pe-photo .avatar-img').outerHTML = String(avatarHtml({ ...p, photo }, 'xl')));
      // Photo et bannière animées : un GIF de la recherche (lien) ou un GIF de l'appareil (gardé tel quel)
      w.querySelector('#pe-gif').onclick = async () => {
        const g = await pickGif();
        if (!g) return;
        photo = g;
        pcrop = null;
        w.querySelector('#pe-pcrop').innerHTML = '';
        showPhoto();
      };
      w.querySelector('#pe-bgif').onclick = async () => {
        const g = await pickGif();
        if (!g) return;
        banner = g;
        crop = null;
        w.querySelector('#pe-bprev').innerHTML = bannerPrev(g);
      };
      w.querySelector('#pe-file').onchange = async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        if (f.type === 'image/gif') {
          try {
            photo = await readGif(f, 45 * 1024);
            pcrop = null;
            w.querySelector('#pe-pcrop').innerHTML = '';
            showPhoto();
          } catch (err) {
            toast(err.message, { timeout: 6000 });
          }
          return;
        }
        // Recadrage : déplacer la photo et zoomer dans le rond, puis Enregistrer
        try {
          pcrop = await bannerCropper(w.querySelector('#pe-pcrop'), f, { W: 400, H: 400, round: true });
        } catch {
          photo = await squareImage(f);
          w.querySelector('.pe-photo .avatar-img').outerHTML = String(avatarHtml({ ...p, photo }, 'xl'));
        }
      };
      w.querySelector('#pe-bfile').onchange = async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        if (f.type === 'image/gif') {
          try {
            banner = await readGif(f, 180 * 1024);
            crop = null;
            w.querySelector('#pe-bprev').innerHTML = bannerPrev(banner);
          } catch (err) {
            toast(err.message, { timeout: 6000 });
          }
          return;
        }
        try {
          crop = await bannerCropper(w.querySelector('#pe-bprev'), f);
        } catch (err) {
          toast(err.message);
        }
      };
      w.querySelector('#pe-brm').onclick = () => ((banner = null), (crop = null), (w.querySelector('#pe-bprev').innerHTML = bannerPrev(null)));
      w.querySelector('#pe-rm')?.addEventListener('click', () => {
        photo = null;
        pcrop = null;
        w.querySelector('#pe-pcrop').innerHTML = '';
        w.querySelector('.pe-photo .avatar-img').outerHTML = String(avatarHtml({ ...p, photo: null }, 'xl'));
      });
    },
  });
  if (!v || v === 'Annuler') return;
  await updateProfile(p.id, { name: v.name, photo: v.photo, banner: v.banner || null });
  Object.assign(state.profile, { name: v.name, photo: v.photo, banner: v.banner || null });
  document.dispatchEvent(new Event('profile-updated'));
  toast('Profil mis à jour');
}

export async function profilePage(el, _p, ctx) {
  const render = async () => {
    const p = state.profile;
    const lib = state.library;
    el.innerHTML = String(html`
      <div class="hero profile-hero ${p.banner && !state.safeMode ? 'has-banner' : ''}" style="${p.banner && !state.safeMode ? `background-image:url('${p.banner}')` : ''}">
        <button class="pe-photo" id="pf-photo" title="Choisir une photo">${avatarHtml(p, 'hero')}<span>${icon('edit')}Choisir une photo</span></button>
        <div class="hero-info"><span class="hero-type">Profil</span>
          <h1 class="editable" id="pf-name">${p.name}</h1>
          <div class="hero-meta"><span>${plural(lib.playlists.filter((x) => x.visibility === 'public').length, 'playlist publique')}</span><span class="sep"></span><a class="link" href="#/following">${plural(lib.follows.length, 'abonnement')}</a><span class="sep"></span><a class="link" href="#/liked">${plural(lib.liked.length, 'titre liké')}</a></div>
        </div>
      </div>
      <div class="page-body">
        <div class="actions"><button class="outline-btn" id="pf-share">${icon('share', 16)} Partager mon profil</button><a class="outline-btn" href="#/wrapped">Mon récap</a><button class="act-btn" id="pf-edit" title="Modifier le profil">${icon('more')}</button></div>
        <div id="pf-tops"><div class="sk sk-title"></div><div class="sk-cards">${raw('<div class="sk sk-card"></div>'.repeat(5))}</div></div>
        ${lib.playlists.some((x) => x.visibility === 'public') ? html`<section class="section"><div class="section-head"><div><h2>Playlists publiques</h2><div class="muted">${plural(lib.playlists.filter((x) => x.visibility !== 'public').length, 'playlist privée')} masquée${lib.playlists.filter((x) => x.visibility !== 'public').length > 1 ? 's' : ''} (bouton « Privée / Publique » sur chaque playlist)</div></div><a href="#/library">Tout afficher</a></div><div class="cards row">${lib.playlists.filter((x) => x.visibility === 'public').map((pl) => card({ ...pl, type: 'local', coverHtml: playlistCover(pl) }, { sub: `${pl.visibility === 'public' ? 'Publique' : 'Privée'} · ${plural(pl.tracks.length, 'titre')}` }))}</div></section>` : ''}
        ${lib.follows.length ? html`<section class="section"><div class="section-head"><h2><a class="link" href="#/following">Abonnements</a></h2><a href="#/following">Tout afficher</a></div><div class="cards row">${lib.follows.map((f) => card({ ...f, type: 'artist' }))}</div></section>` : ''}
      </div>`);
    if (p.photo) dominantColor(p.photo).then((c) => c && el.querySelector('.profile-hero')?.style.setProperty('--hero', c));
    else el.querySelector('.profile-hero').style.setProperty('--hero', p.color);
    // Mes likes : la page Titres likés ; et la nouvelle bannière suit tout de suite
    document.addEventListener('profile-updated', () => ctx.alive() && render(), { once: true });
    el.querySelector('#pf-photo').onclick = editProfile;
    el.querySelector('#pf-name').onclick = editProfile;
    el.querySelector('#pf-edit').onclick = editProfile;
    el.querySelector('#pf-share').onclick = shareProfile;

    const s = await getStats(30).catch(() => null);
    if (!ctx.alive() || !s) return;
    const box = el.querySelector('#pf-tops');
    if (!box) return;
    rememberTracks(s.topTracks.map((t) => t.track));
    box.innerHTML = s.plays
      ? String(html`
        <section class="section"><div class="section-head"><div><h2>Top artistes ce mois-ci</h2><div class="muted">Visible uniquement par toi</div></div><a href="#/stats">Tout afficher</a></div>
          <div class="cards row">${s.topArtists.map((a) => card({ type: 'artist', id: a.artist.id, name: a.artist.name, thumb: a.thumb }, { sub: plural(a.count, 'écoute'), href: a.artist.id ? `#/artist/${a.artist.id}` : '#/stats', play: a.artist.id ? `artist:${a.artist.id}` : '' }))}</div></section>
        <section class="section"><div class="section-head"><div><h2>Top titres ce mois-ci</h2><div class="muted">Visible uniquement par toi</div></div><a href="#/stats">Tout afficher</a></div>
          ${trackList(s.topTracks.slice(0, 4).map((t) => t.track), { context: { type: 'top', name: 'Top titres du mois' } })}</section>`)
      : '<p class="muted" style="margin-bottom:32px">Écoute un peu de musique : tes tops du mois apparaîtront ici.</p>';
  };
  await render();
  return { onLibrary: render };
}

// Profil public : une page web (lien) avec ta photo, tes tops du mois, tes playlists et tes abonnements
export async function shareProfile() {
  const p = state.profile;
  const draw = (w) => {
    const on = !!p.publicCode;
    w.querySelector('.pp-body').innerHTML = String(on
      ? html`<p>Ton profil est visible par toute personne qui a le lien. Il se met à jour une fois par jour.</p>
        <div class="row-flex"><input class="input" readonly value="${publicProfileUrl(p.publicCode)}" style="flex:1"><button class="btn white" data-pp="copy">Copier</button></div>
        <div class="row-flex" style="margin-top:12px"><a class="btn ghost" href="${publicProfileUrl(p.publicCode)}" target="_blank" rel="noopener">Voir la page</a><button class="btn ghost" data-pp="refresh">Mettre à jour maintenant</button><button class="btn ghost" data-pp="off" style="color:var(--danger)">Ne plus partager</button></div>`
      : html`<p>Crée une page publique avec ta photo, tes tops du mois, tes playlists et tes abonnements, à partager par lien (Insta, Snap…).</p><p class="muted" style="font-size:13px">Seuls ton nom, ta photo, tes tops, tes playlists et tes abonnements sont visibles. Tu peux arrêter le partage à tout moment.</p>
        <button class="btn white" data-pp="on">Créer mon lien</button>`);
  };
  await modal({
    title: 'Partager mon profil',
    body: '<div class="pp-body"></div>',
    actions: [{ label: 'Fermer' }],
    onMount: (w) => {
      draw(w);
      w.addEventListener('click', async (e) => {
        const a = e.target.closest('[data-pp]')?.dataset.pp;
        if (!a) return;
        try {
          if (a === 'on' || a === 'refresh') {
            toast('Publication…');
            await publishProfile();
            toast(a === 'on' ? 'Ton profil est en ligne' : 'Profil mis à jour');
          } else if (a === 'off') {
            await unpublishProfile();
            toast('Ton profil n’est plus partagé');
          } else if (a === 'copy') {
            await navigator.clipboard.writeText(publicProfileUrl(p.publicCode));
            return toast('Lien copié');
          }
        } catch (err) {
          toast('Impossible : ' + err.message);
        }
        draw(w);
      });
    },
  });
}
// Liste des artistes suivis (depuis le profil : « N abonnements ») : recherche, tri, désabonnement
export async function followingPage(el) {
  let q = '';
  let sort = ls.get('boombox.followSort', 'recent');
  const render = () => {
    const all = state.library.follows;
    let list = all.filter((f) => !q || f.name.toLowerCase().includes(q));
    if (sort === 'alpha') list = list.slice().sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
    el.querySelector('.fw-count').textContent = plural(all.length, 'artiste suivi');
    el.querySelector('.fw-grid').innerHTML = list.length
      ? list.map((f) => String(html`<div class="fw-item"><a href="#/artist/${f.id}">${cover(f, 'round', 300)}<b class="ellipsis">${f.name}</b><span class="muted">Artiste</span></a><button class="outline-btn fw-unfollow" data-unfollow="${f.id}">Abonné</button></div>`)).join('')
      : String(html`<div class="empty" style="grid-column:1/-1"><h2>${all.length ? 'Aucun artiste trouvé' : 'Tu ne suis encore aucun artiste'}</h2><p>${all.length ? '' : 'Abonne-toi depuis la page d’un artiste, ou importe tes abonnements Spotify (Importer → Importer mes abonnements).'}</p></div>`);
    el.querySelectorAll('[data-unfollow]').forEach((b) => {
      b.onmouseenter = () => (b.textContent = 'Se désabonner');
      b.onmouseleave = () => (b.textContent = 'Abonné');
      b.onclick = () => {
        const f = state.library.follows.find((x) => x.id === b.dataset.unfollow);
        if (f) toggleFollow(f);
      };
    });
  };
  el.innerHTML = String(html`<div class="page">
    <a class="muted link" href="#/profile" style="font-size:14px">← ${state.profile.name}</a>
    <div class="row-flex" style="justify-content:space-between;margin:8px 0 16px;flex-wrap:wrap;gap:12px"><div><h1>Abonnements</h1><p class="muted fw-count" style="margin:4px 0 0"></p></div>
      <div class="row-flex" style="gap:8px"><div class="search-box" style="height:40px;flex:0 1 240px"><input id="fw-q" placeholder="Rechercher un artiste" autocomplete="off"></div>
      <select class="lib-sort" id="fw-sort"><option value="recent">Récemment suivis</option><option value="alpha">A → Z</option></select></div></div>
    <div class="fw-grid"></div></div>`);
  el.querySelector('#fw-sort').value = sort;
  el.querySelector('#fw-sort').onchange = (e) => ((sort = e.target.value), ls.set('boombox.followSort', sort), render());
  el.querySelector('#fw-q').oninput = (e) => ((q = e.target.value.toLowerCase().trim()), render());
  render();
  return { onLibrary: render };
}