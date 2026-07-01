import { test, expect } from '@playwright/test'

test.describe('Homepage', () => {
  test('loads and shows hero content', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/varlikent|varli/i)
    // Hero section visible
    const hero = page.locator('section').first()
    await expect(hero).toBeVisible()
  })

  test('hero has search bar with Buy/Rent toggle', async ({ page }) => {
    await page.goto('/')
    // Buy/Rent toggle buttons
    const buyBtn = page.getByRole('button', { name: /buy/i })
    const rentBtn = page.getByRole('button', { name: /rent/i })
    await expect(buyBtn).toBeVisible()
    await expect(rentBtn).toBeVisible()
    // Click Rent
    await rentBtn.click()
    await expect(rentBtn).toHaveClass(/bg-\[#4b6741\]|text-white/)
  })

  test('search form submits without error', async ({ page }) => {
    await page.goto('/')
    const searchBtn = page.getByRole('button', { name: /search/i }).first()
    await expect(searchBtn).toBeVisible()
    await searchBtn.click()
    // Should not navigate away or crash
    await expect(page).toHaveURL('/')
  })

  test('no JS console errors on load', async ({ page }) => {
    const errors = []
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
    page.on('pageerror', err => errors.push(err.message))
    await page.goto('/')
    await page.waitForTimeout(2000)
    // Filter out known non-critical errors (network failures for API in test env)
    const criticalErrors = errors.filter(e => !e.includes('api') && !e.includes('net::ERR') && !e.includes('fetch'))
    expect(criticalErrors).toHaveLength(0)
  })
})
