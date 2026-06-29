// LifeLine Mesh — Unit Test Harness
// Run directly in a browser console or as a standalone HTML test page

import { BloomFilter } from "../src/routing/bloomFilter.js";
import { PriorityQueue } from "../src/routing/priorityQueue.js";
import { MessageLog } from "../src/crdt/messageLog.js";
import { incrementClock, mergeClock, happenedBefore, areConcurrent, isIdentical } from "../src/crdt/vectorClock.js";
import { createMessage, validateMessageShape, PRIORITY, hasExpired } from "../src/schema.js";

const TESTS_PASSED = [];
const TESTS_FAILED = [];

function assert(condition, description) {
  if (condition) {
    TESTS_PASSED.push(description);
    console.log(`  ✅ ${description}`);
  } else {
    TESTS_FAILED.push(description);
    console.error(`  ❌ ${description}`);
  }
}

function assertEqual(actual, expected, description) {
  const a = typeof actual === "object" ? JSON.stringify(actual) : String(actual);
  const e = typeof expected === "object" ? JSON.stringify(expected) : String(expected);
  assert(a === e, `${description} (expected: ${e}, got: ${a})`);
}

// ─── Schema Tests ───────────────────────────────────────────────────────────

console.group("📐 Schema Tests");

assert(validateMessageShape(createMessage({
  senderId: "test-device",
  priority: PRIORITY.NORMAL,
  vectorClock: {},
  payload: "hello",
})), "createMessage produces valid shape");

const msg = createMessage({
  senderId: "test",
  priority: PRIORITY.SOS,
  vectorClock: { test: 1 },
  payload: "SOS test",
});
assert(msg.priority === "sos", "SOS priority is set correctly");
assert(msg.hopCount === 0, "hopCount starts at 0");
assert(msg.ttl === 8, "default TTL is 8");
assert(validateMessageShape(msg), "SOS message validates");

assert(!hasExpired(msg), "fresh message has not expired");
msg.hopCount = 8;
assert(hasExpired(msg), "message with hopCount >= TTL has expired");
msg.hopCount = 0;

assert(!validateMessageShape(null), "null is invalid");
assert(!validateMessageShape({}), "empty object is invalid");
assert(!validateMessageShape({ id: "test" }), "partial object is invalid");

console.groupEnd();

// ─── Bloom Filter Tests ─────────────────────────────────────────────────────

console.group("🌿 Bloom Filter Tests");

const bf = new BloomFilter(960, 4);
const testIds = [];
for (let i = 0; i < 100; i++) {
  const id = crypto.randomUUID();
  testIds.push(id);
  bf.add(id);
}

let falseNegatives = 0;
for (const id of testIds) {
  if (!bf.mightContain(id)) falseNegatives++;
}
assert(falseNegatives === 0, `zero false negatives across ${testIds.length} inserted IDs`);

let numFalsePositives = 0;
const trials = 1000;
for (let i = 0; i < trials; i++) {
  const randomId = crypto.randomUUID();
  if (!testIds.includes(randomId) && bf.mightContain(randomId)) {
    numFalsePositives++;
  }
}
const fpRate = numFalsePositives / trials;
assert(fpRate < 0.05, `false positive rate acceptable: ${(fpRate * 100).toFixed(2)}%`);

const bfClone = bf.clone();
assert(bfClone.mightContain(testIds[0]), "cloned filter retains membership");

bf.clear();
assert(!bf.mightContain(testIds[0]), "cleared filter reports nothing");

assert(BloomFilter.optimalSize(1000, 0.01) > 0, "optimalSize returns positive value");
assert(BloomFilter.optimalHashes(1000, 9600) > 0, "optimalHashes returns positive value");

console.groupEnd();

// ─── Priority Queue Tests ───────────────────────────────────────────────────

console.group("📊 Priority Queue Tests");

const pq = new PriorityQueue();

pq.enqueue({ id: "1", priority: "chat", text: "chat msg" });
pq.enqueue({ id: "2", priority: "normal", text: "normal msg" });
pq.enqueue({ id: "3", priority: "sos", text: "SOS msg" });

assertEqual(pq.size, 3, "queue has 3 items");

const first = pq.dequeue();
assertEqual(first.id, "3", "SOS dequeued first despite being enqueued last");

const second = pq.dequeue();
assertEqual(second.id, "2", "normal dequeued second");

const third = pq.dequeue();
assertEqual(third.id, "1", "chat dequeued third");

assert(pq.dequeue() === null, "empty queue returns null");
assertEqual(pq.size, 0, "queue is empty");

pq.enqueue({ id: "a", priority: "sos" });
pq.enqueue({ id: "b", priority: "sos" });
const bucketSizes = pq.getBucketSizes();
assertEqual(bucketSizes.sos, 2, "SOS bucket has 2 items");
pq.clear();
assertEqual(pq.size, 0, "cleared queue is empty");

console.groupEnd();

// ─── Vector Clock Tests ─────────────────────────────────────────────────────

