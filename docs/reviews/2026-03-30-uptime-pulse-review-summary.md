---
title: Uptime Pulse Review Summary
reviewers: [security-sentinel, kieran-typescript-reviewer, code-simplicity-reviewer]
findings: 23
critical: 1
high: 3
p1: 3
p2: 5
medium: 3
p3: 3
low: 2
simplification: 4
---

# Review Summary — Uptime Pulse

## Severity Snapshot

- Security: 1 Critical (SSRF), 3 High (auth, timing, rate limit), 3 Medium, 2 Low
- Frontend: 3 P1 (XSS numeric, SRI, chart adapter), 5 P2, 3 P3
- Simplicity: 4 items (dead CSS, YAGNI realtime, Promise.allSettled noise)

## What Was Fixed

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | SSRF via user-supplied URLs | Critical | Fixed — DNS resolution + IP blocklist |
| 2 | Timing-unsafe cron secret | High | Fixed — crypto.timingSafeEqual |
| 3 | Chart.js time adapter missing | P1 | Fixed — added date-fns adapter |
| 4 | XSS numeric values in innerHTML | P1 | Fixed — escapeHtml on all values |
| 5 | Supabase script missing SRI | P1 | Fixed — added crossorigin attribute |
| 6 | Error message leakage | Medium | Fixed — generic error messages |
| 7 | URL validation weak | Medium | Fixed — URL constructor + length limits |
| 8 | Realtime N+1 API calls | P2 | Fixed — 2s debounce |
| 9 | Realtime no error handling | P2 | Fixed — status callback + polling fallback |
| 10 | Dead CSS (.filters, .loading vars) | P3 | Fixed — removed |
| 11 | Promise.allSettled unnecessary | Simplicity | Fixed — replaced with Promise.all |

## What Was NOT Fixed (Accepted for Sandbox)

| Issue | Severity | Why deferred |
|-------|----------|-------------|
| Unauthenticated write endpoints | High | Sandbox only — mandatory for production |
| No rate limiting | High | Sandbox only — add express-rate-limit for production |
| Missing security headers (helmet) | Low | Sandbox only |
| CORS wildcard fallback | Low | Acceptable — ALLOWED_ORIGINS is set in Railway |
| Accessibility gaps (aria-labels) | P2 | Partial fix (role=alert on toast) |
| No loading state | P2 | CSS exists but not wired up |

## Review Phase Feed-Forward

- **Hardest decision:** Whether to fix auth/rate-limiting or defer. Deferred because it's a sandbox, but the SSRF chain (write URL → cron fetches → read exfiltrated data) showed why unauthenticated writes are dangerous even in sandbox.
- **Rejected alternatives:** Full auth middleware (adds complexity for a sandbox test). Removing the cron endpoint entirely (defeats the purpose of testing multi-service automation).
- **Least confident:** DNS rebinding could bypass the SSRF protection. Production needs DNS pinning or a fetch proxy.
