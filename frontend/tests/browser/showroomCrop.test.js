// Real React/canvas interactions, isolated from live APIs. Run explicitly:
// node --test tests/browser/showroomCrop.test.js
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import translations from '../../src/locales/translations.js'
import { imageCropLabels } from '../../src/locales/imageCrop.js'
import { teamWorkLabels } from '../../src/locales/teamWork.js'

let server, browser, base
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div>
<script type="module">
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '/src/contexts/LanguageContext.jsx';
import { AuthProvider } from '/src/contexts/AuthContext.jsx';
import AdminShowroom from '/src/pages/AdminShowroom.jsx';
import ShowroomCarousel from '/src/components/ShowroomCarousel.jsx';
import AdminTeam from '/src/pages/AdminTeam.jsx';
import TeamPage from '/src/pages/TeamPage.jsx';
import '/src/index.css';
const e = React.createElement;
window.showCarousel = images => createRoot(document.getElementById('root')).render(e(LanguageProvider, null, e(ShowroomCarousel, { images })));
if (location.search.includes('team-public')) createRoot(document.getElementById('root')).render(e(MemoryRouter, null, e(LanguageProvider, null, e(TeamPage))));
else if (!location.search.includes('public')) createRoot(document.getElementById('root')).render(e(MemoryRouter, null, e(LanguageProvider, null, e(AuthProvider, null, e(location.search.includes('team-admin') ? AdminTeam : AdminShowroom)))));
</script></body></html>`

before(async () => {
  server = await createServer({
    logLevel: 'error', server: { host: '127.0.0.1', port: 0 },
    plugins: [{ name: 'showroom-test-harness', configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/__crop_test.html') || req.url.includes('html-proxy')) return next()
        try {
          res.setHeader('Content-Type', 'text/html')
          res.end(await vite.transformIndexHtml('/__crop_test.html', html))
        } catch (error) { next(error) }
      })
    } }],
  })
  await server.listen()
  base = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true })
})
after(async () => { await browser?.close(); await server?.close() })

async function setup(t, { viewport = { width: 1366, height: 768 }, language = 'en', publicPage = false, mode = '', members = [] } = {}) {
  const page = await browser.newPage({ viewport })
  t.after(() => page.close())
  const state = { uploads: [], saves: [], images: [], members, failUpload: false }
  await page.addInitScript(({ language }) => {
    localStorage.setItem('vk_lang', language)
    localStorage.setItem('varlikent_token', 'isolated-test-token')
    localStorage.setItem('varlikent_user', JSON.stringify({ role: 'owner', name: 'Test Owner' }))
    window.revoked = []
    const revoke = URL.revokeObjectURL.bind(URL)
    URL.revokeObjectURL = url => { window.revoked.push(url); revoke(url) }
  }, { language })
  // Block every remote request; all uploads/save calls below are local fixtures.
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.pathname.includes('/api/')) {
      let json = { success: true }
      if (url.pathname.endsWith('/auth/me')) json.user = { role: 'owner', name: 'Test Owner' }
      else if (url.pathname.endsWith('/upload')) {
        const body = route.request().postDataBuffer()
        const cropped = body.includes(Buffer.from('filename="cropped.jpg"'))
        state.uploads.push({ cropped, body })
        if (state.failUpload) return route.fulfill({ status: 500, json: { message: 'Test upload failure' } })
        json.url = `${base}/${cropped ? 'crop' : 'original'}.png`
        if (body.includes(Buffer.from('filename="portfolio.pdf"'))) json.url = `${base}/portfolio.pdf`
      } else if (['POST', 'PUT'].includes(route.request().method())) {
        const data = route.request().postDataJSON()
        state.saves.push(data)
        const item = { ...data, _id: 'item1' }
        state.images = [item]
        json.image = item
        if (url.pathname.includes('/team')) { json.member = item; state.members = [item] }
      } else { json.images = state.images; json.members = state.members }
      return route.fulfill({ json })
    }
    if (['/original.png', '/crop.png'].includes(url.pathname)) {
      return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="500"><rect width="1000" height="500" fill="green"/></svg>' })
    }
    if (url.origin !== base) return route.abort()
    return route.continue()
  })
  await page.goto(`${base}/__crop_test.html${mode ? '?' + mode : publicPage ? '?public' : ''}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  if (!publicPage && mode !== 'team-public') await page.getByRole('button', { name: mode === 'team-admin' ? translations[language].adminPages.team.addMember : translations[language].adminPages.showroom.addMedia, exact: true }).waitFor({ timeout: 60000 })
  return { page, state }
}
async function uploadImage(page, applyLabel = 'Apply Crop') {
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 500
    const ctx = canvas.getContext('2d'); ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 500, 500); ctx.fillStyle = 'blue'; ctx.fillRect(500, 0, 500, 500)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await page.locator('input[type=file]').setInputFiles({ name: 'original.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') })
  await expect(page.getByRole('button', { name: applyLabel, exact: true })).toBeEnabled()
}

