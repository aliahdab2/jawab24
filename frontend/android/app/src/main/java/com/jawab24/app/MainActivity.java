package com.jawab24.app;

import android.os.Bundle;
import android.util.Log;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;

import com.getcapacitor.BridgeActivity;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.appupdate.AppUpdateOptions;
import com.google.android.play.core.install.InstallStateUpdatedListener;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.InstallStatus;
import com.google.android.play.core.install.model.UpdateAvailability;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "Jawab24";
    private long backPressedTime = 0;
    private AppUpdateManager appUpdateManager;
    private ActivityResultLauncher<IntentSenderRequest> updateLauncher;

    private final InstallStateUpdatedListener installStateListener = state -> {
        if (state.installStatus() == InstallStatus.DOWNLOADED) {
            appUpdateManager.completeUpdate();
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Audio permissions are handled by Capacitor's BridgeWebChromeClient.
        // Do NOT replace it with a custom WebChromeClient — that breaks <input type="file">.

        // Back button: navigate WebView history or double-press to exit
        try {
            getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
                @Override
                public void handleOnBackPressed() {
                    if (getBridge() != null && getBridge().getWebView().canGoBack()) {
                        getBridge().getWebView().goBack();
                    } else if (backPressedTime + 2000 > System.currentTimeMillis()) {
                        finish();
                    } else {
                        Toast.makeText(MainActivity.this, "Press back again to exit", Toast.LENGTH_SHORT).show();
                        backPressedTime = System.currentTimeMillis();
                    }
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "Back button setup failed", e);
        }

        try {
            updateLauncher = registerForActivityResult(
                    new ActivityResultContracts.StartIntentSenderForResult(),
                    result -> { /* Update flow completed or cancelled by user */ }
            );
            checkForAppUpdate();
        } catch (Exception e) {
            Log.e(TAG, "In-app update setup failed", e);
        }
    }

    private void checkForAppUpdate() {
        try {
            appUpdateManager = AppUpdateManagerFactory.create(this);
            appUpdateManager.registerListener(installStateListener);

            appUpdateManager.getAppUpdateInfo().addOnSuccessListener(info -> {
                if (info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE
                        && info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE)) {
                    try {
                        appUpdateManager.startUpdateFlowForResult(
                                info,
                                updateLauncher,
                                AppUpdateOptions.newBuilder(AppUpdateType.FLEXIBLE).build()
                        );
                    } catch (Exception e) {
                        Log.w(TAG, "Could not start update flow", e);
                    }
                }
            }).addOnFailureListener(e -> {
                Log.w(TAG, "Update check failed", e);
            });
        } catch (Exception e) {
            Log.e(TAG, "AppUpdateManager init failed", e);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        if (appUpdateManager != null) {
            try {
                appUpdateManager.getAppUpdateInfo().addOnSuccessListener(info -> {
                    if (info.installStatus() == InstallStatus.DOWNLOADED) {
                        appUpdateManager.completeUpdate();
                    }
                });
            } catch (Exception e) {
                Log.w(TAG, "Resume update check failed", e);
            }
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (appUpdateManager != null) {
            try {
                appUpdateManager.unregisterListener(installStateListener);
            } catch (Exception e) {
                Log.w(TAG, "Listener cleanup failed", e);
            }
        }
    }
}
