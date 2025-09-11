import { Page, expect } from '@playwright/test';

export async function completeWalletCreation(page: Page) {
  // Click "Continue"
  await page.getByRole('button', { name: 'Continue' }).click();

  // Click "Create Wallet"
  await page.getByRole('button', { name: 'Create Wallet' }).click();

  // Fill device name
  await page.locator('#deviceName').fill('device');

  // Click "Continue"
  await page.getByRole('button', { name: 'Continue' }).click();

  // Check that "Continue" is disabled initially
  await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();

  // Find and check all checkboxes
  const checkboxes = page.locator('input[type="checkbox"]');
  const count = await checkboxes.count();
  for (let i = 0; i < count; i++) {
    await checkboxes.nth(i).check();
    if (i < count - 1) {
      await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
    }
  }

  // Ensure it's enabled and click "Get started"
  await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();
    await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Get started' }).click();
}
