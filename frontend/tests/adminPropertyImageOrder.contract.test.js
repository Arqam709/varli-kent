// Property Images: drag-to-reorder, the derived cover, and the batch upload.
//
// ── Why this file exists ────────────────────────────────────────────────
// Two behaviours here are invisible from the rendered page and easy to undo by
// accident, so they are pinned in source.
//
// 1. THE ARRAY ORDER IS THE GALLERY. Nothing else records it. The admin's drag
//    order is written straight to `images`, and PropertyDetailsPage renders
//    `property.images` exactly as stored. Any sort, any Set round trip that
//    loses position, any keying of the thumbnails by index, and a visitor sees
//    a different gallery from the one the admin arranged.
//
// 2. ONE SOURCE OF TRUTH FOR THE COVER. `mainImage` used to live in its own
//    state, which meant reordering could leave the stored cover pointing at an
//    image that was no longer first. It is now derived from position 0 at
//    submit. Reintroducing a setMainImage brings the drift back.
//
// The third group covers the failure that motivated the work: a batch of
// thirty photographs where one bad file used to abort the other twenty-nine.
//
// Static source contracts, run with plain `node --test` from frontend/.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const readSrc = async (...p) => readFile(join(here, '..', 'src', ...p), 'utf8')
const readBackend = async (...p) => readFile(join(here, '..', '..', 'backend', ...p), 'utf8')

const admin = await readSrc('pages', 'AdminProperties.jsx')
const details = await readSrc('pages', 'PropertyDetailsPage.jsx')
const route = await readBackend('routes', 'properties.js')
const upload = await readBackend('routes', 'upload.js')

/* ══════════════ 1. The order survives to the public page ══════════════ */

