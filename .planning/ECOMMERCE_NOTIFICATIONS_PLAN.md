# E-Commerce Customer Notifications — Implementation Plan

> Compete with LetsBot: abandoned cart recovery, order status notifications,
> review requests, digital product delivery, and merchant-configurable templates.
>
> **Channel strategy:** SMS (Vonage) now → WhatsApp Cloud API when approved by Meta.

---

## Table of Contents

1. [New Webhook Events](#1-new-webhook-events)
2. [Database Schema](#2-database-schema)
3. [Notification Delivery Service](#3-notification-delivery-service)
4. [Feature 1: Abandoned Cart Recovery](#4-abandoned-cart-recovery)
5. [Feature 2: Order Status Notifications](#5-order-status-notifications)
6. [Feature 3: Review Request Messages](#6-review-request-messages)
7. [Feature 4: Digital Product Delivery](#7-digital-product-delivery)
8. [Merchant Dashboard UI](#8-merchant-dashboard-ui)
9. [WhatsApp Migration Path](#9-whatsapp-migration-path)
10. [Implementation Order](#10-implementation-order)

---

## 1. New Webhook Events

### Current State

| Platform | Current Events | Missing Events |
|----------|---------------|----------------|
| **Salla** | product.created/deleted/price/status/quantity, app.uninstalled | `order.created`, `order.updated`, `order.shipping.update`, `order.completed`, `cart.abandoned` |
| **Shopify** | products/create/update/delete, app/uninstalled | `orders/create`, `orders/updated`, `orders/fulfilled`, `carts/create`, `carts/update` |
| **Zid** | product.created/updated/deleted, app.uninstalled | `order.created`, `order.updated`, `order.shipped`, `order.delivered` |

### New Events to Register

**Salla** — add to `SALLA_WEBHOOK_EVENTS` in `backend/src/services/salla.ts`:
```typescript
// Existing events stay unchanged, add:
'order.created',
'order.updated',           // status changes (processing, shipped, delivered)
'order.shipping.update',   // tracking number assigned
'order.completed',         // delivery confirmed
'abandoned.cart',          // Salla fires this when cart is idle for X minutes
```

**Shopify** — add to webhook registration in `backend/src/services/shopify.ts`:
```typescript
'orders/create',     // new order placed
'orders/updated',    // status change
'orders/fulfilled',  // shipped / tracking assigned
// Shopify doesn't have a native abandoned cart webhook.
// Use: poll /admin/api/2025-01/checkouts.json?updated_at_min=... via cron
// OR use Shopify Flow + webhook to fire on cart abandonment.
```

**Zid** — add to `ZID_WEBHOOK_EVENTS` in `backend/src/services/zid.ts`:
```typescript
'order.created',
'order.updated',
'order.shipped',
'order.delivered',
// Zid abandoned cart: check API docs — may need polling similar to Shopify
```

### Scopes

Current scopes already include `orders.read_write` (Salla) and `read_orders` + `read_fulfillments` (Shopify). No scope changes needed.

---

## 2. Database Schema

### New Table: `customer_notification_templates`

Merchant-configurable message templates per store with variable support.

```sql
CREATE TABLE customer_notification_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ecommerce_store_id UUID NOT NULL REFERENCES ecommerce_stores(id) ON DELETE CASCADE,

    -- Template type
    notification_type VARCHAR(50) NOT NULL,
    -- Types: 'abandoned_cart', 'order_confirmed', 'order_shipped',
    --        'order_delivered', 'review_request', 'digital_delivery'

    -- Channel: 'sms' now, 'whatsapp' later, 'both' for fallback
    channel VARCHAR(20) NOT NULL DEFAULT 'sms',

    -- Bilingual message templates with variable placeholders
    message_ar TEXT NOT NULL,  -- Arabic template
    message_en TEXT NOT NULL,  -- English template
    -- Variables: {customer_name}, {order_number}, {product_name},
    --            {tracking_number}, {tracking_url}, {store_name},
    --            {total_amount}, {coupon_code}, {review_url},
    --            {download_url}

    -- Behavior
    is_enabled BOOLEAN DEFAULT true,
    delay_minutes INTEGER DEFAULT 0,     -- delay before sending (e.g., 60 for abandoned cart)

    -- Optional coupon (abandoned cart)
    include_coupon BOOLEAN DEFAULT false,
    coupon_code VARCHAR(50),
    coupon_discount VARCHAR(20),          -- e.g., "10%" or "20 SAR"

    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),

    UNIQUE(ecommerce_store_id, notification_type)
);

CREATE INDEX idx_cust_notif_templates_store ON customer_notification_templates(ecommerce_store_id);
CREATE INDEX idx_cust_notif_templates_type ON customer_notification_templates(notification_type);
```

### New Table: `customer_notifications_log`

Track every notification sent to customers for analytics and deduplication.

```sql
CREATE TABLE customer_notifications_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ecommerce_store_id UUID NOT NULL REFERENCES ecommerce_stores(id) ON DELETE CASCADE,

    -- What triggered it
    notification_type VARCHAR(50) NOT NULL,
    platform_event_id VARCHAR(255),        -- platform's event/order ID for dedup

    -- Who received it
    customer_phone VARCHAR(20) NOT NULL,
    customer_name VARCHAR(255),

    -- What was sent
    channel VARCHAR(20) NOT NULL,          -- 'sms' | 'whatsapp'
    message_sent TEXT NOT NULL,

    -- Result
    status VARCHAR(20) DEFAULT 'pending',  -- 'pending' | 'sent' | 'delivered' | 'failed'
    provider_message_id VARCHAR(255),      -- Vonage/WhatsApp message ID
    error_message TEXT,

    -- Context
    order_number VARCHAR(50),
    cart_total VARCHAR(50),

    -- Timing
    scheduled_at TIMESTAMP,                -- when it should be sent (for delayed msgs)
    sent_at TIMESTAMP,                     -- when actually sent
    created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_cust_notif_log_store ON customer_notifications_log(ecommerce_store_id);
CREATE INDEX idx_cust_notif_log_phone ON customer_notifications_log(customer_phone);
CREATE INDEX idx_cust_notif_log_status ON customer_notifications_log(status);
CREATE INDEX idx_cust_notif_log_type_event ON customer_notifications_log(notification_type, platform_event_id);
CREATE INDEX idx_cust_notif_log_scheduled ON customer_notifications_log(status, scheduled_at)
    WHERE status = 'pending';
```

### Default Templates (seeded on store connection)

```typescript
const DEFAULT_TEMPLATES = {
    abandoned_cart: {
        message_ar: 'مرحباً {customer_name}! لسا عندك منتجات بالسلة بقيمة {total_amount}. كمل طلبك الحين 🛒',
        message_en: 'Hi {customer_name}! You left items worth {total_amount} in your cart. Complete your order now 🛒',
        delay_minutes: 60,
    },
    order_confirmed: {
        message_ar: '{customer_name}، تم تأكيد طلبك #{order_number} بنجاح ✅ شكراً لتسوقك من {store_name}',
        message_en: '{customer_name}, your order #{order_number} is confirmed ✅ Thank you for shopping at {store_name}',
        delay_minutes: 0,
    },
    order_shipped: {
        message_ar: '{customer_name}، طلبك #{order_number} تم شحنه 🚚 رقم التتبع: {tracking_number}',
        message_en: '{customer_name}, your order #{order_number} has been shipped 🚚 Tracking: {tracking_number}',
        delay_minutes: 0,
    },
    order_delivered: {
        message_ar: '{customer_name}، طلبك #{order_number} تم توصيله ✅ نتمنى تعجبك المنتجات!',
        message_en: '{customer_name}, your order #{order_number} has been delivered ✅ We hope you love it!',
        delay_minutes: 0,
    },
    review_request: {
        message_ar: '{customer_name}، كيف كانت تجربتك مع {product_name}؟ شاركنا رأيك ⭐ {review_url}',
        message_en: '{customer_name}, how was your experience with {product_name}? Share your review ⭐ {review_url}',
        delay_minutes: 2880, // 48 hours after delivery
    },
    digital_delivery: {
        message_ar: '{customer_name}، منتجك الرقمي جاهز! حمله من هنا: {download_url}',
        message_en: '{customer_name}, your digital product is ready! Download here: {download_url}',
        delay_minutes: 0,
    },
};
```

---

## 3. Notification Delivery Service

### New File: `backend/src/services/customerNotifications.ts`

This service handles all customer-facing notifications (distinct from the existing
`notifications.ts` which handles merchant/internal notifications).

```
┌──────────────┐     ┌────────────────────┐     ┌─────────────┐
│  Webhook     │────▶│ customerNotifications│────▶│  smsService │──▶ Vonage
│  Handler     │     │  .schedule()        │     │  .send()    │
└──────────────┘     └────────┬───────────┘     └─────────────┘
                              │                         │
                              ▼                         ▼ (Phase 3)
                     ┌────────────────┐         ┌─────────────┐
                     │  BullMQ Queue  │         │  WhatsApp   │
                     │  (delayed jobs)│         │  Cloud API  │
                     └────────────────┘         └─────────────┘
```

### Key Methods

```typescript
class CustomerNotificationService {
    // Schedule a notification (immediate or delayed)
    async schedule(params: {
        storeId: string;
        type: NotificationType;
        customerPhone: string;
        customerName: string;
        variables: Record<string, string>;
        platformEventId?: string;  // for deduplication
    }): Promise<void>;

    // Process a scheduled notification (called by worker)
    async send(notificationLogId: string): Promise<void>;

    // Cancel pending notifications (e.g., customer completes cart)
    async cancel(storeId: string, type: string, customerPhone: string): Promise<void>;

    // Replace variables in template
    private renderTemplate(template: string, variables: Record<string, string>): string;

    // Detect customer language (from phone prefix or platform data)
    private detectLanguage(phone: string, platformLocale?: string): 'ar' | 'en';
}
```

### BullMQ Queue for Delayed Messages

```typescript
// New file: backend/src/lib/customerNotificationQueue.ts
import { Queue } from 'bullmq';

export const CUSTOMER_NOTIFICATION_QUEUE = 'customer-notifications';

export const customerNotificationQueue = new Queue(CUSTOMER_NOTIFICATION_QUEUE, {
    connection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600 },  // 1 hour
        removeOnFail: 200,
    },
});

// Worker: backend/src/workers/customerNotificationWorker.ts
// Processes delayed jobs (e.g., abandoned cart after 60 min)
```

### Deduplication

Before scheduling, check `customer_notifications_log` for existing entry with
same `(notification_type, platform_event_id)`. Skip if already sent/pending.

---

## 4. Abandoned Cart Recovery

### Flow

```
Customer abandons cart
        │
        ▼
Salla webhook: abandoned.cart ──────────────────────────┐
Shopify: cron polls /checkouts.json every 15 min ──────┤
Zid: webhook or cron (check API docs) ─────────────────┘
        │
        ▼
Backend receives event with:
  - customer_phone (from cart/checkout data)
  - customer_name
  - cart items + total amount
  - cart recovery URL (platform provides this)
        │
        ▼
customerNotifications.schedule({
    type: 'abandoned_cart',
    delay: template.delay_minutes (default: 60 min),
    variables: { customer_name, total_amount, coupon_code }
})
        │
        ▼
BullMQ delayed job (60 min)
        │
        ▼
Before sending: check if order was placed in the meantime
  - If order exists for same phone → cancel notification
  - If no order → send SMS
        │
        ▼
SMS sent via smsService.send()
Log result in customer_notifications_log
```

### Salla Abandoned Cart Webhook Payload (expected)

```json
{
    "event": "abandoned.cart",
    "data": {
        "id": 12345,
        "customer": {
            "first_name": "أحمد",
            "mobile": "+966500000000"
        },
        "items": [
            { "name": "قميص أزرق", "quantity": 1, "price": 120 }
        ],
        "total": { "amount": 120, "currency": "SAR" },
        "recovery_url": "https://store.salla.sa/cart/recover/abc123"
    }
}
```

### Shopify Abandoned Cart (Polling)

Shopify doesn't fire abandoned cart webhooks natively. Options:

1. **Cron job** — poll `GET /admin/api/2025-01/checkouts.json?updated_at_min=...` every 15 min
2. **Shopify Flow** — merchant configures a Shopify Flow that fires a webhook to our endpoint
3. Start with option 1 (no merchant setup needed)

Shopify checkout object includes `email`, `phone`, `abandoned_checkout_url`.

### Cancellation Logic

When `order.created` webhook fires, check `customer_notifications_log` for pending
`abandoned_cart` entries for that phone → cancel them via `customerNotifications.cancel()`.

---

## 5. Order Status Notifications

### Flow

```
Order event webhook (created/shipped/delivered)
        │
        ▼
Extract: order_number, status, customer_phone, customer_name,
         tracking_number (if shipped), tracking_url
        │
        ▼
Map status to notification type:
  - order created   → 'order_confirmed'
  - order shipped   → 'order_shipped'
  - order delivered  → 'order_delivered'
        │
        ▼
Check template is_enabled for this type
        │
        ▼
customerNotifications.schedule({
    type: mapped_type,
    delay: 0 (immediate),
    variables: { customer_name, order_number, tracking_number, ... }
})
        │
        ▼
SMS sent immediately
```

### Platform Status Mapping

| Platform | Event / Status | Maps To |
|----------|---------------|---------|
| **Salla** | `order.created` | `order_confirmed` |
| **Salla** | `order.updated` + status=`in_transit` | `order_shipped` |
| **Salla** | `order.shipping.update` | `order_shipped` (with tracking) |
| **Salla** | `order.completed` | `order_delivered` |
| **Shopify** | `orders/create` | `order_confirmed` |
| **Shopify** | `orders/fulfilled` | `order_shipped` |
| **Shopify** | `orders/updated` + fulfillment_status=`delivered` | `order_delivered` |
| **Zid** | `order.created` | `order_confirmed` |
| **Zid** | `order.shipped` | `order_shipped` |
| **Zid** | `order.delivered` | `order_delivered` |

---

## 6. Review Request Messages

### Flow

```
Order delivered event
        │
        ▼
customerNotifications.schedule({
    type: 'review_request',
    delay: template.delay_minutes (default: 2880 min = 48 hours),
    variables: { customer_name, product_name, review_url }
})
        │
        ▼
BullMQ delayed job (48 hours)
        │
        ▼
SMS sent with review link
```

### Review URL

- **Salla**: `https://{store_domain}/reviews/add/{order_id}` (or per-product URL)
- **Shopify**: Merchant's preferred review app URL (configurable in template)
- **Zid**: `https://{store_domain}/review/{order_id}`

Merchant can customize the URL in their template settings.

---

## 7. Digital Product Delivery

### Flow

```
Order confirmed + payment completed
        │
        ▼
Check if order contains digital products
  - Salla: product.type === 'digital' or product.require_shipping === false
  - Shopify: product.product_type === 'Digital' or requires_shipping === false
  - Zid: product.is_digital === true
        │
        ▼
For each digital product in order:
  customerNotifications.schedule({
      type: 'digital_delivery',
      delay: 0 (immediate),
      variables: { customer_name, product_name, download_url }
  })
```

### Download URL

Platforms provide download URLs for digital products. If not available from
the webhook payload, fetch via API:
- **Salla**: `GET /admin/v2/orders/{id}/files`
- **Shopify**: fulfillment with digital delivery
- **Zid**: `GET /v1/orders/{id}/digital-products`

---

## 8. Merchant Dashboard UI

### New Page: Notification Settings (`/settings/notifications`)

```
┌─────────────────────────────────────────────────┐
│  إعدادات الإشعارات  /  Notification Settings    │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌─────────────────────────────────────────┐    │
│  │ 🛒 السلة المتروكة  [تفعيل/إيقاف]       │    │
│  │                                          │    │
│  │ التأخير: [60] دقيقة                      │    │
│  │ كوبون خصم: [تفعيل] الكود: [WELCOME10]   │    │
│  │ الرسالة (عربي): [...................]    │    │
│  │ الرسالة (English): [.................]   │    │
│  │ المتغيرات: {customer_name} {total_amount}│    │
│  └─────────────────────────────────────────┘    │
│                                                  │
│  ┌─────────────────────────────────────────┐    │
│  │ ✅ تأكيد الطلب  [تفعيل/إيقاف]           │    │
│  │ الرسالة (عربي): [...................]    │    │
│  │ الرسالة (English): [.................]   │    │
│  └─────────────────────────────────────────┘    │
│                                                  │
│  ┌─────────────────────────────────────────┐    │
│  │ 🚚 تحديث الشحن  [تفعيل/إيقاف]          │    │
│  │  ...                                     │    │
│  └─────────────────────────────────────────┘    │
│                                                  │
│  ┌─────────────────────────────────────────┐    │
│  │ ⭐ طلب التقييم  [تفعيل/إيقاف]           │    │
│  │ التأخير: [48] ساعة بعد التوصيل          │    │
│  │  ...                                     │    │
│  └─────────────────────────────────────────┘    │
│                                                  │
│  ┌─────────────────────────────────────────┐    │
│  │ 📦 تسليم المنتجات الرقمية [تفعيل/إيقاف] │    │
│  │  ...                                     │    │
│  └─────────────────────────────────────────┘    │
│                                                  │
│  ┌─────────────────────────────────────────┐    │
│  │ 📊 إحصائيات الإشعارات                   │    │
│  │ مرسلة: 1,234  |  معدل التحويل: 12%     │    │
│  └─────────────────────────────────────────┘    │
│                                                  │
└─────────────────────────────────────────────────┘
```

### API Endpoints

```
GET    /api/notification-templates/:storeId          — list all templates
PUT    /api/notification-templates/:storeId/:type     — update template
POST   /api/notification-templates/:storeId/reset     — reset to defaults
GET    /api/notification-log/:storeId                 — notification history
GET    /api/notification-log/:storeId/stats           — analytics
```

### i18n Namespaces

New namespace: `frontend/src/i18n/{en,ar}/customerNotifications.json`

---

## 9. WhatsApp Migration Path

When Meta approves WhatsApp Business API:

### Step 1: Register WhatsApp Message Templates

Submit these templates to Meta for approval:
- `abandoned_cart_reminder` — authentication category
- `order_confirmation` — utility category
- `shipping_update` — utility category
- `delivery_confirmation` — utility category
- `review_request` — marketing category
- `digital_delivery` — utility category

### Step 2: Update Delivery Service

```typescript
// In customerNotifications.ts — send() method:
async send(notificationLogId: string): Promise<void> {
    const notification = await getNotificationById(notificationLogId);

    // Try WhatsApp first (Phase 3)
    if (config.whatsapp.enabled) {
        try {
            await whatsappService.sendTemplate(
                notification.customerPhone,
                notification.type,
                notification.variables
            );
            return;
        } catch {
            // Fall back to SMS
        }
    }

    // SMS fallback (current Phase 2)
    await smsService.send(notification.customerPhone, notification.messageSent);
}
```

### Step 3: Update Template System

Add WhatsApp template IDs to `customer_notification_templates`:

```sql
ALTER TABLE customer_notification_templates
    ADD COLUMN whatsapp_template_name VARCHAR(255),
    ADD COLUMN whatsapp_template_language VARCHAR(10);
```

---

## 10. Implementation Order

### Phase 1: Foundation (Week 1)

1. **Database migration** — create `customer_notification_templates` and `customer_notifications_log` tables
2. **CustomerNotificationService** — core service with schedule/send/cancel/render
3. **BullMQ queue + worker** — `customerNotificationQueue` + `customerNotificationWorker`
4. **Default template seeding** — insert defaults when merchant connects store
5. **API endpoints** — CRUD for templates + notification log

### Phase 2: Order Notifications (Week 1-2)

6. **Register new webhook events** — order events for Salla, Shopify, Zid
7. **Webhook handlers** — process order events → schedule notifications
8. **Platform status mapping** — normalize events across platforms
9. **Order confirmed + shipped + delivered** — end-to-end flow

### Phase 3: Abandoned Cart (Week 2)

10. **Salla abandoned cart webhook** — handle `abandoned.cart` event
11. **Shopify checkout polling** — cron job for abandoned checkouts
12. **Cancellation logic** — cancel abandoned cart notification when order is placed
13. **Coupon support** — optional coupon code in abandoned cart messages

### Phase 4: Review + Digital (Week 2-3)

14. **Review request** — scheduled after delivery (48h delay)
15. **Digital product delivery** — detect digital products, send download link
16. **Review URL configuration** — per-store review URL in settings

### Phase 5: Dashboard UI (Week 3)

17. **Notification settings page** — template editor with variable preview
18. **Notification log/history** — list of sent notifications with status
19. **Analytics** — sent count, delivery rate, conversion rate
20. **i18n** — Arabic + English translations for all UI

### Phase 6: Testing (Week 3-4)

21. **Unit tests** — CustomerNotificationService, template rendering, dedup
22. **Integration tests** — webhook → schedule → send flow
23. **E2E tests** — merchant enables feature → customer receives SMS
24. **Load test** — verify queue handles spikes (Black Friday scenario)

---

## Files to Create

```
backend/src/services/customerNotifications.ts    — core service
backend/src/lib/customerNotificationQueue.ts     — BullMQ queue
backend/src/workers/customerNotificationWorker.ts — delayed job processor
backend/src/routes/customerNotifications.ts      — API routes
backend/src/controllers/customerNotifications.ts — route handlers
backend/src/db/migrations/XXX_customer_notifications.ts — schema migration
backend/test/services/customerNotifications.test.ts — unit tests

frontend/src/pages/settings/notifications.tsx    — merchant UI
frontend/src/i18n/en/customerNotifications.json  — English translations
frontend/src/i18n/ar/customerNotifications.json  — Arabic translations
frontend/src/components/settings/NotificationTemplateEditor.tsx — template editor
```

## Files to Modify

```
backend/src/services/salla.ts        — add order + cart webhook events
backend/src/services/shopify.ts      — add order webhook events
backend/src/services/zid.ts          — add order webhook events
backend/src/db/schema.ts             — add new tables
backend/src/lib/queue.ts             — export new queue
backend/src/routes/index.ts          — register new routes
backend/src/services/ecommerce.ts    — seed default templates on store connect
frontend/src/i18n/en/settings.json   — add notification settings labels
frontend/src/i18n/ar/settings.json   — same
```
