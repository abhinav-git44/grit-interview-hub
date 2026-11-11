import type { DB, ID, NotificationType, Notification, Policies } from './types';

// ── Errors ─────────────────────────────────────────────────
export type ErrorCode =
  | 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID_TRANSITION' | 'VALIDATION' | 'NOT_ELIGIBLE'
  | 'SLOT_TAKEN' | 'SLOT_IN_PAST' | 'ALREADY_BOOKED' | 'CUTOFF_PASSED' | 'OVERLAP'
  | 'HAS_BOOKINGS' | 'INACTIVE' | 'DUPLICATE' | 'CONFLICT' | 'COOLDOWN' | 'LIMIT_REACHED';

export class DomainError extends Error {
  constructor(public code: ErrorCode, message: string, public details?: unknown) { super(message); this.name = 'DomainError'; }
}
export const fail = (code: ErrorCode, message: string, details?: unknown): never => { throw new DomainError(code, message, details); };

// ── Clock (injectable so tests and the demo can control "now") ──
let clockOffsetMs = 0;
let fixedNow: number | null = null;
export const clock = {
  now: (): Date => new Date(fixedNow ?? Date.now() + clockOffsetMs),
  set: (d: Date | null) => { fixedNow = d ? d.getTime() : null; },
  shift: (ms: number) => { clockOffsetMs = ms; },
};
export const nowISO = () => clock.now().toISOString();
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

// ── IDs ────────────────────────────────────────────────────
export function nextId(db: DB, prefix: string): ID { db.seq += 1; return `${prefix}_${db.seq.toString(36).padStart(4, '0')}`; }

// ── Defaults (ILLUSTRATIVE ASSUMPTIONS — not confirmed GRIT policy; editable in Admin → Settings) ──
export const DEFAULT_POLICIES: Policies = {
  interviewDurationMin: 30,
  slotBufferMin: 10,
  minBookingLeadHours: 2,
  cancelRescheduleCutoffHours: 12,
  maxReschedulesPerBooking: 2,
  retakeCooldownDays: 5,
  failCooldownDays: 14,
  maxAttemptsPerBadge: 3,
  studentNoShowCountsAsAttempt: true,
  studentNoShowCooldownDays: 3,
  outcomeEditWindowHours: 24,
  bookingHorizonDays: 21,
};

// ── Audit + notifications (always written inside the same transaction as the change) ──
export function audit(db: DB, actorId: ID, action: string, entityType: string, entityId: ID,
  oldValue?: unknown, newValue?: unknown, metadata?: Record<string, unknown>) {
  db.auditLogs.push({ id: nextId(db, 'aud'), actorId, action, entityType, entityId, oldValue, newValue, metadata, createdAt: nowISO() });
}

export function notify(db: DB, userId: ID, type: NotificationType, msg: { title: string; body: string; cta?: Notification['cta'] }) {
  // Delivery is decoupled from the business change: a failed delivery never rolls back a booking/result.
  const failed = !!db.simulateNotificationFailure;
  db.notifications.push({
    id: nextId(db, 'ntf'), userId, type, ...msg, isRead: false,
    deliveryStatus: failed ? 'FAILED' : 'DELIVERED', createdAt: nowISO(),
  });
}

// ── Lookups ────────────────────────────────────────────────
export function must<T>(v: T | undefined, what: string): T { if (v === undefined) fail('NOT_FOUND', `${what} not found`); return v as T; }
export const getUser = (db: DB, id: ID) => must(db.users.find(u => u.id === id), 'User');
export const getStudent = (db: DB, id: ID) => must(db.students.find(s => s.id === id), 'Student');
export const getInterviewer = (db: DB, id: ID) => must(db.interviewers.find(i => i.id === id), 'Interviewer');
export const studentByUser = (db: DB, userId: ID) => db.students.find(s => s.userId === userId);
export const interviewerByUser = (db: DB, userId: ID) => db.interviewers.find(i => i.userId === userId);
export const getBadgeDef = (db: DB, id: ID) => must(db.badgeDefs.find(b => b.id === id), 'Badge');
export const getSlot = (db: DB, id: ID) => must(db.slots.find(s => s.id === id), 'Slot');
export const getBooking = (db: DB, id: ID) => must(db.bookings.find(b => b.id === id), 'Booking');
export const getAttempt = (db: DB, id: ID) => must(db.attempts.find(a => a.id === id), 'Interview');
export const nameOf = (db: DB, userId: ID) => db.users.find(u => u.id === userId)?.fullName ?? 'Unknown';
export const studentName = (db: DB, studentId: ID) => { const s = db.students.find(x => x.id === studentId); return s ? nameOf(db, s.userId) : 'Unknown student'; };
export const interviewerName = (db: DB, id: ID) => { const i = db.interviewers.find(x => x.id === id); return i ? nameOf(db, i.userId) : 'Unknown interviewer'; };
export const badgeLabel = (db: DB, badgeDefId: ID) => {
  const b = db.badgeDefs.find(x => x.id === badgeDefId); if (!b) return 'Badge';
  const t = db.tracks.find(x => x.id === b.trackId); return `${t?.name ?? ''} · ${b.level}`;
};
