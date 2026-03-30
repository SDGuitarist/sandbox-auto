---
tags: [swarm, parallel-agents, automation, css, javascript, alignment]
module: sandbox-auto
problem: Parallel swarm agents building HTML/CSS/JS created 7 class name mismatches
severity: P2
lesson: Swarm agents need a shared interface specification to stay aligned
---

# Swarm Build Alignment — Shared Interface Spec Pattern

## Problem

Three agents built health/styles.css, health/index.html, and health/app.js in parallel. Without shared context, each agent invented its own naming conventions:

- CSS used `.selected`, JS used `.active`
- CSS used `.stat-number`, HTML used `.card-number`
- CSS used `.chart-grid`, HTML used `.charts-grid`
- CSS used `.btn-save`, HTML used `.save-btn`
- CSS used `.btn-delete`, JS rendered `.delete-btn`
- JS rendered bare type classes (`symptom`), CSS expected prefixed (`type-symptom`)
- JS toggled `.hidden` for views, CSS used `.active`

## Solution

Before launching parallel agents, write a **shared interface spec** that defines:
1. All CSS class names and what they style
2. All HTML element IDs
3. Data attributes used for JS targeting
4. Class names toggled by JS for state changes
5. Data model shape (localStorage keys and structure)

Every agent prompt must include "Read shared-spec.md first and follow it exactly."

## Patterns

- The spec is a **contract between agents** — not a full design doc, just the interface surface
- Keep it under 100 lines so it doesn't eat context
- For 3-file static apps, the spec needs: class names, IDs, toggle classes, data attributes
- For larger apps, the spec would also need: function signatures, event names, API endpoints

## Risk Resolution

- **Flagged risk:** Chart.js integration complexity
- **What actually happened:** Chart.js worked fine. The real risk was agent coordination, not library complexity.
- **Lesson:** When parallelizing work, the integration surface between agents is the primary risk, not the technical difficulty of any single agent's task.

## Feed-Forward

- **Hardest decision:** Whether to fix CSS to match JS or vice versa. Chose to fix CSS since JS was the runtime source of truth.
- **Rejected alternatives:** Could have re-run all 3 agents with a shared spec instead of manually fixing. Chose manual fix because it was faster and the mismatches were well-defined.
- **Least confident:** Whether the shared spec pattern scales beyond 3 files. For 10+ file swarms, may need a different coordination mechanism (e.g., one agent writes interfaces first, others implement).
