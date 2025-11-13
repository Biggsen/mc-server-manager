import { SpinnerGap } from '@phosphor-icons/react'
import { useActiveAsyncActions } from '../../lib/asyncActionsContext'

export function ActiveActionIndicator() {
  const activeActions = useActiveAsyncActions()
  const activeCount = activeActions.length
  const latest = activeCount > 0 ? activeActions[activeCount - 1] : null

  const label = latest?.label ?? 'Idle'
  const statusLabel =
    activeCount === 0
      ? 'No active actions'
      : activeCount === 1
        ? `1 action in progress: ${label}`
        : `${activeCount} actions in progress. Latest: ${label}`

  return (
    <div
      className={`activity-indicator${activeCount > 0 ? ' is-active' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={statusLabel}
    >
      <span
        className={`activity-indicator__icon${activeCount > 0 ? ' is-spinning' : ''}`}
        aria-hidden="true"
      >
        <SpinnerGap size={18} weight="bold" />
      </span>
      <span className="activity-indicator__text">
        {label}
        {activeCount > 1 ? <span className="activity-indicator__count">+{activeCount - 1}</span> : null}
      </span>
    </div>
  )
}


