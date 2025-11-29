# Development Plan — AutoReply.AI

This document outlines the full development roadmap for building AutoReply.AI.

---

# 1. Project Setup

### 1.1 Create repo structure  
Follow `FOLDER_STRUCTURE.md`.

### 1.2 Create Docker setup  
Follow `DOCKER_PLAN.md`.

### 1.3 Configure environment variables  
Follow `ENV_EXAMPLE.md`.

---

# 2. Backend Development

### 2.1 Technologies  
- Node.js (Express) OR Python (FastAPI)  
- PostgreSQL  
- Redis  

### 2.2 Modules
- Auth (Facebook OAuth)  
- Webhooks  
- Pages  
- Posts  
- Templates  
- Rules Engine  
- AI Engine  
- Comment Replyer  
- Logs  

### 2.3 Backend tasks  
1. Install framework  
2. Implement OAuth  
3. Implement token storage  
4. Build Webhook handler  
5. Build Rules Engine  
6. Build Template Engine  
7. Build AI Request API  
8. Connect to AI Worker  
9. Store replies  
10. Create API endpoints  
11. Add logging + error layers  

---

# 3. AI Worker Development

### Tasks:
1. Create queue listener (Redis)  
2. Accept jobs from backend  
3. Send requests to ChatGPT Mini  
4. Output reply  
5. Return result via callback or pub/sub  

---

# 4. Mobile App Development (Primary)

### Tech:
- React Native (Expo)
- React Native Paper (UI)
- Push Notifications

### Screens:
- Login (Facebook OAuth)
- Page Selector
- Posts List & Toggle
- Templates (Multi-language)
- Inbox & Quick Reply
- Settings

---

# 5. Web Dashboard (Secondary / Phase 3)

### Tech:
- Next.js / React
- TailwindCSS
- i18n

### Status:
- Deferred until Mobile App is stable
- Will share same API as Mobile App  

---

# 6. Facebook Setup  
See `FACEBOOK_SETUP.md`.

---

# 6. Database Schema  
See `DATABASE_SCHEMA.md`.

---

# 7. API Specification  
See `API_SPEC.md`.

---

# 8. Deployment

### Steps:
1. Push to server  
2. Install Docker  
3. Run:
```
docker-compose up -d
```
4. Set up Nginx with HTTPS  
5. Test webhooks  
6. Move app to Live mode in Meta  

---

# 9. Beta Testing  
- Test with 5–10 pages  
- Fix AI prompts  
- Add Syrian dialect templates  

---

# 10. Launch  
- Add pricing  
- Add monitoring  
- Add backups  
