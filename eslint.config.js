// Requires: npm i -D eslint typescript-eslint
import { existsSync, readFileSync } from "node:fs";
import { builtinRules } from "eslint/use-at-your-own-risk";
import tseslint from "typescript-eslint";

function readLines(file) {
  return existsSync(file)
    ? readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
    : [];
}

// "strict" (default) or "interview". See scripts/check_no_fakes.py. Only the user edits no-fakes.profile.
const profileLines = readLines("no-fakes.profile");
const profile = profileLines.length ? profileLines[0] : "strict";
if (profileLines.length > 1 || !["strict", "interview"].includes(profile)) {
  throw new Error(`no-fakes.profile must contain 'strict' or 'interview', got ${JSON.stringify(profileLines)}`);
}
const strict = profile === "strict";

// Files the user has approved for test doubles. Only the user edits no-fakes.allow.
const allowed = readLines("no-fakes.allow").map((line) => {
  const [glob, reason] = line.split("#");
  if (!reason?.trim()) throw new Error(`no-fakes.allow: entry needs a reason after '#': ${line}`);
  return glob.trim();
});

const TEST_FILES = ["**/*.test.*", "**/*.spec.*", "**/test/**", "**/tests/**", "**/__tests__/**"];
const LITERAL = "/^(Literal|ArrayExpression|ObjectExpression|TemplateLiteral)$/";
const DOUBLE_IMPORTS = {
  patterns: [{
    group: [
      "sinon", "nock", "msw", "msw/*", "jest-mock", "jest-mock-extended", "vitest-mock-extended",
      "ts-mockito", "testdouble", "@faker-js/*", "**/__mocks__/**", "**/mocks/**",
    ],
    message: strict ? "Test doubles need user approval in no-fakes.allow." : "Test doubles belong in test files.",
  }],
};

const S = {
  envDefault: {
    selector:
      "LogicalExpression[operator=/^(\\?\\?|\\|\\|)$/][left.object.object.name='process'][left.object.property.name='env']",
    message: "Don't default env vars. Validate required config at startup and fail fast.",
  },
  // A literal 0 is exempt: it's the identity for counting and sums (`(m.get(k) ?? 0) + 1`).
  literalDefault: {
    selector: `LogicalExpression[operator=/^(\\?\\?|\\|\\|)$/][right.type=${LITERAL}]:not([right.value=0])`,
    message: "Literal default after ?? or || hides missing data. Fail instead.",
  },
  literalAssign: {
    selector: `AssignmentExpression[operator=/^(\\?\\?=|\\|\\|=)$/][right.type=${LITERAL}]:not([right.value=0])`,
    message: "Literal default after ??= or ||= hides missing data. Fail instead.",
  },
  catchNoThrow: {
    selector: "CatchClause:not(:has(ThrowStatement))",
    message: "catch block doesn't rethrow. Handle the error for real or let it propagate.",
  },
  catchOnlyLogs: {
    selector: "CatchClause > BlockStatement[body.length=1] > ExpressionStatement > CallExpression[callee.object.name='console']",
    message: "catch block that only logs swallows the error. Rethrow, or handle it for real.",
  },
  promiseCatchNoThrow: {
    selector: "CallExpression[callee.property.name='catch']:not(:has(ThrowStatement))",
    message: ".catch() without a rethrow swallows the error.",
  },
  promiseCatchLiteral: {
    selector:
      "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression[body.type=/^(Literal|ArrayExpression|ObjectExpression|Identifier)$/]",
    message: ".catch() returning a stand-in value is a silent fallback.",
  },
  notImplemented: {
    selector: "ThrowStatement > NewExpression[arguments.0.value=/not implemented/i]",
    message: "No 'not implemented' stubs in delivered code.",
  },
  suspectNames: {
    selector:
      "Identifier[name=/(^|_)(mock|fake|stub|dummy|fallback)|Mock|Fake|Stub|Dummy|Fallback|MOCK|FAKE|STUB|DUMMY|FALLBACK/]",
    message: "Names like mock/fake/stub/dummy/fallback point to a fake path. Do the real thing.",
  },
  fallbackNames: {
    selector: "Identifier[name=/(^|_)fallback|Fallback|FALLBACK/]",
    message: "A fallback path hides failures. Let the intended path fail visibly.",
  },
  doubleApis: {
    selector:
      "CallExpression[callee.object.name=/^(jest|vi)$/][callee.property.name=/^(mock|doMock|fn|spyOn|stubGlobal|stubEnv|mocked|useFakeTimers)$/]",
    message: strict ? "Test doubles need user approval in no-fakes.allow." : "Test doubles belong in test files.",
  },
  skipTests: {
    selector: "CallExpression[callee.object.name=/^(it|test|describe)$/][callee.property.name=/^(skip|only|todo)$/]",
    message: "Don't skip, focus, or stub tests.",
  },
  skipTestsX: {
    selector: "CallExpression[callee.name=/^(xit|xtest|xdescribe|fit|fdescribe)$/]",
    message: "Don't skip or focus tests.",
  },
};

