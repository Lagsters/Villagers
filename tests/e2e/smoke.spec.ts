import { expect, test } from '@playwright/test';

test('strona startuje', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', '1');
});
