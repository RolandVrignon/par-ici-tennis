import { chromium } from 'playwright'
import { loadAccountConfig } from './config.js'
import { waitForStep } from './captcha.js'

export const SITE_ROOT = 'https://tennis.paris.fr/tennis/'
export const siteUrl = query => `${SITE_ROOT}jsp/site/Portal.jsp?${query}`

export const withSitePage = async (operation, { headed = false, authenticate = false, config, ...options } = {}) => {
  const browser = await chromium.launch({ headless: !headed, slowMo: headed ? 250 : 0, timeout: 90000 })
  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(30000)
    if (authenticate) {
      const accountConfig = config || loadAccountConfig()
      await page.goto(siteUrl('page=tennis&view=start&full=1'))
      await page.click('#button_suivi_inscription')
      await page.fill('#username', accountConfig.account?.email || process.env.ACCOUNT_EMAIL || '')
      await page.fill('#password', accountConfig.account?.password || process.env.ACCOUNT_PASSWORD || '')
      await page.click('#form-login >> button')
      await waitForStep(page, '.main-informations', { ...options, headed, ai: accountConfig.ai })
    }
    return await operation(page)
  } finally {
    await browser.close()
  }
}
