#!/usr/bin/env node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { setTimeout as wait } from 'node:timers/promises'
import dayjs from 'dayjs'
import { buildBookingConfig, normalizeBookingRequest, getBookingSchedule } from '../lib/booking-request.js'
import { bookingJobOptions, claimBookingJob, updateBookingJob } from '../lib/booking-job.js'
import { acquireOperationLock } from '../lib/operation-lock.js'
import { classifyBookingResult } from '../lib/booking-result.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
let release = () => {}
let temporaryDirectory
let child
let record
let options
let claimed = false
let outcome
let logFile
const controller = new AbortController()
const interrupt = () => { controller.abort(); child?.kill('SIGTERM') }
process.once('SIGTERM', interrupt)
process.once('SIGINT', interrupt)

try {
  const index = args.indexOf('--request')
  if (index === -1 || !args[index + 1]) throw new Error('Missing --request')
  const requestFile = resolve(args[index + 1])
  record = JSON.parse(readFileSync(requestFile, 'utf8'))
  if (!/^[a-z0-9-]+$/.test(record.id) || requestFile !== join(dirname(requestFile), `${record.id}.json`)) throw new Error('Invalid request file or id')
  options = bookingJobOptions({ stateDirectory: dirname(requestFile) })
  if (!checkOnly) release = acquireOperationLock(options.stateDirectory)
  record = JSON.parse(readFileSync(requestFile, 'utf8'))
  const request = normalizeBookingRequest(record.request, { allowPastOpening: true })
  const fixed = JSON.parse(readFileSync(options.fixedConfigPath, 'utf8'))
  const fullConfig = buildBookingConfig(fixed, request)
  // Check configuration without creating a secret file or changing job status.
  if (checkOnly) {
    process.stdout.write('Booking request check passed. No browser was started.\n')
  } else {
    const expected = getBookingSchedule(request)
    if (record.bookingOpensAt !== expected.bookingOpensAt) throw new Error('Stored opening time differs from the Paris schedule; re-prepare this request')
    const waitMilliseconds = Math.max(0, dayjs(record.bookingOpensAt).diff(dayjs()))
    if (waitMilliseconds > 600000) throw new Error('Booking runner started more than ten minutes before opening')
    if (dayjs().diff(dayjs(record.bookingOpensAt)) > 3600000) throw new Error('Booking window expired; prepare a new request instead of replaying it')
    claimBookingJob(record.id, options)
    claimed = true
    if (waitMilliseconds) await wait(waitMilliseconds, undefined, { signal: controller.signal })
    if (controller.signal.aborted) throw new Error('Booking interrupted before launch')
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'par-ici-tennis-'))
    const configPath = join(temporaryDirectory, 'config.json')
    writeFileSync(configPath, `${JSON.stringify(fullConfig)}\n`, { mode: 0o600 })
    const logDirectory = join(root, 'logs', 'hermes')
    mkdirSync(logDirectory, { recursive: true, mode: 0o700 })
    logFile = join(logDirectory, `${record.id}.log`)
    const childArgs = ['index.js', '--debug', ...(request.dryRun ? ['--dry-run'] : [])]
    child = spawn(process.execPath, childArgs, {
      cwd: root,
      env: { ...process.env, TENNIS_CONFIG_PATH: configPath },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    child.on('message', message => {
      if (message?.type !== 'tennis-result' || !['submitted', 'confirmed', 'dry-run-cancelled'].includes(message.status)) return
      if (outcome === 'confirmed' || outcome === 'dry-run-cancelled') return
      outcome = message.status
      // Persist confirmation before ancillary work (ICS, notifications) can fail.
      updateBookingJob(record.id, { outcome, logFile }, options)
    })
    const capture = chunk => appendFileSync(logFile, chunk, { mode: 0o600 })
    child.stdout.on('data', capture)
    child.stderr.on('data', capture)
    const exitCode = await new Promise((resolveCode, reject) => {
      child.once('error', reject)
      child.once('close', code => resolveCode(code ?? 1))
    })
    const status = classifyBookingResult({ exitCode, outcome, dryRun: request.dryRun })
    updateBookingJob(record.id, { status, outcome, exitCode, logFile, completedAt: new Date().toISOString() }, options)
    const label = `${request.date} à ${request.hours.join('/')}h — ${Array.isArray(request.locations) ? request.locations.join(', ') : Object.keys(request.locations).join(', ')}`
    const messages = {
      succeeded: `✅ Réservation Paris Tennis confirmée : ${label}.`,
      succeeded_with_warnings: `⚠️ Réservation Paris Tennis confirmée : ${label}. Une étape après réservation a échoué ; ne pas relancer. Journal : ${logFile}`,
      dry_run_succeeded: `✅ Test Paris Tennis terminé et annulation vérifiée : ${label}. Aucune réservation réelle.`,
      unavailable: `⚠️ Aucun terrain correspondant trouvé : ${label}.`,
      needs_reconciliation: `⚠️ Résultat de réservation incertain : ${label}. Vérifier le compte avant toute nouvelle tentative. Journal : ${logFile}`,
      failed: `Échec de la réservation Paris Tennis : ${label}. Journal : ${logFile}`,
    }
    process.stdout.write(`${messages[status]}\n`)
    if (['failed', 'needs_reconciliation'].includes(status)) process.exitCode = 1
  }
} catch (error) {
  if (claimed) {
    const status = outcome === 'confirmed' ? 'succeeded_with_warnings' : outcome === 'submitted' || controller.signal.aborted ? 'needs_reconciliation' : 'failed'
    updateBookingJob(record.id, { status, outcome, error: error.message, logFile, completedAt: new Date().toISOString() }, options)
  }
  process.stderr.write(`${outcome === 'confirmed' ? 'Réservation confirmée, erreur après réservation' : 'Échec du lanceur Paris Tennis'} : ${error.message}\n`)
  process.exitCode = outcome === 'confirmed' ? 0 : 1
} finally {
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true })
  if (claimed) rmSync(join(options.hermesScriptsDirectory, `tennis-booking-${record.id}.sh`), { force: true })
  release()
  process.removeListener('SIGTERM', interrupt)
  process.removeListener('SIGINT', interrupt)
}
