package com.cav.photostudio;

import android.content.Intent;
import android.util.Log;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginHandle;

import ee.forgr.capacitor.social.login.GoogleProvider;
import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;
import ee.forgr.capacitor.social.login.SocialLoginPlugin;

public class MainActivity extends BridgeActivity implements ModifiedMainActivityForSocialLoginPlugin {
    @Override
    public void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode < GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MIN
            || requestCode >= GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MAX) {
            return;
        }

        PluginHandle pluginHandle = getBridge().getPlugin("SocialLogin");
        if (pluginHandle == null || !(pluginHandle.getInstance() instanceof SocialLoginPlugin)) {
            Log.w("CAV Google Login", "SocialLogin plugin is unavailable for the activity result.");
            return;
        }

        ((SocialLoginPlugin) pluginHandle.getInstance()).handleGoogleLoginIntent(requestCode, data);
    }

    @Override
    public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {
        // Required marker for the SocialLogin Android activity-result bridge.
    }
}
