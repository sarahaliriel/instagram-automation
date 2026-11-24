-- Commit the enum value before any constraint uses it.
ALTER TYPE "EventState" ADD VALUE 'READY_FOR_DELIVERY';
