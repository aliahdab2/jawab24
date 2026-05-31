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

| Notification Type | Trigger | Channels |
|-------------------|---------|----------|
| Payment Failed | Stripe webhook `invoice.payment_failed` | Push + In-App |
| Subscription Expiring | 3 days before expiry (cron) | Push + In-App |
| Page Disconnected | Facebook API error (token expired) | Push + In-App |
| New Lead | Lead captured (customer shared a phone) — first time per sender only | Push (gated by per-user `newLeadAlertsEnabled`) + In-App |

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
