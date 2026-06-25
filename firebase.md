# Firebase FCM Setup

Required events:

- New post in followed community or channel
- User post approved, rejected, or removed
- Channel creation eligibility unlocked
- Paid channel subscription confirmed
- Live class reminders
- Key points and mark sheet readiness

Each service should enqueue notification events with a user id, event type, title, body, and optional email/SMS fallback. The production adapter should send through Firebase Cloud Messaging and log delivery status.

