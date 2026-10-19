package app.boombox.nativeplugin;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.yausername.youtubedl_android.YoutubeDL;
import com.yausername.youtubedl_android.YoutubeDLRequest;

import java.io.File;
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

    @Override
    public void load() {
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
}
