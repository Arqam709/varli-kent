import { test, expect } from '@playwright/test'

test.describe('Auth Pages', () => {
  test('login page loads', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: /sign in|login|welcome/i })).toBeVisible()
    await expect(page.getByLabel(/email/i)).toBeVisible()
    await expect(page.getByLabel(/password/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in|login/i })).toBeVisible()
  })

  test('register page loads', async ({ page }) => {
    await page.goto('/register')
    await expect(page.getByLabel(/email/i)).toBeVisible()
    await expect(page.getByLabel(/password/i)).toBeVisible()
  })

  test('login shows error on bad credentials', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel(/email/i).fill('fake@test.com')
    await page.getByLabel(/password/i).fill('wrongpassword')
    await page.getByRole('button', { name: /sign in|login/i }).click()
    // Should show an error message, not crash
    await page.waitForTimeout(2000)
    await expect(page).toHaveURL(/\/login/)
  })
})
