---
seoTitle: "Is Your Data Safe with Jawab24? Security & Privacy, Explained"
seoDescription: "How Jawab24 protects your page and your customers' data: official Facebook login with no password sharing, TLS in transit and AES-256-GCM on the access tokens we store, limited revocable permissions, and full data deletion on request."
seoKeywords: "Jawab24 security, is Jawab24 safe, Facebook page data protection, auto reply security, customer data privacy, connect Facebook page safely, WhatsApp Business security, connect WhatsApp safely, Facebook app permissions, data deletion, GDPR auto reply"
title: "Is Your Data Safe with Jawab24? Here's Exactly What Happens to It"
excerpt: "Connecting your page or WhatsApp number to any third-party tool is a decision worth scrutinizing. This article explains transparently how Jawab24 accesses your channels, which permissions it requests and why, and how we protect your conversations and your customers' data."
---

## A Fair Question — Answered in Detail

Your Facebook page, Instagram account, and WhatsApp number aren't just accounts; they're your business's main sales channels, holding your customers' conversations, phone numbers, and orders. So when you consider connecting it to a third-party tool, you have every right to ask: who can access what? And what happens to my data?

This article answers those questions precisely and transparently — not with vague reassurances like "your data is safe with us," but with concrete details you can verify yourself.

## Connection Happens Through Facebook Itself — We Never See Your Password

When you connect your page to Jawab24, you never type your password on our site. The entire connection runs through Meta's official login system: we send you to Facebook itself, you sign in there, and you choose which pages to connect. Your password stays between you and Facebook — Jawab24 doesn't see it, doesn't store it, and technically cannot.

This isn't just our choice — it's the only method Meta allows for approved apps. Jawab24 has passed Meta's official App Review, an audit in which Meta examines the app, its permissions, and the justification for each one before allowing it to work with pages.

The same applies to **WhatsApp**: connecting your WhatsApp Business number runs through Meta's official signup flow for the WhatsApp Business Platform, on Meta's own site, following the steps Meta defines — not us.

## Limited Permissions — And You Stay in Control

When connecting, Jawab24 requests only specific permissions, each tied to a feature you can see and use:

| Permission | Why we need it |
|-----------|----------------|
| View your list of pages | So you can choose which page to connect |
| Read and reply to page messages | So the AI employee can answer your customers on Messenger and Instagram |
| Read and reply to comments | For comment replies and Post Reply |
| Receive instant notifications of new messages | So your customer gets an answer in seconds, not hours |

Just as important is what we **don't** request:

- **We cannot post as you.** Permission to create or delete posts isn't in what we request at all — even if we wanted to, Meta would reject it technically.
- **We have no access to your personal profile**, your friends, or any page you didn't explicitly select.
- **We don't change your page settings** or delete its content.

For WhatsApp, access is confined to the WhatsApp Business account you connect yourself: receiving and answering your customers' messages on that number — nothing more. And nothing changes in your daily use: your number stays yours and keeps working on your phone as usual.

You can revoke Jawab24's access entirely at any moment — from Facebook's settings (Settings → Business Integrations) for pages, and from Meta Business settings for WhatsApp — no permission from us needed, no notice required.

## How We Protect Data Technically

- **Encryption in transit:** every connection between your browser and our servers, and between our servers and Meta, runs over encrypted channels (HTTPS/TLS).
- **Encryption at rest:** access keys for pages and WhatsApp accounts — the most sensitive thing we hold — are stored encrypted with AES-256-GCM, unreadable even inside the database itself.
- **Every incoming notification is verified:** each event Meta sends us — whether from Facebook, Instagram, or WhatsApp — carries a digital signature we validate before processing, so no third party can impersonate Meta and inject fake data.
- **Account isolation:** every Jawab24 account sees only its own data. Your pages, conversations, and Business Info are fully isolated from other accounts.

## Who Can Read Your Customers' Conversations?

The short answer: you and your team.

The AI employee processes incoming messages to answer them from your Business Info. Smart Replies are processed through OpenAI's business API, which under its published policy does not use data submitted via the API to train general AI models. Your customers' conversations are nobody's training material.

Our commitments to you:

- **We do not sell your data or your customers' data to any third party.** Our business model is subscriptions — not advertising, not data brokering.
- **Internal access is limited:** our team only looks at your account's data when needed to help you with a support issue.

## Payment Details Never Touch Our Servers

When you subscribe by card, your card details go directly into Stripe — the global payment platform certified at the highest level of payment security standards (PCI DSS). Card numbers never reach Jawab24's servers and are never stored with us.

## Your Right to Deletion — Guaranteed and Automated

Your data is yours, and deleting it is your right:

- **Disconnecting a page** stops processing its messages immediately.
- **Removing the Jawab24 app from your Facebook settings** automatically triggers a data-deletion request we fulfill without manual intervention — an official Meta mechanism we comply with.
- **Requesting account deletion** removes your data from our systems.

The full privacy policy is always available on our [privacy page](/en/privacy), written in plain language, not legal maze.

## Frequently Asked Questions

### Can Jawab24 post on my page?

No. Posting permission is not among the permissions we request from Meta, and the restriction is technical, not a verbal promise: an app cannot do what it was never explicitly granted.

### Does Jawab24 see my Facebook password?

No. Login happens on Facebook's own site, and your password never passes through our servers at any stage.

### Are my customers' conversations used to train AI models?

No. Replies are processed through the business API, and data submitted through it is not used to train general models.

### Does all of this apply to WhatsApp too?

Yes. WhatsApp connects through Meta's official system as well, access is confined to the WhatsApp Business account you connect, access keys are encrypted with the same standard, and every incoming notification goes through the same signature verification. And your number keeps working on your phone as usual.

### What happens to my data if I cancel my subscription?

Cancelling stops the service, but your data remains yours: you can disconnect your pages at any time and request permanent deletion of your data, and we comply.

### Where do I find the full legal details?

On the [privacy policy page](/en/privacy) and the [terms page](/en/terms).

## Bottom Line: Trust Is Built with Transparency

We know connecting your page to a third-party tool takes trust, and trust isn't requested — it's demonstrated: official connection through Meta with no password sharing, limited permissions you can revoke yourself at any moment, encryption in transit and AES-256-GCM on the access keys we store, and no selling or repurposing of your data outside serving you.

If you have a security or privacy question we didn't answer here, write to us and we'll answer it in the same level of detail.