test('the dragged order is what is sent, unsorted', () => {
  // `images` goes into the payload as-is. A .sort() or a re-derivation here
  // would silently override whatever the admin arranged.
  assert.match(admin, /\/\/ Order is the gallery[\s\S]{0,200}?\r?\n\s*images,\r?\n/)
  assert.doesNotMatch(admin, /images\.sort\(|\[\.\.\.images\]\.sort\(/)
})

test('the public gallery still renders the stored array in stored order', () => {
  // If this ever becomes a sort or a mainImage-first concatenation, the saved
  // order stops being what the visitor sees.
  assert.match(details, /const images = property\.images\?\.length \? property\.images :/)
})

test('the backend writes the array it was given, in order', () => {
  assert.match(route, /out\.images = ordered/)
  assert.doesNotMatch(route, /ordered\.sort\(/)
})

test('thumbnails are keyed by url, not by index', () => {
  // An index key makes React keep each <img> element in place and swap only
  // the src, so during a drag the wrong picture appears to move.
  const thumbnailKey = admin.match(/key=\{(\w+)\}\s*\n\s*draggable=/)
  assert.ok(thumbnailKey, 'the draggable thumbnail no longer carries a key')
  assert.equal(thumbnailKey[1], 'img', 'the thumbnail key must be the url')
})

test('reordering moves the entry and shifts the rest, rather than swapping two', () => {
  // A swap would scramble the images between source and destination: dragging
  // 4 to position 2 must give 1,4,2,3 — not 1,4,3,2.
  assert.match(admin, /next\.splice\(from, 1\)[\s\S]{0,80}?next\.splice\(to, 0, moved\)/)
})

test('reordering never re-uploads', () => {
  // moveImage may only touch the array. An api.post inside the reorder path
  // would mean dragging an image costs a Cloudinary upload.
  const moveImage = admin.match(/const moveImage = useCallback\([\s\S]*?\r?\n {2}\}, \[\]\)/)
  assert.ok(moveImage, 'moveImage is gone')
  assert.doesNotMatch(moveImage[0], /api\.(post|put)/)
})

test('a drag can be completed — dragOver preventDefault is present', () => {
  // Without it the browser refuses the drop and animates the thumbnail back,
  // which reads to the admin as "reordering does not work".
  assert.match(admin, /onThumbDragOver = \(e\) => \{[\s\S]{0,200}?e\.preventDefault\(\)/)
})

test('reordering is reachable without a mouse', () => {
  // HTML5 drag events do not fire from touch at all, so these buttons are the
  // only way to reorder on a phone or from the keyboard.
  assert.match(admin, /moveImage\(i, i - 1\)/)
  assert.match(admin, /moveImage\(i, i \+ 1\)/)
  assert.match(admin, /aria-label=\{p\.moveEarlier/)
  assert.match(admin, /aria-label=\{p\.moveLater/)
})

test('the admin is told the thumbnails can be reordered', () => {
  assert.match(admin, /p\.reorderHint/)
  assert.match(admin, /p\.coverBadge/)
})

/* ══════════════ 2. One source of truth for the cover ══════════════════ */

test('the cover is derived from position 0, not held separately', () => {
  assert.match(admin, /mainImage: images\[0\] \|\| ''/)
  assert.doesNotMatch(admin, /setMainImage\(/)
  assert.doesNotMatch(admin, /const \[mainImage, setMainImage\]/)
})

test('the stored cover is brought to position 0 when an existing property opens', () => {
  // Otherwise position 0 would not be the cover for such a listing, and every
  // drag would be reasoning about the wrong image.
  assert.match(admin, /setImages\(galleryFromProperty\(prop\)\)/)
  assert.match(admin, /const at = ordered\.indexOf\(cover\)/)
  assert.match(admin, /if \(at === -1\) return \[cover, \.\.\.ordered\]/)
})

test('the backend repairs a cover that is not in the gallery', () => {
  assert.match(route, /if \(out\.images && \(!out\.mainImage \|\| !out\.images\.includes\(out\.mainImage\)\)\)/)
})

test('an edit that sends no images leaves the stored gallery and cover alone', () => {
  // stripPropertyImageFields + Object.assign is the strip-then-apply rule: a
  // key the client did not send never reaches $set.
  assert.match(route, /stripPropertyImageFields\(updateData\)\r?\n\s*Object\.assign\(updateData, parsedImages\.value\)/)
})

/* ══════════════ 3. A large batch cannot be lost ═══════════════════════ */

test('one failed file no longer aborts the rest of the batch', () => {
  // The per-file catch RECORDS the failure instead of letting it escape the
  // loop. This is the whole fix for "thirty images fails, five works".
  assert.match(admin, /results\[index\] = \{ ok: false, error:/)
  assert.match(admin, /const uploaded = results\.filter\(\(r\) => r\?\.ok\)/)
})

test('files are checked for type and size before anything is uploaded', () => {
  assert.match(admin, /if \(file\.size > cap\)/)
  assert.match(admin, /p\.unsupportedFile/)
  assert.match(admin, /p\.fileTooLarge/)
})

test('the failure message the server sent is shown, not swallowed', () => {
  assert.match(admin, /const fromServer = err\?\.response\?\.data\?\.message/)
})

test('the image count has an explicit ceiling on both sides', () => {
  assert.match(admin, /const MAX_PROPERTY_IMAGES = 60/)
  assert.match(route, /export const MAX_PROPERTY_IMAGES = 60/)
  // Refused before the request, with the number named.
  assert.match(admin, /p\.tooManyImages/)
})

test('the client and server size caps agree', () => {
  assert.match(admin, /const MAX_IMAGE_BYTES = 10 \* 1024 \* 1024/)
  assert.match(admin, /const MAX_VIDEO_BYTES = 100 \* 1024 \* 1024/)
  assert.match(upload, /export const MAX_IMAGE_BYTES = 10 \* 1024 \* 1024/)
  assert.match(upload, /export const MAX_VIDEO_BYTES = 100 \* 1024 \* 1024/)
})

test('an oversized upload is a 413, never a 500', () => {
  // MulterError carries no .status, so without this mapping server.js's
  // `err.status || 500` reported a fixable file as a server fault.
  assert.match(upload, /err\.code === 'LIMIT_FILE_SIZE'[\s\S]{0,200}?res\.status\(413\)/)
})

test('the provider error text is never forwarded to the admin', () => {
  // It can name the cloud, the folder and the API surface.
  assert.doesNotMatch(upload, /message: err\.message/)
  assert.match(upload, /console\.error\('\[upload\] Cloudinary upload failed:'/)
})

test('uploads are bounded, not unbounded and not serial', () => {
  assert.match(admin, /const UPLOAD_CONCURRENCY = 3/)
  assert.match(admin, /Math\.min\(UPLOAD_CONCURRENCY, accepted\.length\)/)
})

test('the uploading flag is released even if the batch throws', () => {
  // A stuck flag disables the picker AND the Save button, stranding the admin
  // in a form they cannot submit.
  // Anchored on the batch's own try/finally, not on the per-file one above it.
  assert.match(
    admin,
    /await Promise\.all\([\s\S]{0,300}?\}\s*finally \{[\s\S]{0,600}?setUploading\(false\)\r?\n\s*setUploadProgress\(null\)/
  )
})
