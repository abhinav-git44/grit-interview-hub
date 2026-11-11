// Student-facing copy. The first three are the "3 most important messages"
// required by the assignment and are rendered by the app exactly as written here.

export interface Msg { title: string; body: string; cta?: { label: string; to: string } }

export const MESSAGES = {
  // ── MESSAGE 1: ELIGIBILITY ──
  eligible: (): Msg => ({
    title: "You're eligible for your Track Badge interview!",
    body:
      "Congratulations! You've completed all the required skills for this track. You're now eligible to book your live interview.\n\n" +
      'Choose an available date and time that works for you to take the next step towards earning your badge.',
    cta: { label: 'Book Your Interview', to: 'student/book' },
  }),

  // ── MESSAGE 2: BOOKING CONFIRMATION ──
  bookingConfirmed: (v: { date: string; time: string; interviewer: string }): Msg => ({
    title: 'Your interview is confirmed!',
    body:
      'Your Track Badge interview has been successfully scheduled.\n\n' +
      `Date: ${v.date}\nTime: ${v.time}\nInterviewer: ${v.interviewer}\nMode: Online\n\n` +
      'Please join using the interview link at your scheduled time. We recommend joining 5 minutes early.',
    cta: { label: 'View Interview Details', to: 'student/interviews' },
  }),

  // ── MESSAGE 3: PASS RESULT ──
  pass: (): Msg => ({
    title: "Congratulations! You've passed your interview!",
    body:
      "You've successfully cleared your Track Badge interview. Your badge has been earned!\n\n" +
      'Your hard work and dedication have paid off. Keep progressing through GRIT and continue building your skills.',
    cta: { label: 'View Your Badge', to: 'student/badges' },
  }),

  // ── Contextual messages ──
  retake: (v: { badge: string; availableOn: string; feedback?: string }): Msg => ({
    title: 'Not this time — but you are close',
    body:
      `Your interviewer has recommended a retake for ${v.badge}. This is not a fail: your skills are cleared and your progress is safe.\n\n` +
      `You can book your next attempt from ${v.availableOn}. Use the time to work on the feedback below.` +
      (v.feedback ? `\n\nInterviewer feedback: “${v.feedback}”` : ''),
    cta: { label: 'See feedback', to: 'student/interviews' },
  }),
  fail: (v: { badge: string; availableOn: string; attemptsLeft: number }): Msg => ({
    title: 'Your interview result is in',
    body:
      `You didn't clear the ${v.badge} interview this time. Your cleared skills stay on your profile.\n\n` +
      (v.attemptsLeft > 0
        ? `You can book another attempt from ${v.availableOn} (${v.attemptsLeft} attempt${v.attemptsLeft === 1 ? '' : 's'} left). Review your feedback before booking.`
        : 'You have used all attempts for this badge this season. Contact the GRIT team if you believe this is a mistake.'),
    cta: { label: 'See feedback', to: 'student/interviews' },
  }),
  noShow: (v: { badge: string; availableOn: string }): Msg => ({
    title: 'You missed your interview',
    body: `We didn't see you at your ${v.badge} interview, so it has been marked as a no-show. You can book a new slot from ${v.availableOn}.`,
    cta: { label: 'Book again', to: 'student/book' },
  }),
  cancelled: (v: { when: string }): Msg => ({
    title: 'Your interview has been cancelled',
    body: `Your interview on ${v.when} has been cancelled. You can book a new slot whenever you're ready.`,
    cta: { label: 'Book a new slot', to: 'student/book' },
  }),
  rescheduled: (v: { from: string; to: string; interviewer: string }): Msg => ({
    title: 'Your interview has been rescheduled',
    body: `Your interview has moved from ${v.from} to ${v.to} with ${v.interviewer}. Your old slot has been released.`,
    cta: { label: 'View Interview Details', to: 'student/interviews' },
  }),
  interviewerUnavailable: (v: { when: string; newWhen?: string; newInterviewer?: string }): Msg =>
    v.newWhen
      ? { title: 'Your interviewer has changed', body: `Your original interviewer is unavailable. Your interview stays at ${v.newWhen}, now with ${v.newInterviewer}. Nothing else changes.`, cta: { label: 'View Interview Details', to: 'student/interviews' } }
      : { title: "We're sorry — your interview needs a new time", body: `Your interviewer became unavailable for ${v.when}. This was not your fault and does not count as an attempt. You have priority access to book a new slot.`, cta: { label: 'Pick a new slot', to: 'student/book' } },
  underReview: (v: { badge: string }): Msg => ({
    title: 'Your badge is under review',
    body: `Your ${v.badge} badge is being reviewed by the GRIT integrity team. This is a review, not a decision: your badge stays on your profile while it is under review. We'll tell you the outcome as soon as the review is complete.`,
  }),
  reinstated: (v: { badge: string }): Msg => ({
    title: 'Review closed — your badge stands',
    body: `The review of your ${v.badge} badge is complete and no action was taken. Your badge is fully active.`,
    cta: { label: 'View Your Badge', to: 'student/badges' },
  }),
  nullified: (v: { badge: string }): Msg => ({
    title: 'Your badge has been nullified',
    body: `After review, the GRIT integrity team confirmed a code-of-conduct violation linked to your ${v.badge} badge. The badge has been nullified and no longer counts towards your GRIT standing. If you'd like to appeal, reply to the email sent to your registered address within 7 days.`,
  }),
  nudge: (v: { badge: string }): Msg => ({
    title: 'Slots are filling up',
    body: `You're eligible for the ${v.badge} interview but haven't booked yet. Interview slots are limited — book yours now.`,
    cta: { label: 'Book Your Interview', to: 'student/book' },
  }),
};
