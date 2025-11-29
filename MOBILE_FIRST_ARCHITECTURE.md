# Mobile-First Architecture — AutoReply.AI

## Overview

AutoReply.AI is designed with a **mobile-first approach** to match user behavior in target markets.

---

## 🎯 **Platform Priority**

### **1. Mobile App (Primary)** ⭐
- **Technology:** React Native (iOS + Android from one codebase)
- **Purpose:** Primary user interface
- **Features:**
  - Login with Facebook
  - Select pages to monitor
  - Create/edit templates
  - View recent comments
  - Enable/disable auto-reply per post
  - Push notifications for new comments
  - Quick manual replies
  - Settings and preferences

### **2. Web Dashboard (Secondary)**
- **Technology:** Next.js (responsive)
- **Purpose:** Initial setup, advanced features, desktop users
- **Features:**
  - Same as mobile
  - Better for bulk template creation
  - Analytics and reports
  - Advanced settings

### **3. Backend API**
- **Technology:** Node.js/Express
- **Purpose:** Serve both mobile and web
- **Features:**
  - RESTful API
  - Facebook OAuth
  - Webhook handling
  - Rules engine
  - AI integration

---

## 📱 **Mobile App Architecture**

### **Technology Stack**

```
React Native (Expo)
├── React Navigation (routing)
├── React Native Paper (UI components)
├── AsyncStorage (local data)
├── Axios (API calls)
├── React Native Push Notifications
└── i18n (multi-language)
```

### **Why React Native?**
- ✅ **One codebase** → iOS + Android
- ✅ **Fast development** (weeks, not months)
- ✅ **Native performance**
- ✅ **Large community**
- ✅ **Easy to maintain**
- ✅ **Cost-effective**

### **Alternative: Flutter**
- Also good choice
- Slightly better performance
- Smaller community
- Either works well

---

## 🔔 **Push Notifications (Critical)**

### **Use Case:**
```
New comment received
    ↓
Webhook triggers
    ↓
Backend processes (rules/AI)
    ↓
Reply posted automatically
    ↓
Push notification to user:
"✅ Replied to Ahmad: 'شكراً إلك!'"
```

### **Implementation:**
- **Firebase Cloud Messaging (FCM)** - Free, reliable
- **OneSignal** - Alternative, easier setup
- **Expo Push Notifications** - If using Expo

### **Notification Types:**
1. **New comment** (if auto-reply disabled)
2. **Reply sent** (confirmation)
3. **AI failed** (needs manual reply)
4. **Daily summary** (optional)

---

## 📊 **Updated System Architecture**

```
┌─────────────────┐
│  Mobile App     │ ← Primary Interface
│  (React Native) │
└────────┬────────┘
         │
         │ HTTPS/REST
         │
┌────────▼────────┐
│   Backend API   │
│  (Node.js)      │
└────┬──────┬─────┘
     │      │
     │      └──────→ Push Notification Service
     │                (Firebase/OneSignal)
     │
┌────▼─────────────────────────────┐
│  Facebook Graph API + Webhooks   │
└──────────────────────────────────┘

┌─────────────────┐
│  Web Dashboard  │ ← Secondary Interface
│  (Next.js)      │
└────────┬────────┘
         │
         └──────→ Same Backend API
```

---

## 🎨 **Mobile App Screens**

### **Core Screens:**

1. **Login**
   - Facebook OAuth
   - Simple, one-tap login

2. **Pages List**
   - User's Facebook pages
   - Toggle auto-reply on/off
   - Page stats (comments today, replies sent)

3. **Posts List** (per page)
   - Recent posts
   - Enable/disable auto-reply per post
   - Comment count

4. **Templates**
   - List of templates
   - Create/edit (multi-language)
   - Keywords
   - Quick actions (duplicate, delete)

5. **Inbox** (Recent Comments)
   - Latest comments
   - Replied status
   - Reply preview
   - Manual reply option

6. **Settings**
   - Language preference
   - Notification settings
   - AI on/off
   - Default reply language
   - Logout

### **Optional Screens:**
7. **Analytics** (simple)
   - Comments today/week/month
   - Reply rate
   - Most used templates

8. **Rules** (advanced)
   - Keyword → Template rules
   - Priority order

---

## 🚀 **Development Phases**

### **Phase 1: Backend + Web (MVP)**
**Timeline:** 4-6 weeks
- Backend API
- Facebook integration
- Webhooks
- Rules engine
- AI worker
- Basic web dashboard

**Why start with web?**
- Faster to build
- Test Facebook integration
- Validate business logic
- Get first users

### **Phase 2: Mobile App**
**Timeline:** 3-4 weeks
- React Native app
- Connect to existing API
- Push notifications
- Core features (pages, templates, inbox)

**Why second?**
- Backend already tested
- API already working
- Can reuse all business logic

### **Phase 3: Polish + Launch**
**Timeline:** 2-3 weeks
- UI/UX improvements
- Advanced features
- Analytics
- App Store submission

---

## 📱 **Mobile App Tech Stack**

### **Recommended: Expo (React Native)**

```json
{
  "dependencies": {
    "expo": "~49.0.0",
    "react-native": "0.72.0",
    "react-navigation": "^6.0.0",
    "react-native-paper": "^5.0.0",
    "axios": "^1.6.0",
    "expo-notifications": "~0.20.0",
    "expo-auth-session": "~5.0.0",
    "react-i18next": "^14.0.0",
    "@react-native-async-storage/async-storage": "^1.19.0"
  }
}
```

