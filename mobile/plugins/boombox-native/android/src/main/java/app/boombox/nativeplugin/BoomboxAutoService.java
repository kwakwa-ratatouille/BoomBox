package app.boombox.nativeplugin;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.session.MediaSession;
import android.net.Uri;
import android.os.Bundle;
import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.MediaDescriptionCompat;
import android.support.v4.media.session.MediaSessionCompat;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.media.MediaBrowserServiceCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Android Auto : Boombox dans l'écran de la voiture (à côté de Waze, Maps…).
 * La voiture parcourt la bibliothèque envoyée par l'appli (Titres likés + playlists, voir setAutoLibrary) et
 * pilote la lecture par la session média de Boombox (lecture, pause, suivant, précédent, son choisi).
 * Le son est joué par l'appli Boombox elle-même : elle doit être ouverte (en arrière-plan suffit).
 */
public class BoomboxAutoService extends MediaBrowserServiceCompat {
    static final String ROOT = "root";
    private static final String PREFS = "boombox";
    private static final String KEY = "autoLibrary";
    private static BoomboxAutoService current;

    // Session média partagée avec le module (notification, écran verrouillé, voiture)
    private static MediaSession session;
    static synchronized MediaSession session(Context ctx) {
        if (session == null) {
            session = new MediaSession(ctx.getApplicationContext(), "Boombox");
            session.setActive(true);
        }
        return session;
    }

    // Bibliothèque reçue de l'appli : gardée sur le téléphone (la voiture peut se connecter avant l'ouverture de l'appli)
    static void saveLibrary(Context ctx, String json) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply();
        if (current != null) {
            current.notifyChildrenChanged(ROOT);
        }
    }

    private JSONObject library() {
        try {
            return new JSONObject(getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        current = this;
        setSessionToken(MediaSessionCompat.Token.fromToken(session(this).getSessionToken()));
    }

    @Override
    public void onDestroy() {
        if (current == this) current = null;
        super.onDestroy();
    }

    @Nullable
    @Override
    public BrowserRoot onGetRoot(@NonNull String clientPackageName, int clientUid, @Nullable Bundle rootHints) {
        return new BrowserRoot(ROOT, null);
    }

    @Override
    public void onLoadChildren(@NonNull String parentId, @NonNull Result<List<MediaBrowserCompat.MediaItem>> result) {
        List<MediaBrowserCompat.MediaItem> out = new ArrayList<>();
        JSONObject lib = library();
        JSONArray lists = lib.optJSONArray("lists");
        if (lists == null) lists = new JSONArray();
        if (ROOT.equals(parentId)) {
            // Accueil de la voiture : une entrée par liste (Titres likés en premier)
            for (int i = 0; i < lists.length(); i++) {
                JSONObject l = lists.optJSONObject(i);
                if (l == null) continue;
                MediaDescriptionCompat.Builder d = new MediaDescriptionCompat.Builder()
                        .setMediaId("list:" + l.optString("id"))
                        .setTitle(l.optString("name"))
                        .setSubtitle(l.optInt("count") + " titres");
                String cover = l.optString("cover", "");
                if (cover.startsWith("http")) d.setIconUri(Uri.parse(cover));
                out.add(new MediaBrowserCompat.MediaItem(d.build(), MediaBrowserCompat.MediaItem.FLAG_BROWSABLE));
            }
        } else if (parentId.startsWith("list:")) {
            String id = parentId.substring(5);
            for (int i = 0; i < lists.length(); i++) {
                JSONObject l = lists.optJSONObject(i);
                if (l == null || !id.equals(l.optString("id"))) continue;
                JSONArray tracks = l.optJSONArray("tracks");
                if (tracks == null) break;
                for (int k = 0; k < tracks.length(); k++) {
                    JSONObject t = tracks.optJSONObject(k);
                    if (t == null) continue;
                    MediaDescriptionCompat.Builder d = new MediaDescriptionCompat.Builder()
                            .setMediaId("play:" + id + ":" + k)
                            .setTitle(t.optString("title"))
                            .setSubtitle(t.optString("artist"));
                    String thumb = t.optString("thumb", "");
                    if (thumb.startsWith("http")) d.setIconUri(Uri.parse(thumb));
                    out.add(new MediaBrowserCompat.MediaItem(d.build(), MediaBrowserCompat.MediaItem.FLAG_PLAYABLE));
                }
                break;
            }
        }
        result.sendResult(out);
    }

    // Appli fermée quand la voiture demande un son : on l'ouvre (le son demandé est rejoué à son démarrage)
    static void openApp(Context ctx) {
        try {
            Intent i = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
            if (i == null) return;
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            ctx.startActivity(i);
        } catch (Exception ignored) {
        }
    }

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
