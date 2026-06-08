package com.jawab24.app;

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;

import io.sentry.android.core.SentryAndroid;

public class Jawab24Application extends Application {
    // Channel IDs MUST match ANDROID_CHANNEL_ID / ANDROID_URGENT_CHANNEL_ID(_V2) in
    // backend/src/services/notifications.ts. FCM messages tagged with these
    // channelIds are delivered into the matching channel; mismatch causes
    // Android 8+ to silently drop the notification.
    private static final String CHANNEL_DEFAULT_ID = "jawab24_default";
    private static final String CHANNEL_URGENT_ID = "jawab24_urgent";
    // A channel's sound is immutable after creation, so the custom bad-comment
    // sound lives on a NEW channel id rather than mutating jawab24_urgent. The
    // old urgent channel is kept (below) so pushes from a backend that hasn't
    // flipped to v2 yet are still delivered instead of silently dropped.
    private static final String CHANNEL_URGENT_V2_ID = "jawab24_urgent_v2";

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

            // Urgent (legacy): heads-up + default system sound. Kept for backward
            // compatibility so urgent pushes still land while the backend is still
            // addressing this channel id (before ANDROID_URGENT_SOUND is flipped on).
            NotificationChannel urgentChannel = new NotificationChannel(
                CHANNEL_URGENT_ID,
                getString(R.string.notification_channel_urgent_name),
                NotificationManager.IMPORTANCE_HIGH
            );
            urgentChannel.setDescription(getString(R.string.notification_channel_urgent_description));
            manager.createNotificationChannel(urgentChannel);

            // Urgent v2: heads-up + a DISTINCT custom sound — offensive/high-stakes
            // comments. Separate id because a channel's sound cannot be changed after
            // creation. The backend routes here once ANDROID_URGENT_SOUND=true.
            NotificationChannel urgentV2Channel = new NotificationChannel(
                CHANNEL_URGENT_V2_ID,
                getString(R.string.notification_channel_urgent_name),
                NotificationManager.IMPORTANCE_HIGH
            );
            urgentV2Channel.setDescription(getString(R.string.notification_channel_urgent_description));
            Uri urgentSound = Uri.parse(
                "android.resource://" + getPackageName() + "/" + R.raw.urgent_alert
            );
            AudioAttributes soundAttrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
            urgentV2Channel.setSound(urgentSound, soundAttrs);
            manager.createNotificationChannel(urgentV2Channel);
        } catch (Exception e) {
            android.util.Log.e("Jawab24", "Notification channel creation failed", e);
        }
    }
}
