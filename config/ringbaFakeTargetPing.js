/**
 * Fake Ring Tree Target ping — always reject, optional shared secret.
 *
 * Ringba RTT URL example:
 * /webhooks/ringba/fake-target-ping?token=SECRET&callId=[Call:InboundCallId]&callerId=[tag:InboundNumber:Number]&zipCode=[tag:User:zip]&state=[tag:InboundNumber:State]
 */
const RINGBA_FAKE_TARGET_PING_TOKEN =
  process.env.RINGBA_FAKE_TARGET_PING_TOKEN || "";

/** Response shape for Ringba RTT parsing (always reject; never route calls). */
const REJECT_RESPONSE = Object.freeze({
  available: false,
  bid: 0,
  duration: 0,
});

module.exports = {
  RINGBA_FAKE_TARGET_PING_TOKEN,
  REJECT_RESPONSE,
};
