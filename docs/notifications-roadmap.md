# Jawab24 Notification System Roadmap

This document outlines the notification system architecture, implementation phases, and best practices for Jawab24.

## Overview

Jawab24 is an **automation service** - users trust it to handle social media responses automatically. The notification strategy focuses on **critical alerts only** to avoid notification fatigue while ensuring users never miss important events.

### Design Principles

1. **Minimal Interruption** - Only notify for truly important events
2. **User Control** - Let users configure their preferences
3. **Bilingual Support** - All notifications in Arabic and English
4. **Reliability** - Critical alerts must always be delivered

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        NOTIFICATION SYSTEM                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Event Triggers              Notification Service         Delivery       │
│  ──────────────              ────────────────────         ────────       │
│                                                                          │
│  ┌──────────────┐           ┌─────────────────┐         ┌─────────┐    │
│  │ Stripe       │──────────►│                 │────────►│ FCM     │    │
│  │ Webhooks     │           │   Notification  │         │ (Push)  │    │
│  └──────────────┘           │   Service       │         └─────────┘    │
│                              │                 │                         │
│  ┌──────────────┐           │  - Validate     │         ┌─────────┐    │
│  │ Facebook     │──────────►│  - Store in DB  │────────►│ Email   │    │
│  │ API Errors   │           │  - Send Push    │         │ (Future)│    │
│  └──────────────┘           │  - Send Email   │         └─────────┘    │
│                              │                 │                         │
│  ┌──────────────┐           └─────────────────┘         ┌─────────┐    │
│  │ Cron Jobs    │──────────────────┬───────────────────►│ In-App  │    │
│  │ (Daily)      │                  │                    │ Center  │    │
│  └──────────────┘                  ▼                    └─────────┘    │
│                              ┌───────────┐                              │
│                              │ PostgreSQL│                              │
│                              │ (Storage) │                              │
│                              └───────────┘                              │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Push Notifications** | Firebase Cloud Messaging (FCM) | Free, reliable, handles Android + iOS |
| **Email** | Resend or SendGrid (Phase 2) | Simple API, good deliverability |
| **In-App** | PostgreSQL + REST API | Already in stack, no new dependencies |
| **Mobile Plugin** | @capacitor/push-notifications | Official Capacitor plugin |

---

## Database Schema

### device_tokens
Stores FCM tokens for each user's devices.

```sql
CREATE TABLE device_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    platform VARCHAR(20) NOT NULL, -- 'android', 'ios', 'web'
    created_at TIMESTAMP DEFAULT NOW(),
    last_used_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, token)
);

CREATE INDEX idx_device_tokens_user_id ON device_tokens(user_id);
```

### notifications
Stores all notifications for in-app display and history.

```sql
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL, -- 'payment_failed', 'subscription_expiring', etc.
    title_en TEXT NOT NULL,
    title_ar TEXT NOT NULL,
    body_en TEXT NOT NULL,
    body_ar TEXT NOT NULL,
    data JSONB, -- Deep link info, metadata
    read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id, read) WHERE read = FALSE;
```

### notification_preferences (Phase 2)
User preferences for notification types.

```sql
CREATE TABLE notification_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    payment_alerts BOOLEAN DEFAULT TRUE,
    subscription_alerts BOOLEAN DEFAULT TRUE,
    page_disconnect_alerts BOOLEAN DEFAULT TRUE,
    daily_summary BOOLEAN DEFAULT FALSE,
    quiet_hours_start TIME, -- e.g., '22:00'
    quiet_hours_end TIME,   -- e.g., '08:00'
    updated_at TIMESTAMP DEFAULT NOW()
);
```

---

## Implementation Phases

### Phase 1: Critical Alerts (Current)
**Goal:** Notify users of events that require immediate action.

| Notification Type | Trigger | Channels | Status |
|-------------------|---------|----------|--------|
| Payment Failed | Stripe webhook `invoice.payment_failed` | Push + In-App + **Email** (hosted-invoice pay link; once per failure episode) | ✅ live — email via `services/dunningNotices.ts` (webhook + daily catch-up sweep) |
| Service Suspended (unpaid renewal) | `customer.subscription.deleted` (involuntary) OR past_due grace expiry (daily sweep) | **Email** | ✅ live — `services/dunningNotices.ts` |
| Payment Recovered | `invoice.payment_succeeded` closing an open failure episode | **Email** | ✅ live — `services/dunningNotices.ts` |
| Page Disconnected | Facebook API error (token expired) | Push + In-App | ✅ live — but **not** fired on the Facebook-revoked path (see below) |
| New Lead | Lead captured (customer shared a phone) — first time per sender only | Push (gated by per-user `newLeadAlertsEnabled`) + In-App | ✅ live |
| Subscription Expiring | 3 days before expiry (cron) | Push + In-App | ❌ **NOT IMPLEMENTED** |
| Trial Ending | 3 days before `trial_ends_at` (daily cron) | Push + In-App + **Email** | ✅ live — `services/trialReminders.ts` |
| Trial Ended ("last try") | after `trial_ends_at` passes (daily cron, ≤ `ENDED_LOOKBACK_DAYS` back) | Push + In-App + **Email** | ✅ live — `services/trialReminders.ts` (`runTrialEndedNotices`) |

