import { test, expect } from '@playwright/test';
import { completeWalletCreation } from './helpers/create-wallet';
import { spawn, execSync, ChildProcessWithoutNullStreams } from 'child_process';
import fs from "fs";
import path from "path";

// Enable video for this test
test.use({ video: 'on' });

function startSimulator(): ChildProcessWithoutNullStreams {
  const proc = spawn(
    '/home/bznein/Shift/BitBoxSwiss/fork/bitbox02-firmware/build-build-noasan/bin/bitbox02-multi-v9.24.0-simulator1.0.0-linux-adm64',
    {
      stdio: "inherit",
      env: {
        ...process.env,
        FAKE_MEMORY_FILEPATH: "/tmp/fakememory",
      },
    }
  );

  // crude wait, replace with proper readiness check in production
  return proc;
}

function startServeWallet(): ChildProcessWithoutNullStreams {
  const proc = spawn(
    'make',
    ['-C', '../../', 'servewallet-simulator'],
    { stdio: 'inherit' } // inherit stdio to see output in the console
  );

  // crude wait, replace with proper readiness check in production
  return proc;
}

async function cleanupFakeMemoryFiles() {
  const dir = "/tmp";
  const files = await fs.promises.readdir(dir);
  for (const f of files) {
    if (f.startsWith("fakememory_")) {
      await fs.promises.unlink(path.join(dir, f));
    }
  }
}

test('toggle watch-only and disconnect test wallet', async ({ page }) => {
  let simulatorProcess: ChildProcessWithoutNullStreams;

  cleanupFakeMemoryFiles().catch((err) => {
    console.error('Error during cleanup of fake memory files:', err);
  });

  await test.step('Start simulator', async () => {
    simulatorProcess = startSimulator();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    console.log('Simulator started');
  });

  await test.step('Start servewallet', async () => {
    startServeWallet();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    console.log('Servewallet started');
  });

  await page.goto('/');

  await test.step('create new wallet', async () => {
    await completeWalletCreation(page);
    await expect(
      page.locator('span[title="Connected wallet"]')
    ).toHaveCount(2);
  });

  await test.step('Navigate to Manage Accounts', async () => {
    await page.locator('text=Settings').click();
    await page.locator('a[href="#/settings/manage-accounts"]').click();
  });

  await test.step('Toggle watch-only mode', async () => {
    const toggle = page.locator('[data-testid="watchonly-toggle"]')
    await toggle.click();
    // Click the checkbox
    await page.locator('#dont_show_enable_remember_wallet').click();
    await page.locator('button:has-text("OK")').click();
  });

  await test.step('Disconnect wallet', async () => {
    simulatorProcess.kill();
    await new Promise((resolve) => setTimeout(resolve, 500));
    console.log('Simulator killed');
    await expect(
      page.locator('span[title="Connected wallet"]')
    ).toHaveCount(0);

  });

  await test.step('Verify account page loads', async () => {
    await page.goto('/#/account/v0-c5053c91-tbtc-0');
    await expect(page.locator('body')).toContainText('Bitcoin Testnet');
  });

  await test.step('Disable watch-only mode', async () => {
    await page.locator('text=Settings').click();
    await page.locator('a[href="#/settings/manage-accounts"]').click();
    const toggle = page.locator('[data-testid="watchonly-toggle"]');
    await toggle.click();
    await page.locator('button:has-text("Confirm")').click();
  });

  await test.step('Verify no Bitcoin Testnet account present', async () => {
    await page.goto('/#/account/v0-c5053c91-tbtc-0');
    await expect(page).toHaveURL('/#/')
  });

  await test.step('Restart simulator', async () => {
    simulatorProcess = startSimulator();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    console.log('Simulator restarted');
  });

  await page.getByRole('button', { name: 'Continue' }).click();

  await test.step('Re-enable watch only', async () => {
    await page.locator('text=Settings').click();
    await page.locator('a[href="#/settings/manage-accounts"]').click();
    const toggle = page.locator('[data-testid="watchonly-toggle"]')
    await toggle.click();
    // Click the checkbox
    await expect(page.locator('#dont_show_enable_remember_wallet')).toHaveCount(0);
  });

});
