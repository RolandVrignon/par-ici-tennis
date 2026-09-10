import { chromium } from 'playwright'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'
import { writeFileSync } from 'fs'
import { createEvent } from 'ics'
import { config } from './staticFiles.js'
import { notify } from './lib/ntfy.js'
import { waitForStep } from './lib/captcha.js'

dayjs.extend(customParseFormat)

const bookTennis = async () => {
  const DRY_RUN_MODE = process.argv.includes('--dry-run')
  const HEADED_MODE = process.argv.includes('--headed')
  const captchaOptions = { headed: HEADED_MODE, ai: config.ai }
  if (DRY_RUN_MODE) {
    console.log('----- DRY RUN START -----')
    console.log('Script lancé en mode DRY RUN. Afin de tester votre configuration, une recherche va être lancé mais AUCUNE réservation ne sera réalisée')
  }

  console.log(`${dayjs().format()} - Starting searching tennis`)
  const browser = await chromium.launch({
    headless: !HEADED_MODE,
    slowMo: HEADED_MODE ? 250 : 0,
    timeout: 90000,
  })

  console.log(`${dayjs().format()} - Browser started`)
  const page = await browser.newPage()
  let canAbortBooking = false
  page.setDefaultTimeout(90000)
  try {
    await page.goto('https://tennis.paris.fr/tennis/jsp/site/Portal.jsp?page=tennis&view=start&full=1')

    await page.click('#button_suivi_inscription')
    await page.fill('#username', config?.account?.email || process.env.ACCOUNT_EMAIL)
    await page.fill('#password', config?.account?.password || process.env.ACCOUNT_PASSWORD)
    await page.click('#form-login >> button')

    // wait for login redirection before continue
    await waitForStep(page, '.main-informations', captchaOptions)

    console.log(`${dayjs().format()} - User connected`)

    const locations = !Array.isArray(config.locations) ? Object.keys(config.locations) : config.locations
    locationsLoop:
    for (const [i, location] of locations.entries()) {
      const logLocation = process.env.GITHUB_ACTIONS ? `location ${i + 1}` : location
      console.log(`${dayjs().format()} - Search at ${logLocation}`)
      await page.goto('https://tennis.paris.fr/tennis/jsp/site/Portal.jsp?page=recherche&view=recherche_creneau#!')

      // select tennis location
      await waitForStep(page, '.tokens-input-text', captchaOptions)
      await page.locator('.tokens-input-text').pressSequentially(`${location} `)
      await page.waitForSelector(`.tokens-suggestions-list-element >> text="${location}"`)
      await page.click(`.tokens-suggestions-list-element >> text="${location}"`)

      // select date
      await page.click('#when')
      const date = config.date ? dayjs(config.date, 'D/MM/YYYY') : dayjs().add(6, 'days')
      await page.waitForSelector(`[dateiso="${date.format('DD/MM/YYYY')}"]`)
      await page.click(`[dateiso="${date.format('DD/MM/YYYY')}"]`)
      await page.waitForSelector('.date-picker', { state: 'hidden' })

      await page.click('#rechercher')

      // wait until the results page is fully loaded before continue
      await page.waitForLoadState('domcontentloaded')

      let selectedHour
      hoursLoop:
      for (const hour of config.hours) {
        const dateDeb = `[datedeb="${date.format('YYYY/MM/DD')} ${hour}:00:00"]`
        if (await page.locator(dateDeb).count()) {
          if (await page.isHidden(dateDeb)) {
            await page.click(`#head${location.replaceAll(' ', '')}${hour}h .panel-title`)
          }

          const courtNumbers = !Array.isArray(config.locations) ? config.locations[location] : []
          const slots = await page.locator(dateDeb).all()
          for (const slot of slots) {
            const bookSlotButton = `[courtid="${await slot.getAttribute('courtid')}"]${dateDeb}`
            if (courtNumbers.length > 0) {
              const courtName = (await page.locator(`.court:left-of(${bookSlotButton})`).innerText()).trim()
              if (!courtNumbers.includes(parseInt(courtName.match(/Court N°(\d+)/)[1]))) {
                continue
              }
            }

            const [priceType, courtType] = (await page.locator(`.row.tennis-court:has(${bookSlotButton})`).locator('.price-description').innerHTML()).split('<br>')
            if (!config.priceType.includes(priceType) || !config.courtType.includes(courtType)) {
              continue
            }
            selectedHour = hour
            await page.click(bookSlotButton)
            canAbortBooking = true

            break hoursLoop
          }
        }
      }

      if (await page.title() !== 'Paris | TENNIS - Reservation') {
        console.log(`${dayjs().format()} - Failed to find reservation for ${logLocation}`)
        continue
      }

      await waitForStep(page, '.order-steps-infos h2 >> text="1 / 3 - Validation du court"', captchaOptions)

      for (const [i, player] of config.players.entries()) {
        if (i > 0) {
          await page.click('.addPlayer')
        }
        await page.waitForSelector(`[name="player${i + 1}"]`)
        await page.fill(`[name="player${i + 1}"] >> nth=0`, player.lastName)
        await page.fill(`[name="player${i + 1}"] >> nth=1`, player.firstName)
      }

      await page.keyboard.press('Enter')

      await waitForStep(page, '.order-steps-infos h2 >> text="2 / 3 - Mode de paiement"', captchaOptions)
      await page.waitForSelector('.priceTable')

      const paymentSummary = await page.locator('.priceTable').innerText()
      const isFreeBooking = paymentSummary.includes('Gratuité')

      if (!isFreeBooking) {
        const paymentMode = page.locator('#order_select_payment_form #paymentMode')
        await paymentMode.waitFor({ state: 'attached' })
        await paymentMode.evaluate(el => {
          el.removeAttribute('readonly')
          el.style.display = 'block'
        })
        await paymentMode.fill('existingTicket')
      } else {
        console.log(`${dayjs().format()} - Free price detected`)
      }

      if (DRY_RUN_MODE) {
        console.log(`${dayjs().format()} - Fausse réservation faite : ${logLocation}`)
        if (!process.env.GITHUB_ACTIONS) console.log(`pour le ${date.format('YYYY/MM/DD')} à ${selectedHour}h`)
        console.log('----- DRY RUN END -----')
        console.log('Pour réellement réserver un crénau, relancez le script sans le paramètre --dry-run')

        await page.click('#previous')
        const [cancelResponse] = await Promise.all([
          page.waitForResponse(response => response.url().endsWith('/tennis/rest/abortBooking') && response.request().method() === 'POST'),
          page.click('#btnCancelBooking'),
        ])
        if (!cancelResponse.ok()) throw new Error('Dry-run cancellation failed')
        canAbortBooking = false

        break locationsLoop
      }

      if (isFreeBooking) {
        await page.locator('.priceTable .price-item[paymentMode="free"]').click()
        canAbortBooking = false
        await page.locator('.step-two #submit:not(.disabled)').click()
      } else {
        const submit = page.locator('#order_select_payment_form #envoyer')
        await submit.evaluate(el => el.classList.remove('hide'))
        canAbortBooking = false
        await submit.click()
      }

      await page.waitForSelector('.confirmReservation')

      // Extract reservation details
      const address = (await page.locator('.address').textContent()).trim().replace(/( ){2,}/g, ' ')
      const dateStr = (await page.locator('.date').textContent()).trim().replace(/( ){2,}/g, ' ')
      const court = (await page.locator('.court').textContent()).trim().replace(/( ){2,}/g, ' ')

      if (!process.env.GITHUB_ACTIONS) {
        console.log(`${dayjs().format()} - Réservation faite : ${address}`)
        console.log(`pour le ${dateStr}`)
        console.log(`sur le ${court}`)
      } else {
        console.log('Réservation faite, regardez vos emails ou rendez-vous sur votre compte tennis.paris.fr pour plus de détails sur votre réservation.')
      }

      const [day, month, year] = [date.date(), date.month() + 1, date.year()]
      const hourMatch = dateStr.match(/(\d{2})h/)
      const hour = hourMatch ? Number(hourMatch[1]) : 12
      const start = [year, month, day, hour, 0]
      const duration = { hours: 1, minutes: 0 }
      const event = {
        start,
        duration,
        title: 'Réservation Tennis',
        description: `Court: ${court}\nAdresse: ${address}`,
        location: address,
        status: 'CONFIRMED',
      }

      const createdEvent = createEvent(event)
      if (createdEvent.error) {
        console.log('ICS creation error:', createdEvent.error)

        break
      }

      const { value } = createdEvent
      if (!process.env.GITHUB_ACTIONS) {
        writeFileSync('event.ics', value)
      }
      if (config.ntfy?.enable === true || process.env.NTFY_TOPIC) {
        await notify(Buffer.from(value, 'utf8'), 'event.ics',
          `Confirmation pour le ${date.format('DD/MM/YYYY')} - ${hour}h`, {
            domain: config?.ntfy?.domain || process.env.NTFY_DOMAIN,
            topic: config?.ntfy?.topic || process.env.NTFY_TOPIC,
          })
      }

      break
    }
  } catch (e) {
    console.log(e)
    process.exitCode = 1
    if (!page.isClosed()) {
      const screenshot = await page.screenshot({ path: 'img/failure.png' })

      // Release only this run's temporary hold, never a submitted reservation.
      if (canAbortBooking) {
        try {
          const response = await page.request.post('https://tennis.paris.fr/tennis/rest/abortBooking', { timeout: 10000 })
          console.log(response.ok() ? 'Pending booking abandoned after failure' : 'Could not abandon the pending booking; check your account')
        } catch {
          console.log('Could not abandon the pending booking; check your account')
        }
      }

      if (config.ntfy?.enable === true || process.env.NTFY_TOPIC) {
        await notify(screenshot, 'failure.png', 'Erreur lors de l\'execution du programme.', {
          domain: config?.ntfy?.domain || process.env.NTFY_DOMAIN,
          topic: config?.ntfy?.topic || process.env.NTFY_TOPIC,
        })
      }
    }
  } finally {
    await browser.close()
  }
}

bookTennis()
