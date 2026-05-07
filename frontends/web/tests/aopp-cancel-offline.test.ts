// SPDX-License-Identifier: Apache-2.0

import { test } from './helpers/fixtures';
import { expect } from '@playwright/test';
import { exec as childExec, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { ServeWallet } from './helpers/servewallet';
import { launchRegtest, setupRegtestWallet, cleanupRegtest, sendCoins, mineBlocks } from './helpers/regtest';
import { startSimulator, stopSimulator, completeWalletSetupFlow, cleanFakeMemoryFiles } from './helpers/simulator';
import { startAOPPServer, generateAOPPRequest } from './helpers/aopp';
import { deleteAccountsFile } from './helpers/fs';
import { getReceiveAddress } from './helpers/account';

const execAsync = promisify(childExec);

let servewallet: ServeWallet | undefined;
let regtest: ChildProcess | undefined;
let aoppServer: ChildProcess | undefined;
let simulatorProc: ChildProcess | undefined;

const getSimulatorPath = (): string => {
  const simulatorPath = process.env.SIMULATOR_PATH;
  if (!simulatorPath) {
    throw new Error('SIMULATOR_PATH environment variable not set');
  }
  return simulatorPath;
};

const pauseElectrs = async (): Promise<void> => {
  await execAsync('docker pause electrs-regtest1 electrs-regtest2');
};

const unpauseElectrs = async (): Promise<void> => {
  await execAsync('docker unpause electrs-regtest1 electrs-regtest2 >/dev/null 2>&1 || true');
};

test.beforeEach(() => {
  deleteAccountsFile();
  cleanFakeMemoryFiles();
});

test.afterEach(async () => {
  await servewallet?.stop();
  servewallet = undefined;

  if (aoppServer) {
    aoppServer.kill('SIGTERM');
    aoppServer = undefined;
  }

  if (simulatorProc) {
    await stopSimulator(simulatorProc);
    simulatorProc = undefined;
  }

  await unpauseElectrs();
  await cleanupRegtest(regtest);
  regtest = undefined;
});

test('AOPP can be cancelled while account sync is stuck', async ({ page, host, frontendPort, servewalletPort }, testInfo) => {
  await test.step('Start regtest and initialize wallet', async () => {
    regtest = await launchRegtest();
    await setupRegtestWallet();
  });

  await test.step('Start servewallet and simulator', async () => {
    servewallet = new ServeWallet(page, servewalletPort, frontendPort, host, testInfo.outputDir, { regtest: true, testnet: false, simulator: true });
    await servewallet.start();
    simulatorProc = startSimulator(getSimulatorPath(), testInfo.outputDir, true);
  });

  await test.step('Initialize BitBox wallet', async () => {
    await completeWalletSetupFlow(page);
  });

  await test.step('Create unseen account activity', async () => {
    await page.getByRole('link', { name: 'Bitcoin Regtest Bitcoin' }).click();
    await page.getByRole('button', { name: 'Receive Bitcoin' }).click();
    const receiveAddress = await getReceiveAddress(page, host, servewalletPort);

    await servewallet?.stop();
    servewallet = undefined;

    await sendCoins(receiveAddress, '1');
    await mineBlocks(1);
  });

  let aoppRequest: string;
  await test.step('Generate AOPP request', async () => {
    aoppServer = await startAOPPServer();
    aoppRequest = await generateAOPPRequest('rbtc');
  });

  await test.step('Restart servewallet with Electrs unresponsive', async () => {
    await pauseElectrs();
    servewallet = new ServeWallet(page, servewalletPort, frontendPort, host, testInfo.outputDir, { regtest: true, testnet: false, simulator: true });
    await servewallet.start({ extraFlags: { aoppUrl: aoppRequest } });
  });

  await test.step('Cancel AOPP while syncing', async () => {
    await page.goto('/');
    const body = page.locator('body');

    await expect(body).toContainText('localhost:8888 is requesting a receiving address');
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(body).toContainText('Syncing the account, please wait.');
    const cancelResponsePromise = page.waitForResponse(response =>
      response.url().endsWith('/api/aopp/cancel') &&
      response.request().method() === 'POST',
    { timeout: 10_000 });
    await page.getByRole('button', { name: 'Cancel' }).click();

    const cancelResponse = await cancelResponsePromise;
    expect(cancelResponse.ok()).toBe(true);
    const aoppResponse = await page.request.get(`http://${host}:${servewalletPort}/api/aopp`);
    expect(aoppResponse.ok()).toBe(true);
    const aopp = await aoppResponse.json() as { state: string };
    expect(aopp.state).toBe('inactive');
    await expect(body).not.toContainText('Syncing the account, please wait.');
  });
});