test('cancel/Escape preserve form, revoke pending file, and leave the showroom editor open', async t => {
  const { page, state } = await setup(t)
  await page.getByRole('button', { name: 'Add Media', exact: true }).click()
  await page.locator('input[placeholder="https://res.cloudinary.com/..."]').fill(`${base}/original.png`)
  await uploadImage(page)
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.locator('input[placeholder="https://res.cloudinary.com/..."]')).toHaveValue(`${base}/original.png`)
  assert.equal(state.uploads.length, 0)
  assert.equal(await page.evaluate(() => window.revoked.length), 1)
  await uploadImage(page)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add to Showroom', exact: true })).toBeVisible()
  assert.equal(state.uploads.length, 0)
})

test('preset Apply without dragging uploads two files, persists crop metadata, and recrop preserves original', async t => {
  const { page, state } = await setup(t)
  await page.getByRole('button', { name: 'Add Media', exact: true }).click()
  await uploadImage(page)
  await page.getByRole('button', { name: 'Square', exact: true }).click()
  await page.getByRole('slider').fill('2')
  await expect.poll(async () => page.evaluate(() => {
    const wrapper = document.querySelector('.ReactCrop__child-wrapper').getBoundingClientRect()
    const image = document.querySelector('.ReactCrop img').getBoundingClientRect()
    return Math.abs(wrapper.width - image.width) + Math.abs(wrapper.height - image.height)
  })).toBeLessThan(2)
  const selected = await page.locator('.ReactCrop__crop-selection').boundingBox()
  assert.ok(Math.abs(selected.width - selected.height) < 2, 'square overlay must remain square after zoom')
  await page.getByRole('button', { name: 'Apply Crop', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(state.uploads.length, 2)
  assert.equal(state.uploads.filter(upload => upload.cropped).length, 1)
  await page.getByRole('button', { name: 'Add to Showroom', exact: true }).click()
  await expect.poll(() => state.saves.length).toBe(1)
  const saved = state.saves[0]
  assert.equal(saved.url, `${base}/original.png`)
  assert.equal(saved.cropUrl, `${base}/crop.png`)
  assert.equal(saved.width, 1000)
  assert.equal(saved.height, 500)
  assert.equal(saved.cropWidth, saved.cropHeight)
  assert.ok(saved.cropWidth > 0 && saved.cropWidth <= 500)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByRole('button', { name: 'Crop image', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Apply Crop', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Wide', exact: true }).click()
  await page.getByRole('button', { name: 'Apply Crop', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(state.uploads.length, 3)
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click()
  await expect.poll(() => state.saves.length).toBe(2)
  assert.equal(state.saves[1].url, saved.url)
  assert.ok(Math.abs(state.saves[1].cropWidth / state.saves[1].cropHeight - 16 / 9) < 0.01)
})

test('upload failure leaves crop retryable and original form unchanged', async t => {
  const { page, state } = await setup(t)
  await page.getByRole('button', { name: 'Add Media', exact: true }).click()
  await page.locator('input[placeholder="https://res.cloudinary.com/..."]').fill(`${base}/original.png`)
  await uploadImage(page)
  state.failUpload = true
  await page.getByRole('button', { name: 'Apply Crop', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Apply Crop', exact: true })).toBeEnabled()
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.locator('input[placeholder="https://res.cloudinary.com/..."]')).toHaveValue(`${base}/original.png`)
  assert.equal(state.saves.length, 0)
})

test('mobile crop controls stay within viewport and focus wraps inside dialog', async t => {
  const { page } = await setup(t, { viewport: { width: 390, height: 844 } })
  await page.getByRole('button', { name: 'Add Media', exact: true }).click()
  await uploadImage(page)
  const apply = page.getByRole('button', { name: 'Apply Crop', exact: true })
  await page.screenshot({ path: join(tmpdir(), 'varlikent-showroom-crop-mobile.png') })
  const box = await apply.boundingBox()
  assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844)
  await apply.focus()
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')), true)
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(page.getByRole('slider')).toHaveValue('1')
})

test('public cards use originals; lightbox uses crop with a working legacy fallback', async t => {
  const { page } = await setup(t, { publicPage: true })
  await page.waitForFunction(() => !!window.showCarousel)
  await page.evaluate(base => window.showCarousel([
    { _id: 'cropped', url: `${base}/original.png`, cropUrl: `${base}/crop.png`, caption: 'Cropped' },
    { _id: 'legacy', url: `${base}/original.png`, caption: 'Legacy' },
  ]), base)
  await page.getByRole('button', { name: /Cropped/ }).first().click()
  await expect(page.getByRole('dialog').locator('img')).toHaveAttribute('src', `${base}/crop.png`)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /Legacy/ }).first().click()
  await expect(page.getByRole('dialog').locator('img')).toHaveAttribute('src', `${base}/original.png`)
})


test('Arabic and Urdu crop dialogs retain RTL labels and keep coordinate interaction LTR', async t => {
  for (const language of ['ar', 'ur']) {
    const { page } = await setup(t, { language, viewport: { width: 390, height: 844 } })
    const labels = imageCropLabels(language)
    await page.getByRole('button', { name: translations[language].adminPages.showroom.addMedia, exact: true }).click()
    await uploadImage(page, labels.apply)
    await expect(page.getByRole('dialog')).toHaveAttribute('dir', 'rtl')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.getByRole('dialog').locator('[dir="ltr"]')).toHaveCount(1)
    await page.getByRole('button', { name: labels.square, exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: labels.cancel, exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }
})


const teamFixture = () => ({ _id: 'member1', name: 'Ada', role: 'Architect', bio: 'Short biography', longBio: 'Full biography', photo: base + '/original.png', secondaryPhoto: base + '/original.png', secondaryPhotoCropUrl: base + '/crop.png', workImages: [base + '/original.png'],
  workSections: [{ _id: '100000000000000000000001', label: 'Residential', title: 'Villa', description: 'Section introduction', conclusion: 'Project complete', order: 0,
    items: [{ _id: '200000000000000000000001', url: base + '/original.png', cropUrl: base + '/crop.png', width: 400, height: 300, title: 'Kitchen', description: 'Marble finishes' }] }],
  workFiles: [{ _id: '300000000000000000000001', url: base + '/portfolio.pdf', name: 'Portfolio', fileType: 'pdf' }] })

test('Team editor creates, reorders, crops, attaches documents, saves and reopens work', async t => {
  const { page, state } = await setup(t, { mode: 'team-admin' })
  await page.getByRole('button', { name: 'Add Member', exact: true }).click()
  await page.getByPlaceholder('e.g. Ahmet Yilmaz').fill('Ada')
  await page.getByPlaceholder('e.g. Senior Architect').fill('Architect')
  await page.getByPlaceholder('https://…').first().fill(base + '/original.png')
  await page.getByRole('button', { name: 'Crop image', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Apply Crop', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Apply Crop', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Add section', exact: true }).click()
  let section = page.getByTestId('work-section-editor').first()
  await section.getByLabel('Eyebrow label', { exact: true }).fill('Residential')
  await section.getByLabel('Title', { exact: true }).fill('Villa')
  await section.getByLabel('Description', { exact: true }).fill('Introduction')
  await section.getByLabel('Conclusion', { exact: true }).fill('Complete')
  await section.getByRole('button', { name: 'Add image', exact: true }).click()
  let item = page.getByTestId('work-item-editor').first()
  await item.getByLabel('URL', { exact: true }).fill(base + '/original.png')
  await item.getByLabel('Image title', { exact: true }).fill('Kitchen')
  await item.getByLabel('Image description', { exact: true }).fill('Marble details')
  await item.getByRole('button', { name: 'Crop image', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Apply Crop', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Square', exact: true }).click()
  await page.getByRole('button', { name: 'Apply Crop', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Add section', exact: true }).click()
  await page.getByTestId('work-section-editor').nth(1).getByLabel('Title', { exact: true }).fill('Second')
  await page.getByRole('button', { name: 'Move up: Section 2', exact: true }).click()
  await expect(page.getByTestId('work-section-editor').first().getByLabel('Title', { exact: true })).toHaveValue('Second')
  await page.getByLabel('Add document', { exact: true }).setInputFiles({ name: 'portfolio.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') })
  await expect(page.getByLabel('File name', { exact: true })).toHaveValue('portfolio.pdf')
  await page.locator('button[type=submit]').click()
  await expect.poll(() => state.saves.length).toBe(1)
  const saved = state.saves[0]
  assert.equal(saved.photo, base + '/original.png')
  assert.equal(saved.photoCropUrl, base + '/crop.png')
  assert.equal(saved.workSections[1].items[0].url, base + '/original.png')
  assert.equal(saved.workSections[1].items[0].cropUrl, base + '/crop.png')
  assert.equal(saved.workSections[1].items[0].width, saved.workSections[1].items[0].height)
  assert.equal(saved.workFiles[0].fileType, 'pdf')
  assert.equal(saved.workSections[1].order, 1)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page.getByTestId('work-section-editor').nth(1).getByLabel('Title', { exact: true })).toHaveValue('Villa')
  await expect(page.getByLabel('Image description', { exact: true })).toHaveValue('Marble details')
})

test('Team public profile renders work, files and legacy gallery; Escape closes only the work image', async t => {
  const { page } = await setup(t, { mode: 'team-public', members: [teamFixture()] })
  await page.getByRole('button', { name: 'Ada — View Profile', exact: true }).click()
  await expect(page.getByRole('dialog').getByText('Full biography', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Their Work', exact: true }).click()
  await expect(page.getByText('Section introduction', { exact: true })).toBeVisible()
  await expect(page.getByText('Project complete', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /Portfolio/ })).toHaveAttribute('href', base + '/portfolio.pdf')
  await page.getByRole('button', { name: 'Kitchen', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Kitchen', exact: true }).locator('img')).toHaveAttribute('src', base + '/crop.png')
  await expect(page.getByText('Marble finishes', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Kitchen', exact: true })).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'Ada', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Kitchen', exact: true }).click()
  await page.getByRole('dialog', { name: 'Kitchen', exact: true }).click({ position: { x: 2, y: 2 } })
  await expect(page.getByRole('dialog', { name: 'Kitchen', exact: true })).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'Ada', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('Team legacy member without work keeps profile fallbacks and mobile RTL portfolio is usable', async t => {
  const { page } = await setup(t, { mode: 'team-public', members: [{ _id: 'legacy', name: 'Legacy', role: 'Architect', bio: 'Legacy bio' }] })
  await page.getByRole('button', { name: 'Legacy — View Profile', exact: true }).click()
  await expect(page.getByText('Legacy bio', { exact: true }).last()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Their Work', exact: true })).toHaveCount(0)
  for (const language of ['ar', 'ur']) {
    const { page: rtl } = await setup(t, { mode: 'team-public', members: [teamFixture()], language, viewport: { width: 390, height: 844 } })
    await rtl.getByRole('button', { name: 'Ada — ' + translations[language].teamPage.viewProfile, exact: true }).click()
    await rtl.getByRole('button', { name: translations[language].teamPage.workTab, exact: true }).click()
    await expect(rtl.locator('html')).toHaveAttribute('dir', 'rtl')
    await rtl.getByRole('button', { name: 'Kitchen', exact: true }).click()
    const dialog = rtl.getByRole('dialog', { name: 'Kitchen', exact: true })
    await expect(dialog).toHaveAttribute('dir', 'rtl')
    await rtl.screenshot({ path: join(tmpdir(), 'varlikent-team-work-' + language + '.png') })
    const close = await dialog.getByRole('button', { name: teamWorkLabels(language).closeImage, exact: true }).boundingBox()
    assert.ok(close.y >= 0 && close.y + close.height <= 844)
  }
})


test('Team Add/Edit modal scrolls every field above a stationary footer on desktop and small RTL viewports', async t => {
  for (const options of [
    { viewport: { width: 1366, height: 768 }, language: 'en', edit: false },
    { viewport: { width: 1366, height: 768 }, language: 'en', edit: true },
    { viewport: { width: 390, height: 640 }, language: 'ar', edit: false },
    { viewport: { width: 390, height: 640 }, language: 'ur', edit: true },
  ]) {
    const { page } = await setup(t, { ...options, mode: 'team-admin', members: options.edit ? [teamFixture()] : [] })
    const labels = translations[options.language].adminPages
    await page.getByRole('button', { name: options.edit ? labels.common.edit : labels.team.addMember, exact: true }).click()
    const form = page.locator('form').filter({ has: page.locator('button[type=submit]') })
    const body = form.locator(':scope > fieldset, :scope > [data-testid="team-modal-body"]')
    const footer = form.locator(':scope > div').last()
    const header = form.locator('..').locator(':scope > div').first()
    const before = { footer: await footer.boundingBox(), header: await header.boundingBox() }
    const panel = await form.locator('..').boundingBox()
    assert.ok(panel.y >= 0 && panel.y + panel.height <= options.viewport.height + 1)
    await body.hover()
    await page.mouse.wheel(0, 10000)
    await expect.poll(() => body.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
    const geometry = await body.evaluate(el => {
      el.scrollTop = el.scrollHeight
      const b = el.getBoundingClientRect()
      const last = el.querySelector('input[type=checkbox]').getBoundingClientRect()
      return { top: b.top, bottom: b.bottom, right: b.right, left: b.left, lastTop: last.top, lastBottom: last.bottom, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth }
    })
    const after = { footer: await footer.boundingBox(), header: await header.boundingBox() }
    assert.ok(geometry.lastTop >= geometry.top && geometry.lastBottom <= geometry.bottom, 'last form control must be inside the scroll viewport')
    assert.ok(geometry.bottom <= after.footer.y + 1, 'footer must be outside the scroll viewport')
    assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1, 'body must not overflow horizontally')
    assert.ok(Math.abs(before.footer.y - after.footer.y) < 1 && Math.abs(before.header.y - after.header.y) < 1)
    assert.ok(after.footer.y + after.footer.height <= options.viewport.height)
    await expect(body.getByTestId('team-work-editor')).toHaveCount(1)
    const documentInput = page.getByLabel(teamWorkLabels(options.language).addDocument, { exact: true })
    await documentInput.scrollIntoViewIfNeeded()
    const documentBox = await documentInput.boundingBox()
    assert.ok(documentBox.y >= geometry.top && documentBox.y + documentBox.height <= after.footer.y)
    await page.close()
  }
})
