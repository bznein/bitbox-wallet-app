package ch.shiftcrypto.bitboxapp;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.ServiceConnection;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkRequest;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Message;
import android.os.Process;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.result.ActivityResultCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.Observer;
import androidx.lifecycle.ViewModelProviders;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.util.Arrays;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.regex.Pattern;

import mobileserver.Mobileserver;

public class MainActivity extends AppCompatActivity {
    static {
        System.loadLibrary("signal_handler");
    }
    public native void initsignalhandler();
    private final int PERMISSIONS_REQUEST_CAMERA_QRCODE = 0;
    private static final String ACTION_USB_PERMISSION = "ch.shiftcrypto.bitboxapp.USB_PERMISSION";
    private static final String BASE_URL = "https://shiftcrypto.ch/";

    private PermissionRequest webViewpermissionRequest;

    GoService goService;

    private ValueCallback<Uri[]> filePathCallback;

    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback networkCallback;

    private boolean hasInternetConnectivity(NetworkCapabilities capabilities) {
        if (capabilities == null) {
            Util.log("bznein: Got null capabilities when we shouldn't have. Assuming we are online.");
            return true;
        }

        boolean hasInternet = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        Util.log("bznein: hasInternet capability: " + hasInternet);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            boolean isValidated = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
            Util.log("bznein: isValidated capability: " + isValidated);
            return hasInternet && isValidated;
        }

