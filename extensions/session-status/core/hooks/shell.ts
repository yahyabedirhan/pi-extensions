// A Bash command as the simple commands it runs, for the hooks that read a
// command's text: links.ts and effort.ts. It drops heredoc bodies, so text a
// command only feeds to a program (a script, a file) is never read as a
// command, and splits on `&&`, `||`, `;`, `|` and newlines outside quotes and
// command substitutions. It reads enough shell to tell commands apart, not to
// run them.

/** A heredoc's start: `<<EOF`, `<<-EOF`, `<<'EOF'` or `<<"EOF"`. */
const HEREDOC = /^<<(-?)[ \t]*(?:'([^']*)'|"([^"]*)"|\\?([A-Za-z0-9_.-]+))/

/** The words before a command that are not the command: keywords, groups, `!` and `NAME=value`. */
const PREFIX = /^(?:(?:do|then|else|elif|if|while|until|time)\s+|[({!]\s*|[A-Za-z_]\w*=(?:'[^']*'|"[^"]*"|[^\s'"]*)\s+)/

/** A heredoc whose body is still to skip. */
type Heredoc = { end: string; isTabbed: boolean }

/**
 * The simple commands a Bash command runs, in order, each trimmed and
 * without its leading keywords (`do`, `then`, …), groups and variable
 * assignments; heredoc bodies dropped. A separator inside quotes or a
 * `$(…)` does not split.
 */
export function simpleCommands(command: string): string[] {
  const parts: string[] = []
  let part = ''
  // The open quotes and substitutions, innermost last: `'`, `"` or `(`.
  const open: string[] = []
  let heredocs: Heredoc[] = []
  let at = 0

  const finish = () => {
    const simple = withoutPrefix(part.trim())
    if (simple !== '') {
      parts.push(simple)
    }
    part = ''
  }

  while (at < command.length) {
    const char = command[at] ?? ''
    const inner = open[open.length - 1]
    if (inner === "'") {
      part += char
      at += 1
      if (char === "'") {
        open.pop()
      }
      continue
    }
    if (char === '\\') {
      part += command.slice(at, at + 2)
      at += 2
      continue
    }
    if (inner === '"') {
      if (char === '"') {
        open.pop()
      } else if (command.startsWith('$(', at)) {
        open.push('(')
        part += '$('
        at += 2
        continue
      }
      part += char
      at += 1
      continue
    }

    // Outside quotes: at the top, or in a `$(…)`.
    const heredoc = command.startsWith('<<<', at) ? null : HEREDOC.exec(command.slice(at))
    if (heredoc !== null) {
      heredocs.push({ end: heredoc[2] ?? heredoc[3] ?? heredoc[4] ?? '', isTabbed: heredoc[1] === '-' })
      part += heredoc[0]
      at += heredoc[0].length
      continue
    }
    if (char === '\n' && heredocs.length > 0) {
      at = afterBodies(command, at + 1, heredocs)
      heredocs = []
      if (open.length === 0) {
        finish()
      } else {
        part += '\n'
      }
      continue
    }
    if (char === "'" || char === '"' || char === '(') {
      open.push(char)
    } else if (char === ')' && open.length > 0) {
      open.pop()
    } else if (open.length === 0) {
      const separator = ['&&', '||'].find(text => command.startsWith(text, at)) ?? (/[;|\n]/.test(char) ? char : null)
      if (separator !== null) {
        finish()
        at += separator.length
        continue
      }
    }
    part += char
    at += 1
  }
  finish()

  return parts
}

/** Where the command goes on after the heredoc bodies that start at `from`. */
function afterBodies(command: string, from: number, heredocs: readonly Heredoc[]): number {
  let at = from
  for (const heredoc of heredocs) {
    while (at < command.length) {
      const lineEnd = command.indexOf('\n', at)
      const end = lineEnd === -1 ? command.length : lineEnd
      const line = command.slice(at, end)
      at = lineEnd === -1 ? command.length : lineEnd + 1
      if ((heredoc.isTabbed ? line.replace(/^\t+/, '') : line) === heredoc.end) {
        break
      }
    }
  }

  return at
}

/** A simple command without the keywords, groups and assignments before it. */
function withoutPrefix(part: string): string {
  let simple = part
  for (let prefix = PREFIX.exec(simple); prefix !== null; prefix = PREFIX.exec(simple)) {
    simple = simple.slice(prefix[0].length)
  }

  return simple
}
