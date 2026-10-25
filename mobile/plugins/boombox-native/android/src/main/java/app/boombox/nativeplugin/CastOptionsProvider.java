package app.boombox.nativeplugin;

import android.content.Context;
import com.google.android.gms.cast.framework.CastOptions;
import com.google.android.gms.cast.framework.OptionsProvider;
import com.google.android.gms.cast.framework.SessionProvider;
import java.util.List;

/**
 * Chromecast : l'appli réceptrice de Boombox (console Google Cast, Application ID 43163073) affiche
 * https://musikal-b72d1.web.app/cast.html sur la télé — l'écran du mode soirée.
 */
public class CastOptionsProvider implements OptionsProvider {
    public static final String APP_ID = "43163073";

    @Override
    public CastOptions getCastOptions(Context context) {
        return new CastOptions.Builder().setReceiverApplicationId(APP_ID).setStopReceiverApplicationWhenEndingSession(false).build();
    }

    @Override
    public List<SessionProvider> getAdditionalSessionProviders(Context context) {
        return null;
    }
}
