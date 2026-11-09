package com.mo.pocketledger;

import android.os.Bundle;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.OnApplyWindowInsetsListener;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 自定义插件必须在 super.onCreate 之前注册，否则 WebView 启动时找不到它
        registerPlugin(AppIconPlugin.class);
        registerPlugin(UiPlugin.class);
        super.onCreate(savedInstanceState);

        if (getBridge() == null || getBridge().getWebView() == null) return;
        final WebView webView = getBridge().getWebView();

        // 1) 系统字体被调成「特大」时，WebView 会把整页文字一起放大，布局直接被撑破。
        //    这里锁回 100%，让页面按自己的字号走。
        WebSettings settings = webView.getSettings();
        settings.setTextZoom(100);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        // 2) targetSdk 35 起，Android 15/16 对应用强制「边到边」，
        //    状态栏和底部手势条会压在网页上，顶部标题、底部导航被盖掉。
        //    WebView 里 env(safe-area-inset-*) 在安卓恒为 0，只能由原生把真实
        //    insets 算成 CSS 变量塞进去，样式里用 --sat / --sab 补偿。
        ViewCompat.setOnApplyWindowInsetsListener(webView, new OnApplyWindowInsetsListener() {
            @Override
            public WindowInsetsCompat onApplyWindowInsets(View v, WindowInsetsCompat windowInsets) {
                Insets bars = windowInsets.getInsets(
                        WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
                float density = v.getResources().getDisplayMetrics().density;
                if (density <= 0) density = 1f;
                final String js = "document.documentElement.style.setProperty('--sat','"
                        + (bars.top / density) + "px');"
                        + "document.documentElement.style.setProperty('--sab','"
                        + (bars.bottom / density) + "px');";
                v.post(new Runnable() {
                    @Override
                    public void run() {
                        webView.evaluateJavascript(js, null);
                    }
                });
                // 不消费 insets：WebView 仍然铺满，遮挡交给 CSS 补
                return windowInsets;
            }
        });
        ViewCompat.requestApplyInsets(webView);
    }
}
