#!/usr/bin/env node

import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { setTimeout as wait } from 'node:timers/promises'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import { buildBookingConfig, normalizeBookingRequest, PARIS_TIMEZONE } from '../lib/booking-request.js'
import { updateBookingJob } from '../lib/booking-job.js'

dayjs.extend(utc)
dayjs.extend(timezone)

const repositoryDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)))
const args = process.argv.slice(2)
const requestIndex = args.indexOf('--request')
if (requestIndex === -1 || !args[requestIndex + 1]) throw new Error('Missing --request')

const requestFile = resolve(args[requestIndex + 1])
const checkOnly = args.includes('--check')
const record = JSON.parse(readFileSync(requestFile, 'utf8'))
const request = normalizeBookingRequest(record.request, { allowPastOpening: true })
const fixedConfigPath = resolve(process.env.TENNIS_FIXED_CONFIG_PATH || join(repositoryDirectory, 'config.fixed.json'))
const fixedConfig = JSON.parse(readFileSync(fixedConfigPath, 'utf8'))
const fullConfig = buildBookingConfig(fixedConfig, request)
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'par-ici-tennis-'))
const temporaryConfigPath = join(temporaryDirectory, 'config.json')
const logDirectory = join(repositoryDirectory, 'logs', 'hermes')
const logFile = join(logDirectory, `${record.id}.log`)
const hermesScriptsDirectory = resolve(process.env.HERMES_HOME || '/home/rolexx/.hermes', 'scripts')
const wrapperFile = join(hermesScriptsDirectory, `tennis-booking-${record.id}.sh`)

mkdirSync(logDirectory, { recursive: true, mode: 0o700 })
writeFileSync(temporaryConfigPath, `${JSON.stringify(fullConfig, null, 2)}\n`, { mode: 0o600 })

const run = async () => {
  if (checkOnly) {
    const loadedConfig = JSON.parse(readFileSync(temporaryConfigPath, 'utf8'))
    if (!loadedConfig.account?.email || !loadedConfig.account?.password) throw new Error('Temporary configuration has no credentials')
    if (loadedConfig.date !== request.date) throw new Error('Temporary configuration has the wrong target date')
    process.stdout.write('Booking request check passed. No browser was started.\n')
    return
  }

  const opening = dayjs(record.bookingOpensAt).tz(PARIS_TIMEZONE)
  const waitMilliseconds = Math.max(0, opening.diff(dayjs().tz(PARIS_TIMEZONE)))
  if (waitMilliseconds > 10 * 60 * 1000) throw new Error('Booking runner started more than ten minutes before opening')

  updateBookingJob(record.id, { status: 'running', startedAt: new Date().toISOString(), logFile })
  if (waitMilliseconds > 0) await wait(waitMilliseconds)

  const childArguments = ['index.js', '--debug']
  if (request.dryRun) childArguments.push('--dry-run')
  const output = []
  let outputSize = 0
  const logStream = createWriteStream(logFile, { flags: 'a', mode: 0o600 })
  const child = spawn(process.execPath, childArguments, {
    cwd: repositoryDirectory,
    env: { ...process.env, TENNIS_CONFIG_PATH: temporaryConfigPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const capture = chunk => {
    logStream.write(chunk)
    if (outputSize < 2_000_000) {
      const value = chunk.toString()
      output.push(value)
      outputSize += value.length
    }
  }
  child.stdout.on('data', capture)
  child.stderr.on('data', capture)

  const exitCode = await new Promise((resolveCode, reject) => {
    child.once('error', reject)
    child.once('close', code => resolveCode(code ?? 1))
  })
  await new Promise(resolveStream => logStream.end(resolveStream))

  const combinedOutput = output.join('')
  const foundReservation = request.dryRun
    ? combinedOutput.includes('Fausse réservation faite')
    : combinedOutput.includes('Réservation faite :') || combinedOutput.includes('Réservation faite, regardez')
  const status = exitCode !== 0 ? 'failed' : foundReservation ? 'succeeded' : 'unavailable'
  updateBookingJob(record.id, {
    status,
    completedAt: new Date().toISOString(),
    exitCode,
    logFile,
  })

  const label = `${request.date} à ${request.hours.join('/')}h — ${Array.isArray(request.locations) ? request.locations.join(', ') : Object.keys(request.locations).join(', ')}`
  if (exitCode !== 0) {
    process.stderr.write(`Échec de la réservation Paris Tennis (${label}). Journal : ${logFile}\n`)
    process.exitCode = exitCode
  } else if (foundReservation && request.dryRun) {
    process.stdout.write(`✅ Test Paris Tennis réussi pour le ${label}. Aucune réservation réelle effectuée.\n`)
  } else if (foundReservation) {
    process.stdout.write(`✅ Réservation Paris Tennis effectuée pour le ${label}.\n`)
  } else {
    process.stdout.write(`⚠️ Aucun terrain correspondant trouvé pour le ${label}. Journal : ${logFile}\n`)
  }
}

try {
  await run()
} catch (error) {
  updateBookingJob(record.id, {
    status: 'failed',
    completedAt: new Date().toISOString(),
    error: error.message,
    logFile,
  })
  process.stderr.write(`Échec du lanceur Paris Tennis : ${error.message}\n`)
  process.exitCode = 1
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true })
  if (!checkOnly) rmSync(wrapperFile, { force: true })
}
