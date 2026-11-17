package com.botcosas.embeds;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

public class MainActivity extends Activity {
    private WebView web;
    private String pendingUrl, pendingName;
    private ValueCallback<Uri[]> filePathCb; // selector de imágenes (<input type=file>) para comentarios

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // el video arranca solo al abrirlo
        web.setBackgroundColor(0xFF050412);
        web.addJavascriptInterface(new Bridge(), "Native"); // copiar / abrir en Discord / descargar
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (filePathCb != null) filePathCb.onReceiveValue(null);
                filePathCb = cb;
                try {
                    startActivityForResult(p.createIntent(), 9);
                } catch (Exception e) {
                    filePathCb = null;
                    return false;
                }
                return true;
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                return loader.shouldInterceptRequest(r.getUrl()); // null = carga normal (API, Google Fonts...)
            }
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if ("appassets.androidplatform.net".equals(u.getHost())) return false;
                openExternal(u.toString());
                return true;
            }
        });
        web.loadUrl("https://appassets.androidplatform.net/assets/index.html");
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == 9) {
            if (filePathCb != null) {
                filePathCb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
                filePathCb = null;
            }
            return;
        }
        super.onActivityResult(req, res, data);
    }

    /** Atrás: primero lo gestiona la interfaz (reproductor -> detalle -> lista -> menú); en el menú cierra la app. */
    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.appBack ? window.appBack() : false", value -> {
            if (!"true".equals(value)) MainActivity.super.onBackPressed();
        });
    }

    private void openExternal(String url) {
        try {
            Uri u = Uri.parse(url);
            String sc = u.getScheme();
            if (!"http".equals(sc) && !"https".equals(sc) && !"discord".equals(sc)) return;
            startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Exception e) {
            Toast.makeText(this, "No se pudo abrir el enlace", Toast.LENGTH_SHORT).show();
        }
    }

    private void startDownload(String url, String name) {
        try {
            String safe = name == null || name.isEmpty() ? "embed" : name.replaceAll("[\\\\/:*?\"<>|]", "_");
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
            r.setTitle(safe);
            r.addRequestHeader("User-Agent", "Mozilla/5.0");
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, safe);
            ((DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(r);
            Toast.makeText(this, "Descargando " + safe, Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Toast.makeText(this, "No se pudo descargar", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        super.onRequestPermissionsResult(code, perms, res);
        if (code == 7 && res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED && pendingUrl != null) {
            startDownload(pendingUrl, pendingName);
        }
        pendingUrl = pendingName = null;
    }

    /** Funciones que la interfaz llama como window.Native.xxx(...) */
    private class Bridge {
        @JavascriptInterface
        public void copy(final String text) {
            runOnUiThread(() -> {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                cm.setPrimaryClip(ClipData.newPlainText("mensaje", text == null ? "" : text));
            });
        }

        @JavascriptInterface
        public void open(final String url) {
            runOnUiThread(() -> openExternal(url));
        }

        @JavascriptInterface
        public void download(final String url, final String name) {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT < 29
                        && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                    pendingUrl = url; pendingName = name;
                    requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, 7);
                    return;
                }
                startDownload(url, name);
            });
        }
    }
}
