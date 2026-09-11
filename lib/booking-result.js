export const reportBookingResult = status => {
  if (process.send && process.connected) process.send({ type: 'tennis-result', status })
}

export const classifyBookingResult = ({ exitCode, outcome, dryRun }) => {
  if (!dryRun && outcome === 'confirmed') return exitCode === 0 ? 'succeeded' : 'succeeded_with_warnings'
  if (dryRun && outcome === 'dry-run-cancelled' && exitCode === 0) return 'dry_run_succeeded'
  if (outcome === 'submitted') return 'needs_reconciliation'
  return exitCode === 0 && !outcome ? 'unavailable' : 'failed'
}