        Util.log("bznein: Pre-M, returning hasInternet: " + hasInternet);
        return hasInternet;
    }

    private void checkConnectivity() {
        Util.log("bznein: Starting checkConnectivity()");
        Network activeNetwork = connectivityManager.getActiveNetwork();

        if (activeNetwork == null) {
            Util.log("bznein: No active network - setting offline");
            Mobileserver.setOnline(false);
            return;
        }

        NetworkCapabilities capabilities = connectivityManager.getNetworkCapabilities(activeNetwork);
        Util.log("bznein: Active network capabilities retrieved");
        Mobileserver.setOnline(hasInternetConnectivity(capabilities));
    }

    private ServiceConnection connection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName className,
                                       IBinder service) {
            GoService.GoServiceBinder binder = (GoService.GoServiceBinder) service;
            goService = binder.getService();
            goService.setViewModelStoreOwner(MainActivity.this);
            Util.log("Bind connection completed!");
            startServer();
        }

        @Override
        public void onServiceDisconnected(ComponentName arg0) {
            goService = null;
            Util.log("Bind connection unexpectedly closed!");
        }
    };

    private class JavascriptBridge {
        private Context context;

        JavascriptBridge(Context context) {
            this.context = context;
        }

        @JavascriptInterface
        public void call(int queryID, String query) {
            Mobileserver.backendCall(queryID, query);
        }
    }

    private final BroadcastReceiver usbStateReceiver = new BroadcastReceiver() {
        public void onReceive(Context context, Intent intent) {
            handleIntent(intent);
        }
    };

    private BroadcastReceiver networkStateReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            Util.log("bznein: Network state broadcast received");
            Mobileserver.usingMobileDataChanged();
        }
    };

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        int currentNightMode = newConfig.uiMode & Configuration.UI_MODE_NIGHT_MASK;
        switch (currentNightMode) {
            case Configuration.UI_MODE_NIGHT_NO:
                setDarkTheme(false);
                break;
            case Configuration.UI_MODE_NIGHT_YES:
                setDarkTheme(true);
                break;
        }
        super.onConfigurationChanged(newConfig);
    }

    public void setDarkTheme(boolean isDark) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            int flags = getWindow().getDecorView().getSystemUiVisibility();
            if (isDark) {
                Util.log("Dark theme");
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
                getWindow().setStatusBarColor(ContextCompat.getColor(getApplicationContext(), R.color.colorPrimaryDark));
                getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
                flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                getWindow().getDecorView().setSystemUiVisibility(flags);
            } else {
                Util.log("Light theme");
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
                getWindow().setStatusBarColor(ContextCompat.getColor(getApplicationContext(), R.color.colorPrimary));
                flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                getWindow().getDecorView().setSystemUiVisibility(flags);
            }
        } else {
            Util.log("Status bar theme not updated");
        }
    }

    @SuppressLint("HandlerLeak")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Util.log("lifecycle: onCreate");

        initsignalhandler();

        getSupportActionBar().hide();
        onConfigurationChanged(getResources().getConfiguration());
        setContentView(R.layout.activity_main);
        final WebView vw = (WebView)findViewById(R.id.vw);
        CookieManager.getInstance().setAcceptThirdPartyCookies(vw, true);

        final GoViewModel goViewModel = ViewModelProviders.of(this).get(GoViewModel.class);

        Intent intent = new Intent(this, GoService.class);
        bindService(intent, connection, Context.BIND_AUTO_CREATE);

        goViewModel.setMessageHandlers(
                new Handler() {
                    @Override
                    public void handleMessage(final Message msg) {
                        final GoViewModel.Response response = (GoViewModel.Response) msg.obj;
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                vw.evaluateJavascript("window.onMobileCallResponse(" + String.valueOf(response.queryID) + ", " + response.response + ");", null);
                            }
                        });
                    }
                },
                new Handler() {
                    @Override
                    public void handleMessage(final Message msg) {
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                vw.evaluateJavascript("window.onMobilePushNotification(" + (String)(msg.obj) + ");", null);
                            }
                        });
                    }
                }
        );
        vw.clearCache(true);
        vw.clearHistory();
        vw.getSettings().setJavaScriptEnabled(true);
        vw.getSettings().setAllowUniversalAccessFromFileURLs(true);
        vw.getSettings().setAllowFileAccess(true);
        vw.getSettings().setDomStorageEnabled(true);
        vw.getSettings().setMediaPlaybackRequiresUserGesture(false);

        vw.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                view.evaluateJavascript(
                        "navigator.clipboard.readText = () => {" +
                        "    return androidClipboard.readFromClipboard();" +
                        "};", null);
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(final WebView view, WebResourceRequest request) {
                if (request != null && request.getUrl() != null) {
                    String url = request.getUrl().toString();
                    if (url != null && url.startsWith(BASE_URL)) {
                        try {
                            InputStream inputStream = getAssets().open(url.replace(BASE_URL, "web/"));
                            String mimeType = Util.getMimeType(url);
                            if (mimeType != null) {
                                return new WebResourceResponse(mimeType, "UTF-8", inputStream);
                            }
                            Util.log("Unknown MimeType: " + url);
                        } catch (IOException e) {
                            Util.log("Internal resource not found: " + url);
                        }
                    } else {
                        return super.shouldInterceptRequest(view, request);
                    }
                } else {
                    Util.log("Null request!");
                }
                return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream("".getBytes()));
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view,  WebResourceRequest request) {
                String url = request.getUrl().toString();

                try {
                    List<Pattern> patterns = new ArrayList<>();
                    patterns.add(Pattern.compile("^(.*\\.)?pocketbitcoin\\.com$"));
                    patterns.add(Pattern.compile("^(.*\\.)?moonpay\\.com$"));
                    patterns.add(Pattern.compile("^(.*\\.)?bitsurance\\.eu$"));
                    patterns.add(Pattern.compile("^(.*\\.)?btcdirect\\.eu$"));

                    for (Pattern pattern : patterns) {
                        if (pattern.matcher(request.getUrl().getHost()).matches()) {
                            Util.systemOpen(getApplication(), url);
                            return true;
                        }
                    }
                } catch(Exception e) {
                    Util.log(e.getMessage());
                }
                Util.log("Blocked: " + url);
                return true;
            }
        });

        vw.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                Util.log(consoleMessage.message() + " -- From line "
                        + consoleMessage.lineNumber() + " of "
                        + consoleMessage.sourceId());
                return super.onConsoleMessage(consoleMessage);
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                for (String resource : request.getResources()) {
                    if (resource.equals(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) {
                        if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA)
                                == PackageManager.PERMISSION_GRANTED) {
                            request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                            return;
                        }
                        MainActivity.this.webViewpermissionRequest = request;
                        ActivityCompat.requestPermissions(MainActivity.this,
                                new String[]{Manifest.permission.CAMERA},
                                PERMISSIONS_REQUEST_CAMERA_QRCODE);
                        return;
                    }
                }
                request.deny();
            }

            ActivityResultLauncher<String> mGetContent = registerForActivityResult(new ActivityResultContracts.GetContent(),
                    new ActivityResultCallback<Uri>() {
                        @Override
                        public void onActivityResult(Uri uri) {
                            if (filePathCallback != null) {
                                if (uri != null) {
                                    filePathCallback.onReceiveValue(new Uri[]{uri});
                                } else {
                                    Util.log("Received null Uri in activity result");
                                    filePathCallback.onReceiveValue(new Uri[]{});
                                }
                                filePathCallback = null;
                            }
                        }
                    });
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                MainActivity.this.filePathCallback = filePathCallback;
                String[] mimeTypes = fileChooserParams.getAcceptTypes();
                String fileType = "*/*";
                if (mimeTypes.length == 1 && MimeTypeMap.getSingleton().hasMimeType(mimeTypes[0])) {
                    fileType = mimeTypes[0];
                }
                mGetContent.launch(fileType);
                return true;
            }
        });

        final String javascriptVariableName = "android";
        vw.addJavascriptInterface(new JavascriptBridge(this), javascriptVariableName);
        vw.addJavascriptInterface(new ClipboardHandler(this), "androidClipboard");
        vw.loadUrl(BASE_URL + "index.html");

        this.updateDevice();

        connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onCapabilitiesChanged(android.net.Network network, android.net.NetworkCapabilities capabilities) {
                super.onCapabilitiesChanged(network, capabilities);
                Util.log("bznein: onCapabilitiesChanged callback triggered");
                Mobileserver.setOnline(hasInternetConnectivity(capabilities));
            }

            @Override
            public void onLost(Network network) {
                super.onLost(network);
                Util.log("bznein: onLost callback triggered - setting offline");
                Mobileserver.setOnline(false);
            }
        };
    }

    private void startServer() {
        final GoViewModel gVM = ViewModelProviders.of(this).get(GoViewModel.class);
        goService.startServer(getApplicationContext().getFilesDir().getAbsolutePath(), gVM.getGoEnvironment(), gVM.getGoAPI());

        Util.log("bznein: Triggering initial connectivity check");
        checkConnectivity();
    }

    private static String readRawText(InputStream inputStream) throws IOException {
        if (inputStream == null) {
            return null;
        }

        BufferedReader bufferedReader = new BufferedReader(new InputStreamReader(inputStream));
        StringBuilder fileContent = new StringBuilder();
        String currentLine = bufferedReader.readLine();
        while (currentLine != null) {
            fileContent.append(currentLine);
            fileContent.append("\n");
            currentLine = bufferedReader.readLine();
        }
        return fileContent.toString();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
    }

    @Override
    protected void onStart() {
        super.onStart();
        Util.log("lifecycle: onStart");
        final GoViewModel goViewModel = ViewModelProviders.of(this).get(GoViewModel.class);
        goViewModel.getIsDarkTheme().observe(this, new Observer<Boolean>() {
            @Override
            public void onChanged(Boolean isDarkTheme) {
                setDarkTheme(isDarkTheme);
            }
        });

        goViewModel.getAuthenticator().observe(this, new Observer<Boolean>() {
            @Override
            public void onChanged(Boolean requestAuth) {
                if (!requestAuth) {
                    return;
                }

                BiometricAuthHelper.showAuthenticationPrompt(MainActivity.this, new BiometricAuthHelper.AuthCallback() {
                    @Override
                    public void onSuccess() {
                        Util.log("Auth success");
                        goViewModel.closeAuth();
                        Mobileserver.authResult(true);
                    }

                    @Override
                    public void onFailure() {
                        Util.log("Auth failed");
                        goViewModel.closeAuth();
                        Mobileserver.authResult(false);
                    }

                    @Override
                    public void onCancel() {
                        Util.log("Auth canceled");
                        goViewModel.closeAuth();
                        Mobileserver.cancelAuth();
                    }
                });
            }
        });

        goViewModel.getAuthSetting().observe(this, new Observer<Boolean>() {
            @Override
            public void onChanged(Boolean enabled) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (enabled) {
                            getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
                        } else {
                            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
                        }
                    }
                });
            }
        });

        NetworkRequest request = new NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .addTransportType(NetworkCapabilities.TRANSPORT_CELLULAR)
            .build();
        Util.log("bznein: Registering network callback in onStart()");
        connectivityManager.registerNetworkCallback(request, networkCallback);
    }

    @Override
    protected void onResume() {
        super.onResume();
        Util.log("lifecycle: onResume");
        Mobileserver.triggerAuth();

        IntentFilter filter = new IntentFilter();
        filter.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);
        filter.addAction(ACTION_USB_PERMISSION);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            registerReceiver(this.usbStateReceiver, filter, Context.RECEIVER_EXPORTED);
        } else {
            registerReceiver(this.usbStateReceiver, filter);
        }

        registerReceiver(this.networkStateReceiver, new IntentFilter(ConnectivityManager.CONNECTIVITY_ACTION));

        Util.log("bznein: Triggering connectivity check in onResume()");
        checkConnectivity();

        Intent intent = getIntent();
        handleIntent(intent);
    }

    @Override
    protected void onPause() {
        super.onPause();
        Util.log("lifecycle: onPause");
        unregisterReceiver(this.usbStateReceiver);
        unregisterReceiver(this.networkStateReceiver);
    }

    private void handleIntent(Intent intent) {
        if (intent.getAction().equals(ACTION_USB_PERMISSION)) {
            synchronized (this) {
                UsbDevice device = (UsbDevice) intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                if (intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) {
                    if (device != null) {
                        Util.log("usb: permission granted");
                        final GoViewModel goViewModel = ViewModelProviders.of(this).get(GoViewModel.class);
                        goViewModel.setDevice(device);
                    }
                } else {
                    Util.log("usb: permission denied");
                }
            }
        }
        if (intent.getAction().equals(UsbManager.ACTION_USB_DEVICE_ATTACHED)) {
            Util.log("usb: attached");
            this.updateDevice();
        }
        if (intent.getAction().equals(UsbManager.ACTION_USB_DEVICE_DETACHED)) {
            Util.log("usb: detached");
            this.updateDevice();
        }
        if (intent.getAction().equals(Intent.ACTION_VIEW)) {
            Uri uri = intent.getData();
            if (uri != null) {
                if (uri.getScheme().equals("aopp")) {
                    Mobileserver.handleURI(uri.toString());
                }
            }
        }
    }

    private void updateDevice() {
        final GoViewModel goViewModel = ViewModelProviders.of(this).get(GoViewModel.class);
        goViewModel.setDevice(null);
        UsbManager manager = (UsbManager) getApplication().getSystemService(Context.USB_SERVICE);
        HashMap<String, UsbDevice> deviceList = manager.getDeviceList();
        Iterator<UsbDevice> deviceIterator = deviceList.values().iterator();
        while (deviceIterator.hasNext()){
            UsbDevice device = deviceIterator.next();
            if (device.getVendorId() == 1003 && device.getProductId() == 9219) {
                if (manager.hasPermission(device)) {
                    goViewModel.setDevice(device);
                } else {
                    PendingIntent permissionIntent = PendingIntent.getBroadcast(this, 0, new Intent(ACTION_USB_PERMISSION), PendingIntent.FLAG_IMMUTABLE);
                    manager.requestPermission(device, permissionIntent);
                }
                break;
            }
        }
    }

    @Override
    protected void onStop() {
        super.onStop();
        if (connectivityManager != null && networkCallback != null) {
            Util.log("bznein: Unregistering network callback in onStop()");
            connectivityManager.unregisterNetworkCallback(networkCallback);
        }
        Util.log("lifecycle: onStop");
    }

    @Override
    protected void onRestart() {
        if (goService == null) {
            Intent intent = new Intent(this, GoService.class);
            bindService(intent, connection, Context.BIND_AUTO_CREATE);
        }
        super.onRestart();
    }

    @Override
    protected void onDestroy() {
        Util.log("lifecycle: onDestroy");
        if (goService != null) {
            unbindService(connection);
        }
        super.onDestroy();
        Util.quit(MainActivity.this);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        switch (requestCode) {
            case PERMISSIONS_REQUEST_CAMERA_QRCODE:
                if (this.webViewpermissionRequest != null) {
                    if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                        this.webViewpermissionRequest.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                    } else {
                        this.webViewpermissionRequest.deny();
                    }
                    this.webViewpermissionRequest = null;
                }
                break;
        }
    }

    @Override
    public void onBackPressed() {
        runOnUiThread(new Runnable() {
            final WebView vw = (WebView) findViewById(R.id.vw);
            @Override
            public void run() {
                vw.evaluateJavascript("window.onBackButtonPressed();", value -> {
                    boolean doDefault = Boolean.parseBoolean(value);
                    if (doDefault) {
                        if (vw.canGoBack()) {
                            vw.goBack();
                            return;
                        }
                        new AlertDialog.Builder(MainActivity.this)
                                .setTitle("Close BitBoxApp")
                                .setMessage("Do you really want to exit?")
                                .setPositiveButton(android.R.string.yes, new DialogInterface.OnClickListener() {
                                    public void onClick(DialogInterface dialog, int which) {
                                        Util.quit(MainActivity.this);
                                    }
                                })
                                .setNegativeButton(android.R.string.no, new DialogInterface.OnClickListener() {
                                    public void onClick(DialogInterface dialog, int which) {
                                        dialog.dismiss();
                                    }
                                })
                                .setIcon(android.R.drawable.ic_dialog_alert)
                                .show();
                    }
                });
            }
        });
    }
}
