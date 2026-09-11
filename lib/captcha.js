import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { huggingFaceAPI } from './huggingface.js'

const diagnosticUrl = (value) => {
  try {
    const url = new URL(value)
    const keptParams = new URLSearchParams()
    for (const key of ['page', 'view', 'action']) {
      if (url.searchParams.has(key)) keptParams.set(key, url.searchParams.get(key))
    }
    if (url.origin === 'null') return url.href
    const query = keptParams.toString()
    return `${url.origin}${url.pathname}${query ? `?${query}` : ''}`
  } catch {
    return String(value).split('?')[0]
  }
}

const captchaPageMessage = async (page) => {
  const text = await page.locator('body').innerText().catch(() => '')
  return text.split('\n')
    .map(line => line.trim())
    .find(line => /captcha|robot|blacklist/i.test(line)) || 'none'
}

// Wait for the requested booking step, solving a visible text CAPTCHA only.
export const waitForStep = async (page, selector, options = {}, recognize = huggingFaceAPI) => {
  const { headed = false, debug = false, ai = {}, timeoutMs = headed ? 300000 : 90000 } = options
  const startedAt = Date.now()
  const deadline = Date.now() + timeoutMs
  const maxAttempts = Math.min(3, Math.max(1, Math.floor(Number(ai.maxAttempts) || 2)))
  let attempts = 0
  let lastImage
  let lastObservedImage
  let lastSubmission = 0
  let manual = false
  let nextHeartbeat = 0

  const debugLog = (message) => {
    if (debug) console.log(`[debug][captcha] ${message}`)
  }

  const onResponse = (response) => {
    const url = response.url()
    if (!url.includes('captcha.liveidentity.com') && !url.includes('reservation_captcha')) return
    debugLog(`response=${response.status()} method=${response.request().method()} url=${diagnosticUrl(url)}`)
  }

  const onRequestFailed = (request) => {
    const url = request.url()
    if (!url.includes('captcha.liveidentity.com') && !url.includes('reservation_captcha')) return
    debugLog(`request-failed method=${request.method()} error=${request.failure()?.errorText || 'unknown'} url=${diagnosticUrl(url)}`)
  }

  const fallback = (reason) => {
    if (!headed) throw new Error(`${reason}. Retry with --headed for manual CAPTCHA entry.`)
    if (!manual) console.log(`${reason}. Solve the CAPTCHA manually in the browser.`)
    manual = true
  }

  if (debug) {
    page.on('response', onResponse)
    page.on('requestfailed', onRequestFailed)
  }
  debugLog(`waiting selector=${JSON.stringify(selector)} timeoutMs=${timeoutMs} headed=${headed} aiEnabled=${ai.enable !== false} url=${diagnosticUrl(page.url())}`)

  try {
    while (Date.now() < deadline) {
      if (page.isClosed()) throw new Error('Browser closed while waiting for a booking step')
      if (await page.locator(selector).isVisible()) {
        debugLog(`step-ready selector=${JSON.stringify(selector)} elapsedMs=${Date.now() - startedAt} url=${diagnosticUrl(page.url())}`)
        return
      }

      // This button becomes enabled only after the site accepts the CAPTCHA.
      const proceed = page.getByRole('button', { name: 'Poursuivre la réservation', exact: true })
      const proceedVisible = await proceed.isVisible()
      const proceedEnabled = proceedVisible && await proceed.isEnabled()
      if (proceedEnabled) {
        debugLog(`captcha-accepted clicking-proceed url=${diagnosticUrl(page.url())}`)
        await proceed.click()
        await delay(250)
        continue
      }

      let visibleCaptchaFrames = 0
      for (const frame of page.frames()) {
        if (frame.isDetached()) continue
        const input = frame.locator('#li-antibot-answer')
        if (!await input.isVisible()) continue
        visibleCaptchaFrames++
        if (manual) break
        if (ai.enable === false) {
          fallback('Automatic CAPTCHA recognition is disabled')
          break
        }

        const image = frame.locator('#li-antibot-questions-container img')
        if (!await image.isVisible()) continue
        const bytes = await image.screenshot({ timeout: 5000 })
        const fingerprint = createHash('sha256').update(bytes).digest('hex')
        if (fingerprint !== lastObservedImage) {
          debugLog(`challenge-visible frame=${diagnosticUrl(frame.url())} fingerprint=${fingerprint.slice(0, 12)} bytes=${bytes.length}`)
          lastObservedImage = fingerprint
        }
        // Give the widget time to validate; never repeatedly submit the same image.
        if (fingerprint === lastImage) {
          if (Date.now() - lastSubmission > 10000) fallback('CAPTCHA validation did not succeed')
          break
        }
        if (attempts >= maxAttempts) {
          fallback('CAPTCHA recognition attempt limit reached')
          break
        }

        attempts++
        console.log(`Text CAPTCHA detected: Hugging Face attempt ${attempts}/${maxAttempts}`)
        debugLog(`recognition-start provider=${ai.space || 'default'} attempt=${attempts}`)
        try {
          const recognitionStartedAt = Date.now()
          const answer = await recognize(new Blob([bytes], { type: 'image/png' }), {
            ...ai,
            timeoutMs: Math.min(Number(ai.timeoutMs) || 30000, Math.max(1000, deadline - Date.now())),
          })
          debugLog(`recognition-result attempt=${attempts} elapsedMs=${Date.now() - recognitionStartedAt} answer=${JSON.stringify(answer)}`)
          // A user or the widget may have changed the challenge while inference ran.
          if (frame.isDetached() || !await input.isVisible()) {
            debugLog(`challenge-detached-before-submit attempt=${attempts}`)
            break
          }
          const currentImage = await image.screenshot({ timeout: 5000 })
          if (createHash('sha256').update(currentImage).digest('hex') !== fingerprint) {
            debugLog(`challenge-changed-before-submit attempt=${attempts}`)
            break
          }
          await input.fill(answer)
          await frame.locator('#li-antibot-validate').click()
          lastImage = fingerprint
          lastSubmission = Date.now()
          await delay(250)
          const validationNoteLocator = frame.locator('#li-antibot-check-note')
          const validationNote = await validationNoteLocator.count()
            ? await validationNoteLocator.innerText({ timeout: 1000 }).catch(() => '')
            : ''
          debugLog(`answer-submitted attempt=${attempts} validationNote=${JSON.stringify(validationNote.trim() || 'none')}`)
        } catch (error) {
          debugLog(`recognition-error attempt=${attempts} message=${JSON.stringify(error.message || String(error))}`)
          fallback(`Automatic CAPTCHA recognition failed: ${error.message || 'provider unavailable'}`)
        }
        break
      }

      if (debug && Date.now() >= nextHeartbeat) {
        const message = await captchaPageMessage(page)
        debugLog(`waiting elapsedMs=${Date.now() - startedAt} url=${diagnosticUrl(page.url())} frames=${page.frames().length} visibleCaptchaFrames=${visibleCaptchaFrames} proceedVisible=${proceedVisible} proceedEnabled=${proceedEnabled} pageMessage=${JSON.stringify(message)}`)
        nextHeartbeat = Date.now() + 5000
      }
      await delay(250)
    }
    throw new Error(`Timed out waiting for the booking step or manual CAPTCHA validation (selector=${JSON.stringify(selector)}, url=${diagnosticUrl(page.url())})`)
  } finally {
    if (debug) {
      page.off('response', onResponse)
      page.off('requestfailed', onRequestFailed)
    }
  }
}
