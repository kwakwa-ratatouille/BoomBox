package app.boombox.nativeplugin;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * Service de lecture (Android) : porte la notification de lecture au premier plan. Sans lui, certaines surcouches
 * (Xiaomi / MIUI / HyperOS) ne montrent pas le lecteur dans les notifications, ou le donnent à une autre appli
 * (Brave…). Le contenu de la notification est préparé par BoomboxNativePlugin.mediaUpdate.
 */
public class PlaybackService extends Service {
    static volatile Notification current;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Android exige startForeground() dans les 5 s après le démarrage, sinon il tue l'appli : on l'appelle
        // toujours, avec une notification minimale si celle du lecteur n'est pas (encore) prête
        Notification n = current;
        if (n == null) {
            if (Build.VERSION.SDK_INT >= 26) {
                ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(new NotificationChannel("boombox_playback", "Lecture", NotificationManager.IMPORTANCE_LOW));
                n = new Notification.Builder(this, "boombox_playback").setSmallIcon(android.R.drawable.ic_media_play).setContentTitle("Boombox").build();
            } else {
                n = new Notification.Builder(this).setSmallIcon(android.R.drawable.ic_media_play).setContentTitle("Boombox").build();
            }
        }
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(4242, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            else startForeground(4242, n);
        } catch (Throwable e) {
            stopSelf();
        }
        if (current == null) stopSelf();
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