console.group("🕐 Vector Clock Tests");

let clockA = {};
clockA = incrementClock(clockA, "device1");
assertEqual(clockA.device1, 1, "incrementClock: device1 -> 1");

clockA = incrementClock(clockA, "device1");
assertEqual(clockA.device1, 2, "incrementClock: device1 -> 2");

clockA = incrementClock(clockA, "device2");
assertEqual(clockA.device2, 1, "incrementClock: device2 -> 1");

let clockB = { device1: 1, device2: 2 };
let clockC = { device1: 2, device2: 1 };

const merged = mergeClock(clockB, clockC);
assertEqual(merged.device1, 2, "mergeClock picks max for device1");
assertEqual(merged.device2, 2, "mergeClock picks max for device2");

assert(happenedBefore({ device1: 1 }, { device1: 2 }), "happenedBefore: 1 < 2");
assert(!happenedBefore({ device1: 2 }, { device1: 1 }), "happenedBefore: 2 > 1 is false");
assert(!happenedBefore({ device1: 1 }, { device1: 1 }), "happenedBefore: equal is false");

assert(areConcurrent({ device1: 1 }, { device2: 1 }), "areConcurrent: different devices");
assert(!areConcurrent({ device1: 1 }, { device1: 2 }), "not concurrent when one happened before");

assert(isIdentical({ a: 1, b: 2 }, { a: 1, b: 2 }), "isIdentical: identical clocks");
assert(!isIdentical({ a: 1 }, { a: 1, b: 2 }), "isIdentical: different clocks");

console.groupEnd();

// ─── MessageLog (CRDT G-Set) Tests ──────────────────────────────────────────

console.group("📝 MessageLog CRDT Tests");

const log = new MessageLog();

const m1 = createMessage({ senderId: "dev1", priority: "normal", vectorClock: { dev1: 1 }, payload: "first" });
const m2 = createMessage({ senderId: "dev1", priority: "normal", vectorClock: { dev1: 2 }, payload: "second" });

assert(log.add(m1), "first add returns true");
assert(!log.add(m1), "duplicate add returns false (idempotent)");
assertEqual(log.getCount(), 1, "log size is 1 after dedup");

log.add(m2);
assertEqual(log.getCount(), 2, "log size is 2 after unique add");

assert(log.has(m1.id), "has() returns true for existing message");
assert(!log.has("non-existent"), "has() returns false for missing message");

const retrieved = log.get(m1.id);
assertEqual(retrieved.id, m1.id, "get() retrieves by ID");

// CRDT Merge Test — the core property
const logA = new MessageLog();
const logB = new MessageLog();

logA.add(createMessage({ senderId: "dev1", priority: "normal", vectorClock: { dev1: 1 }, payload: "A1" }));
logA.add(createMessage({ senderId: "dev1", priority: "normal", vectorClock: { dev1: 2 }, payload: "A2" }));

logB.add(createMessage({ senderId: "dev2", priority: "sos", vectorClock: { dev2: 1 }, payload: "B1" }));
logB.add(createMessage({ senderId: "dev2", priority: "normal", vectorClock: { dev2: 2 }, payload: "B2" }));

const mergedAB = new MessageLog();
mergedAB.mergeWith(logA);
mergedAB.mergeWith(logB);
assertEqual(mergedAB.getCount(), 4, "merge AB produces 4 messages");

const mergedBA = new MessageLog();
mergedBA.mergeWith(logB);
mergedBA.mergeWith(logA);
assertEqual(mergedBA.getCount(), 4, "merge BA produces 4 messages");

// Commutativity check
const idsAB = mergedAB.getAllMessages().map((m) => m.id).sort();
const idsBA = mergedBA.getAllMessages().map((m) => m.id).sort();
assertEqual(JSON.stringify(idsAB), JSON.stringify(idsBA), "merge is commutative (same IDs regardless of order)");

const sorted = log.getSortedForDisplay("asc");
assert(sorted.length >= 2, "getSortedForDisplay returns messages");
assert(sorted[0].timestamp <= sorted[1].timestamp, "messages are in ascending order");

const json = log.toJSON();
const restored = MessageLog.fromJSON(json);
assertEqual(restored.getCount(), log.getCount(), "serialization round-trip preserves count");

const pruned = log.pruneBeforeTimestamp(Date.now() + 100000);
assertEqual(pruned, 2, "pruneBeforeTimestamp removes old messages");

console.groupEnd();

// ─── Summary ────────────────────────────────────────────────────────────────

console.log("\n═══════════════════════════════════════");
console.log(`📊 Results: ${TESTS_PASSED.length} passed, ${TESTS_FAILED.length} failed`);
console.log("═══════════════════════════════════════\n");

if (TESTS_FAILED.length > 0) {
  console.error("Failed tests:");
  TESTS_FAILED.forEach((t) => console.error(`  • ${t}`));
}

export { TESTS_PASSED, TESTS_FAILED };
