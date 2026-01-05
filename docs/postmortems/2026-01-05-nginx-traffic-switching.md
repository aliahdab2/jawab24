# Deployment Traffic Switching Issue - Post-Mortem

**Date:** 2026-01-05  
**Severity:** Critical  
**Status:** ✅ Fixed

## Summary
After deploying code fixes to production, traffic was not switching to the new environment (green), causing users to continue seeing 500 errors from the old environment (blue) even though the deployment script reported success.

## Timeline
- **01:52 UTC** - Deployment script completed, reported "Traffic switched to green"
- **01:52-07:58 UTC** - Users continued to see 500 errors
- **07:58 UTC** - Issue discovered: Nginx was still serving blue environment
- **07:59 UTC** - Manual Nginx restart fixed the issue
- **08:00 UTC** - Root cause identified and permanent fix implemented

## Root Cause

### Technical Details
1. **Read-Only Volume Mount**: The `nginx/upstream.conf` file is mounted as read-only (`:ro`) in `docker-compose.yml`:
   ```yaml
   volumes:
     - ./nginx/upstream.conf:/etc/nginx/upstream.conf:ro
   ```

2. **Docker Volume Behavior**: When Docker mounts a file as read-only, it creates an **inode reference** at container start time. Even when the host file is updated, the running container continues to see the old file content until the container is restarted.

3. **Insufficient Reload**: The deployment script was using `nginx -s reload`, which only reloads the configuration **already in memory**, not from the mounted file.

4. **Silent Failure**: The script had a fallback to restart Nginx if reload failed, but the reload command was succeeding (returning exit code 0) even though it wasn't picking up the new config.

## Impact
- **Duration**: ~6 hours of serving stale code
- **User Impact**: 500 errors on `/api/messages` and `/api/messages/stats` endpoints
- **Affected Users**: All users attempting to access the Messages page
- **Data Loss**: None (read-only operations failed)

## The Fix

### Changes Made
1. **Force Container Restart** (instead of reload):
   ```bash
   # Old approach (didn't work)
   docker exec jawab24-nginx nginx -s reload
   
   # New approach (works reliably)
   docker restart jawab24-nginx
   ```

2. **Add Verification Step**:
   ```bash
   # Verify the switch actually worked
   ACTUAL_ENV=$(curl -s http://localhost/api/version | grep -o '"environment":"[^"]*"')
   if [ "$ACTUAL_ENV" != "$DEPLOY_ENV" ]; then
       echo "WARNING: Traffic switch failed!"
   fi
   ```

3. **Health Check Wait**:
   - Wait up to 30 seconds for Nginx to become healthy after restart
   - Prevents race conditions where requests hit Nginx before it's ready

### Files Modified
- `scripts/deploy-on-server.sh` - Updated traffic switching logic
- Commit: `e997553` - "fix(deploy): force Nginx container restart to apply upstream config changes"

## Prevention Measures

### Immediate
- ✅ Deployment script now forces Nginx restart
- ✅ Verification step confirms environment switch
- ✅ Health check ensures Nginx is ready before declaring success

### Future Improvements
1. **Monitoring**: Add alerting when API version doesn't match expected environment
2. **Automated Testing**: Add end-to-end test that verifies deployment switches traffic
3. **Volume Mount Alternative**: Consider using Docker configs or secrets instead of read-only mounts
4. **Deployment Smoke Tests**: Automatically test critical endpoints after deployment

## Lessons Learned

### What Went Well
- Blue-green deployment kept the site online during the issue
- Manual intervention was quick once the problem was identified
- Root cause was clear and easy to fix

### What Could Be Better
- Deployment script should have caught this automatically
- Need better post-deployment verification
- Should monitor environment version in production

### Action Items
- [ ] Add Datadog/monitoring alert for environment mismatch
- [ ] Create automated smoke test suite
- [ ] Document this issue in deployment runbook
- [ ] Consider alternative to read-only volume mounts

## References
- GitHub Issue: (to be created)
- Deployment Script: `scripts/deploy-on-server.sh`
- Docker Compose: `docker-compose.yml` (line 153)
- Related Commits:
  - `667e469` - Fixed MessagesController property mismatch
  - `e997553` - Fixed Nginx traffic switching

## Verification
To verify this is fixed in future deployments:
```bash
# After deployment completes, check:
curl https://jawab24.com/api/version | jq .environment

# Should match the environment you just deployed to (green or blue)
```
