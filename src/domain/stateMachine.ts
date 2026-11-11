import { audit, fail } from './core';
import type { DB, ID } from './types';

/**
 * One transition table per lifecycle dimension. Every status change in the
 * system goes through `transition()`, which rejects anything not listed here
 * and writes an audit record in the same transaction.
 */
export const TRANSITIONS = {
  slot: {
    OPEN: ['BOOKED', 'BLOCKED', 'REMOVED'],
    BOOKED: ['OPEN', 'BLOCKED'],          // OPEN on cancellation; BLOCKED when interviewer becomes unavailable
    BLOCKED: ['OPEN', 'REMOVED'],
    REMOVED: [],
  },
  booking: {
    BOOKED: ['RESCHEDULED', 'CANCELLED', 'COMPLETED'],
    RESCHEDULED: [], CANCELLED: [], COMPLETED: [],
  },
  interview: {
    SCHEDULED: ['IN_PROGRESS', 'CANCELLED', 'COMPLETED'], // COMPLETED directly only for no-shows
    IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
    COMPLETED: [], CANCELLED: [],
  },
  attendance: {
    PENDING: ['PRESENT', 'STUDENT_NO_SHOW', 'INTERVIEWER_NO_SHOW'],
    PRESENT: [], STUDENT_NO_SHOW: [], INTERVIEWER_NO_SHOW: [],
  },
  outcome: {
    PENDING: ['PASS', 'FAIL', 'RETAKE_LATER'],
    // Changing a submitted outcome is NOT a normal transition: it goes through
    // amendOutcome() (time window / admin + mandatory reason + revision history).
    PASS: [], FAIL: [], RETAKE_LATER: [],
  },
  badge: {
    EARNED: ['UNDER_REVIEW'],
    UNDER_REVIEW: ['EARNED', 'NULLIFIED'],
    NULLIFIED: [],
  },
  malpractice: {
    FLAGGED: ['UNDER_INVESTIGATION', 'DISMISSED'],
    UNDER_INVESTIGATION: ['CONFIRMED', 'DISMISSED'],
    CONFIRMED: [], DISMISSED: [],
  },
} as const;

export type Dimension = keyof typeof TRANSITIONS;

export function canTransition(dim: Dimension, from: string, to: string): boolean {
  const table = TRANSITIONS[dim] as Record<string, readonly string[]>;
  return (table[from] ?? []).includes(to);
}

export function transition<T extends { id: ID }, K extends keyof T>(
  db: DB, actorId: ID, dim: Dimension, entity: T, field: K, to: T[K], meta?: Record<string, unknown>,
): void {
  const from = entity[field] as unknown as string;
  if (!canTransition(dim, from, to as unknown as string)) {
    fail('INVALID_TRANSITION', `Cannot move ${dim} from ${from} to ${String(to)}`, { dim, from, to });
  }
  entity[field] = to;
  audit(db, actorId, `${dim}.${String(to).toLowerCase()}`, dim, entity.id, from, to, meta);
}
