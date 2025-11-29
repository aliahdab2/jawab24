# System Architecture — AutoReply.AI

## Overview
AutoReply.AI consists of 6 cooperating services:

1. Backend API  
2. AI Worker  
3. Frontend Web Dashboard  
4. PostgreSQL  
5. Redis  
6. Nginx reverse proxy  

All components are containerized with Docker.

---

## Data Flow
1. User logs in via Facebook OAuth  
2. Backend fetches Page Access Token  
3. Webhooks receive comments  
4. Backend processes through rules engine  
5. If needed, backend sends job to Redis queue  
6. AI Worker generates reply  
7. Backend posts reply via Graph API  
8. Logs saved in PostgreSQL  

---

## Scaling
- Backend horizontal scaling  
- AI Worker scaling  
- Redis cluster optional  
- Postgres scaling optional  
