#!/usr/bin/env node
// Prints the causes in a captured `aspen` failure, without the cascade.
//
//   aspen compile --metadata > /tmp/aspen.out 2>&1; node causes.mjs /tmp/aspen.out
//
// One bad component fails the whole batch, and every other component reports that it "passed
// initial validation, but further checks were skipped due to other errors in the batch". Under an
// agent the CLI prints the failure as JSON with every component inside one `detail` string, so a
// line filter such as `grep -v` drops the causes along with the cascade. This reads the JSON when
// there is some, and the plain lines otherwise.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const CASCADE = /skipped due to other errors|another component failed validation/

// The JSON object that starts on a line of its own, or null.
function report (text) {
  for (let at = text.indexOf('{'); at !== -1; at = text.indexOf('{', at + 1)) {
    if (at > 0 && text[at - 1] !== '\n') continue
    try { return JSON.parse(text.slice(at)) } catch {}
  }
  return null
}

export function causes (text) {
  const json = report(text)
  const lines = json?.failures?.length
    ? json.failures.flatMap((f) => String(f.detail ?? '').split('\n'))
    : text.replace(/\\n/g, '\n').split('\n')
  return [...new Set(lines.map((l) => l.trimEnd()))].filter((l) => l.trim() && !CASCADE.test(l))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2]
  const text = readFileSync(file ?? 0, 'utf8')
  for (const line of causes(text)) console.log(line)
}
