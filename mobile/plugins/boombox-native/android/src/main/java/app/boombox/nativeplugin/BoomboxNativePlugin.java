package app.boombox.nativeplugin;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.WebViewListener;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.yausername.youtubedl_android.YoutubeDL;
import com.yausername.youtubedl_android.YoutubeDLRequest;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.io.InputStream;
import java.net.URL;
import java.util.concurrent.CountDownLatch;

/**
 * Module natif Boombox (Android) : yt-dlp embarqué dans l'appli.
 * Le téléphone récupère l'audio lui-même, comme le serveur du PC, sans dépendre du PC.
 * yt-dlp est mis à jour automatiquement une fois par semaine (YouTube change souvent ses protections).
 */
@CapacitorPlugin(name = "BoomboxNative")
public class BoomboxNativePlugin extends Plugin {
    private final CountDownLatch ready = new CountDownLatch(1);
    private volatile String initError = null;

    // Casque débranché / Bluetooth déconnecté : l'appli met en pause (sinon le son part dans le haut-parleur)
    private BroadcastReceiver noisy;

    @Override
    public void load() {
        Context app = getContext().getApplicationContext();
        // Boombox lancé depuis « Partager » (Shazam, Google…) : le texte partagé est gardé pour le JavaScript
        if (getActivity() != null) keepShared(getActivity().getIntent());
        // Plantage : on garde la cause (rapport envoyé au prochain lancement par le JavaScript, voir takeCrash)
        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((th, ex) -> {
            try {
                java.io.StringWriter sw = new java.io.StringWriter();
                ex.printStackTrace(new java.io.PrintWriter(sw));
                String trace = sw.toString();
                app.getSharedPreferences("boombox", Context.MODE_PRIVATE).edit()
                    .putString("lastCrash", (Build.MANUFACTURER + " " + Build.MODEL + " Android " + Build.VERSION.RELEASE + " · " + th.getName() + "\n" + trace).substring(0, Math.min(3000, trace.length() + 120)))
                    .commit();
            } catch (Throwable ignored) {
            }
            if (prev != null) prev.uncaughtException(th, ex);
        });
        noisy = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent i) { notifyListeners("audioUnplugged", new JSObject()); }
        };
        // Moteur d'affichage (WebView) arrêté par Android : manque de mémoire avec une grosse bibliothèque, ou
        // plantage de Chrome. Sans réponse, Android ferme TOUTE l'appli d'un coup (le « crash » sur Samsung/Xiaomi).
        // On note la cause et on recrée l'écran : l'appli se recharge au lieu de se fermer.
        bridge.addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(android.webkit.WebView view, android.webkit.RenderProcessGoneDetail detail) {
                boolean crashed = Build.VERSION.SDK_INT >= 26 && detail != null && detail.didCrash();
                app.getSharedPreferences("boombox", Context.MODE_PRIVATE).edit()
                    .putString("lastCrash", Build.MANUFACTURER + " " + Build.MODEL + " Android " + Build.VERSION.RELEASE + " · WebView\n"
                        + (crashed ? "RenderProcessGone: le moteur d'affichage a planté" : "RenderProcessGone: arrêté par Android (manque de mémoire)"))
                    .apply();
                try {
                    if (view != null) {
                        android.view.ViewGroup parent = (android.view.ViewGroup) view.getParent();
                        if (parent != null) parent.removeView(view);
                        view.destroy();
                    }
                } catch (Throwable ignored) {
                }
                if (getActivity() != null) getActivity().runOnUiThread(() -> getActivity().recreate());
                return true;
            }
        });
        // Appui long sur l'icône de l'appli → « Quel est ce son ? » (ouvre Boombox sur boombox://identify)
        if (Build.VERSION.SDK_INT >= 25) {
            try {
                android.content.pm.ShortcutManager sm = app.getSystemService(android.content.pm.ShortcutManager.class);
                Intent si = new Intent(Intent.ACTION_VIEW, Uri.parse("boombox://identify")).setPackage(app.getPackageName());
                android.content.pm.ShortcutInfo sc = new android.content.pm.ShortcutInfo.Builder(app, "identify")
                    .setShortLabel("Quel est ce son ?")
                    .setLongLabel("Trouver le son qui passe")
                    .setIcon(android.graphics.drawable.Icon.createWithResource(app, android.R.drawable.ic_btn_speak_now))
                    .setIntent(si)
                    .build();
                sm.setDynamicShortcuts(java.util.Collections.singletonList(sc));
            } catch (Throwable ignored) {
            }
        }
        IntentFilter nf = new IntentFilter(android.media.AudioManager.ACTION_AUDIO_BECOMING_NOISY);
        if (Build.VERSION.SDK_INT >= 33) app.registerReceiver(noisy, nf, Context.RECEIVER_EXPORTED);
        else app.registerReceiver(noisy, nf);
        // Préparation en arrière-plan (première ouverture : extraction de Python, quelques secondes)
        new Thread(() -> {
            Context ctx = getContext().getApplicationContext();
            try {
                YoutubeDL.getInstance().init(ctx);
            } catch (Exception e) {
                initError = e.getMessage();
            }
            ready.countDown();
            if (initError != null) return;
            SharedPreferences prefs = ctx.getSharedPreferences("boombox", Context.MODE_PRIVATE);
            long last = prefs.getLong("ytdlpUpdatedAt", 0);
            if (System.currentTimeMillis() - last > 7L * 24 * 3600 * 1000) {
                try {
                    YoutubeDL.getInstance().updateYoutubeDL(ctx, YoutubeDL.UpdateChannel._STABLE);
                    prefs.edit().putLong("ytdlpUpdatedAt", System.currentTimeMillis()).apply();
                } catch (Exception ignored) {
                }
            }
        }).start();
    }

    /** Télécharge l'audio d'une vidéo YouTube vers un fichier de l'appli (chemin relatif au dossier de données). */
    @PluginMethod
    public void ytdlpDownload(PluginCall call) {
        String id = call.getString("id");
        String path = call.getString("path");
        if (id == null || !id.matches("[\\w-]{11}") || path == null || path.contains("..")) {
            call.reject("Paramètres invalides");
            return;
        }
        new Thread(() -> {
            try {
                ready.await();
                if (initError != null) {
                    call.reject("yt-dlp indisponible : " + initError);
                    return;
                }
                File out = new File(getContext().getFilesDir(), path);
                File parent = out.getParentFile();
                if (parent != null) parent.mkdirs();
                File tmp = new File(out.getAbsolutePath() + ".dl");
                tmp.delete();
                YoutubeDLRequest req = new YoutubeDLRequest("https://www.youtube.com/watch?v=" + id);
                req.addOption("-f", "bestaudio[ext=m4a]/bestaudio");
                req.addOption("-o", tmp.getAbsolutePath());
                req.addOption("--no-part");
                req.addOption("--no-playlist");
                req.addOption("--no-mtime");
                YoutubeDL.getInstance().execute(req);
                if (!tmp.exists() || tmp.length() == 0) {
                    call.reject("téléchargement vide");
                    return;
                }
                out.delete();
                if (!tmp.renameTo(out)) {
                    call.reject("fichier impossible à enregistrer");
                    return;
                }
                JSObject r = new JSObject();
                r.put("size", out.length());
                call.resolve(r);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "erreur yt-dlp" : e.getMessage());
            }
        }).start();
    }
    // ---------- Notification de lecture (Android) : précédent / lecture-pause / suivant ----------
    // La WebView d'Android n'affiche pas de notification média : on en crée une native, reliée à une MediaSession
    // (écran de verrouillage, écouteurs Bluetooth, montre). Les appuis remontent au JavaScript (événement « mediaAction »).
    private static final String CH = "boombox_playback";
    private static final String ACT = "app.boombox.MEDIA";
    private MediaSession session;
    private BroadcastReceiver receiver;
    private String artUrl = null;
    private Bitmap art = null;

    private void emit(String action) {
        JSObject o = new JSObject();
        o.put("action", action);
        notifyListeners("mediaAction", o);
    }

    private void ensureSession() {
        if (session != null) return;
        Context ctx = getContext().getApplicationContext();
        session = new MediaSession(ctx, "Boombox");
        // Rappels sur le fil principal : mediaUpdate tourne sur un fil à part (sans « Looper »), où Android refusait
        // de créer le lecteur système → aucune notification de lecture sur Android
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { emit("play"); }
            @Override public void onPause() { emit("pause"); }
            @Override public void onSkipToNext() { emit("next"); }
            @Override public void onSkipToPrevious() { emit("prev"); }
            @Override public void onSeekTo(long pos) {
                JSObject o = new JSObject();
                o.put("action", "seek");
                o.put("time", pos / 1000.0);
                notifyListeners("mediaAction", o);
            }
        }, new android.os.Handler(android.os.Looper.getMainLooper()));
        session.setActive(true);
        receiver = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent i) {
                String a = i.getStringExtra("a");
                if (a != null) emit(a);
            }
        };
        if (Build.VERSION.SDK_INT >= 33) ctx.registerReceiver(receiver, new IntentFilter(ACT), Context.RECEIVER_NOT_EXPORTED);
        else ctx.registerReceiver(receiver, new IntentFilter(ACT));
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(new NotificationChannel(CH, "Lecture", NotificationManager.IMPORTANCE_LOW));
    }

    private Notification.Action action(Context ctx, int icon, String title, String a, int code) {
        Intent i = new Intent(ACT).setPackage(ctx.getPackageName()).putExtra("a", a);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Action.Builder(android.graphics.drawable.Icon.createWithResource(ctx, icon), title, pi).build();
    }

    // Android 13+ (Xiaomi, Redmi…) : sans l'autorisation « Notifications », la notification de lecture est
    // jetée sans rien dire. On la demande une fois, au premier son joué.
    private boolean askedNotif = false;
    private void askNotifPermission() {
        if (askedNotif || Build.VERSION.SDK_INT < 33 || getActivity() == null) return;
        askedNotif = true;
        if (ContextCompat.checkSelfPermission(getContext(), "android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
            getActivity().runOnUiThread(() -> ActivityCompat.requestPermissions(getActivity(), new String[] { "android.permission.POST_NOTIFICATIONS" }, 4243));
        }
    }

    @PluginMethod
    public void mediaUpdate(PluginCall call) {
        askNotifPermission();
        String title = call.getString("title", "");
        String artist = call.getString("artist", "");
        String url = call.getString("artwork", null);
        boolean playing = Boolean.TRUE.equals(call.getBoolean("playing", false));
        double pos = call.getDouble("position", 0.0);
        double dur = call.getDouble("duration", 0.0);
        new Thread(() -> {
            try {
                ensureSession();
                if (url != null && !url.equals(artUrl)) {
                    artUrl = url;
                    art = null;
                    try (InputStream in = new URL(url).openStream()) {
                        art = BitmapFactory.decodeStream(in);
                    } catch (Exception ignored) {
                    }
                }
                Context ctx = getContext().getApplicationContext();
                MediaMetadata.Builder md = new MediaMetadata.Builder()
                    .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                    .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
                    .putLong(MediaMetadata.METADATA_KEY_DURATION, (long) (dur * 1000));
                if (art != null) md.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, art);
                session.setMetadata(md.build());
                session.setPlaybackState(new PlaybackState.Builder()
                    .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_SEEK_TO)
                    .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, (long) (pos * 1000), playing ? 1f : 0f)
                    .build());
                Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
                PendingIntent content = open == null ? null : PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_IMMUTABLE);
                Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(ctx, CH) : new Notification.Builder(ctx);
                // Petite icône système (monochrome) : l'icône colorée de l'appli y est refusée par certains Android
                // (Samsung…) et, avec le service de lecture, faisait planter l'appli (« Bad notification »)
                b.setSmallIcon(android.R.drawable.ic_media_play)
                    .setContentTitle(title)
                    .setContentText(artist)
                    .setLargeIcon(art)
                    .setContentIntent(content)
                    .setOngoing(playing)
                    .setShowWhen(false)
                    .setVisibility(Notification.VISIBILITY_PUBLIC)
                    .setCategory(Notification.CATEGORY_TRANSPORT)
                    .setOnlyAlertOnce(true)
                    .addAction(action(ctx, android.R.drawable.ic_media_previous, "Précédent", "prev", 1))
                    .addAction(playing ? action(ctx, android.R.drawable.ic_media_pause, "Pause", "pause", 2) : action(ctx, android.R.drawable.ic_media_play, "Lecture", "play", 2))
                    .addAction(action(ctx, android.R.drawable.ic_media_next, "Suivant", "next", 3))
                    .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2));
                Notification n = b.build();
                PlaybackService.current = n;
                // Premier son : le service de lecture prend la notification au premier plan. Ensuite (ou s'il ne peut
                // pas démarrer, appli en arrière-plan), on met simplement la notification à jour.
                boolean started = false;
                if (playing && !serviceOn) {
                    try {
                        androidx.core.content.ContextCompat.startForegroundService(ctx, new Intent(ctx, PlaybackService.class));
                        serviceOn = true;
                        started = true;
                    } catch (Exception ignored) {
                    }
                }
                if (!started) ((NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE)).notify(4242, n);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        }).start();
    }

    // Mise à jour de l'appli : télécharge l'APK (progression envoyée par « apkProgress ») puis ouvre l'écran
    // d'installation d'Android. La première fois, Android demande d'autoriser Boombox à installer des applis :
    // on ouvre ce réglage et on renvoie l'erreur « permission » (il suffit de réappuyer ensuite).
    @PluginMethod
    public void installApk(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("adresse manquante");
            return;
        }
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= 26 && !ctx.getPackageManager().canRequestPackageInstalls()) {
            Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName()));
            s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(s);
            call.reject("permission", "permission");
            return;
        }
        new Thread(() -> {
            try {
                File dir = new File(ctx.getCacheDir(), "update");
                dir.mkdirs();
                File apk = new File(dir, "Boombox.apk");
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setInstanceFollowRedirects(true);
                c.setConnectTimeout(15000);
                c.setReadTimeout(30000);
                long total = c.getContentLengthLong();
                try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
                    byte[] buf = new byte[65536];
                    long done = 0, lastSent = 0;
                    for (int n; (n = in.read(buf)) > 0; ) {
                        out.write(buf, 0, n);
                        done += n;
                        if (total > 0 && done - lastSent > total / 50) {
                            lastSent = done;
                            JSObject p = new JSObject();
                            p.put("progress", (double) done / total);
                            notifyListeners("apkProgress", p);
                        }
                    }
                }
                Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apk);
                Intent i = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(i);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        }).start();
    }

    private static boolean serviceOn = false;

    // Reconnaissance d'un son (gratuite) : on ouvre « Rechercher un titre » de Google ; à défaut Shazam s'il est installé
    @PluginMethod
    public void soundSearch(PluginCall call) {
        Context ctx = getContext();
        Intent[] tries = {
            new Intent("com.google.android.googlequicksearchbox.MUSIC_SEARCH"),
            new Intent("android.media.action.MEDIA_SEARCH").setPackage("com.google.android.googlequicksearchbox"),
            new Intent("com.shazam.android.intent.actions.START_TAGGING"),
        };
        for (Intent i : tries) {
            try {
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(i);
                JSObject r = new JSObject();
                r.put("app", i.getAction().contains("shazam") ? "shazam" : "google");
                call.resolve(r);
                return;
            } catch (Throwable ignored) {
            }
        }
        call.reject("aucune appli", "none");
    }

    // ---------- Chromecast : l'écran du mode soirée sur la télé ----------
    // On choisit la télé (liste Google Cast), la télé lance l'appli réceptrice de Boombox (cast.html) et reçoit le
    // code de la party. Ensuite elle est autonome : le téléphone peut se mettre en veille.
    private static final String CAST_NS = "urn:x-cast:app.boombox.tv";
    private String pendingCast = null;
    private boolean castListening = false;

    private void castEvent(String state, String device) {
        JSObject o = new JSObject();
        o.put("state", state);
        if (device != null) o.put("device", device);
        notifyListeners("castState", o);
    }

    @PluginMethod
    public void castParty(PluginCall call) {
        String code = call.getString("code");
        if (code == null || getActivity() == null) {
            call.reject("code manquant");
            return;
        }
        String msg = "{\"code\":\"" + code.replaceAll("[^A-Za-z0-9]", "") + "\"}";
        getActivity().runOnUiThread(() -> {
            try {
                com.google.android.gms.cast.framework.CastContext cc = com.google.android.gms.cast.framework.CastContext.getSharedInstance(getContext());
                com.google.android.gms.cast.framework.SessionManager sm = cc.getSessionManager();
                if (!castListening) {
                    castListening = true;
                    sm.addSessionManagerListener(new com.google.android.gms.cast.framework.SessionManagerListener<com.google.android.gms.cast.framework.CastSession>() {
                        @Override public void onSessionStarted(com.google.android.gms.cast.framework.CastSession s, String id) { sendPending(s); }
                        @Override public void onSessionResumed(com.google.android.gms.cast.framework.CastSession s, boolean b) { sendPending(s); }
                        @Override public void onSessionStartFailed(com.google.android.gms.cast.framework.CastSession s, int e) { castEvent("failed", null); }
                        @Override public void onSessionEnded(com.google.android.gms.cast.framework.CastSession s, int e) { castEvent("ended", null); }
                        @Override public void onSessionStarting(com.google.android.gms.cast.framework.CastSession s) { castEvent("connecting", null); }
                        @Override public void onSessionEnding(com.google.android.gms.cast.framework.CastSession s) {}
                        @Override public void onSessionResuming(com.google.android.gms.cast.framework.CastSession s, String id) {}
                        @Override public void onSessionResumeFailed(com.google.android.gms.cast.framework.CastSession s, int e) {}
                        @Override public void onSessionSuspended(com.google.android.gms.cast.framework.CastSession s, int r) {}
                    }, com.google.android.gms.cast.framework.CastSession.class);
                }
                com.google.android.gms.cast.framework.CastSession cur = sm.getCurrentCastSession();
                pendingCast = msg;
                if (cur != null && cur.isConnected()) {
                    sendPending(cur);
                } else {
                    androidx.mediarouter.app.MediaRouteChooserDialog d = new androidx.mediarouter.app.MediaRouteChooserDialog(new android.view.ContextThemeWrapper(getActivity(), androidx.mediarouter.R.style.Theme_MediaRouter));
                    androidx.mediarouter.media.MediaRouteSelector sel = cc.getMergedSelector();
                    if (sel == null) sel = new androidx.mediarouter.media.MediaRouteSelector.Builder()
                        .addControlCategory(com.google.android.gms.cast.CastMediaControlIntent.categoryForCast("43163073")).build();
                    d.setRouteSelector(sel);
                    // Titre après show() : avant, sa zone de texte n'existe pas encore (plantage « TextView.setText
                    // on a null object reference » : « Chromecast indisponible »)
                    d.show();
                    d.setTitle("Afficher la party sur…");
                }
                call.resolve();
            } catch (Throwable e) {
                call.reject(e.getMessage() == null ? "Chromecast indisponible" : e.getMessage());
            }
        });
    }

    private void sendPending(com.google.android.gms.cast.framework.CastSession s) {
        if (pendingCast == null || s == null) return;
        String m = pendingCast;
        pendingCast = null;
        try {
            s.sendMessage(CAST_NS, m);
            castEvent("connected", s.getCastDevice() != null ? s.getCastDevice().getFriendlyName() : null);
        } catch (Throwable e) {
            castEvent("failed", null);
        }
    }

    @PluginMethod
    public void castStop(PluginCall call) {
        if (getActivity() == null) {
            call.resolve();
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                com.google.android.gms.cast.framework.CastContext.getSharedInstance(getContext()).getSessionManager().endCurrentSession(true);
            } catch (Throwable ignored) {
            }
            call.resolve();
        });
    }

    // Écran gardé allumé (paroles affichées pendant la lecture) : la WebView Android n'a pas l'API Wake Lock
    @PluginMethod
    public void setKeepAwake(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        if (getActivity() == null) {
            call.resolve();
            return;
        }
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    // ---------- « Partager » vers Boombox (ex. le son trouvé par Shazam ou Google) ----------
    private String sharedText = null;
    private void keepShared(Intent i) {
        if (i == null || !Intent.ACTION_SEND.equals(i.getAction())) return;
        String t = i.getStringExtra(Intent.EXTRA_TEXT);
        if (t == null || t.trim().isEmpty()) return;
        i.setAction(Intent.ACTION_MAIN); // une seule fois, même si l'activité est recréée
        sharedText = t;
        JSObject o = new JSObject();
        o.put("text", t);
        notifyListeners("shared", o);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        keepShared(intent);
    }

    // Texte partagé en attente (puis effacé) : lu au démarrage de l'interface
    @PluginMethod
    public void takeShared(PluginCall call) {
        JSObject r = new JSObject();
        if (sharedText != null) r.put("text", sharedText);
        sharedText = null;
        call.resolve(r);
    }

    // Dernier plantage enregistré (puis effacé)
    @PluginMethod
    public void takeCrash(PluginCall call) {
        SharedPreferences p = getContext().getSharedPreferences("boombox", Context.MODE_PRIVATE);
        String c = p.getString("lastCrash", null);
        p.edit().remove("lastCrash").apply();
        JSObject r = new JSObject();
        if (c != null) r.put("crash", c);
        call.resolve(r);
    }

    @PluginMethod
    public void mediaStop(PluginCall call) {
        Context ctx = getContext().getApplicationContext();
        if (serviceOn) {
            ctx.stopService(new Intent(ctx, PlaybackService.class));
            serviceOn = false;
        }
        ((NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(4242);
        call.resolve();
    }
}
