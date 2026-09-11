#!/usr/bin/env bash

set -u -o pipefail

REPOSITORY_DIR="/home/rolexx/par-ici-tennis"
NODE_BINARY="/home/rolexx/.local/share/fnm/aliases/default/bin/node"
EXPECTED_PARIS_DATE="2026-09-15"
LOG_DIRECTORY="${REPOSITORY_DIR}/logs"
LOG_FILE="${LOG_DIRECTORY}/booking-2026-09-21.log"
LOCK_FILE="/tmp/par-ici-tennis-booking.lock"

check_prerequisites() {
  local required_file

  if [[ ! -x "${NODE_BINARY}" ]]; then
    echo "ERROR: Node.js executable not found: ${NODE_BINARY}" >&2
    return 1
  fi

  for required_file in config.fixed.json config.request.json index.js scripts/wait-8-am.js; do
    if [[ ! -f "${REPOSITORY_DIR}/${required_file}" ]]; then
      echo "ERROR: Missing required file: ${REPOSITORY_DIR}/${required_file}" >&2
      return 1
    fi
  done

  return 0
}

if [[ "${1:-}" == "--check" ]]; then
  check_prerequisites || exit 1
  "${NODE_BINARY}" --check "${REPOSITORY_DIR}/index.js" || exit 1
  "${NODE_BINARY}" --check "${REPOSITORY_DIR}/scripts/wait-8-am.js" || exit 1
  echo "Cron launcher check passed. Booking was not started."
  exit 0
fi

/usr/bin/mkdir -p "${LOG_DIRECTORY}"
exec >> "${LOG_FILE}" 2>&1

echo "$(/usr/bin/date --iso-8601=seconds) - Cron launcher started"

check_prerequisites || exit 1

CURRENT_PARIS_DATE="$(TZ=Europe/Paris /usr/bin/date +%F)"
if [[ "${CURRENT_PARIS_DATE}" != "${EXPECTED_PARIS_DATE}" ]]; then
  echo "$(/usr/bin/date --iso-8601=seconds) - Skipped: expected Paris date ${EXPECTED_PARIS_DATE}, got ${CURRENT_PARIS_DATE}"
  exit 0
fi

exec 9> "${LOCK_FILE}"
if ! /usr/bin/flock -n 9; then
  echo "$(/usr/bin/date --iso-8601=seconds) - Skipped: another booking process holds the lock"
  exit 0
fi

cd "${REPOSITORY_DIR}" || exit 1

# Cron wakes the launcher at 07:45 Paris time. The existing waiter releases it
# at exactly 08:00, when courts six days ahead become available.
"${NODE_BINARY}" scripts/wait-8-am.js
WAIT_STATUS=$?

if [[ ${WAIT_STATUS} -ne 0 ]]; then
  echo "$(/usr/bin/date --iso-8601=seconds) - Waiting step failed with status ${WAIT_STATUS}"
  exit "${WAIT_STATUS}"
fi

# Run the same headless browser path validated by `npm run start-dry`.
"${NODE_BINARY}" index.js --debug
BOOKING_STATUS=$?

echo "$(/usr/bin/date --iso-8601=seconds) - Booking process finished with status ${BOOKING_STATUS}"
exit "${BOOKING_STATUS}"
