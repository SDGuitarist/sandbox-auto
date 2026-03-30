---
tags: [swarm, shared-spec, multi-service, deployment, ssrf, automation]
module: sandbox-auto
problem: Building and deploying a multi-service app (API + DB + frontend) via swarm agents
severity: Critical (SSRF found in review)
lesson: Shared interface spec eliminates swarm mismatches; SSRF is the default risk when servers fetch user-provided URLs
---

# Multi-Service Swarm Build — Shared Spec Validation

## Problem

Built a 5-component monitoring app (Supabase DB, Express API on Railway, static frontend on GitHub Pages) using parallel swarm agents. Two questions: (1) Does the shared spec pattern from the health journal fix scale to multi-service? (2) What new risks appear when the architecture grows?

## Solution

### Shared Spec Pattern — Validated at Scale

The shared interface spec (embedded in the plan doc) defined:
- Database schema (SQL)
- API endpoints with request/response shapes
- TypeScript types shared between API and frontend
- CSS class names, element IDs, data attributes
- Environment variables per service
- RLS policies

**Result: Zero interface mismatches across 5 files and 3 services.** Compared to 7 mismatches without a spec in the health journal build.

### New Risk: SSRF in Server-Side URL Fetching

The cron endpoint fetches user-provided URLs. Without protection, attackers could:
- Probe Railway's internal network (169.254.169.254 metadata, localhost, RFC 1918 ranges)
- Self-reference the API to create loops
- Exfiltrate cloud credentials via metadata endpoints

**Fix:** DNS resolution before fetch + IP blocklist (private ranges, localhost, metadata hosts). Added to both URL validation at creation time and before each cron fetch.

## Patterns

1. **Shared spec scales to multi-service** — the same document that prevented CSS mismatches also prevented API response shape mismatches. The spec is a contract between services, not just between files.
2. **SSRF is the default risk when servers fetch user URLs** — any feature where the server makes HTTP requests to user-controlled destinations needs an IP blocklist. This should be in a security checklist, not discovered in review.
3. **Timing-safe comparison for secrets** — `===` leaks info via timing side-channel. Use `crypto.timingSafeEqual()` for any secret comparison.
4. **Debounce realtime subscriptions** — Supabase Realtime fires per-row INSERT. A cron checking N sites generates N events. Without debounce, dashboard makes N * (1 + N) API calls.
5. **Generic error messages to clients** — Supabase errors contain schema info. Always `console.error` the detail and return "Internal server error" to the client.

## Risk Resolution

- **Flagged risk (plan Feed-Forward):** Multi-service deploy coordination
- **What actually happened:** Deploy coordination worked fine — the order (DB → API → frontend) was natural and each step was independently verifiable. The REAL risk was SSRF in the cron endpoint, which wasn't flagged in planning at all.
- **Lesson:** Plan Feed-Forward tends to flag operational risks (deploy order, env vars). Security risks in application logic (SSRF, injection) are harder to predict in planning and reliably surface in review. This validates the mandatory review workflow.

## Feed-Forward

- **Hardest decision:** Whether to add full auth to the API (API keys for write endpoints) or accept the sandbox risk. Chose to skip auth since this is a throwaway sandbox, but documented it as a mandatory fix for any real deployment.
- **Rejected alternatives:** Removing Supabase Realtime entirely (simplicity reviewer suggested polling). Kept it because the goal is to test full automation of complex architectures, not to build the simplest possible app.
- **Least confident:** Whether the DNS resolution SSRF protection is sufficient. DNS rebinding attacks can bypass it (resolve to public IP first, then to private IP). A production app would need a DNS pinning library or a proxy that re-resolves after redirect.
