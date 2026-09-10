import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { huggingFaceAPI } from './huggingface.js'

// Wait for the requested booking step, solving a visible text CAPTCHA only.
export const waitForStep = async (page, selector, options = {}, recognize = huggingFaceAPI) => {
  const { headed = false, ai = {}, timeoutMs = headed ? 300000 : 90000 } = options
  const deadline = Date.now() + timeoutMs
  const maxAttempts = Math.min(3, Math.max(1, Math.floor(Number(ai.maxAttempts) || 2)))
  let attempts = 0
  let lastImage
  let lastSubmission = 0
  let manual = false

  const fallback = (reason) => {
    if (!headed) throw new Error(`${reason}. Retry with --headed for manual CAPTCHA entry.`)
    if (!manual) console.log(`${reason}. Solve the CAPTCHA manually in the browser.`)
    manual = true
  }

  while (Date.now() < deadline) {
    if (page.isClosed()) throw new Error('Browser closed while waiting for a booking step')
    if (await page.locator(selector).isVisible()) return

    // This button becomes enabled only after the site accepts the CAPTCHA.
    const proceed = page.getByRole('button', { name: 'Poursuivre la réservation', exact: true })
    if (await proceed.isVisible() && await proceed.isEnabled()) {
      await proceed.click()
      await delay(250)
      continue
    }

    for (const frame of page.frames()) {
      if (frame.isDetached()) continue
      const input = frame.locator('#li-antibot-answer')
      if (!await input.isVisible()) continue
      if (manual) break
      if (ai.enable === false) {
        fallback('Automatic CAPTCHA recognition is disabled')
        break
      }

      const image = frame.locator('#li-antibot-questions-container img')
      if (!await image.isVisible()) continue
      const bytes = await image.screenshot({ timeout: 5000 })
      const fingerprint = createHash('sha256').update(bytes).digest('hex')
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
      try {
        const answer = await recognize(new Blob([bytes], { type: 'image/png' }), {
          ...ai,
          timeoutMs: Math.min(Number(ai.timeoutMs) || 30000, Math.max(1000, deadline - Date.now())),
        })
        // A user or the widget may have changed the challenge while inference ran.
        if (frame.isDetached() || !await input.isVisible()) break
        const currentImage = await image.screenshot({ timeout: 5000 })
        if (createHash('sha256').update(currentImage).digest('hex') !== fingerprint) break
        await input.fill(answer)
        await frame.locator('#li-antibot-validate').click()
        lastImage = fingerprint
        lastSubmission = Date.now()
      } catch (error) {
        fallback(`Automatic CAPTCHA recognition failed: ${error.message || 'provider unavailable'}`)
      }
      break
    }
    await delay(250)
  }
  throw new Error('Timed out waiting for the booking step or manual CAPTCHA validation')
}
