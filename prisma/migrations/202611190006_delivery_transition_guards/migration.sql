-- Terminal or uncertain actions cannot be requeued, even through direct SQL writes.
CREATE FUNCTION enforce_delivery_action_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."executionId" <> OLD."executionId" OR NEW.kind <> OLD.kind OR NEW.mode <> OLD.mode
     OR NEW."approvalId" IS DISTINCT FROM OLD."approvalId"
     OR NEW."approvedUntil" IS DISTINCT FROM OLD."approvedUntil"
     OR NEW."rejectionEvidenceId" IS DISTINCT FROM OLD."rejectionEvidenceId" THEN
    RAISE EXCEPTION 'Delivery identity and approval are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.state <> OLD.state AND NOT (
    (OLD.state IN ('PENDING_DELIVERY','FAILED_RETRYABLE') AND NEW.state IN ('SENDING','MANUAL_REVIEW')) OR
    (OLD.state = 'SENDING' AND NEW.state IN ('ACCEPTED_BY_META','FAILED_RETRYABLE','FAILED_PERMANENT','UNKNOWN_OUTCOME','FALLBACK_ELIGIBLE','FALLBACK_ACCEPTED_BY_META')) OR
    (OLD.state IN ('UNKNOWN_OUTCOME','FAILED_PERMANENT') AND NEW.state = 'MANUAL_REVIEW')
  ) THEN
    RAISE EXCEPTION 'Unsafe delivery transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER delivery_action_transition BEFORE UPDATE ON "DeliveryAction"
FOR EACH ROW EXECUTE FUNCTION enforce_delivery_action_transition();

CREATE FUNCTION enforce_message_attempt_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE action "DeliveryAction";
BEGIN
  SELECT * INTO action FROM "DeliveryAction" WHERE id = NEW."actionId" FOR UPDATE;
  IF NOT FOUND OR action.state <> 'SENDING' OR action."activeAttemptId" IS DISTINCT FROM NEW.id
     OR action.attempts <> NEW.number OR NEW.state <> 'SENDING' THEN
    RAISE EXCEPTION 'Attempt requires an owned durable sending claim' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "MessageAttempt" WHERE "actionId" = NEW."actionId" AND state <> 'FAILED_RETRYABLE') THEN
    RAISE EXCEPTION 'Prior attempt is not safely retryable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER message_attempt_insert BEFORE INSERT ON "MessageAttempt"
FOR EACH ROW EXECUTE FUNCTION enforce_message_attempt_insert();

CREATE FUNCTION enforce_message_attempt_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW."actionId" <> OLD."actionId" OR NEW.number <> OLD.number
     OR OLD.state <> 'SENDING'
     OR NEW.state NOT IN ('ACCEPTED_BY_META','FAILED_RETRYABLE','FAILED_PERMANENT','UNKNOWN_OUTCOME','FALLBACK_ELIGIBLE','FALLBACK_ACCEPTED_BY_META') THEN
    RAISE EXCEPTION 'Unsafe attempt transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER message_attempt_transition BEFORE UPDATE ON "MessageAttempt"
FOR EACH ROW EXECUTE FUNCTION enforce_message_attempt_transition();
