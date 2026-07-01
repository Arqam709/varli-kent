import { test, expect } from '@playwright/test'

test.describe('Properties Pages', () => {
  test('properties page loads with search filters', async ({ page }) => {
    await page.goto('/properties')
    await expect(page).toHaveURL('/properties')
    // Search bar should be present
    const searchBtn = page.getByRole('button', { name: /search/i }).first()
    await expect(searchBtn).toBeVisible()
  })

  test('for sale page loads', async ({ page }) => {
    await page.goto('/sale')
    await expect(page).toHaveURL('/sale')
  })

  test('for rent page loads', async ({ page }) => {
    await page.goto('/rent')
    await expect(page).toHaveURL('/rent')
  })

  test('property search filters work', async ({ page }) => {
    await page.goto('/properties')
    // District dropdown should exist
    const selects = page.locator('select')
    await expect(selects.first()).toBeVisible()
    // Change district filter
    await selects.first().selectOption({ index: 0 })
  })
})
