/**
 * Waitlist launch email — English mirror of waitlistLaunchAr.ts.
 *
 * Same structure, colors, components, and CSS classes; LTR direction; Inter font
 * (instead of Cairo); English copy; direction-sensitive rules flipped where
 * needed (e.g. accent border, icon-cell padding).
 *
 * Single placeholder: {{UNSUBSCRIBE_URL}}.
 */
export const WAITLIST_LAUNCH_EN_HTML = `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <meta name="x-apple-disable-message-reformatting">
  <title>It's ready — Jawab24</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    @media only screen and (max-width: 620px) {
      .container { width: 100% !important; border-radius: 0 !important; }
      .px-pad { padding-left: 24px !important; padding-right: 24px !important; }
      .hero-title { font-size: 32px !important; }
      .hero-emoji { font-size: 56px !important; }
      .feature-row td { display: block !important; width: 100% !important; padding: 12px 0 !important; }
      .cta-btn { padding: 15px 36px !important; }
    }
    @media (prefers-color-scheme: dark) {
      .bg-page { background-color: #0a0a0a !important; }
      .bg-card { background-color: #18181b !important; }
      .text-body { color: #e4e4e7 !important; }
      .text-muted { color: #a1a1aa !important; }
      .border-soft { border-color: #27272a !important; }
      .feature-card { background-color: #0f0f10 !important; border-color: #27272a !important; }
    }
  </style>
</head>
<body class="bg-page" style="margin:0;padding:0;background-color:#f4f4f5;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">

  <!-- Preheader -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f4f4f5;">
    Thanks for waiting — Jawab24 is now ready. Start your free trial today.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-page" style="background-color:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">

        <!-- Outer container -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="container bg-card" style="background-color:#ffffff;border-radius:16px;overflow:hidden;max-width:600px;width:100%;box-shadow:0 1px 3px rgba(0,0,0,0.04);">

          <!-- Brand bar -->
          <tr>
            <td style="background-color:#0d9488;padding:20px 32px;text-align:center;">
              <span style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.3px;">Jawab24</span>
            </td>
          </tr>

          <!-- Hero -->
          <tr>
            <td class="px-pad" style="padding:48px 32px 16px 32px;text-align:center;">
              <div class="hero-emoji" style="font-size:72px;line-height:1;margin-bottom:20px;">🎉</div>
              <h1 class="hero-title text-body" style="margin:0 0 16px 0;font-size:38px;font-weight:800;color:#18181b;line-height:1.2;letter-spacing:-1px;">
                Jawab24 is ready
              </h1>
              <p class="text-body" style="margin:0;font-size:21px;font-weight:600;color:#27272a;line-height:1.55;max-width:520px;display:inline-block;">
                Turn on smart replies for your page comments and DMs — and grow its engagement and reach.
              </p>
            </td>
          </tr>

          <!-- Primary CTA -->
          <tr>
            <td class="px-pad" style="padding:32px 32px 8px 32px;text-align:center;">
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="https://jawab24.com/login" style="height:56px;v-text-anchor:middle;width:280px;" arcsize="16%" stroke="f" fillcolor="#0d9488">
                <w:anchorlock/>
                <center style="color:#ffffff;font-family:sans-serif;font-size:17px;font-weight:bold;">Start now — 14 days free</center>
              </v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-- -->
              <a href="https://jawab24.com/login" class="cta-btn" style="display:inline-block;background-color:#0d9488;color:#ffffff;padding:17px 44px;border-radius:12px;text-decoration:none;font-weight:700;font-size:17px;line-height:1;box-shadow:0 4px 12px rgba(13,148,136,0.3);">
                Start now — 14 days free →
              </a>
              <!--<![endif]-->
            </td>
          </tr>

          <!-- Onboarding tip -->
          <tr>
            <td class="px-pad" style="padding:20px 32px 0 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background-color:#fffbeb;border-left:3px solid #f59e0b;border-radius:8px;padding:14px 16px;">
                    <p class="text-body" style="margin:0;font-size:13px;color:#78350f;line-height:1.7;">
                      <strong>💡 Tip:</strong> After signing up, we recommend adding your business details on the <a href="https://jawab24.com/pages" style="color:#92400e;text-decoration:underline;font-weight:700;">Pages screen</a> — so Jawab24 replies to your customers accurately from the very first message.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Spacer -->
          <tr><td style="height:24px;line-height:24px;">&nbsp;</td></tr>

          <!-- Section divider -->
          <tr>
            <td class="px-pad" style="padding:0 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="border-bottom:1px solid #e4e4e7;height:1px;line-height:1px;">&nbsp;</td>
                  <td class="text-muted" style="padding:0 16px;font-size:12px;color:#71717a;font-weight:700;white-space:nowrap;letter-spacing:0.6px;">WHAT YOU GET</td>
                  <td style="border-bottom:1px solid #e4e4e7;height:1px;line-height:1px;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Features -->
          <tr>
            <td class="px-pad" style="padding:24px 32px 0 32px;">

              <!-- Feature 1 -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
                <tr>
                  <td width="56" style="vertical-align:top;padding-right:14px;">
                    <div style="width:44px;height:44px;background-color:#f0fdfa;border-radius:12px;text-align:center;line-height:44px;font-size:22px;">🤖</div>
                  </td>
                  <td style="vertical-align:top;">
                    <h3 class="text-body" style="margin:0 0 4px 0;font-size:16px;font-weight:700;color:#18181b;">Smart replies that work 24/7</h3>
                    <p class="text-muted" style="margin:0;font-size:14px;color:#52525b;line-height:1.6;">
                      Jawab24 understands your tone and replies to your customers instantly — even while you sleep.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Feature 2 -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
                <tr>
                  <td width="56" style="vertical-align:top;padding-right:14px;">
                    <div style="width:44px;height:44px;background-color:#fef3c7;border-radius:12px;text-align:center;line-height:44px;font-size:22px;">🎯</div>
                  </td>
                  <td style="vertical-align:top;">
                    <h3 class="text-body" style="margin:0 0 4px 0;font-size:16px;font-weight:700;color:#18181b;">Auto-capture every lead</h3>
                    <p class="text-muted" style="margin:0;font-size:14px;color:#52525b;line-height:1.6;">
                      Every serious question turns into a lead in your <a href="https://jawab24.com/leads" style="color:#0d9488;text-decoration:underline;font-weight:600;">leads page</a> — you'll never miss another customer.
                    </p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Coming soon -->
          <tr>
            <td class="px-pad" style="padding:32px 32px 0 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="feature-card border-soft" style="background-color:#eff6ff;border:1px solid #dbeafe;border-radius:14px;">
                <tr>
                  <td style="padding:18px 22px;">
                    <p class="text-body" style="margin:0 0 8px 0;font-size:13px;font-weight:700;color:#1d4ed8;letter-spacing:0.3px;">🚀 Coming soon</p>
                    <p class="text-body" style="margin:0 0 6px 0;font-size:15px;color:#1e3a8a;line-height:1.6;font-weight:500;">
                      💬 <strong>WhatsApp support</strong> — smart replies for your customers' WhatsApp messages.
                    </p>
                    <p class="text-body" style="margin:0;font-size:15px;color:#1e3a8a;line-height:1.6;font-weight:500;">
                      🛒 <strong>Shopify integration</strong> — Jawab24 will read your products and orders, and reply with accurate info.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Spacer -->
          <tr><td style="height:32px;line-height:32px;">&nbsp;</td></tr>

          <!-- Footer -->
          <tr>
            <td class="px-pad border-soft" style="padding:24px 32px;border-top:1px solid #e4e4e7;text-align:center;">
              <p class="text-muted" style="margin:0 0 8px 0;color:#71717a;font-size:12px;line-height:1.6;">
                Smart auto-replies · Lead management · Real-time analytics
              </p>
              <p style="margin:0 0 12px 0;font-size:13px;">
                <a href="https://jawab24.com" style="color:#0d9488;text-decoration:none;font-weight:600;">jawab24.com</a>
              </p>
              <p style="margin:0;font-size:12px;">
                <a href="https://play.google.com/store/apps/details?id=com.jawab24.android" style="color:#71717a;text-decoration:none;font-weight:500;">📱 Available on Google Play</a>
              </p>
            </td>
          </tr>

        </table>

        <!-- Outside container note -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
          <tr>
            <td style="padding:16px 32px 0 32px;text-align:center;">
              <p class="text-muted" style="margin:0;font-size:11px;color:#a1a1aa;line-height:1.5;">
                You're receiving this email because you signed up for the waitlist at jawab24.com.
                <br>
                <a href="{{UNSUBSCRIBE_URL}}" style="color:#a1a1aa;text-decoration:underline;">Unsubscribe</a>
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
