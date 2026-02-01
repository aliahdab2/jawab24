package com.jawab24.app;

import android.app.Application;

import io.sentry.android.core.SentryAndroid;

public class Jawab24Application extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        initSentry();
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
}
