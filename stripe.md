# Stripe Architecture

Payment flows:

- Paid channel subscriptions: Stripe Subscriptions + Connect
- Course purchases: Payment Intents
- Job post fees: Payment Intents
- Video upload fees: Payment Intents
- Premium profile: Subscriptions
- Live class key points and grading: Payment Intents
- Channel owner payouts: Stripe Connect Express

Webhook handlers should be routed through `learnlink-backend-gateway` and delegated to the owning service.

