import test from "node:test";
import assert from "node:assert/strict";
import { formatSourceMutationProof } from "./source-mutation-proof";

test("formats source mutation proof", () => {
  assert.equal(formatSourceMutationProof(" Forge "), "forge-source:forge");
  assert.equal(formatSourceMutationProof("SOURCE"), "forge-source:source");
});