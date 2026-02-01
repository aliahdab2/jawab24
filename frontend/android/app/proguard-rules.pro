# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# --- Crash reporting: preserve line numbers ---
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# --- WebView / Capacitor ---
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * {
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.PluginMethod <methods>;
}
-dontwarn com.getcapacitor.**

-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# --- Sentry ---
-keep class io.sentry.** { *; }
-dontwarn io.sentry.**

# --- Facebook SDK ---
-keep class com.facebook.** { *; }
-dontwarn com.facebook.**

# --- Google Play Core (In-App Updates) ---
-keep class com.google.android.play.core.** { *; }
-dontwarn com.google.android.play.core.**
