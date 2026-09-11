#!/usr/bin/env node
import { findClubs, loadClubCatalog } from '../lib/clubs.js'
import { cancelReservation, listReservations } from '../lib/reservations.js'

console.log = (...values) => console.error(...values)
const [resource, command, ...args] = process.argv.slice(2)
try {
  const allowed = resource === 'clubs' ? ['--query', '--arrondissement', '--headed'] : ['--id', '--confirm', '--headed']
  const parsed = new Map()
  for (let i = 0; i < args.length; i++) {
    const key = args[i]
    if (!allowed.includes(key) || parsed.has(key)) throw new Error(`Unexpected or duplicate option ${key}`)
    if (['--confirm', '--headed'].includes(key)) parsed.set(key, true)
    else {
      const value = args[++i]
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`)
      parsed.set(key, value)
    }
  }
  const option = name => parsed.get(name)
  const options = { headed: args.includes('--headed') }
  let result
  if (resource === 'clubs' && ['list', 'find'].includes(command)) {
    const query = option('--query')
    if (command === 'find' && !query) throw new Error('Missing --query')
    result = { source: 'Paris Tennis', fetchedAt: new Date().toISOString(), ...findClubs(await loadClubCatalog(options), { query, arrondissement: option('--arrondissement') }) }
  } else if (resource === 'reservations' && command === 'list') {
    if (args.includes('--confirm') || args.includes('--id')) throw new Error('list does not accept --confirm or --id')
    result = { source: 'Paris Tennis', fetchedAt: new Date().toISOString(), reservations: await listReservations(options) }
  } else if (resource === 'reservations' && command === 'cancel') {
    result = await cancelReservation(option('--id'), { ...options, confirm: args.includes('--confirm') })
  } else throw new Error('Usage: tennis.js clubs list|find [--query NAME] [--arrondissement N] | reservations list|cancel [--id ID] [--confirm] [--headed]')
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: error.message })}\n`)
  process.exitCode = 1
}
