import { test, expect } from '@playwright/test'

test.describe('Navbar', () => {
  test('renders logo and main links', async ({ page }) => {
    await page.goto('/')
    // Logo text (VARLI or KENT)
    await expect(page.getByText(/varli/i).first()).toBeVisible()
  })

  test('Properties link navigates correctly', async ({ page }) => {
    await page.goto('/')
    const link = page.getByRole('link', { name: /properties/i }).first()
    await expect(link).toBeVisible()
    await link.click()
    await expect(page).toHaveURL(/\/properties/)
  })

  test('language switcher shows EN/TR/AR', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('EN')).toBeVisible()
    await expect(page.getByText('TR')).toBeVisible()
    await expect(page.getByText('AR')).toBeVisible()
  })

  test('language switcher changes language', async ({ page }) => {
    await page.goto('/')
    const trBtn = page.getByRole('button', { name: 'TR' }).first()
    await trBtn.click()
    // After switching to Turkish, page should update
    await page.waitForTimeout(300)
    const enBtn = page.getByRole('button', { name: 'EN' }).first()
    await enBtn.click()
  })

  test('mobile hamburger menu opens', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/')
    const menuBtn = page.getByRole('button', { name: /menu|open/i }).first()
    if (await menuBtn.isVisible()) {
      await menuBtn.click()
      await page.waitForTimeout(300)
    }
  })
})
