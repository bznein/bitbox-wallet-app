import { remote } from "webdriverio";
import { expect } from "chai";

// --- Test ---
describe("BitBoxApp Base Test", function () {
  this.timeout(180000); // 3 minutes timeout for emulator/simulator boot

  let driver;

  before(async () => {
    const isIos = process.env.PLATFORM === "iOS";

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
            'appium:usePrebuiltWDA': true,
            'appium:noReset': true,
            'appium:wdaStartupRetries': 3,
            'appium:wdaLaunchTimeout': 120000,
            'appium:wdaStartupRetryInterval': 15000,
            'appium:webviewConnectTimeout': 250000, // ms
            'appium:webviewConnectRetries': 30,
          }
        : {
            platformName: 'Android',
            'appium:deviceName': 'Android Emulator',
            'appium:automationName': 'UiAutomator2',
            'appium:app': './apk/app-debug.apk',
            'appium:noReset': true,
          },
    };

    driver = await remote(opts);

    // Switch to WebView if present
    const contexts = await driver.getContexts();
    const webview = contexts.find((c) => c.startsWith("WEBVIEW_"));
    if (webview) {
      await driver.switchContext(webview);
    }
  });

  after(async () => {
    if (driver) await driver.deleteSession();
  });

  it("App main page loads", async () => {
    const body = await driver.$("body");
    const bodyText = await body.getText();
    expect(bodyText).to.include(
      "Please connect your BitBox and tap the side to continue."
    );
  });
});