> ✅ **Trial Ending shipped 2026-07-31.** `runTrialEndingReminders()` runs once a day (registered
> in `index.ts` beside the lead digest, first run 7 min after boot). It selects `trialing`
> subscriptions whose `trial_ends_at` falls in the next 3 days, sends the `trial_ending` in-app
> notification (which the frontend already deep-links to `/pricing`) plus a bilingual reminder
> email, then stamps `subscriptions.trial_ending_notified_at`.
>
> Three properties worth knowing before changing it:
> - **One reminder per trial, not per day.** The stamp is the whole idempotency mechanism; the
>   query skips stamped rows. Remove it and the daily cadence warns each merchant three times.
> - **No backfill, by design (owner's ruling).** The window bound is `trial_ends_at > now`, so an
>   already-expired trial is never in the result set. Relaxing that bound would have emailed all
>   30 silently-expired trials at once.
> - **Email is the second channel and best-effort.** A failed send is captured but not retried,
>   because retrying it tomorrow would re-send the bell row too. A failed *in-app* notification
>   is the retryable case: the row stays un-stamped.
>
> ⚠️ **`subscription_expiring` (paid renewals) is still missing** — it has finished bilingual
> templates in `services/notifications.ts` and frontend deep-linking, but the only caller is the
> demo seeder (`plugins/demo/seedData.ts`). Paid-subscription expiry remains lazy, evaluated on
> read (`services/subscriptions.ts` flips status when someone fetches the subscription), and the
> sole merchant-facing signal is `auto_reply_paused_billing` — fired *reactively* on the next
> inbound message **after** expiry, i.e. only once a real customer has already gone unanswered.
>
> Measured impact that motivated the trial job (prod, 2026-07-31): **30 of 52 `trialing`
> subscriptions were already past `trial_ends_at`, and all 30 had sent zero replies in the
> preceding 14 days** — silent churn. Those 30 were deliberately NOT warned retroactively.
>
> `services/trialReminders.ts` is now the shape to copy for `subscription_expiring`.
>
> ✅ **Trial Ended shipped 2026-08-04** (same file, `runTrialEndedNotices`, second daily sweep
> staggered 2 min behind the reminder). The "last try" conversion touch: once `trial_ends_at`
> has passed and the reply gate has closed — expired no-payment-method trials now hard-stop at
> `trial_ends_at` with no grace — it sends the `trial_ended` in-app notification + bilingual
> email and stamps `subscriptions.trial_ended_notified_at` (migration 0152). It exists because
> `auto_reply_paused_billing` is reactive (fires on the next inbound message), so a merchant
> nobody writes to was never told their replies stopped. Same idempotency and channel semantics
> as the reminder; its no-backfill guard is the `ENDED_LOOKBACK_DAYS` (3-day) lookback bound —
> long-expired trials are never noticed retroactively, however long the job was down.
>
> ⚠️ Do **not** conflate this with `auto_reply_disabled_reason = 'trial_block'`, which is the
> per-channel anti-abuse ledger applied at *connect* time and has nothing to do with a
> subscription trial ending.

> ⚠️ **`page_disconnected` has a blind spot.** It fires on Graph API token errors, but *not*
> when Facebook simply stops returning a page from `/me/accounts` (the merchant deselected it
> in Meta's permission dialog). That path — in `services/pages.ts` — clears the access token
> and deliberately nulls `auto_reply_disabled_reason`, so the page goes silent with no
> notification and no recorded reason. See "Why a Page Went Quiet" in `SYSTEM_ANALYSIS.md`
> for the full discriminator table.

**Deliverables:**
- [x] Database schema (device_tokens, notifications)
- [x] Backend notification service
- [x] FCM integration with user language preference
- [x] API endpoints for token registration
- [x] Frontend push permission + registration
- [x] In-app notification bell with unread count
- [x] Backend tests (service + routes)
- [x] Frontend tests (NotificationBell component)
- [x] Bilingual push notifications (uses user's dashboardLanguage)

### Phase 2: User Preferences & Email
**Goal:** Give users control and add email channel.

| Feature | Description |
|---------|-------------|
| Notification Preferences UI | Toggle each notification type on/off |
| Quiet Hours | No push during specified hours |
| Email Notifications | Backup channel for critical alerts |
| Daily Summary Email | Optional digest of activity |

**Deliverables:**
- [ ] notification_preferences table
- [ ] Settings page UI for preferences
- [ ] Email service integration (Resend/SendGrid)
- [ ] Daily summary cron job

### Phase 3: Advanced Features
**Goal:** Enhance engagement and reliability.

| Feature | Description |
|---------|-------------|
| Web Push | Notifications for web users |
| Notification History | View past notifications in app |
| Smart Timing | Send when user is most active (ML) |
| Localized Templates | Dynamic content with placeholders |

---

## API Endpoints

### POST /notifications/register-token
Register a device's FCM token.

```json
// Request
{
  "token": "fcm_token_here",
  "platform": "android" // or "ios", "web"
}

// Response
{ "success": true }
```

### GET /notifications
Get user's notifications (paginated).

```json
// Response
{
  "notifications": [
    {
      "id": "uuid",
      "type": "payment_failed",
      "title": "Payment Failed",
      "body": "Your payment could not be processed.",
      "read": false,
      "createdAt": "2024-01-15T10:30:00Z",
      "data": { "action": "/settings/billing" }
    }
  ],
  "unreadCount": 3,
  "total": 15
}
```

### PATCH /notifications/:id/read
Mark a notification as read.

### GET /notifications/unread-count
Get unread notification count for badge.

```json
{ "count": 3 }
```

---

## Notification Templates

### Payment Failed
```
English:
  Title: "Payment Failed"
  Body: "We couldn't process your payment. Please update your payment method to continue using Jawab24."

Arabic:
  Title: "فشل الدفع"
  Body: "لم نتمكن من معالجة الدفع. يرجى تحديث طريقة الدفع لمواصلة استخدام Jawab24."
```

### Subscription Expiring
```
English:
  Title: "Subscription Expiring Soon"
  Body: "Your subscription expires in {days} days. Renew now to avoid service interruption."

Arabic:
  Title: "اشتراكك ينتهي قريباً"
  Body: "ينتهي اشتراكك خلال {days} أيام. جدد الآن لتجنب انقطاع الخدمة."
```

### Page Disconnected
```
English:
  Title: "Page Disconnected"
  Body: "Your page '{pageName}' has been disconnected. Please reconnect to resume auto-replies."

Arabic:
  Title: "تم فصل الصفحة"
  Body: "تم فصل صفحتك '{pageName}'. يرجى إعادة الاتصال لاستئناف الرد التلقائي."
```

---

## Best Practices

### 1. Batching
Don't send a notification for every single event. Batch similar events:
```
❌ "New comment" x 50 times
✅ "You have 50 new comments in the last hour"
```

### 2. Quiet Hours
Respect user's sleep/work schedule. Don't send non-critical notifications during quiet hours.

### 3. Deep Links
Every notification should have a clear action:
```json
{
  "data": {
    "action": "/settings/billing",
    "type": "payment_failed"
  }
}
```

### 4. Fallback Channels
If push fails, fall back to email for critical alerts.

### 5. Token Hygiene
- Remove invalid tokens when FCM returns errors
- Update `last_used_at` on each successful send
- Clean up tokens not used in 90+ days

---

## Firebase Setup Requirements

### 1. Firebase Console
- Create a Firebase project
- Enable Cloud Messaging
- Download `google-services.json` (Android)
- Download `GoogleService-Info.plist` (iOS)

### 2. Backend
- Generate a service account key (JSON)
- Store securely (environment variable or secrets manager)
- Initialize `firebase-admin` SDK

### 3. Android
- Place `google-services.json` in `frontend/android/app/`
- The `build.gradle` is already configured for Google Services

### 4. iOS (Future)
- Place `GoogleService-Info.plist` in iOS project
- Configure APNs in Firebase Console

---

## Android Notification Channels & the Urgent Custom Sound

Three Android channels are created at app startup (`Jawab24Application.java`) and the
backend addresses them by id (`notifications.ts`). The id sent **must** match a channel
that exists on the device, or Android 8+ silently drops the push.

| Channel id | Importance | Sound | Used for |
|------------|-----------|-------|----------|
| `jawab24_default` | DEFAULT | system | routine pushes (replies, billing, leads) |
| `jawab24_urgent` | HIGH | system (default) | urgent pushes — heads-up, **legacy** |
| `jawab24_urgent_v2` | HIGH | **custom** (`urgent_alert`) | urgent pushes with the distinct bad-comment sound |

A push is "urgent" when `data.urgent === true` (offensive / high-stakes comments + DMs).
Urgent pushes also get a short, separate 60s rate-limit window (`URGENT_PUSH_COOLDOWN_SECONDS`)
so a second *distinct* bad comment still alerts, and a fire-and-forget counter
`metrics:notif:urgent_push:{type}` for volume monitoring.

### Why a `_v2` channel
An Android channel's sound is **immutable after creation**. `jawab24_urgent` already exists
on installed devices with the default sound, so the custom sound had to go on a new channel id.

### Deploy flag: `ANDROID_URGENT_SOUND`
Gates which Android channel the backend addresses for urgent pushes (`resolveUrgentChannelId`):

| Value | Channel | When |
|-------|---------|------|
| unset / `false` (default) | `jawab24_urgent` | safe for all app versions — **keep here until the new Android app is adopted** |
| `true` | `jawab24_urgent_v2` | flip **only after** the app version that creates `jawab24_urgent_v2` is widely installed |

> Flipping it on too early means urgent pushes are silently dropped on not-yet-updated Android
> devices. iOS is unaffected — an unknown `aps.sound` falls back to the default tone, so the
> iOS custom sound (`urgent_alert.caf`) activates automatically once the app updates.
> Once the flip is permanent, a later app version can delete the legacy `jawab24_urgent` channel.

---

## Monitoring & Metrics

Track these metrics to ensure notification health:

| Metric | Target | Alert If |
|--------|--------|----------|
| Push delivery rate | > 95% | < 90% |
| Token registration success | > 99% | < 95% |
| Notification open rate | > 30% | < 15% |
| Unsubscribe rate | < 5% | > 10% |

---

## Security Considerations

1. **Token Storage** - FCM tokens are sensitive; store encrypted at rest
2. **Rate Limiting** - Limit token registration to prevent abuse
3. **Validation** - Validate all notification payloads server-side
4. **User Consent** - Always ask permission before sending push notifications

---

## Testing Strategy

### Backend Tests

**Location:** `backend/test/services/notifications.test.ts` and `backend/test/routes/notifications.test.ts`

#### Service Tests (`notifications.test.ts`)
| Test Area | Coverage |
|-----------|----------|
| Template validation | All templates have bilingual content (AR/EN) |
| Token registration | Insert new tokens, update existing tokens |
| Token removal | Delete user tokens |
| Notification storage | Store notifications in database |
| Template interpolation | Replace `{variable}` placeholders |
| Notification retrieval | Pagination, unread count |
| Mark as read | Single notification, all notifications |
| Unread count | Count accuracy, zero case |

#### Route Tests (`notifications.test.ts`)
| Endpoint | Test Cases |
|----------|------------|
| `POST /register-token` | Success, missing token, invalid platform, no auth |
| `POST /remove-token` | Success, missing token |
| `GET /notifications` | Success, pagination, limit cap |
| `GET /unread-count` | Count returned |
| `PATCH /:id/read` | Mark single as read |
| `POST /mark-all-read` | Mark all as read |

### Frontend Tests

**Location:** `frontend/test/components/NotificationBell.test.tsx`

| Test Case | Description |
|-----------|-------------|
| Render | Bell icon renders correctly |
| Badge visible | Shows count when > 0 |
| Badge cap | Shows "99+" when count > 99 |
| Badge hidden | No badge when count = 0 |
| No fetch without token | Doesn't call API if user not logged in |
| API headers | Sends correct Authorization header |
| Error handling | Graceful degradation on API/network errors |
| Auto-refresh | Polls for updates periodically |

### Running Tests

```bash
# All tests
npm run test

# Backend only
cd backend && npm run test

# Frontend only
cd frontend && npm run test

# Specific test file
cd backend && npm run test -- notifications
```

### Mock Strategy

1. **Database** - Mock Drizzle `db` object to avoid real DB calls
2. **Firebase Admin** - Mock `firebase-admin` to avoid real FCM calls
3. **Fetch** - Mock `global.fetch` for frontend API calls
4. **Zustand Store** - Mock `useStore` to control auth state

### Coverage Goals

| Area | Target | Notes |
|------|--------|-------|
| Service logic | 90%+ | All public methods covered |
| Routes | 80%+ | Happy path + error cases |
| Frontend components | 70%+ | Render + interaction tests |

---

## Timeline Estimate

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1 | 2-3 days | Firebase project setup |
| Phase 2 | 3-5 days | Email provider account |
| Phase 3 | 5-7 days | Phase 1 & 2 complete |

---

## References

- [Firebase Cloud Messaging Docs](https://firebase.google.com/docs/cloud-messaging)
- [Capacitor Push Notifications](https://capacitorjs.com/docs/apis/push-notifications)
- [FCM Best Practices](https://firebase.google.com/docs/cloud-messaging/concept-options)
