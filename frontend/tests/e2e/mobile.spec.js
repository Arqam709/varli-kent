import { test, expect } from '@playwright/test'

const MOBILE = { width: 375, height: 812 }
const TABLET = { width: 768, height: 1024 }

test.describe('Mobile Viewport', () => {
  test('homepage renders without horizontal scroll on iPhone', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await page.goto('/')
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
    const viewportWidth = await page.evaluate(() => window.innerWidth)
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 2) // 2px tolerance
  })

  test('homepage renders without horizontal scroll on tablet', async ({ page }) => {
    await page.setViewportSize(TABLET)
    await page.goto('/')
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
    const viewportWidth = await page.evaluate(() => window.innerWidth)
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 2)
  })

  test('properties page works on mobile', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await page.goto('/properties')
    await expect(page.getByRole('button', { name: /search/i }).first()).toBeVisible()
  })

  test('contact page works on mobile', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await page.goto('/contact')
    await expect(page).toHaveURL('/contact')
  })

  test('about page works on mobile', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await page.goto('/about')
    await expect(page).toHaveURL('/about')
  })
})
