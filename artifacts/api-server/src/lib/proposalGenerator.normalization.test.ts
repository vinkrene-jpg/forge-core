import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProposalFiles } from "./proposalGenerator";

const parsed = { moduleName: "broken-ai-proposal" };

test("creates missing package.json and required scripts", () => {
  const files = [
    { path: "index.js", content: "module.exports = { ok: true };\n" },
    { path: "test/index.test.js", content: "const test = require('node:test');\n" },
  ];
  const result = normalizeProposalFiles(parsed, files);
  const pkg = JSON.parse(result.packageFile.content);
  assert.equal(result.entry, "index.js");
  assert.equal(result.testFile, "test/index.test.js");
  assert.equal(pkg.name, "broken-ai-proposal");
  assert.equal(pkg.scripts.lint, "node --check index.js");
  assert.equal(pkg.scripts.typecheck, "node --check index.js");
  assert.equal(pkg.scripts.build, "node --check index.js");
  assert.equal(pkg.scripts.test, "node --test --test-isolation=none");
});

test("repairs malformed package.json", () => {
  const files = [
    { path: "index.js", content: "module.exports = {};\n" },
    { path: "index.test.js", content: "require('node:test');\n" },
    { path: "package.json", content: "{broken json" },
  ];
  const pkg = JSON.parse(normalizeProposalFiles(parsed, files).packageFile.content);
  assert.equal(pkg.name, "broken-ai-proposal");
  assert.equal(pkg.scripts.test, "node --test --test-isolation=none");
});

test("preserves valid scripts", () => {
  const files = [
    { path: "main.js", content: "module.exports = {};\n" },
    { path: "test/main.test.js", content: "require('node:test');\n" },
    {
      path: "package.json",
      content: JSON.stringify({
        name: "custom",
        scripts: {
          lint: "node --check main.js",
          typecheck: "node --check main.js",
          build: "node --check main.js",
          test: "node --test --test-isolation=none",
        },
      }),
    },
  ];
  const pkg = JSON.parse(normalizeProposalFiles(parsed, files).packageFile.content);
  assert.equal(pkg.name, "custom");
  assert.equal(pkg.scripts.lint, "node --check main.js");
});

test("blocks missing entry", () => {
  assert.throws(
    () => normalizeProposalFiles(parsed, [
      { path: "test/index.test.js", content: "require('node:test');\n" },
    ]),
    /no executable JavaScript entry file/,
  );
});

test("blocks missing test", () => {
  assert.throws(
    () => normalizeProposalFiles(parsed, [
      { path: "index.js", content: "module.exports = {};\n" },
    ]),
    /no JavaScript test file/,
  );
});