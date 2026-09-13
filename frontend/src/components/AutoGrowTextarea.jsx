import { useLayoutEffect, useRef } from 'react'

/**
 * A <textarea> that sizes itself to its content.
 *
 * A fixed `rows` textarea stops growing once it is full and shows an inner
 * scrollbar, so a long biography ends up being edited through a five-line
 * window. This grows with the text instead, and shrinks again when text is
 * deleted, up to an optional ceiling — past that it stops growing and scrolls.
 *
 * useLayoutEffect rather than useEffect: the measurement runs before the
 * browser paints, so opening an edit form on an existing long value shows the
 * correct height immediately instead of flashing one frame at the `rows`
 * height and then snapping taller.
 */
const AutoGrowTextarea = ({ value, onChange, className = '', minRows = 3, maxRows, ...rest }) => {
  const ref = useRef(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    /*
     * Collapse first, then measure.
     *
     * scrollHeight reports the taller of the content and the current box, so
     * without this reset the field could only ever grow — deleting a paragraph
     * would leave the box at its old height.
     */
    el.style.height = 'auto'

    const styles = getComputedStyle(el)
    const lineHeight = parseFloat(styles.lineHeight) || 20

    /*
     * scrollHeight covers content + padding but not borders, while `height`
     * under border-box covers content + padding + borders. Left uncorrected
     * the box lands a couple of pixels short and the last line clips.
     *
     * The row floor needs the same treatment for a different reason: it is
     * expressed in rows of TEXT, so the padding has to be added back or a
     * minRows={2} field computes 40px against this project's 20px of vertical
     * padding — which renders as a single cramped row, not two.
     */
    const padding = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom)
    const borders = parseFloat(styles.borderTopWidth) + parseFloat(styles.borderBottomWidth)
    const chrome = styles.boxSizing === 'border-box' ? padding + borders : 0

    const contentHeight = el.scrollHeight + (styles.boxSizing === 'border-box' ? borders : -padding)
    const minHeight = lineHeight * minRows + chrome
    const maxHeight = maxRows ? lineHeight * maxRows + chrome : Infinity

    el.style.height = `${Math.min(Math.max(contentHeight, minHeight), maxHeight)}px`
    // Only once the ceiling is reached, so no scrollbar flickers in and out
    // while the field is still free to grow.
    el.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden'
  }, [value, minRows, maxRows])

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      // resize-none last, so the browser's drag handle cannot fight the
      // automatic sizing. The caller's own classes are kept.
      className={`${className} resize-none`}
      rows={minRows}
      {...rest}
    />
  )
}

export default AutoGrowTextarea
