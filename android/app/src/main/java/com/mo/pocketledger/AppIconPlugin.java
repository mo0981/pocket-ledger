package com.mo.pocketledger;

import android.content.ComponentName;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 桌面图标跟随皮肤切换。
 *
 * 原理：Android 不允许在运行时替换 <application android:icon>，
 * 但允许按需启用/停用 activity-alias —— 每个别名可以挂自己的图标和 label。
 * 所以清单里声明了 6 个带 LAUNCHER 入口的别名，同一时刻只留一个启用，
 * 桌面图标就等于当前启用别名的图标。
 *
 * 两个必须注意的点：
 * 1) 必须带 DONT_KILL_APP，否则切换时系统会杀掉进程，用户正在输入的内容全丢。
 * 2) 先启用新的再停用旧的：顺序反了中间会有一瞬间「手机上找不到这个 App」，
 *    部分启动器还会把残留的快捷方式清掉。
 */
@CapacitorPlugin(name = "AppIcon")
public class AppIconPlugin extends Plugin {

    /** 与 app.js 里的 SKINS 顺序一一对应 */
    private static final String[] KEYS = {"classic", "ink", "aurora", "pop", "term", "cel"};
    private static final String[] ALIASES = {
            "IconClassic", "IconInk", "IconAurora", "IconPop", "IconTerm", "IconCel"
    };

    @PluginMethod
    public void set(PluginCall call) {
        String skin = call.getString("skin", "classic");
        int idx = indexOf(skin);
        if (idx < 0) {
            call.reject("未知的皮肤: " + skin);
            return;
        }

        final PackageManager pm = getContext().getPackageManager();
        final String pkg = getContext().getPackageName();
        final ComponentName target = new ComponentName(pkg, pkg + "." + ALIASES[idx]);

        int state = pm.getComponentEnabledSetting(target);
        // 已经是这套图标就什么也不做：每次启动都写一次会让桌面图标反复闪
        if (state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED) {
            call.resolve();
            return;
        }

        try {
            pm.setComponentEnabledSetting(target,
                    PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                    PackageManager.DONT_KILL_APP);
        } catch (Exception e) {
            call.reject("启用图标失败: " + e.getMessage());
            return;
        }

        // 给系统广播留出时间，再关掉其余别名
        new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
            @Override
            public void run() {
                for (String alias : ALIASES) {
                    ComponentName cn = new ComponentName(pkg, pkg + "." + alias);
                    if (cn.equals(target)) continue;
                    if (pm.getComponentEnabledSetting(cn)
                            == PackageManager.COMPONENT_ENABLED_STATE_DISABLED) continue;
                    try {
                        pm.setComponentEnabledSetting(cn,
                                PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                                PackageManager.DONT_KILL_APP);
                    } catch (Exception ignored) {
                        // 单个别名失败不影响其它，忽略
                    }
                }
            }
        }, 350);

        call.resolve();
    }

    /** 当前生效的别名对应的皮肤 key，供调试和测试用 */
    @PluginMethod
    public void current(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        String pkg = getContext().getPackageName();
        String found = "classic";
        for (int i = 0; i < ALIASES.length; i++) {
            ComponentName cn = new ComponentName(pkg, pkg + "." + ALIASES[i]);
            int st = pm.getComponentEnabledSetting(cn);
            boolean on = st == PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                    || (st == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && i == 0);
            if (on) {
                found = KEYS[i];
                break;
            }
        }
        com.getcapacitor.JSObject ret = new com.getcapacitor.JSObject();
        ret.put("skin", found);
        call.resolve(ret);
    }

    private static int indexOf(String key) {
        for (int i = 0; i < KEYS.length; i++) {
            if (KEYS[i].equals(key)) return i;
        }
        return -1;
    }
}
