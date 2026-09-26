// Display-order helpers for the admin list editors.
//
// Every admin screen that manages an ordered list — projects, reviews, About
// blocks/stats/team, showroom images, team members — had the same two problems,
// so they are fixed in one place rather than five.

/**
 * The next free display-order slot for a list.
 *
 * The bug this replaces: a new item was given either a hardcoded 0 or
 * `list.length`. Both COLLIDE with an item that already exists.
 *
 *   - 0 puts every new item ahead of, or tied with, the first one.
 *   - `length` looks right only while the orders happen to be 0..n-1. Reorder
 *     anything, delete an item from the middle, or type an order by hand, and
 *     `length` names a slot something else already occupies. Two items then
 *     share an order and their relative position is decided by whatever the
 *     sort happens to do with a tie — which is to say, arbitrarily.
 *
 * Taking `max + 1` means "after everything currently here", which is what
 * "add" should mean, and it cannot tie with an existing value.
 *
 * `?? 0` rather than `|| 0` so a legitimate stored 0 is not treated as missing.
 */
export const nextOrder = (list) => {
  if (!Array.isArray(list) || list.length === 0) return 0
  const orders = list.map((entry) => (typeof entry?.order === 'number' && Number.isFinite(entry.order) ? entry.order : 0))
  return Math.max(...orders) + 1
}

/**
 * A raw order input's value as a usable non-negative number.
 *
 * `Number(event.target.value)` alone lets two bad values through. A cleared or
 * non-numeric input yields NaN, which React renders as an empty field whose
 * state is nonetheless broken and which serialises to `null` on save. A typed
 * `-5` is accepted despite `min={0}`, because that attribute constrains the
 * spinner and form validation, not what a person can type into the box.
 *
 * Both collapse to 0 here — the first free slot — so the field always holds a
 * real number the backend can sort on.
 */
export const orderInputValue = (raw) => {
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}
