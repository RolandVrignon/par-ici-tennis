import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import dayjs from 'dayjs'
import { attachCronJob, listBookingJobs, prepareBookingJob, removeBookingJob, cancelBookingJob, claimBookingJob, editBookingJob } from '../lib/booking-job.js'

test('prepared Hermes jobs contain no fixed credentials and can be managed', async t => {
  const root = mkdtempSync(join(tmpdir(), 'par-ici-tennis-job-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const stateDirectory = join(root, 'state')
  const hermesScriptsDirectory = join(root, 'hermes-scripts')
  const fixedConfigPath = join(root, 'config.fixed.json')
  writeFileSync(fixedConfigPath, JSON.stringify({
    account: { email: 'fixed@example.test', password: 'never-copy-this-secret' },
    priceType: ['Gratuité'],
    ntfy: { enable: true, topic: 'fixed-topic' },
  }))
  const options = {
    catalog: [{ id: '293', name: 'Max Rousié', arrondissement: 17 }, { id: '294', name: 'Jesse Owens', arrondissement: 18 }],
    stateDirectory,
    hermesScriptsDirectory,
    repositoryDirectory: root,
    nodeBinary: '/opt/node/bin/node',
    fixedConfigPath,
    now: dayjs('2026-09-11T12:00:00+02:00'),
  }
  const prepared = await prepareBookingJob({
    date: '21/09/2026',
    locations: ['Max Rousié'],
    hours: ['18'],
    courtType: ['Couvert'],
    players: [{ lastName: 'DUPONT', firstName: 'Paul' }],
  }, options)

  assert.equal(prepared.schedule, '2026-09-15T07:55:00+02:00')
  assert.equal(prepared.bookingOpensAt, '2026-09-15T08:00:00+02:00')
  const requestFile = join(stateDirectory, `${prepared.requestId}.json`)
  const wrapperFile = join(hermesScriptsDirectory, prepared.script)
  const requestContent = readFileSync(requestFile, 'utf8')
  const wrapperContent = readFileSync(wrapperFile, 'utf8')
  assert.doesNotMatch(requestContent, /never-copy-this-secret/)
  assert.doesNotMatch(wrapperContent, /never-copy-this-secret/)
  assert.equal(statSync(requestFile).mode & 0o777, 0o600)
  assert.equal(statSync(wrapperFile).mode & 0o777, 0o700)
  assert.equal(spawnSync('bash', ['-n', wrapperFile]).status, 0)

  const attached = attachCronJob(prepared.requestId, 'hermes-job-123', options)
  assert.equal(attached.status, 'scheduled')
  assert.equal(attached.cronJobId, 'hermes-job-123')
  assert.equal(listBookingJobs(options).length, 1)

  await assert.rejects(() => prepareBookingJob({
    date: '21/09/2026',
    locations: ['Jesse Owens'],
    hours: ['19'],
    courtType: ['Découvert'],
    players: [{ lastName: 'MARTIN', firstName: 'Alice' }],
  }, options), /Another active booking request/)

  const edited = await editBookingJob(prepared.requestId, {
    ...JSON.parse(requestContent).request, hours: ['20'], locations: ['max rousie'],
  }, options)
  assert.deepEqual(edited.request.hours, ['20'])
  assert.deepEqual(edited.request.locations, ['Max Rousié'])
  assert.throws(() => removeBookingJob(prepared.requestId, options), /Only unscheduled/)
  assert.equal(cancelBookingJob(prepared.requestId, options).status, 'cancelled')
  assert.throws(() => claimBookingJob(prepared.requestId, options), /cannot run/)
  assert.equal(listBookingJobs(options).length, 1)
})
