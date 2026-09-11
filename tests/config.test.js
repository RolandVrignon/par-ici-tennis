import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadConfig, mergeConfig } from '../lib/config.js'

const temporaryDirectory = (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'par-ici-tennis-config-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

const writeJson = (filePath, value) => writeFileSync(filePath, JSON.stringify(value))

test('split configuration keeps fixed values separate from booking preferences', t => {
  const rootDirectory = temporaryDirectory(t)
  writeJson(join(rootDirectory, 'config.fixed.json'), {
    account: { email: 'fixed@example.test', password: 'secret' },
    priceType: ['Gratuité'],
    ntfy: { enable: true, topic: 'fixed-topic' },
  })
  writeJson(join(rootDirectory, 'config.request.json'), {
    date: '21/09/2026',
    locations: ['Max Rousié'],
    hours: ['18'],
    courtType: ['Couvert'],
    players: [{ lastName: 'DUPONT', firstName: 'Paul' }],
    priceType: ['Tarif plein'],
  })

  const config = loadConfig({ env: {}, rootDirectory })
  assert.equal(config.account.password, 'secret')
  assert.deepEqual(config.priceType, ['Gratuité'])
  assert.deepEqual(config.locations, ['Max Rousié'])
  assert.equal(config.date, '21/09/2026')
})

test('a complete temporary configuration can be selected explicitly', t => {
  const rootDirectory = temporaryDirectory(t)
  const temporaryConfig = join(rootDirectory, 'generated.json')
  writeJson(temporaryConfig, { marker: 'temporary' })
  assert.deepEqual(loadConfig({ env: { TENNIS_CONFIG_PATH: temporaryConfig }, rootDirectory }), { marker: 'temporary' })
})

test('legacy config.json remains supported when split files are absent', t => {
  const rootDirectory = temporaryDirectory(t)
  writeJson(join(rootDirectory, 'config.json'), { marker: 'legacy' })
  assert.deepEqual(loadConfig({ env: {}, rootDirectory }), { marker: 'legacy' })
})

test('mergeConfig ignores attempts to override fixed fields', () => {
  const merged = mergeConfig(
    { priceType: ['Gratuité'], account: { password: 'secret' } },
    { priceType: ['Tarif plein'], account: { password: 'changed' }, hours: ['18'] },
  )
  assert.deepEqual(merged, {
    priceType: ['Gratuité'],
    account: { password: 'secret' },
    hours: ['18'],
  })
})