### **Folder Structure:**

```
/mobile-app
  /src
    /screens
      LoginScreen.js
      PagesScreen.js
      PostsScreen.js
      TemplatesScreen.js
      InboxScreen.js
      SettingsScreen.js
    /components
      PageCard.js
      TemplateCard.js
      CommentCard.js
    /services
      api.js
      auth.js
      notifications.js
    /navigation
      AppNavigator.js
    /i18n
      en.json
      ar.json
      sv.json
    /utils
      storage.js
      helpers.js
  App.js
  app.json
  package.json
```

---

## 🔐 **Mobile Authentication**

### **Facebook OAuth Flow:**

```javascript
// Using Expo Auth Session
import * as AuthSession from 'expo-auth-session';

const discovery = {
  authorizationEndpoint: 'https://www.facebook.com/v18.0/dialog/oauth',
};

const [request, response, promptAsync] = AuthSession.useAuthRequest(
  {
    clientId: FACEBOOK_APP_ID,
    scopes: ['pages_manage_engagement', 'pages_read_engagement'],
    redirectUri: AuthSession.makeRedirectUri({
      scheme: 'autoreply'
    }),
  },
  discovery
);

// User taps login
await promptAsync();

// Exchange code for token via backend
const { token } = await api.post('/auth/facebook', {
  code: response.params.code
});

// Save token
await AsyncStorage.setItem('token', token);
```

---

## 🔔 **Push Notifications Setup**

### **1. Firebase Setup**

```javascript
// Install
npm install @react-native-firebase/app
npm install @react-native-firebase/messaging

// Register device
import messaging from '@react-native-firebase/messaging';

async function registerDevice() {
  const token = await messaging().getToken();
  
  // Send to backend
  await api.post('/devices/register', {
    fcm_token: token,
    platform: Platform.OS
  });
}

// Listen for notifications
messaging().onMessage(async remoteMessage => {
  Alert.alert(
    remoteMessage.notification.title,
    remoteMessage.notification.body
  );
});
```

### **2. Backend Notification Service**

```javascript
// Send notification when reply is posted
const admin = require('firebase-admin');

async function notifyUser(userId, title, body) {
  const device = await db.query(
    'SELECT fcm_token FROM devices WHERE user_id = $1',
    [userId]
  );
  
  await admin.messaging().send({
    token: device.fcm_token,
    notification: {
      title,
      body
    },
    data: {
      type: 'reply_sent',
      comment_id: 'comment_123'
    }
  });
}
```

---

## 📊 **Mobile vs Web Feature Comparison**

| Feature | Mobile | Web | Priority |
|---------|--------|-----|----------|
| **Login** | ✅ | ✅ | High |
| **Page Management** | ✅ | ✅ | High |
| **Templates (CRUD)** | ✅ | ✅ | High |
| **Inbox** | ✅ | ✅ | High |
| **Push Notifications** | ✅ | ❌ | High |
| **Quick Manual Reply** | ✅ | ✅ | Medium |
| **Bulk Template Import** | ❌ | ✅ | Low |
| **Advanced Analytics** | ❌ | ✅ | Low |
| **Rules Management** | ✅ Basic | ✅ Advanced | Medium |
| **Settings** | ✅ | ✅ | High |

---

## 🎯 **Mobile-First Benefits**

### **For Users:**
- ✅ Manage business from anywhere
- ✅ Instant notifications
- ✅ Quick replies on the go
- ✅ Native mobile experience
- ✅ Works offline (cached data)

### **For Business:**
- ✅ Higher engagement
- ✅ Better retention
- ✅ Premium positioning
- ✅ App Store presence
- ✅ Competitive advantage

### **For Development:**
- ✅ React Native = one codebase
- ✅ Reuse backend API
- ✅ Faster than native development
- ✅ Easy to maintain

---

## 🚀 **Recommended Approach**

### **Phase 1: Backend + Web (Now)**
Build the foundation:
- Backend API
- Facebook integration
- Web dashboard for testing

### **Phase 2: Mobile App (Next)**
Build the primary interface:
- React Native app
- Push notifications
- Core features

### **Phase 3: Launch Both**
- Web for desktop users
- Mobile for primary users
- Cross-platform coverage

---

## 📱 **Mobile App Deployment**

### **iOS (App Store)**
- Apple Developer Account ($99/year)
- TestFlight for beta testing
- App Review (1-2 weeks)

### **Android (Google Play)**
- Google Play Developer ($25 one-time)
- Internal testing
- Faster approval

### **Timeline:**
- Development: 3-4 weeks
- Testing: 1 week
- App Store submission: 1-2 weeks
- **Total: 5-7 weeks** for mobile app

---

## ✅ **Summary**

**Mobile-first is the right strategy for AutoReply.AI:**

1. ✅ **Start with Backend + Web** (validate business logic)
2. ✅ **Build Mobile App** (primary user interface)
3. ✅ **Use React Native** (iOS + Android from one codebase)
4. ✅ **Push Notifications** (critical for engagement)
5. ✅ **Web as secondary** (desktop users, advanced features)

**This approach gives you:**
- Fast time to market
- Mobile-first experience
- Cross-platform coverage
- Cost-effective development
- Competitive advantage

🚀 **Ready to build a mobile-first SaaS!**
