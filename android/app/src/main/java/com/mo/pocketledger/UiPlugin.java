package com.mo.pocketledger;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 状态栏图标深浅。
 *
 * targetSdk 35 起 Android 强制「边到边」，状态栏透明、图标默认白色。
 * 遇到纸白 / 奶黄 / 宣纸这类浅色皮肤时，白色图标等于看不见（时间、电量全消失）。
 * 这里按皮肤把状态栏图标切成深色，深色皮肤保持白色。
 */
@CapacitorPlugin(name = "Ui")
public class UiPlugin extends Plugin {

    /**
     * @param dark true = 状态栏图标用深色（浅色皮肤）；false = 用白色（深色皮肤）
     */
    @PluginMethod
    public void setStatusBar(final PluginCall call) {
        final boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", Boolean.TRUE));
        if (getActivity() == null) {
            call.reject("Activity 还没准备好");
            return;
        }
        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    WindowInsetsControllerCompat c = WindowCompat.getInsetsController(
                            getActivity().getWindow(), getActivity().getWindow().getDecorView());
                    c.setAppearanceLightStatusBars(dark);
                    // 底部手势条同理，否则深色/浅色皮肤下会有一条看不见的导航条
                    c.setAppearanceLightNavigationBars(dark);
                    call.resolve();
                } catch (Exception e) {
                    call.reject("设置状态栏失败: " + e.getMessage());
                }
            }
        });
    }
}
