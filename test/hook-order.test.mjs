// A dependency array is evaluated DURING RENDER, at the point its hook call appears.
// So a hook placed above the useState it depends on throws
// "Cannot access 'x' before initialization" and takes the component into the error
// boundary — for us, the entire map, on every load, in production.
//
// Three things made that bug survive: `next build` compiles it happily (it is a
// runtime error), optional chaining looks like it should protect you (it does not —
// the temporal dead zone rejects touching the binding at all), and the repo has no
// linter. This test is the guard those three gaps left open.

import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const COMPONENTS_DIR = new URL("../app/components/", import.meta.url).pathname;

// `const [x, setX] = useState(…)` / `const x = useMemo(…)` / `const x = useRef(…)`
const DESTRUCTURED = /^\s*const\s*\[\s*(\w+)\s*,\s*\w+\s*\]\s*=\s*use[A-Z]\w*\(/;
const SINGLE = /^\s*const\s+(\w+)\s*=\s*use[A-Z]\w*\(/;

function declarationLines(source) {
  const lines = source.split("\n");
  const declared = new Map();
  lines.forEach((line, index) => {
    const match = DESTRUCTURED.exec(line) ?? SINGLE.exec(line);
    // First declaration wins: a name redeclared in a nested scope is a different
    // binding, and the outer one is what a dependency array higher up would reach.
    if (match && !declared.has(match[1])) declared.set(match[1], index + 1);
  });
  return declared;
}

// Walk a `use…(` call from its opening paren to the matching close, tracking nesting
// and skipping over strings, template literals and comments so their brackets and
// commas cannot be miscounted. Returns the span of the call's final argument.
function finalArgumentOf(source, openParen) {
  let depth = 0;
  let lastTopLevelComma = -1;

  for (let i = openParen; i < source.length; i += 1) {
    const character = source[i];
    const pair = source.slice(i, i + 2);

    if (pair === "//") { i = source.indexOf("\n", i); if (i === -1) break; continue; }
    if (pair === "/*") { i = source.indexOf("*/", i) + 1; if (i === 0) break; continue; }
    if (character === '"' || character === "'" || character === "`") {
      i += 1;
      while (i < source.length && source[i] !== character) i += source[i] === "\\" ? 2 : 1;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") depth += 1;
    else if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
      if (depth === 0) return { start: lastTopLevelComma + 1, end: i };
    } else if (character === "," && depth === 1) lastTopLevelComma = i;
  }
  return null;
}

const lineOf = (source, index) => source.slice(0, index).split("\n").length;

// Every hook dependency array in the file, as { line, identifiers }. A dependency
// array is the final argument of a `use…()` call, so that is what we look for —
// rather than a line shape, which misses `useEffect(() => {}, [x])` written inline.
function dependencyArrays(source) {
  const found = [];

  for (const match of source.matchAll(/\buse[A-Z]\w*\s*\(/g)) {
    const openParen = match.index + match[0].length - 1;
    const span = finalArgumentOf(source, openParen);
    if (!span) continue;

    const argument = source.slice(span.start, span.end);
    const bracket = argument.indexOf("[");
    // Only an array literal is a dependency array; a call with one argument, or one
    // ending in anything else, has none.
    if (bracket === -1 || argument.slice(0, bracket).trim() !== "") continue;

    // Bare identifiers only — `a?.b` and `a.b` both contribute `a`, which is the
    // binding the temporal dead zone actually guards.
    const identifiers = new Set();
    for (const identifier of argument.matchAll(/([A-Za-z_$][\w$]*)\s*(?:\??\.\s*[\w$]+)*/g)) {
      identifiers.add(identifier[1]);
    }
    found.push({ line: lineOf(source, span.start + bracket), identifiers: [...identifiers] });
  }

  return found;
}

const componentFiles = readdirSync(COMPONENTS_DIR)
  .filter((file) => file.endsWith(".jsx") || file.endsWith(".js"));

test("no hook depends on a value declared below it", () => {
  assert.ok(componentFiles.length > 0, "expected component files to scan");
  const problems = [];

  for (const file of componentFiles) {
    const source = readFileSync(join(COMPONENTS_DIR, file), "utf8");
    const declared = declarationLines(source);

    for (const deps of dependencyArrays(source)) {
      for (const identifier of deps.identifiers) {
        const declaredAt = declared.get(identifier);
        if (declaredAt !== undefined && declaredAt > deps.line) {
          problems.push(
            `${file}: dependency array on line ${deps.line} reads "${identifier}", ` +
            `which is not declared until line ${declaredAt}`,
          );
        }
      }
    }
  }

  assert.deepEqual(problems, [], `\n${problems.join("\n")}\n`);
});

// The detector itself has to be known-good, or a green test proves nothing.
test("the check catches the exact shape that broke production", () => {
  const broken = [
    "export default function Component() {",
    "  const [imageAttribution, setImageAttribution] = useState({});",
    "  useEffect(() => {",
    "    const url = activeLocation?.now;",
    "  }, [activeLocation?.now, imageAttribution]);",
    "  const [activeLocation, setActiveLocation] = useState(null);",
    "}",
  ].join("\n");

  const declared = declarationLines(broken);
  assert.equal(declared.get("activeLocation"), 6);

  const [deps] = dependencyArrays(broken);
  assert.equal(deps.line, 5);
  assert.ok(deps.identifiers.includes("activeLocation"));
  assert.ok(declared.get("activeLocation") > deps.line, "should be flagged as used-before-declared");
});

test("the check does not flag a hook placed correctly", () => {
  const fine = [
    "export default function Component() {",
    "  const [activeLocation, setActiveLocation] = useState(null);",
    "  useEffect(() => {}, [activeLocation?.now]);",
    "}",
  ].join("\n");

  const declared = declarationLines(fine);
  const [deps] = dependencyArrays(fine);
  assert.ok(declared.get("activeLocation") < deps.line);
});

test("a multi-line dependency array is read whole", () => {
  // Truncating at the newline would silently skip the identifiers below it.
  const source = [
    "  useEffect(() => {}, [",
    "    alpha,",
    "    beta,",
    "  ]);",
  ].join("\n");
  const [deps] = dependencyArrays(source);
  assert.ok(deps.identifiers.includes("alpha"));
  assert.ok(deps.identifiers.includes("beta"));
});
