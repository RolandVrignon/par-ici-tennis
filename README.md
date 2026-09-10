# par-ici-tennis (*Parisii tennis*)

Script to automatically book a tennis court in Paris (on https://tennis.paris.fr)

> "Par ici" mean "this way" in french. The "Parisii" were a Gallic tribe that dwelt on the banks of the river Seine. They lived on lands now occupied by the modern city of Paris. The project name can be interpreted as "For a Parisian tennis, follow this way"

**NOTE**: Text CAPTCHAs are recognized through a Hugging Face Space only when they appear. Recognition is best effort: public Spaces may sleep or become unavailable. Use the visible browser mode for manual fallback.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Get started](#get-started)
  - [Configuration](#configuration)
  - [CAPTCHA recognition](#captcha-recognition)
  - [Ntfy notifications (optional)](#ntfy-notifications-optional)
  - [Payment process](#payment-process)
  - [Running](#running)
    - [On your machine](#on-your-machine)
    - [Using GitHub Actions (beta)](#using-github-actions-beta)
- [Contributing](#contributing)
- [License](#license)

## Prerequisites
- Node.js >= 20.6.x
- A "carnet de réservation" in your Paris Tennis account for `Tarif plein` or `Tarif réduit`. No carnet is needed for an account eligible for `Gratuité` (see [Payment process](#payment-process)).

## Get started

### Configuration

Create `config.json` file from `config.json.sample` and complete with your preferences.

Never commit `config.json`: it contains your account credentials and is excluded by `.gitignore`.

- `location`: a list of courts ordered by preference - [full list](https://tennis.paris.fr/tennis/jsp/site/Portal.jsp?page=tennisParisien&view=les_tennis_parisiens)

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

- `priceType` an array containing price types you can book: `Tarif plein`, `Tarif réduit`, or `Gratuité`. Keep only the types available to your account; the labels must exactly match those displayed in the court's price description. For a free account, use `"priceType": ["Gratuité"]`.

- `courtType` an array containing court types you can book `Découvert` and/or `Couvert`

- `players` list of players 3 max (without you)

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

To enable ntfy notifications in script, add the following configuration to your `config.json`:

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

Before running a real booking, check that the dry-run reaches the payment step, logs `Free price detected` for `Gratuité`, and cancels successfully. Verify that no reservation remains in your Paris Tennis account.

You can start the script automatically using cron or equivalent

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
