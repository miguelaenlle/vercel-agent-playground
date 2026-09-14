import { test, expect } from '@playwright/test';

test('tools, conversation isolation, history, and reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New conversation' }).click();
  await page.getByRole('textbox', { name: 'Message' }).fill('save my project');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByLabel('Server notes')).toContainText('Prairie');
  await expect(page.locator('article')).toContainText([
    'save my project',
    'tool-saveNote',
  ]);
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(page.getByLabel('Server notes')).toHaveText('{}');
  await page.getByRole('textbox', { name: 'Message' }).fill('read notes');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Chat status: ready')).toBeVisible();
  await expect(page.locator('article')).not.toContainText(['Prairie']);
  await page
    .getByLabel('Conversation', { exact: true })
    .selectOption({ label: 'notes 1' });
  await expect(page.getByLabel('Server notes')).toContainText('Prairie');
  await page.reload();
  await page
    .getByLabel('Conversation', { exact: true })
    .selectOption({ label: 'notes 1' });
  await expect(page.locator('article')).toContainText([
    'save my project',
    'Done.',
  ]);
  await page.screenshot({ path: 'test-results/minimal.png', fullPage: true });
});
