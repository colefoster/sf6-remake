import { defineConfig } from "vitest/config";

/**
 * Vitest's defaults exclude `node_modules` and nothing else, which was fine
 * until agents started working in `git worktree`s under `.claude/worktrees/`.
 * Each worktree is a whole checkout with its own `tests/`, so a run from the
 * repo root collected all of them: 10 files and 266 tests became 40 and 1,066,
 * and the count stopped meaning anything. A worktree's tests are that
 * worktree's business and are run from inside it.
 */
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", ".claude/worktrees/**"],
  },
});
