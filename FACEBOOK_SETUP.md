# Facebook Developer / Meta Setup

This document provides full instructions for configuring Meta for AutoReply.AI.

---

## 1. Create Meta Developer Account
https://developers.facebook.com

---

## 2. Create App
- App type: **Business**
- Name: AutoReply.AI  
- Create Business Account  

---

## 3. Add Products
- Facebook Login  
- Webhooks  
- Graph API  

---

## 4. Configure Facebook Login

Enable:
- Web OAuth Login  

Add Redirect URI:
```
https://yourdomain.com/auth/facebook/callback
```

---

## 5. Configure Webhooks

Subscribe to:
- `comments`
- `mentions`
- `feed`

Callback:
```
https://yourdomain.com/webhook/facebook
```

Verify Token:
```
VERIFY_TOKEN=yourtoken
```

---

## 6. Request Permissions
Request **Advanced Access** for:

- pages_manage_engagement  
- pages_read_engagement  
- pages_manage_metadata  
- pages_manage_posts  
- pages_read_user_content  

---

## 7. App Review Requirements
- Written description  
- Video recording:
  - Login  
  - Page selection  
  - Enable auto-reply  
  - Show Webhook → Reply  

Upload video to YouTube (unlisted).

---

## 8. Privacy Policy  
Provide:
```
https://yourdomain.com/privacy
https://yourdomain.com/terms
```

---

## 9. Domain Verification

Add domain in:
App → Settings → Advanced

---

## 10. After Approval  
Toggle: **Mode → Live**
