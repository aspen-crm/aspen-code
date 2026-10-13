import test from 'node:test'
import assert from 'node:assert/strict'
import { causes } from '../skills/diagnose/scripts/causes.mjs'

const cascade = (n) => `  FAIL layout_p:${n}.layout_p: Component record 'layout_p:${n}.layout_p' passed initial validation, but further checks were skipped due to other errors in the batch.`
const cause = "  FAIL object_type_p:case_p.case_p: Error during merge. Additional details: attribute 'case_p.case_p.fields' is locked and cannot be extended."
const detail = ['The metadata is not valid:', cascade('account_p'), cause, cascade('case_p'), '  33 component(s) validated, 33 failed, 0 batch failure(s)'].join('\n')

test('under an agent: the cause inside the JSON detail, without the cascade', () => {
  const out = [
    'detected agent: Claude Code',
    `ERROR command failed error=UserError(UserFacingError { detail: ${JSON.stringify(detail)} })`,
    JSON.stringify({ status: 'FAILURE', failures: [{ error_type: 'INVALID_DATA', detail, display_detail: '' }] }, null, 2)
  ].join('\n')
  const lines = causes(out)
  assert.ok(lines.includes(cause))
  assert.ok(!lines.some((l) => /skipped due to other errors/.test(l)))
  assert.equal(lines.filter((l) => l === cause).length, 1, 'the cause once, not once per copy of the detail')
})

test('plain output: the cause lines, without the cascade', () => {
  const lines = causes(detail + '\n')
  assert.deepEqual(lines, ['The metadata is not valid:', cause, '  33 component(s) validated, 33 failed, 0 batch failure(s)'])
})

test('check-in cascade lines are dropped too', () => {
  assert.deepEqual(causes('x failed\ny skipped because another component failed validation\n'), ['x failed'])
})
