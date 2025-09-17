import { remote } from "webdriverio";
import { expect } from "chai";

// --- Helpers ---
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickCss(driver, selector, delay = 1000) {
  const el = await driver.$(selector);
  expect(el).to.exist;
  await el.click();
  await sleep(delay);
}

async function clickXPath(driver, xpath, delay = 1000) {
  const el = await driver.$(xpath);
  expect(el).to.exist;
  await el.click();
  await sleep(delay);
}

async function typeInInput(driver, selector, text, delay = 1000) {
  const el = await driver.$(selector);
  expect(el).to.exist;
  await el.clearValue();
  await el.setValue(text);
  await sleep(delay);
}

async function selectOptionByText(driver, text, delay = 1000) {
  const el = await driver.$(`//*[contains(text(),'${text}')]`);
  expect(el).to.exist;
  await el.click();
  await sleep(delay);
}

// --- Test ---
describe("My App (Cross-Platform)", function () {
  this.timeout(180000);

  let driver;
  before(async () => {
    const platform = process.env.PLATFORM || "Android";

    const opts = platform === "iOS"
      ? {
          path: '/',
          port: 4723,
          capabilities: {
            platformName: 'iOS',
            'appium:deviceName': 'iPhone 16 Pro',
            'appium:platformVersion': '18.3',
            'appium:automationName': 'XCUITest',
            'appium:app': '/Users/bznein/Desktop/BitBoxApp.app',
            'appium:noReset': true,
          }
        }
      : {
          path: '/',
          port: 4723,
          capabilities: {
            platformName: 'Android',
            'appium:deviceName': 'Android Emulator',
            'appium:automationName': 'UiAutomator2',
            'appium:app': '/Users/bznein/Downloads/app.apk',
            'appium:noReset': true,
            'appium:chromedriverExecutable': process.env.ANDROID_HOME + '/emulator/chromedriver',
          }
        };

    driver = await remote(opts);

    // Switch to WebView if present
    const contexts = await driver.getContexts();
    const webview = contexts.find((c) => c.startsWith("WEBVIEW_"));
    if (webview) await driver.switchContext(webview);
  });

  after(async () => {
    if (driver) await driver.deleteSession();
  });

  it("should navigate and select Italian language", async () => {
    await clickCss(driver, "button._transparent_1s0sp_84._button_1s0sp_1._button_1fz28_1", 2000);
    await clickXPath(driver, "//*[contains(text(),'General')]", 2000);
    await clickXPath(driver, "//*[contains(text(),'Language')]", 2000);

    // Search and select
    await typeInInput(driver, "input", "Italian", 2000);
    await selectOptionByText(driver, "Italian", 2000);
  });
});
