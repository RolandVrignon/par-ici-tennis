# par-ici-tennis (*Parisii tennis*)

Script to automatically book a tennis court in Paris (on https://tennis.paris.fr)

> "Par ici" mean "this way" in french. The "Parisii" were a Gallic tribe that dwelt on the banks of the river Seine. They lived on lands now occupied by the modern city of Paris. The project name can be interpreted as "For a Parisian tennis, follow this way"

**NOTE**: Text CAPTCHAs are recognized through a Hugging Face Space only when they appear. Recognition is best effort: public Spaces may sleep or become unavailable. Use the visible browser mode for manual fallback.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Get started](#get-started)
  - [Configuration](#configuration)
    - [Price types](#price-types)
    - [Example: free account](#example-free-account)
  - [CAPTCHA recognition](#captcha-recognition)
  - [Ntfy notifications (optional)](#ntfy-notifications-optional)
  - [Payment process](#payment-process)
  - [Running](#running)
    - [On your machine](#on-your-machine)
    - [Using Hermes and Telegram](#using-hermes-and-telegram)
    - [Using GitHub Actions (beta)](#using-github-actions-beta)
- [Contributing](#contributing)
- [License](#license)

## Prerequisites
- Node.js >= 20.6.x
- A "carnet de réservation" in your Paris Tennis account for `Tarif plein` or `Tarif réduit`. No carnet is needed for an account eligible for `Gratuité` (see [Payment process](#payment-process)).

## Get started

### Configuration

Configuration is split so stable secrets and account settings are never copied into temporary booking requests:

- Copy `config.fixed.json.sample` to `config.fixed.json` for `account`, `priceType`, `ai`, and `ntfy`.
- Copy `config.request.json.sample` to `config.request.json` for `date`, `locations`, `hours`, `courtType`, and `players`.

Never commit either local file. Both are excluded by `.gitignore`; keep `config.fixed.json` readable only by your user (`chmod 600 config.fixed.json`). Existing installations can split a legacy `config.json` with `npm run config:migrate`.

- `locations`: a list of courts ordered by preference - [full list](https://tennis.paris.fr/tennis/jsp/site/Portal.jsp?page=tennisParisien&view=les_tennis_parisiens)

You can use two formats for the `locations` field:

1) **Array format:**
  ```json
  "locations": [
    "Valeyre",
    "Suzanne Lenglen",
    "Poliveau"
  ]
  ```
  Use this if you want to search all courts at each location, in order of preference.

2) **Object format (with court numbers):**
  ```json
  "locations": {
    "Suzanne Lenglen": [5, 7, 11],
    "Henry de Montherlant": []
  }
  ```
  Use this if you want to specify court numbers for each location. An empty array means all courts at that location will be considered.

Choose the format that best matches your preferences.

- `date` (optional) a string representing a date formatted D/M/YYYY, do not set the date to automatically book 6 days in the future as soon as the reservation slots open

- `hours` a list of hours ordered by preference

- `priceType` an array containing the price types accepted for your booking (see [Price types](#price-types)).

- `courtType` an array containing court types you can book `Découvert` and/or `Couvert`

- `players` list of players 3 max (without you)

#### Price types

`Gratuité` is the new supported value for free bookings. Use the exact French label, including the capital letter and accent: `Gratuité`. Values such as `Gratuit`, `gratuit`, or `free` will not match the court listings.

| Exact `priceType` value | Account eligibility | Carnet required by the script |
| --- | --- | --- |
| `Tarif plein` | Full-price bookings | Yes, matching the price and court type |
| `Tarif réduit` | Reduced-price bookings | Yes, matching the price and court type |
| `Gratuité` | Free bookings enabled on the Paris Tennis account | No |

For a free account, set `"priceType": ["Gratuité"]`. This filters out paid courts. The setting does not grant free-booking eligibility: your Paris Tennis account must already have it.

Keep only the price types you want to accept in `config.fixed.json`. The order of `priceType` does not rank prices: every listed value is accepted.

#### Example: free account

Save the stable values in `config.fixed.json`:

```json
{
  "account": {
    "email": "your-email@example.com",
    "password": "YOUR_PARIS_TENNIS_PASSWORD"
  },
  "priceType": ["Gratuité"]
}
```

Save the booking preferences in `config.request.json`:

```json
{
  "locations": ["Valeyre", "Suzanne Lenglen"],
  "hours": ["18", "19"],
  "courtType": ["Couvert"],
  "players": [
    {
      "lastName": "PARTNER_LAST_NAME",
      "firstName": "PARTNER_FIRST_NAME"
    }
  ]
}
```

This example searches for a covered court six days ahead because `date` is omitted. It uses the default [CAPTCHA recognition](#captcha-recognition) settings and does not require a carnet. The `players` list contains your partners, not the account holder.

Start with `npm run start-dry-headed`. At the payment step, expect `Free price detected`, followed by cancellation. Check that your account has no new reservation before running `npm start` for a real booking. In a real free booking, the script selects the `Gratuité` card and then clicks `Etape suivante`.

### CAPTCHA recognition

The script uses [Nischay103/captcha_recognition](https://huggingface.co/spaces/Nischay103/captcha_recognition) when a supported LiveIdentity text CAPTCHA appears. It sends only the CAPTCHA image to this third-party Space, never your account credentials or the whole page. No Hugging Face request is made when there is no CAPTCHA.

```json
"ai": {
  "enable": true,
  "space": "Nischay103/captcha_recognition",
  "maxAttempts": 2,
  "timeoutMs": 30000
}
```

These are the defaults when `ai` is omitted. Set `enable` to `false` for manual entry only. An alternative Space must expose the Gradio `/predict` endpoint with an `input` image and a text result. Answers retain their original case and length. Attempts are capped at three and provider calls at 60 seconds.

CAPTCHA network requests are allowed in both browser modes. In `--headed` mode, failed recognition falls back to manual entry within the five-minute step timeout. In headless mode, failed recognition stops the run with an error. The script continues only after the site accepts the CAPTCHA; it does not support image-selection puzzles or guarantee unattended bookings.

If recognition fails after this run selected a court, the script attempts to release its temporary hold. It never automatically cancels a submitted reservation. Run `npm test` for local CAPTCHA regression tests and `npm run start-dry-headed` to validate against your account.

### Ntfy notifications (optional)

You can configure the script to send notifications with the reservation details and the ics file via [ntfy](https://ntfy.sh), a simple pub-sub notification service.

To receive notifications:
- Choose a unique topic name (e.g., `YOUR-UNIQUE-TOPIC-NAME` — choose something unique and hard to guess, as there is no password protection for subscriptions)
- Subscribe to your topic using the [ntfy mobile app](https://ntfy.sh/docs/subscribe/phone/) or [web interface](https://ntfy.sh/)

To enable ntfy notifications, add the following stable configuration to `config.fixed.json`:

```json
"ntfy": {
  "enable": true,
  "topic": "YOUR-UNIQUE-TOPIC-NAME"
}
```

Configuration options:
- `enable`: set to `true` to enable ntfy notifications
- `topic`: your unique ntfy topic name chosen previously
- `domain` (optional): custom ntfy server domain (`ntfy.sh` used if empty)

Notification example:

![Notification example](doc/ntfy.png)

### Payment process

For `Tarif plein` and `Tarif réduit`, you need a "carnet de réservation" that matches your `priceType` & `courtType` [combination](https://tennis.paris.fr/tennis/jsp/site/Portal.jsp?page=rate&view=les_tarifs) selected previously.

For an account eligible for `Gratuité`, no carnet is required. The script detects `Gratuité` in the payment summary, selects the free price card to activate the "Etape suivante" button, and clicks that button without directly accessing the paid payment field. Dry-run mode cancels the booking before confirmation for both free and paid bookings.

### Running

#### <ins>On your machine</ins>

To run this project locally, install the dependencies

```sh
npm install
```

and run the script:

```sh
npm start
```

To test your configuration, you can run this project in dry-run mode. It will check court availability but no reservations will be made:

```sh
npm run start-dry
```

To observe the dry-run in a visible browser, with slower interactions:

```sh
npm run start-dry-headed
```

In visible browser mode, you can solve the CAPTCHA manually if automatic recognition fails. The script waits up to five minutes for each login, search, or booking step.

For detailed troubleshooting logs without displaying account credentials or player names, run:

```sh
npm run start-dry-debug
```

Combine the detailed logs with a visible browser by running `npm run start-dry-headed-debug`. Debug mode reports booking-step transitions, sanitized URLs, CAPTCHA network responses, challenge fingerprints, recognition results, validation messages, and dry-run cancellation status.

Debug mode also saves the exact CAPTCHA images sent to Hugging Face under `img/captcha/`, with the run timestamp, browser mode, and attempt number. It reports their load state and dimensions so you can check whether headless mode captured a complete image. These local files are ignored by Git.

After the widget reports `Vérifié avec succès`, the script waits for the next booking step instead of treating the success image as another CAPTCHA. Headless submission includes a short pause after filling the answer, matching the visible mode's input-to-submit interval. A `La réponse est incorrecte` message still means the widget rejected the answer; recognition is not guaranteed in either mode.

Before running a real booking, check that the dry-run reaches the payment step, logs `Free price detected` for `Gratuité`, and cancels successfully. Verify that no reservation remains in your Paris Tennis account.

You can start the script automatically using cron or equivalent

#### <ins>Manage clubs, reservations and scheduled requests</ins>

The CLI is shared by local use and Hermes on the VPS. Commands return JSON on stdout; diagnostics go to stderr. Prefix with `node scripts/tennis.js` when a machine consumer needs JSON without npm's banner.

```sh
npm run clubs:list
npm run clubs:list -- --arrondissement 18
npm run clubs:find -- --query "max rousie"
npm run reservations:list
```

The club catalogue is fetched from Paris Tennis on every command. It includes official IDs, exact search labels, arrondissement, address and courts. Accents/case are ignored when matching (`max rousie` becomes `Max Rousié`). A unique partial match is allowed; ambiguous matches and spelling suggestions require choosing an exact name. Preparation validates clubs and stores their IDs/labels; execution rechecks the current search catalogue. Order and court-number preferences are preserved. Max Rousié belongs to the **17th arrondissement** in the official catalogue.

`reservations:list` reads the account's **Ma réservation** page, including `details` and whether cancellation is available. It only needs `config.fixed.json` (legacy `config.json` still works). The current site exposes a single current-reservation page; unfamiliar layouts fail explicitly rather than reporting an empty account. Returned `reservation-...` IDs are fingerprints of the displayed details, not official confirmation numbers.

Cancel a specific account reservation using the ID from the live list:

```sh
# Preview: does not submit anything
npm run reservations:cancel -- --id reservation-<fingerprint>
# Cancel the identified reservation and verify the account afterward
npm run reservations:cancel -- --id reservation-<fingerprint> --confirm
```

A changed/missing reservation or disabled cancellation stops the command. The CLI uses the site's confirmation form and verifies the empty-account result. On an uncertain result, inspect the account before retrying. Add `--headed` to account commands for manual CAPTCHA entry if needed. The cancellation flow has local simulated-form coverage; an empty live account does not validate cancelling a real booking.

Future booking **requests** are separate from confirmed account reservations:

```sh
npm run booking:list
npm run booking:manage -- show --request-id <id>
npm run booking:manage -- edit --request-id <id> --input /path/to/request.json
npm run booking:manage -- cancel --request-id <id>
```

Editing requires a complete variable request and keeps the same date/cron attachment. Changing the date requires cancelling and scheduling a new request. Cancelling a pending request disables execution and keeps its audit record; remove its attached Hermes cron too. It never cancels a reservation on Paris Tennis. `cleanup` is only for unscheduled prepared requests.

The runner refuses replays of completed/cancelled requests and serializes booking/cancellation operations. It recalculates Europe/Paris offsets across DST. A confirmed booking followed by an ICS error is `succeeded_with_warnings`, never a failed reservation. `dry_run_succeeded` requires verified cancellation; `needs_reconciliation` means the account must be checked before another attempt. A stale `.operation-lock` requires checking the process/account before removal.

State defaults to `~/.local/state/par-ici-tennis/bookings`; override with `TENNIS_BOOKING_STATE_DIR`. `TENNIS_FIXED_CONFIG_PATH`, `HERMES_HOME`, `HERMES_SCRIPTS_DIR`, and `TENNIS_NODE_BINARY` are supported. Linux Hermes wrappers use `flock`; the CLI itself also runs on macOS. Keep one shared state directory per account.

#### <ins>Using Hermes and Telegram</ins>

Install or update the versioned skill on the VPS:

```sh
cd /home/rolexx/par-ici-tennis
npm run hermes:install
```

The installer backs up the previous `SKILL.md` before replacing it. The source is [skills/tennis-booking/SKILL.md](skills/tennis-booking/SKILL.md). It supports requests such as:

- “Quels clubs dans le 18e ?”
- “Est-ce que Max Rousié existe ?”
- “Liste mes réservations confirmées.”
- “Annule ma réservation de mardi à 18 h.”
- “Décale l'heure de ma demande programmée à 19 h.”

For a new booking, Hermes resolves the official club, collects date/hours/court types/partners, and uses the user's confirmed intent before scheduling. The helper prepares at 07:55 Europe/Paris, then launches the booking at 08:00, six calendar days before the court date. Browser launch and login happen after that launch time; a booking at precisely 08:00 is not guaranteed. One-shot Hermes jobs run with `no_agent=true` and deliver their result to the originating Telegram chat. The temporary full configuration is created with mode 600 immediately before execution and deleted afterward. No Telegram message or cron is created by installing the skill.

#### <ins>Using GitHub Actions (beta)</ins>

> [!IMPORTANT]
> Due to GitHub Actions limitations during high load on their servers, scheduled triggers may not run exactly at 08:00. Improvements are in progress to make the booking more reliable even with a slight delay.
>
> For perfect timing, consider using your [own server or computer](#On-your-machine).

You can automate the booking using GitHub Actions workflows. The repository includes pre-configured workflows:

1. **[Fork this repository](https://github.com/bertrandda/par-ici-tennis/fork)** to your own GitHub account (if you find this repository useful, you can also give it a star ⭐)

2. **Configure GitHub secrets and variables:**
   - Go to your repository Settings → Secrets and variables → Actions
   - Add the following **secrets**:
     - `ACCOUNT_EMAIL`: your Paris Tennis email
     - `ACCOUNT_PASSWORD`: your Paris Tennis password
     - `NTFY_TOPIC`: (optional) your ntfy topic for notifications
     - `NTFY_DOMAIN`: (optional) custom ntfy server domain if you don't use `ntfy.sh`
   - Add a **variable**:
     - `CONFIG_JSON`: the content of your `config.json` file (⚠️ without account credentials and ntfy config for security reasons). Without date line to always book 6 days in advance

3. **Enable workflow:**
   - The day before you want to execute the script, go to the Actions tab and enable the `Tennis booking` workflow
   - The workflow runs the following day at 08:00 Paris time and automatically disables itself after running to avoid restarting on subsequent days
   - Manually re-enable it from the Actions tab when you need to book again

To test Github Actions config you can start `Tennis booking dry-run` workflow manually. It will check court availability but no reservations will be made.

## Contributing

Contributions and bug reports are welcome! Please open an [issue](https://github.com/bertrandda/par-ici-tennis/issues) or submit a [pull request](https://github.com/bertrandda/par-ici-tennis/pulls).

## License

MIT
