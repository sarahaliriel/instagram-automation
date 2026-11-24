import "server-only";
import { parseDeliverySettings } from "./settings-schema";
export function getDeliverySettings(now = new Date()) {
  return parseDeliverySettings(process.env, now);
}
