package np.com.shrabya.foraarya;

import android.app.job.JobParameters;
import android.app.job.JobService;

// Android runs this every 15 minutes or so while a widget is on the home screen
public class WidgetRefresh extends JobService {
    @Override
    public boolean onStartJob(final JobParameters params) {
        new Thread(new Runnable() { public void run() {
            PictureWidget.refresh(getApplicationContext());
            jobFinished(params, false);
        } }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }
}
