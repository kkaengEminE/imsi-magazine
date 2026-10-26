// node --test --experimental-strip-types tests/admin_users_logic.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { leavesNoAdmin, validate } from "../supabase/functions/admin-users/logic.ts";

const accounts = [
  { user_id: "a1", role: "admin", active: true },
  { user_id: "e1", role: "editor", active: true },
];

test("create needs email, 8+ char password, name and a known role", () => {
  assert.equal(validate("create", { email: "x@im.si", password: "12345678", display_name: "x", role: "editor" }), null);
  assert.match(validate("create", { email: "nope", password: "12345678", display_name: "x", role: "editor" })!, /이메일/);
  assert.match(validate("create", { email: "x@im.si", password: "short", display_name: "x", role: "editor" })!, /8자/);
  assert.match(validate("create", { email: "x@im.si", password: "12345678", display_name: "x", role: "owner" })!, /역할/);
});

test("delete needs someone else to take over the articles", () => {
  assert.match(validate("delete", { user_id: "e1" })!, /넘겨받을/);
  assert.match(validate("delete", { user_id: "e1", transfer_to: "e1" })!, /넘길 수 없어요/);
  assert.equal(validate("delete", { user_id: "e1", transfer_to: "a1" }), null);
});

test("unknown actions are rejected", () => {
  assert.match(validate("drop_all", {})!, /알 수 없는/);
});

test("the last active admin cannot be demoted, stopped or removed", () => {
  assert.equal(leavesNoAdmin(accounts, "a1", { role: "editor" }), true);
  assert.equal(leavesNoAdmin(accounts, "a1", { active: false }), true);
  assert.equal(leavesNoAdmin(accounts, "a1", { remove: true }), true);
  assert.equal(leavesNoAdmin(accounts, "e1", { role: "admin" }), false);
  assert.equal(leavesNoAdmin([...accounts, { user_id: "a2", role: "admin", active: true }], "a1", { remove: true }), false);
});
