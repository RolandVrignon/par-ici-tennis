#!/usr/bin/env node
import { mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const destination = join(process.env.HERMES_HOME || join(homedir(), '.hermes'), 'skills', 'tennis-booking')
mkdirSync(destination, { recursive: true, mode: 0o700 })
const file = join(destination, 'SKILL.md')
if (existsSync(file)) copyFileSync(file, join(destination, `SKILL.md.backup-${Date.now()}`))
copyFileSync(join(root, 'skills/tennis-booking/SKILL.md'), file)
process.stdout.write(`Hermes skill installed: ${file}\n`)
