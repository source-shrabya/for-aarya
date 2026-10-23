package np.com.shrabya.foraarya;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

// The whole app is the website in a full-screen browser view. Our own pages open inside it;
// YouTube, Spotify, IMDb and every other site open in their own apps.
public class MainActivity extends Activity {
    private static final String HOME = "https://source-shrabya.github.io/for-aarya/";
    private static final String SITE = "source-shrabya.github.io";
    private static final int PICK_FILES = 1;
    private static final String OFFLINE =
        "<body style=\"margin:0;background:#c3b9a7;color:#1d2a50;font:22px/1.6 serif;"
        + "display:grid;place-items:center;height:100vh;text-align:center\">"
        + "<p>इन्टरनेट छैन जस्तो छ।<br><a href=\"" + HOME + "\" style=\"color:#8c2f3b\">फेरि खोल</a></p></body>";

    private WebView web;
    private ValueCallback<Uri[]> filesWaiting;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        web = new WebView(this);
        web.setBackgroundColor(0xFFC3B9A7);
        setContentView(web);

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (SITE.equals(url.getHost())) return false;
                openOutside(url);
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) view.loadDataWithBaseURL(null, OFFLINE, "text/html", "utf-8", null);
            }
        });

        // Picking photos for letters and the picture wall
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filesWaiting != null) filesWaiting.onReceiveValue(null);
                filesWaiting = callback;
                Intent pick = params.createIntent();
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(pick, PICK_FILES);
                } catch (ActivityNotFoundException e) {
                    filesWaiting = null;
                    return false;
                }
                return true;
            }
        });

        if (saved != null) web.restoreState(saved);
        else web.loadUrl(HOME);
    }

    private void openOutside(Uri url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, url));
        } catch (ActivityNotFoundException e) {
            // nothing on the phone can open it
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != PICK_FILES || filesWaiting == null) return;
        Uri[] picked = null;
        if (resultCode == RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null) {
                picked = new Uri[clip.getItemCount()];
                for (int i = 0; i < picked.length; i++) picked[i] = clip.getItemAt(i).getUri();
            } else if (data.getData() != null) {
                picked = new Uri[] { data.getData() };
            }
        }
        filesWaiting.onReceiveValue(picked);
        filesWaiting = null;
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }
}
