// The Design My Space vocabulary, as the backend accepts it.
//
// Rooms, styles and lighting moods are APP-OWNED ids — the mobile app declares
// them in src/features/design-my-space/design-options.ts and stores the id,
// never a translated label, in every board. The backend does not invent a
// second vocabulary; it copies those ids so a stored board can be validated.
// The app's tests/design-board-parity.test.mjs fails if the two lists drift.
//
// Styles are the Admin → Showroom Interior style ids and lighting moods are
// the Renovation studio mood ids, which is why the app chose them.
//
// Wall finishes, floor finishes and materials are deliberately NOT checked
// against the current StudioPalette. A board stores a SNAPSHOT of what the
// user chose, and an owner editing the palette next month must not make a
// previously saved board impossible to save again.

export const DESIGN_BOARD_VERSION = 1

export const DESIGN_ROOM_IDS = ['living-room', 'bedroom', 'kitchen', 'bathroom', 'office']
export const DESIGN_STYLE_IDS = ['contemporary', 'warm', 'coastal', 'classic']
export const DESIGN_LIGHTING_IDS = ['day', 'warm', 'cool', 'night']

// The Studio Palette's own ceilings (models/StudioPalette.js), so a board can
// never hold more than a palette could have offered.
export const DESIGN_BOARD_LIMITS = {
  label: 80,
  materials: 24,
  image: 2048,
}

export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

// The app's local board id format (createDesignBoardId → `dms-…`). Stored as
// `clientId` so a retried create cannot make a duplicate board.
export const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
