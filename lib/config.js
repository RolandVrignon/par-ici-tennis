import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const VARIABLE_CONFIG_KEYS = Object.freeze([
  'date',
  'locations',
  'hours',
  'courtType',
  'players',
])

const readJson = (filePath) => {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`Unable to read JSON configuration ${filePath}: ${error.message}`, { cause: error })
  }
}

export const mergeConfig = (fixedConfig, requestConfig) => {
  const merged = { ...fixedConfig }
  for (const key of VARIABLE_CONFIG_KEYS) {
    if (Object.hasOwn(requestConfig, key)) merged[key] = requestConfig[key]
  }
  return merged
}

export const loadConfig = ({
  env = process.env,
  rootDirectory = repositoryDirectory,
} = {}) => {
  if (env.TENNIS_CONFIG_PATH) {
    return readJson(resolve(env.TENNIS_CONFIG_PATH))
  }

  const fixedPath = env.TENNIS_FIXED_CONFIG_PATH
    ? resolve(env.TENNIS_FIXED_CONFIG_PATH)
    : resolve(rootDirectory, 'config.fixed.json')
  const requestPath = env.TENNIS_REQUEST_CONFIG_PATH
    ? resolve(env.TENNIS_REQUEST_CONFIG_PATH)
    : resolve(rootDirectory, 'config.request.json')

  if (existsSync(fixedPath) || existsSync(requestPath)) {
    if (!existsSync(fixedPath)) throw new Error(`Missing fixed configuration: ${fixedPath}`)
    if (!existsSync(requestPath)) throw new Error(`Missing request configuration: ${requestPath}`)
    return mergeConfig(readJson(fixedPath), readJson(requestPath))
  }

  const legacyPath = resolve(rootDirectory, 'config.json')
  if (existsSync(legacyPath)) return readJson(legacyPath)

  throw new Error('No configuration found. Create config.fixed.json and config.request.json.')
}

// Account inspection does not require a booking request configuration.
export const loadAccountConfig = ({ env = process.env, rootDirectory = repositoryDirectory } = {}) => {
  if (env.TENNIS_CONFIG_PATH) return readJson(resolve(env.TENNIS_CONFIG_PATH))
  const fixedPath = resolve(env.TENNIS_FIXED_CONFIG_PATH || resolve(rootDirectory, 'config.fixed.json'))
  if (existsSync(fixedPath)) return readJson(fixedPath)
  if (env.TENNIS_FIXED_CONFIG_PATH) throw new Error(`Missing fixed configuration: ${fixedPath}`)
  return readJson(resolve(rootDirectory, 'config.json'))
}
