/**
 * Post Reply update announcement — English.
 *
 * New-feature email: Post Reply any-comment mode + image attachment + Smart Reply synergy (PR #457/#460).
 * Complete HTML document, returned as-is by waitlistEmailTemplate (custom-HTML path);
 * only {{UNSUBSCRIBE_URL}} is substituted per recipient. Images hosted on the public jawab24-media bucket.
 */
export const POST_REPLY_UPDATE_EN_HTML = `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>What’s new in Jawab24: Post Reply update — reply to every comment, add an image</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Reply to everyone who comments, and attach an image to your reply.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
  <tr><td align="center" style="padding:26px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 6px 30px rgba(15,23,42,.08);">
      <tr><td style="background:#0f766e;padding:18px 24px;text-align:center;"><span style="color:#ffffff;font-weight:800;font-size:20px;letter-spacing:.3px;">Jawab24</span></td></tr>
      <tr><td style="padding:28px 26px;">
<div dir="ltr" style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;line-height:1.85;font-size:16px">
  <h1 style="font-size:22px;margin:0 0 6px;color:#0f766e">A new Post Reply update ✨</h1>
  <p style="margin:0 0 22px;color:#475569">We shipped two improvements that make engaging your customers faster and clearer.</p>
  
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdfa;border:1px solid #ccfbf1;border-radius:14px;margin:0 0 18px">
    <tr><td style="padding:18px 20px">
      <h2 style="font-size:18px;margin:0 0 8px;color:#0f766e">1) Auto-reply to everyone who comments</h2>
      <p style="margin:0">No keyword needed. Turn on “Any comment” mode to automatically reply to everyone who comments on your post — perfect for giveaways and “comment for the link” posts.</p>
      <p style="margin:6px 0 0;color:#64748b;font-size:14px">Spam and friend-tags are skipped automatically.</p>
    </td></tr>
  </table>
  <div style="text-align:center;margin:0 0 26px">
    <img src="https://s3.eu-central-003.backblazeb2.com/jawab24-media/announcements/post-reply-2026-07/any-en.png" alt="Set up Post Reply in “Any comment” mode" width="300" style="max-width:300px;width:100%;height:auto;border:1px solid #e2e8f0;border-radius:14px" />
  </div>
  
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdfa;border:1px solid #ccfbf1;border-radius:14px;margin:0 0 18px">
    <tr><td style="padding:18px 20px">
      <h2 style="font-size:18px;margin:0 0 8px;color:#0f766e">2) Attach an image to your reply</h2>
      <p style="margin:0">You can now attach an image to your Post Reply (in private-message modes). Your customer receives your reply text first, then the full image in original quality as a separate message they can open fullscreen.</p>
      <p style="margin:6px 0 0;color:#64748b;font-size:14px">Perfect for a price list, a product photo, or a catalog.</p>
    </td></tr>
  </table>
  <div style="text-align:center;margin:0 0 26px">
    <img src="https://s3.eu-central-003.backblazeb2.com/jawab24-media/announcements/post-reply-2026-07/image-en.png" alt="Attach an image to Post Reply and preview what the customer receives" width="300" style="max-width:300px;width:100%;height:auto;border:1px solid #e2e8f0;border-radius:14px" />
  </div>
  
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdfa;border:1px solid #ccfbf1;border-radius:14px;margin:0 0 18px">
    <tr><td style="padding:18px 20px">
      <h2 style="font-size:18px;margin:0 0 8px;color:#0f766e">3) Save your Smart Reply quota</h2>
      <p style="margin:0">Turn on Post Reply with <strong>dual mode</strong>: Post Reply answers first in the DMs <strong>for free</strong> (a ready message you write) — and if the customer asks more, Smart Replies take over. So your quota is spent only on what truly needs AI.</p>
      <p style="margin:6px 0 0;color:#64748b;font-size:14px">And the richer your <strong>Business Info</strong>, the smarter and more accurate Smart Replies become.</p>
    </td></tr>
  </table>
  <h3 style="font-size:16px;margin:0 0 6px;color:#0f172a">How to try it now</h3>
  <p style="margin:0 0 22px;color:#334155">From the <strong>Comments</strong> page, open “Set up Post Reply” on the post you want (it’s set up per post), write your reply, and add an image if you like.</p>
  <div style="text-align:center;margin:0 0 8px">
    <a href="https://jawab24.com/en/comments" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:13px 34px;border-radius:12px">Open Jawab24</a>
  </div>
</div></td></tr>
      <tr><td dir="ltr" style="padding:16px 24px;background:#f8fafc;border-top:1px solid #eef2f6;text-align:center;color:#94a3b8;font-size:12px;">Sent to you by Jawab24 &middot; <a href="{{UNSUBSCRIBE_URL}}" style="color:#94a3b8;text-decoration:underline;">Unsubscribe</a></td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
