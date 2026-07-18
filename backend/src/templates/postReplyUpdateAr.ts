/**
 * Post Reply update announcement — Arabic.
 *
 * New-feature email: Post Reply any-comment mode + image attachment + Smart Reply synergy (PR #457/#460).
 * Complete HTML document, returned as-is by waitlistEmailTemplate (custom-HTML path);
 * only {{UNSUBSCRIBE_URL}} is substituted per recipient. Images hosted on the public jawab24-media bucket.
 */
export const POST_REPLY_UPDATE_AR_HTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>جديد في جواب24: تحديث «رد البوست» — رد على كل تعليق، وأضف صورة</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:'Cairo','Tajawal','Segoe UI',Tahoma,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">رد تلقائي على كل من يعلّق، وإمكانية إرفاق صورة مع ردّك.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
  <tr><td align="center" style="padding:26px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 6px 30px rgba(15,23,42,.08);">
      <tr><td style="background:#0f766e;padding:18px 24px;text-align:center;"><span style="color:#ffffff;font-weight:800;font-size:20px;letter-spacing:.3px;">Jawab24</span></td></tr>
      <tr><td style="padding:28px 26px;">
<div dir="rtl" style="font-family:'Cairo','Tajawal','Segoe UI',Tahoma,sans-serif;color:#0f172a;line-height:1.85;font-size:16px">
  <h1 style="font-size:22px;margin:0 0 6px;color:#0f766e">تحديث جديد على «رد البوست» ✨</h1>
  <p style="margin:0 0 22px;color:#475569">أضفنا تحسينَين يجعلان تفاعلك مع عملائك أسرع وأوضح.</p>
  
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdfa;border:1px solid #ccfbf1;border-radius:14px;margin:0 0 18px">
    <tr><td style="padding:18px 20px">
      <h2 style="font-size:18px;margin:0 0 8px;color:#0f766e">١) ردٌّ تلقائي على كل من يعلّق</h2>
      <p style="margin:0">لم تعد بحاجة إلى كلمة مفتاحية. فعّل وضع «أي تعليق» ليصل ردّك تلقائيًا إلى كل من يعلّق على منشورك — الخيار الأنسب للمسابقات ومنشورات «علّق ليصلك الرابط».</p>
      <p style="margin:6px 0 0;color:#64748b;font-size:14px">تُستثنى الرسائل المزعجة وإشارات الأصدقاء تلقائيًا.</p>
    </td></tr>
  </table>
  <div style="text-align:center;margin:0 0 26px">
    <img src="https://s3.eu-central-003.backblazeb2.com/jawab24-media/announcements/post-reply-2026-07/any-ar.png" alt="إعداد رد البوست في وضع «أي تعليق»" width="300" style="max-width:300px;width:100%;height:auto;border:1px solid #e2e8f0;border-radius:14px" />
  </div>
  
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdfa;border:1px solid #ccfbf1;border-radius:14px;margin:0 0 18px">
    <tr><td style="padding:18px 20px">
      <h2 style="font-size:18px;margin:0 0 8px;color:#0f766e">٢) أرفِق صورةً مع ردّك</h2>
      <p style="margin:0">صار بإمكانك إرفاق صورة مع رد البوست (في وضع الرسائل الخاصة). يصل عميلك نصُّ ردّك أولًا، ثم الصورة كاملةً بجودتها الأصلية كرسالة مستقلة يفتحها بملء الشاشة.</p>
      <p style="margin:6px 0 0;color:#64748b;font-size:14px">مثالية لقائمة الأسعار، أو صورة المنتج، أو الكتالوج.</p>
    </td></tr>
  </table>
  <div style="text-align:center;margin:0 0 26px">
    <img src="https://s3.eu-central-003.backblazeb2.com/jawab24-media/announcements/post-reply-2026-07/image-ar.png" alt="إرفاق صورة مع رد البوست ومعاينة ما يصل للعميل" width="300" style="max-width:300px;width:100%;height:auto;border:1px solid #e2e8f0;border-radius:14px" />
  </div>
  
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdfa;border:1px solid #ccfbf1;border-radius:14px;margin:0 0 18px">
    <tr><td style="padding:18px 20px">
      <h2 style="font-size:18px;margin:0 0 8px;color:#0f766e">٣) وفِّر رصيد ردودك الذكية</h2>
      <p style="margin:0">فعّل رد البوست مع <strong>الوضع الثنائي</strong>: يرد رد البوست أولًا في الرسائل الخاصة <strong>مجانًا</strong> (رسالة جاهزة تكتبها أنت) — وإذا سأل الزبون أكثر، تُكمل الردود الذكية. هكذا تُنفق رصيدك على ما يحتاج فعلًا إلى ذكاء صناعي.</p>
      <p style="margin:6px 0 0;color:#64748b;font-size:14px">وكلما كانت <strong>معلومات نشاطك التجاري</strong> أغنى بالتفاصيل، صارت الردود الذكية أدقّ وأذكى.</p>
    </td></tr>
  </table>
  <h3 style="font-size:16px;margin:0 0 6px;color:#0f172a">كيف تجرّبها الآن؟</h3>
  <p style="margin:0 0 22px;color:#334155">من صفحة <strong>التعليقات</strong>، افتح «إعداد رد البوست» على المنشور الذي تريده (يُعدّ لكل منشور على حدة)، اكتب ردّك، وأضف صورة إن رغبت.</p>
  <div style="text-align:center;margin:0 0 8px">
    <a href="https://jawab24.com/ar/comments" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:13px 34px;border-radius:12px">افتح جواب24</a>
  </div>
</div></td></tr>
      <tr><td dir="rtl" style="padding:16px 24px;background:#f8fafc;border-top:1px solid #eef2f6;text-align:center;color:#94a3b8;font-size:12px;">أُرسلت إليك من جواب24 &middot; <a href="{{UNSUBSCRIBE_URL}}" style="color:#94a3b8;text-decoration:underline;">إلغاء الاشتراك</a></td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
