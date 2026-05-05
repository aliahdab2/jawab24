package com.jawab24.app;

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;

import io.sentry.android.core.SentryAndroid;

public class Jawab24Application extends Application {
    // Channel IDs MUST match ANDROID_CHANNEL_ID / ANDROID_URGENT_CHANNEL_ID in
    // backend/src/services/notifications.ts. FCM messages tagged with these
    // channelIds are delivered into the matching channel; mismatch causes
    // Android 8+ to silently drop the notification.
    private static final String CHANNEL_DEFAULT_ID = "jawab24_default";
    private static final String CHANNEL_URGENT_ID = "jawab24_urgent";

    @Override
    public void onCreate() {
        super.onCreate();
        initSentry();
        createNotificationChannels();
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

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager == null) return;

            // Default: silent tray entry — replies, comments, billing notices.
            NotificationChannel defaultChannel = new NotificationChannel(
                CHANNEL_DEFAULT_ID,
                getString(R.string.notification_channel_name),
                NotificationManager.IMPORTANCE_DEFAULT
            );
            defaultChannel.setDescription(getString(R.string.notification_channel_description));
            manager.createNotificationChannel(defaultChannel);

            // Urgent: heads-up + sound — flagged replies that need immediate attention.
            NotificationChannel urgentChannel = new NotificationChannel(
                CHANNEL_URGENT_ID,
                getString(R.string.notification_channel_urgent_name),
                NotificationManager.IMPORTANCE_HIGH
            );
            urgentChannel.setDescription(getString(R.string.notification_channel_urgent_description));
            manager.createNotificationChannel(urgentChannel);
        } catch (Exception e) {
            android.util.Log.e("Jawab24", "Notification channel creation failed", e);
        }
    }
}