// `no-restricted-syntax` takes one severity, so interview warnings go through a second copy of it.
const local = { rules: { "restricted-syntax": builtinRules.get("no-restricted-syntax") } };

const strictRules = {
  "no-console": ["error", { allow: ["error"] }],
  "no-warning-comments": ["error", {
    location: "anywhere",
    terms: [
      "todo", "fixme", "xxx", "hack", "mock", "mocked", "fake", "stub", "dummy", "fallback",
      "fall back", "placeholder", "for now", "temporary", "temporarily", "hardcoded",
      "simulate", "simulated",
    ],
  }],
  "no-restricted-imports": ["error", DOUBLE_IMPORTS],
  // `no-restricted-syntax` can only be set once per config object, so every selector lives here.
  "no-restricted-syntax": ["error",
    S.envDefault, S.literalDefault, S.literalAssign, S.catchNoThrow, S.promiseCatchNoThrow,
    S.notImplemented, S.suspectNames, S.doubleApis, S.skipTests, S.skipTestsX,
  ],
};

// Interview: honest stubs are fine (Fake*/InMemory* names, NotImplementedError, TODOs, doubles in
// tests). Silent fakes still fail: swallowed errors, stand-in values, fallback paths, skipped tests.
const interviewErrors = [S.catchOnlyLogs, S.promiseCatchLiteral, S.fallbackNames, S.skipTests, S.skipTestsX];
const interviewRules = {
  "no-warning-comments": ["warn", { location: "anywhere", terms: ["todo", "fixme"] }],
  "no-restricted-imports": ["error", DOUBLE_IMPORTS],
  "no-restricted-syntax": ["error", ...interviewErrors, S.doubleApis],
  "local/restricted-syntax": ["warn", S.envDefault, S.literalDefault, S.literalAssign],
};

export default tseslint.config(
  { ignores: ["eslint.config.*", "node_modules/**", "dist/**", "build/**"] },
  ...tseslint.configs.recommended,
  {
    // Inline `eslint-disable` comments are ignored. Exceptions go through no-fakes.allow.
    linterOptions: { noInlineConfig: true },
    plugins: { local },
    rules: {
      "no-empty": ["error", { allowEmptyCatch: false }],
      "@typescript-eslint/no-empty-function": "error",
      ...(strict ? strictRules : interviewRules),
    },
  },
  ...(strict
    ? []
    : [{
        files: TEST_FILES,
        rules: { "no-restricted-imports": "off", "no-restricted-syntax": ["error", ...interviewErrors] },
      }]),
  ...(allowed.length
    ? [{
        files: allowed,
        rules: {
          "no-restricted-syntax": "off", "no-restricted-imports": "off", "no-warning-comments": "off",
          "local/restricted-syntax": "off",
        },
      }]
    : []),
);
