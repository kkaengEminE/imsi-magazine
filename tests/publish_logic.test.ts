// node --test --experimental-strip-types tests/publish_logic.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRow, displayStatus, editedInCms, queueRange, sanitize } from "../supabase/functions/publish/logic.ts";

const now = new Date("2026-10-23T03:00:00Z");
const base = { external_id: "h1", title: "제목", body_html: "<p>본문</p>" };

test("required fields", () => {
  assert.equal(buildRow({ title: "t" }, now).error, "external_id, title, body_html are required");
});

test("defaults: published now, ko", () => {
  const { row } = buildRow(base, now);
  assert.equal(row!.status, "published");
  assert.equal(row!.published_at, now.toISOString());
  assert.equal(row!.language, "ko");
});

test("accepts pending, display_name and future schedule", () => {
  const { row } = buildRow({ ...base, status: "pending", display_name: "TelloWoo", published_at: "2026-10-24T00:00:00Z" }, now);
  assert.equal(row!.status, "pending");
  assert.equal(row!.display_name, "TelloWoo");
  assert.equal(row!.published_at, "2026-10-24T00:00:00Z");
});

test("unknown status falls back to published; bad date rejected; unknown category dropped", () => {
  assert.equal(buildRow({ ...base, status: "weird" }, now).row!.status, "published");
  assert.match(buildRow({ ...base, published_at: "nope" }, now).error!, /ISO 8601/);
  assert.equal(buildRow({ ...base, category: "sports" }, now).row!.category, null);
});

test("future published is scheduled", () => {
  assert.equal(displayStatus("published", "2026-10-23T04:00:00Z", now), "scheduled");
  assert.equal(displayStatus("published", "2026-10-23T02:00:00Z", now), "published");
  assert.equal(displayStatus("draft", "2026-10-24T00:00:00Z", now), "draft");
});

test("sanitize strips scripts and handlers", () => {
  assert.equal(sanitize('<p onclick="x()">a</p><script>bad()</script>'), "<p>a</p>");
});

test("CMS-edited rows are protected", () => {
  assert.equal(editedInCms({ updated_by: "u1" }), true);
  assert.equal(editedInCms({ updated_by: null }), false);
  assert.equal(editedInCms(null), false);
});

test("queue range defaults to 3 days", () => {
  const r = queueRange(new URLSearchParams(), now) as { from: string; to: string };
  assert.equal(r.from, now.toISOString());
  assert.equal(r.to, "2026-10-26T03:00:00.000Z");
  assert.ok("error" in queueRange(new URLSearchParams("from=x"), now));
});

test("API rows are marked as external and CMS-written rows are never overwritten", () => {
  assert.equal(buildRow(base, now).row!.origin, "api");
  assert.equal(editedInCms({ updated_by: null, origin: "cms" }), true);
  assert.equal(editedInCms({ updated_by: null, origin: "api" }), false);
});
