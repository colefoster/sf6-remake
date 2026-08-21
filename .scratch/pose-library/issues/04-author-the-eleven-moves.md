# 04 — Author the eleven moves

Status: ready-for-agent
Blocked by: 03

~50 poses, in two passes.

## Pass 1 — the agent seeds all of them

Write every pose as JSON from anatomy and from the move's own frame data. A jab
is a straight lead arm on `contact`; a sweep is a low extended rear leg; a
shoryuken rises. Fifty poses in one pass is cheap and none of it needs taste —
it needs a body plan and the phase anchors.

Render a contact sheet of the seeds so the next pass is looking at pictures
rather than reading numbers.

**Do not declare them good.** The agent's job here is coverage, not judgement.

## Pass 2 — the human corrects

Load each seed in the editor, drag what is wrong, save. Seconds per pose, not
minutes.

## The question this pass answers

Do normalised poses transfer between builds, or does Blanka need overrides? His
arms are 1.37x the roster median and Zangief stands 14% wider. Author for Ryu,
then load the same file on those two and look.
