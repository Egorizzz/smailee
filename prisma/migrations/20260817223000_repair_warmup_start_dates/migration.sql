-- Before this fix, switching a customer mailbox to seed only changed isSeed.
-- The mailbox kept its active ramp state but the worker skipped it forever.
-- Historical service seed mailboxes were created with warmupState=off, so repair only
-- the inconsistent state produced by that old toggle and leave real seed mailboxes alone.
UPDATE "Mailbox" AS mailbox
SET
  "isSeed" = false,
  "warmupStartedAt" = COALESCE(mailbox."warmupStartedAt", mailbox."createdAt"),
  "warmupDay" = GREATEST(
    1,
    FLOOR(
      EXTRACT(
        EPOCH FROM (
          CURRENT_TIMESTAMP - COALESCE(mailbox."warmupStartedAt", mailbox."createdAt")
        )
      ) / 86400
    )::INTEGER + 1
  )
WHERE mailbox."isSeed" = true
  AND mailbox."warmupState" IN ('warming', 'warm');

-- Calendar warmup starts when a mailbox is successfully connected, not on the first
-- worker pass. Repair only mailboxes without a successful warmup send so that existing
-- warmup history is not rewritten.
UPDATE "Mailbox" AS mailbox
SET
  "warmupState" = 'warming',
  "warmupStartedAt" = mailbox."createdAt",
  "warmupDay" = GREATEST(
    1,
    FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - mailbox."createdAt")) / 86400)::INTEGER + 1
  )
WHERE mailbox."isSeed" = false
  AND mailbox."connState" IN ('ok', 'paused')
  AND NOT EXISTS (
    SELECT 1
    FROM "WarmupEvent" AS event
    WHERE event."senderMailboxId" = mailbox."id"
      AND event."status" <> 'failed'
  )
  AND (
    mailbox."warmupState" = 'off'
    OR mailbox."warmupStartedAt" IS NULL
    OR (
      mailbox."warmupState" = 'warming'
      AND mailbox."warmupDay" <= 1
      AND mailbox."warmupStartedAt" > mailbox."createdAt" + INTERVAL '12 hours'
    )
  );
