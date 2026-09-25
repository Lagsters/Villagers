import { expect, test } from '@playwright/test';

test('mapa sie renderuje, klik wybiera pole', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/?map=E2E&size=64&players=2');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', '1');
  await page.waitForTimeout(500);
  await page.mouse.click(560, 420);
  await expect(page.locator('.panel')).toBeVisible();
  await expect(page.locator('.panel h3')).not.toBeEmpty();
  await page.screenshot({ path: `test-results/m2-${info.project.name}.png` });
  expect(errors).toEqual([]);
});
