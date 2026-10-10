// Short lists: the first or newest few of a longer one, and how many it
// leaves out, for the pane, the band and the tool replies to show as
// "+N more".

/** A list cut short: the items shown and how many it leaves out. */
export type Cut<T> = { shown: T[]; more: number }

/** The first `limit` items, in order, and how many follow. */
export function first<T>(items: readonly T[], limit: number): Cut<T> {
  const shown = items.slice(0, limit)

  return { shown, more: items.length - shown.length }
}

/**
 * The newest `limit` of a list kept oldest first, newest first, and how many
 * older ones it leaves out.
 */
export function newest<T>(items: readonly T[], limit: number): Cut<T> {
  const shown = items.slice(-limit).reverse()

  return { shown, more: items.length - shown.length }
}

/** The first `limit` names joined by commas, then `+N more`: `#3, #5, +2 more`. */
export function joinFirst(names: readonly string[], limit: number): string {
  const { shown, more } = first(names, limit)

  return [...shown, ...(more > 0 ? [`+${more} more`] : [])].join(', ')
}
