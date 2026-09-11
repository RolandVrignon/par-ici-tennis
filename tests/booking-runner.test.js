import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, copyFileSync, symlinkSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

const fixture = t => {
  const root = mkdtempSync(join(tmpdir(), 'tennis-runner-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const dir of ['lib', 'scripts', 'state', 'hermes/scripts']) mkdirSync(join(root, dir), { recursive: true })
  for (const file of ['lib/booking-request.js', 'lib/config.js', 'lib/booking-job.js', 'lib/clubs.js', 'lib/site-session.js', 'lib/captcha.js', 'lib/huggingface.js', 'lib/operation-lock.js', 'lib/booking-result.js', 'scripts/run-booking-request.js']) copyFileSync(file, join(root, file))
  symlinkSync(resolve('node_modules'), join(root, 'node_modules'))
  writeFileSync(join(root, 'package.json'), '{"type":"module"}')
  writeFileSync(join(root, 'config.fixed.json'), JSON.stringify({ account: { email: 'test@example.test', password: 'fixture-only' }, priceType: ['Gratuité'] }))
  writeFileSync(join(root, 'clock.js'), 'const NativeDate = Date; globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [\'2026-09-15T08:00:01+02:00\'])) } static now() { return new NativeDate(\'2026-09-15T08:00:01+02:00\').getTime() } }')
  const record = { id: 'test-job', status: 'scheduled', bookingOpensAt: '2026-09-15T08:00:00+02:00', request: { date: '21/09/2026', hours: ['18'], locations: ['Example'], courtType: ['Couvert'], players: [{ firstName: 'Test', lastName: 'Partner' }], dryRun: false } }
  const requestFile = join(root, 'state/test-job.json')
  const save = value => writeFileSync(requestFile, JSON.stringify(value))
  save(record)
  const run = (source, flags = []) => {
    writeFileSync(join(root, 'index.js'), source)
    return spawnSync(process.execPath, ['--import', join(root, 'clock.js'), join(root, 'scripts/run-booking-request.js'), '--request', requestFile, ...flags], {
      env: { ...process.env, TENNIS_FIXED_CONFIG_PATH: join(root, 'config.fixed.json'), HERMES_SCRIPTS_DIR: join(root, 'hermes/scripts') }, encoding: 'utf8', timeout: 10000,
    })
  }
  return { root, record, save, run, read: () => JSON.parse(readFileSync(requestFile, 'utf8')) }
}

test('runner preserves confirmation after child failure and refuses replay', t => {
  const f = fixture(t)
  const first = f.run('process.send({type:\'tennis-result\',status:\'confirmed\'}, () => {process.exitCode = 1})')
  assert.equal(first.status, 0, first.stderr)
  assert.equal(f.read().status, 'succeeded_with_warnings')
  assert.match(first.stdout, /confirmée/)
  const replay = f.run('throw new Error(\'must not execute\')')
  assert.equal(replay.status, 1)
  assert.match(replay.stderr, /cannot run/)
  assert.equal(f.read().status, 'succeeded_with_warnings')
  assert.equal(existsSync(join(f.root, 'state/.operation-lock')), false)
})
test('runner classifies interrupted submission and cancelled dry-run separately', t => {
  const f = fixture(t)
  f.run('process.send({type:\'tennis-result\',status:\'submitted\'}, () => {process.exitCode = 1})')
  assert.equal(f.read().status, 'needs_reconciliation')
  f.save({ ...f.record, request: { ...f.record.request, dryRun: true } })
  const dry = f.run('if (!process.argv.includes(\'--dry-run\')) throw new Error(\'Missing dry-run\'); process.send({type:\'tennis-result\',status:\'dry-run-cancelled\'})')
  assert.equal(dry.status, 0, dry.stderr)
  assert.equal(f.read().status, 'dry_run_succeeded')
})
test('configuration check leaves the request untouched and never starts the child', t => {
  const f = fixture(t)
  const result = f.run('throw new Error(\'must not execute\')', ['--check'])
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(f.read(), f.record)
})
test('overlapping execution and cancelled jobs cannot start a booking', t => {
  const f = fixture(t)
  mkdirSync(join(f.root, 'state/.operation-lock'))
  assert.match(f.run('throw new Error(\'must not execute\')').stderr, /Another tennis operation/)
  assert.equal(f.read().status, 'scheduled')
  rmSync(join(f.root, 'state/.operation-lock'), { recursive: true })
  f.save({ ...f.record, status: 'cancelled' })
  assert.match(f.run('throw new Error(\'must not execute\')').stderr, /cannot run/)
  assert.equal(f.read().status, 'cancelled')
})
