// Core entity types. Each lifecycle dimension has its own field/entity —
// nothing is collapsed into one status column. The student-facing "journey
// state" is DERIVED from these (see derive.ts), never stored.

export type Role = 'STUDENT' | 'INTERVIEWER' | 'ADMIN';
export type ID = string;
export type ISO = string; // ISO-8601 timestamp (UTC)

export interface User {
  id: ID; fullName: string; email: string; role: Role; isActive: boolean;
  /** Admin permission flags (prototype stand-in for a permissions table) */
  permissions?: { reviewMalpractice?: boolean; editSettings?: boolean };
}

export interface Student { id: ID; userId: ID; studentCode: string; campus: string; batch: number; timezone: string; }
export interface Interviewer { id: ID; userId: ID; employeeCode: string; specialization: string; isActive: boolean; timezone: string; }

export interface Track { id: ID; name: string; description: string; }
/** One track has several badge LEVELS; each level has its own skill requirements and its own interview. */
export interface BadgeDefinition { id: ID; trackId: ID; level: string; name: string; order: number; }
export interface Skill { id: ID; trackId: ID; name: string; }
export interface BadgeSkillRequirement { badgeDefId: ID; skillId: ID; }

export type SkillStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'CLEARED';
export interface SkillProgress { studentId: ID; skillId: ID; status: SkillStatus; clearedAt?: ISO; }

// ── Scheduling ──────────────────────────────────────────────
export interface AvailabilityWindow {
  id: ID; interviewerId: ID; startAt: ISO; endAt: ISO;
  /** recurring windows are expanded into one row per week, linked by seriesId */
  seriesId?: ID; createdAt: ISO; removedAt?: ISO;
}
export type SlotStatus = 'OPEN' | 'BOOKED' | 'BLOCKED' | 'REMOVED';
export interface Slot { id: ID; interviewerId: ID; windowId: ID; startAt: ISO; endAt: ISO; status: SlotStatus; }

export type BookingStatus = 'BOOKED' | 'RESCHEDULED' | 'CANCELLED' | 'COMPLETED';
export interface Booking {
  id: ID; studentId: ID; badgeDefId: ID; slotId: ID; status: BookingStatus;
  bookedAt: ISO; meetingLink: string; idempotencyKey?: string;
  rescheduledFromId?: ID; rescheduledToId?: ID; rescheduleCount: number;
  cancelledAt?: ISO; cancelledBy?: ID; cancellationReason?: string;
  /** set when the system had to cancel (interviewer unavailable) → student gets priority rebooking */
  priorityRebook?: boolean;
  /** eligibility is evaluated & locked (grandfathered) at booking time */
  eligibilitySnapshotAt: ISO;
}

// ── Interview attempts ─────────────────────────────────────
export type InterviewStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type AttendanceStatus = 'PENDING' | 'PRESENT' | 'STUDENT_NO_SHOW' | 'INTERVIEWER_NO_SHOW';
export type Outcome = 'PENDING' | 'PASS' | 'FAIL' | 'RETAKE_LATER';
export interface Scores { technical: number; communication: number; problemSolving: number; }
export interface OutcomeRevision { outcome: Outcome; feedback: string; changedAt: ISO; changedBy: ID; reason?: string; }
export interface InterviewAttempt {
  id: ID; bookingId: ID; studentId: ID; badgeDefId: ID; interviewerId: ID; attemptNumber: number;
  interviewStatus: InterviewStatus; attendance: AttendanceStatus; outcome: Outcome;
  scores?: Scores; feedback?: string; startedAt?: ISO; submittedAt?: ISO; submittedBy?: ID;
  revisions: OutcomeRevision[]; createdAt: ISO;
}

// ── Badges & malpractice ───────────────────────────────────
export type BadgeStatus = 'EARNED' | 'UNDER_REVIEW' | 'NULLIFIED';
export interface BadgeEvent { at: ISO; by: ID; from?: BadgeStatus; to: BadgeStatus; note: string; }
export interface StudentBadge {
  id: ID; studentId: ID; badgeDefId: ID; attemptId: ID; status: BadgeStatus;
  earnedAt: ISO; nullifiedAt?: ISO; history: BadgeEvent[];
}
export type CaseStatus = 'FLAGGED' | 'UNDER_INVESTIGATION' | 'CONFIRMED' | 'DISMISSED';
export interface CaseEvent { at: ISO; by: ID; action: string; note?: string; }
export interface MalpracticeCase {
  id: ID; studentId: ID; studentBadgeId: ID; reportedBy: ID; description: string; evidenceRef: string;
  status: CaseStatus; decisionReason?: string; reviewedBy?: ID; reviewedAt?: ISO; createdAt: ISO; timeline: CaseEvent[];
}

// ── Comms, audit, config ───────────────────────────────────
export type NotificationType =
  | 'ELIGIBLE' | 'BOOKING_CONFIRMED' | 'RESULT_PASS' | 'RESULT_FAIL' | 'RESULT_RETAKE'
  | 'NO_SHOW' | 'CANCELLED' | 'RESCHEDULED' | 'INTERVIEWER_UNAVAILABLE' | 'BADGE_UNDER_REVIEW'
  | 'BADGE_REINSTATED' | 'BADGE_NULLIFIED' | 'REMINDER' | 'NUDGE';
export interface Notification {
  id: ID; userId: ID; type: NotificationType; title: string; body: string; cta?: { label: string; to: string };
  isRead: boolean; deliveryStatus: 'DELIVERED' | 'FAILED' | 'QUEUED'; createdAt: ISO;
}
export interface AuditLog {
  id: ID; actorId: ID; action: string; entityType: string; entityId: ID;
  oldValue?: unknown; newValue?: unknown; metadata?: Record<string, unknown>; createdAt: ISO;
}

export interface Policies {
  interviewDurationMin: number;
  slotBufferMin: number;
  minBookingLeadHours: number;
  cancelRescheduleCutoffHours: number;
  maxReschedulesPerBooking: number;
  retakeCooldownDays: number;
  failCooldownDays: number;
  maxAttemptsPerBadge: number;
  studentNoShowCountsAsAttempt: boolean;
  studentNoShowCooldownDays: number;
  outcomeEditWindowHours: number;
  bookingHorizonDays: number;
}

export interface DB {
  version: number;
  users: User[]; students: Student[]; interviewers: Interviewer[];
  tracks: Track[]; badgeDefs: BadgeDefinition[]; skills: Skill[]; badgeSkillReqs: BadgeSkillRequirement[];
  skillProgress: SkillProgress[];
  windows: AvailabilityWindow[]; slots: Slot[]; bookings: Booking[]; attempts: InterviewAttempt[];
  studentBadges: StudentBadge[]; malpracticeCases: MalpracticeCase[];
  notifications: Notification[]; auditLogs: AuditLog[];
  policies: Policies;
  /** demo-only: lets the showcase simulate a notification channel failure */
  simulateNotificationFailure?: boolean;
  seq: number;
}
