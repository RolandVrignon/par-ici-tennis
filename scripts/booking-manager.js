#!/usr/bin/env node

import { readFileSync, rmSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import {
  attachCronJob,
  cancelBookingJob,
  editBookingJob,
  listBookingJobs,
  prepareBookingJob,
  readBookingJob,
  removeBookingJob,
} from '../lib/booking-job.js'

console.log = (...values) => console.error(...values)

const [command, ...args] = process.argv.slice(2)
const getArgument = (name) => {
  const index = args.indexOf(name)
  if (index === -1 || !args[index + 1]) throw new Error(`Missing ${name}`)
  return args[index + 1]
}

const print = value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)

try {
  if (command === 'prepare') {
    const inputPath = resolve(getArgument('--input'))
    const consume = args.includes('--consume')
    if (consume && (dirname(inputPath) !== '/tmp' || !/^tennis-booking-request-[a-zA-Z0-9-]+\.json$/.test(basename(inputPath)))) {
      throw new Error('--consume is restricted to /tmp/tennis-booking-request-*.json')
    }
    try {
      print(await prepareBookingJob(JSON.parse(readFileSync(inputPath, 'utf8'))))
    } finally {
      if (consume) rmSync(inputPath, { force: true })
    }
  } else if (command === 'attach') {
    print(attachCronJob(getArgument('--request-id'), getArgument('--cron-job-id')))
  } else if (command === 'list') {
    print(listBookingJobs())
  } else if (command === 'show') {
    print(readBookingJob(getArgument('--request-id')))
  } else if (command === 'cancel') {
    print(cancelBookingJob(getArgument('--request-id')))
  } else if (command === 'edit') {
    print(await editBookingJob(getArgument('--request-id'), JSON.parse(readFileSync(resolve(getArgument('--input')), 'utf8'))))
  } else if (command === 'cleanup') {
    print({ removed: removeBookingJob(getArgument('--request-id'))?.id || null })
  } else {
    throw new Error('Usage: booking-manager.js prepare|attach|list|show|edit|cancel|cleanup')
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
}
