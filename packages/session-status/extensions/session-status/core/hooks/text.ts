// Small text helpers the tool replies and the pings share.

/** `text` as a sentence: a period added unless it already ends in `.`, `!` or `?`. */
export function asSentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`
}
