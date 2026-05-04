package com.jawab24.app;

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;

import io.sentry.android.core.SentryAndroid;

public class Jawab24Application extends Application {
    // Must match ANDROID_CHANNEL_ID in backend/src/services/notifications.ts.
    // FCM messages tagged with this channelId are delivered into this channel;
    // mismatch causes Android 8+ to silently drop the notification.
    private static final String NOTIFICATION_CHANNEL_ID = "jawab24_default";

    @Override
    public void onCreate() {
        super.onCreate();
        initSentry();
        createNotificationChannel();
    }

    private void initSentry() {
        try {
            String dsn = BuildConfig.SENTRY_DSN;
            if (dsn != null && !dsn.isEmpty()) {
                SentryAndroid.init(this, options -> {
                    options.setDsn(dsn);
                    options.setAnrEnabled(true);
                });
            }
        } catch (Exception e) {
            android.util.Log.e("Jawab24", "Sentry init failed", e);
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager == null) return;
            NotificationChannel channel = new NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                getString(R.string.notification_channel_name),
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription(getString(R.string.notification_channel_description));
            manager.createNotificationChannel(channel);
        } catch (Exception e) {
            android.util.Log.e("Jawab24", "Notification channel creation failed", e);
        }
    }
}
