import { randomBytes } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import dayjs from 'dayjs'
import { getBookingSchedule, normalizeBookingRequest, validateFixedConfig } from './booking-request.js'

const repositoryDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)))
const defaultStateDirectory = '/home/rolexx/.local/state/par-ici-tennis/bookings'
const defaultHermesScriptsDirectory = '/home/rolexx/.hermes/scripts'
const defaultNodeBinary = '/home/rolexx/.local/share/fnm/aliases/default/bin/node'
const idPattern = /^[a-z0-9-]+$/

const readJson = (filePath) => JSON.parse(readFileSync(filePath, 'utf8'))

const writeJsonAtomic = (filePath, value) => {
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  chmodSync(temporaryPath, 0o600)
  renameSync(temporaryPath, filePath)
}

const assertRequestId = (requestId) => {
  if (!idPattern.test(requestId)) throw new Error('Invalid booking request id')
  return requestId
}

const getLocationNames = (locations) => Array.isArray(locations) ? locations : Object.keys(locations)

const getPaths = (requestId, { stateDirectory, hermesScriptsDirectory }) => ({
  requestFile: join(stateDirectory, `${requestId}.json`),
  scriptFile: join(hermesScriptsDirectory, `tennis-booking-${requestId}.sh`),
})

const buildWrapper = ({ nodeBinary, repositoryDirectory: root, requestFile }) => `#!/usr/bin/env bash

set -u -o pipefail

exec 9> /tmp/par-ici-tennis-booking.lock
if ! /usr/bin/flock -n 9; then
  echo "⚠️ Une autre réservation Paris Tennis est déjà en cours."
  exit 75
fi

cd "${root}" || exit 1
exec "${nodeBinary}" scripts/run-booking-request.js --request "${requestFile}"
`

export const bookingJobOptions = (overrides = {}) => {
  const root = resolve(overrides.repositoryDirectory || repositoryDirectory)
  return {
    stateDirectory: resolve(overrides.stateDirectory || process.env.TENNIS_BOOKING_STATE_DIR || defaultStateDirectory),
    hermesScriptsDirectory: resolve(overrides.hermesScriptsDirectory || process.env.HERMES_SCRIPTS_DIR || defaultHermesScriptsDirectory),
    repositoryDirectory: root,
    nodeBinary: resolve(overrides.nodeBinary || process.env.TENNIS_NODE_BINARY || defaultNodeBinary),
    fixedConfigPath: resolve(overrides.fixedConfigPath || process.env.TENNIS_FIXED_CONFIG_PATH || join(root, 'config.fixed.json')),
  }
}

export const prepareBookingJob = (input, overrides = {}) => {
  const options = bookingJobOptions(overrides)
  const now = overrides.now || dayjs()
  const request = normalizeBookingRequest(input, { now })
  validateFixedConfig(readJson(options.fixedConfigPath))

  mkdirSync(options.stateDirectory, { recursive: true, mode: 0o700 })
  mkdirSync(options.hermesScriptsDirectory, { recursive: true, mode: 0o700 })
  chmodSync(options.stateDirectory, 0o700)

  const datePart = request.date.split('/').reverse().join('')
  const requestId = `${datePart}-${request.hours[0]}-${randomBytes(3).toString('hex')}`
  const { scheduleAt, bookingOpensAt } = getBookingSchedule(request)
  const conflict = listBookingJobs(options).find(job =>
    ['prepared', 'scheduled', 'running'].includes(job.status)
    && job.bookingOpensAt === bookingOpensAt)
  if (conflict) throw new Error(`Another active booking request already opens at this time: ${conflict.id}`)

  const paths = getPaths(requestId, options)
  const record = {
    version: 1,
    id: requestId,
    status: 'prepared',
    createdAt: now.toISOString(),
    scheduleAt,
    bookingOpensAt,
    cronJobId: null,
    request,
  }

  try {
    writeFileSync(paths.requestFile, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    writeFileSync(paths.scriptFile, buildWrapper({
      nodeBinary: options.nodeBinary,
      repositoryDirectory: options.repositoryDirectory,
      requestFile: paths.requestFile,
    }), { flag: 'wx', mode: 0o700 })
    chmodSync(paths.requestFile, 0o600)
    chmodSync(paths.scriptFile, 0o700)
  } catch (error) {
    rmSync(paths.requestFile, { force: true })
    rmSync(paths.scriptFile, { force: true })
    throw error
  }

  const clubs = getLocationNames(request.locations).join(', ')
  return {
    requestId,
    cronName: `Tennis ${request.date} ${request.hours.join('/')}h - ${clubs}`,
    schedule: scheduleAt,
    bookingOpensAt,
    script: basename(paths.scriptFile),
    dryRun: request.dryRun,
  }
}

export const attachCronJob = (requestId, cronJobId, overrides = {}) => {
  const options = bookingJobOptions(overrides)
  const paths = getPaths(assertRequestId(requestId), options)
  const record = readJson(paths.requestFile)
  if (!String(cronJobId || '').trim()) throw new Error('cronJobId must be a non-empty string')
  record.cronJobId = String(cronJobId).trim()
  record.status = 'scheduled'
  writeJsonAtomic(paths.requestFile, record)
  return record
}

export const updateBookingJob = (requestId, updates, overrides = {}) => {
  const options = bookingJobOptions(overrides)
  const paths = getPaths(assertRequestId(requestId), options)
  const record = readJson(paths.requestFile)
  const updated = { ...record, ...updates, id: record.id, request: record.request }
  writeJsonAtomic(paths.requestFile, updated)
  return updated
}

export const listBookingJobs = (overrides = {}) => {
  const options = bookingJobOptions(overrides)
  if (!existsSync(options.stateDirectory)) return []
  return readdirSync(options.stateDirectory)
    .filter(name => idPattern.test(name.replace(/\.json$/, '')) && name.endsWith('.json'))
    .map(name => readJson(join(options.stateDirectory, name)))
    .sort((a, b) => a.bookingOpensAt.localeCompare(b.bookingOpensAt))
}

export const removeBookingJob = (requestId, overrides = {}) => {
  const options = bookingJobOptions(overrides)
  const paths = getPaths(assertRequestId(requestId), options)
  const record = existsSync(paths.requestFile) ? readJson(paths.requestFile) : null
  rmSync(paths.requestFile, { force: true })
  rmSync(paths.scriptFile, { force: true })
  return record
}

export const readBookingJob = (requestId, overrides = {}) => {
  const options = bookingJobOptions(overrides)
  return readJson(getPaths(assertRequestId(requestId), options).requestFile)
}
