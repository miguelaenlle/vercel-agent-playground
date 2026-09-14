import { test, expect } from '@playwright/test';

test('chat, inspect tools, switch conversations, reload, stop, and delete', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'New conversation', exact: false })
    .click();
  await page.getByRole('textbox', { name: 'Message' }).fill('save my project');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.note')).toContainText('Prairie');
  await page.locator('summary').click();
  await expect(page.locator('.tool-details')).toContainText('Prairie');
  await page.reload();
  await expect(page.locator('.note')).toContainText('Prairie');
  await expect(page.locator('.message.assistant')).toContainText('Done.');
  await page
    .getByRole('button', { name: 'New conversation', exact: false })
    .click();
  await expect(page.locator('.note')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Message' }).fill('slow');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.message.assistant')).toContainText('Hello');
  await page.getByRole('button', { name: 'Stop generating' }).click();
  await expect(page.getByText('Turn stopped.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('.note')).toContainText('Prairie');
  await page.screenshot({
    path: 'test-results/chat-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: 'test-results/chat-mobile.png',
    fullPage: true,
  });
});

test('explains missing credentials and disables sending', async ({ page }) => {
  await page.route('**/api/config', (route) =>
    route.fulfill({
      json: {
        configured: false,
        model: 'gpt-4.1-mini',
        activeConversationId: null,
      },
    }),
  );
  await page.goto('/');
  await page
    .getByRole('button', { name: 'New conversation', exact: false })
    .click();
  await expect(page.getByText("One key, then you're ready.")).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeDisabled();
});
