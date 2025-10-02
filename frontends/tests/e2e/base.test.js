import { remote } from "webdriverio";
import { expect } from "chai";

// --- Test ---
describe("BitBoxApp Base Test", function () {
  this.timeout(9000000); // 5 min total timeout to be safe

  let driver;

  before(async () => {
    const isIos = process.env.PLATFORM === "iOS";

    console.log("bznein: Creating WebDriver session...");
    const opts = {
      path: '/',
      port: 4723,
      connectionRetryTimeout: 300000, // 5 min
      connectionRetryCount: 3,
      capabilities: isIos
        ? {
            platformName: 'iOS',
            'appium:deviceName': 'iPhone 15',
            'appium:platformVersion': '17.5',
            'appium:automationName': 'XCUITest',
            'appium:showXcodeLog': true,
            'appium:app': process.env.IOS_APP_PATH,
            'appium:useNewWDA': true,
            'appium:noReset': true,
            'appium:wdaStartupRetries': 3,
            'appium:wdaLaunchTimeout': 120000,
            'appium:wdaStartupRetryInterval': 15000,
            'appium:webviewConnectTimeout': 250000,
            'appium:webviewConnectRetries': 100,
          }
        : {
            platformName: 'Android',
            'appium:deviceName': 'Android Emulator',
            'appium:automationName': 'UiAutomator2',
            'appium:app': './apk/app-debug.apk',
            'appium:noReset': true,
          },
    };

    try {
      // Add HTTP timeouts directly to opts before passing it to remote()
      opts.http = {
        timeout: 600000,          // 10 min total timeout
        headersTimeout: 600000,   // 10 min for headers to arrive
        bodyTimeout: 600000,      // 10 min for full response
      };

      driver = await remote(opts);
      console.log("bznein: Driver session created successfully");
    } catch (err) {
      console.error("bznein: Failed to create driver session:", err);
      throw err;
    }

    console.log("bznein: Fetching available contexts...");
    let contexts = [];
    for (let i = 0; i < 60; i++) { // up to 60 × 5 s = 5 min
      try {
        contexts = await driver.getContexts();
        console.log("bznein: Contexts found:", contexts);
        if (contexts.some(c => c.startsWith("WEBVIEW_"))) break;
      } catch (err) {
        console.log("bznein: getContexts failed, retrying...");
      }
      await new Promise(r => setTimeout(r, 5000));
    }
    if (!contexts.some(c => c.startsWith("WEBVIEW_"))) {
      throw new Error("bznein: No WEBVIEW_ context found after waiting");
    }



    const webview = contexts.find((c) => c.startsWith("WEBVIEW_"));
    if (webview) {
      console.log("bznein: Switching to WebView:", webview);
      try {
        await driver.switchContext(webview);
        console.log("bznein: Switched to WebView successfully");
      } catch (err) {
        console.error("bznein: Failed to switch context:", err);
        throw err;
      }
    } else {
      console.log("bznein: No WebView found, staying in native context");
    }
  });

  after(async () => {
    if (driver) {
      console.log("bznein: Deleting driver session...");
      await driver.deleteSession();
      console.log("bznein: Driver session deleted");
    }
  });

  it("App main page loads", async () => {
    console.log("bznein: Looking for body element...");
    try {
      const body = await driver.$("body");
      const bodyText = await body.getText();
      console.log("bznein: Body text retrieved:", bodyText);
      expect(bodyText).to.include(
        "Please connect your BitBox and tap the side to continue."
      );
    } catch (err) {
      console.error("bznein: Failed to get body text:", err);
      throw err;
    }
  });
});
