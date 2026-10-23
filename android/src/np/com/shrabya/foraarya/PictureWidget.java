package np.com.shrabya.foraarya;

import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Locale;
import java.util.TimeZone;

// The home screen widget, like Locket: the newest picture the other one posted on the picture wall,
// with its caption. It checks for a new one every 15 minutes, and whenever the app is opened or left.
// The pictures need the password, so it uses the one the app saved after the site was unlocked.
public class PictureWidget extends AppWidgetProvider {
    static final String API = "https://for-aarya-bot.netlify.app/api";
    private static final int JOB = 1;

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        draw(context);
        schedule(context);
        final PendingResult result = goAsync();
        final Context app = context.getApplicationContext();
        new Thread(new Runnable() { public void run() {
            try { refresh(app); } finally { result.finish(); }
        } }).start();
    }

    @Override
    public void onDisabled(Context context) {
        ((JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE)).cancel(JOB);
    }

    static boolean hasWidgets(Context context) {
        return AppWidgetManager.getInstance(context).getAppWidgetIds(new ComponentName(context, PictureWidget.class)).length > 0;
    }

    // Every 15 minutes (the shortest Android allows), only when there is internet
    static void schedule(Context context) {
        JobScheduler jobs = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (jobs.getPendingJob(JOB) != null) return;
        jobs.schedule(new JobInfo.Builder(JOB, new ComponentName(context, WidgetRefresh.class))
            .setPeriodic(15 * 60 * 1000)
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPersisted(true)
            .build());
    }

    // Called from the app, which runs it off the main thread
    static void refreshSoon(final Context context) {
        if (!hasWidgets(context)) return;
        new Thread(new Runnable() { public void run() { refresh(context.getApplicationContext()); } }).start();
    }

    // Looks for a newer picture and redraws the widget. Runs off the main thread.
    static synchronized void refresh(Context context) {
        SharedPreferences prefs = prefs(context);
        String password = prefs.getString("password", "");
        if (password.isEmpty()) { draw(context); return; }
        try {
            String me = new JSONObject(text(get("/avatars", password))).optString("me");
            JSONArray pictures = new JSONObject(text(get("/pictures", password))).getJSONArray("pictures");
            // the newest by when it was posted, not by where we dragged it; the other one's first
            JSONObject theirs = null, anyone = null;
            for (int i = 0; i < pictures.length(); i++) {
                JSONObject p = pictures.getJSONObject(i);
                if (anyone == null || p.optString("added").compareTo(anyone.optString("added")) > 0) anyone = p;
                if (!me.equals(p.optString("by")) && (theirs == null || p.optString("added").compareTo(theirs.optString("added")) > 0)) theirs = p;
            }
            JSONObject newest = theirs != null ? theirs : anyone;
            if (newest == null) { prefs.edit().remove("id").apply(); draw(context); return; }
            String id = newest.getString("id");
            if (!id.equals(prefs.getString("id", "")) || !photoFile(context).exists()) {
                byte[] photo = get("/pictures/" + id + "/thumb", password);
                FileOutputStream out = new FileOutputStream(photoFile(context));
                out.write(photo);
                out.close();
            }
            prefs.edit()
                .putString("id", id)
                .putString("caption", newest.optString("caption"))
                .putString("by", newest.optString("by"))
                .putString("day", newest.has("taken") ? newest.optString("taken") : newest.optString("added").substring(0, 10))
                .putBoolean("locked", false)
                .apply();
        } catch (WrongPassword e) {
            prefs.edit().putBoolean("locked", true).apply();
        } catch (Exception e) {
            // offline or the server is asleep: keep showing the last picture
        }
        draw(context);
    }

    static void draw(Context context) {
        SharedPreferences prefs = prefs(context);
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget);
        views.setViewVisibility(R.id.caption, View.VISIBLE);
        Bitmap photo = prefs.contains("id") ? BitmapFactory.decodeFile(photoFile(context).getPath()) : null;
        if (prefs.getString("password", "").isEmpty() || prefs.getBoolean("locked", false)) {
            views.setImageViewResource(R.id.photo, 0);
            views.setTextViewText(R.id.caption, "एक पटक app खोलेर password हाल");
            views.setTextViewText(R.id.from, "");
        } else if (photo == null) {
            views.setImageViewResource(R.id.photo, 0);
            views.setTextViewText(R.id.caption, "अहिलेसम्म तस्बिर छैन");
            views.setTextViewText(R.id.from, "");
        } else {
            views.setImageViewBitmap(R.id.photo, photo);
            String caption = prefs.getString("caption", "");
            views.setTextViewText(R.id.caption, caption);
            views.setViewVisibility(R.id.caption, caption.isEmpty() ? View.GONE : View.VISIBLE);
            views.setTextViewText(R.id.from, prefs.getString("by", "") + ", " + shortDay(prefs.getString("day", "")));
        }
        // tapping it opens the picture wall in the app
        Intent open = new Intent(context, MainActivity.class).putExtra(MainActivity.OPEN, "pictures.html")
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        views.setOnClickPendingIntent(android.R.id.background,
            PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        AppWidgetManager.getInstance(context).updateAppWidget(new ComponentName(context, PictureWidget.class), views);
    }

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences("widget", Context.MODE_PRIVATE);
    }

    private static File photoFile(Context context) {
        return new File(context.getFilesDir(), "widget.jpg");
    }

    // "2026-10-23" -> "23 Oct"
    private static String shortDay(String day) {
        try {
            SimpleDateFormat in = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
            in.setTimeZone(TimeZone.getTimeZone("UTC"));
            SimpleDateFormat out = new SimpleDateFormat("d MMM", Locale.UK);
            out.setTimeZone(TimeZone.getTimeZone("UTC"));
            return out.format(in.parse(day));
        } catch (Exception e) {
            return day;
        }
    }

    static class WrongPassword extends Exception {}

    private static byte[] get(String path, String password) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(API + path).openConnection();
        c.setRequestProperty("x-letter-password", password);
        c.setConnectTimeout(10000);
        c.setReadTimeout(20000);
        try {
            if (c.getResponseCode() == 401) throw new WrongPassword();
            if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
            InputStream in = c.getInputStream();
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[16384];
            for (int n; (n = in.read(buffer)) > 0; ) bytes.write(buffer, 0, n);
            return bytes.toByteArray();
        } finally {
            c.disconnect();
        }
    }

    private static String text(byte[] bytes) throws Exception {
        return new String(bytes, "UTF-8");
    }
}
