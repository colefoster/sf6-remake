# ADR 0001 — A frame-data engine, not a game simulation

- Status: accepted
- Date: 2026-08-03

## Context

The goal is to answer questions like "does X into Y from scenario Z end plus or
minus, and is it punishable?" Two ways to get there:

1. Simulate SF6 frame-by-frame — two players on a shared clock, boxes colliding,
   hitstun/blockstun/pushback resolved from geometry and physics.
2. Compute the answer directly from published **frame data** (startup, active,
   recovery, on-block, on-hit) using the algebraic identities that relate them.

## Decision

Build the **frame-data engine** (option 2). The questions we care about —
plus/minus, punishability, blockstring gaps, cancel endings, meaty timing — are
all closed-form functions of frame data. See `CONTEXT.md` for the identities.

## Consequences

- The engine is small, fully deterministic, and cheap to test exhaustively
  against real numbers. No physics, no RNG, no rendering.
- It answers *frame* questions exactly. It does **not** answer *spacing*
  questions (does the move actually reach? is this a whiff punish? crossup?) —
  those need geometry we don't have (ADR-0003).
- Advantage (`onBlock`/`onHit`) is the single source of truth; blockstun and
  hitstun are derived from it when a query needs them, so the data stays minimal
  and internally consistent.
