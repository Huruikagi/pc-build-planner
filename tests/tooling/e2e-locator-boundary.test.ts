import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import {
  createScanner,
  SyntaxKind,
} from "../../scripts/typescript-scanner.mjs";

interface RawLocatorCall {
  readonly column: number;
  readonly line: number;
  readonly path: string;
}

function findRawLocatorCalls(path: string, source: string): RawLocatorCall[] {
  const scanner = createScanner(true, undefined, source);
  const calls: RawLocatorCall[] = [];
  let previousKind = SyntaxKind.Unknown;
  let previousText = "";
  let previousStart = 0;
  const templateHoleDepths: number[] = [];

  let kind = scanner.scan();
  while (kind !== SyntaxKind.EndOfFile) {
    const top = templateHoleDepths.length - 1;
    if (kind === SyntaxKind.TemplateHead) {
      templateHoleDepths.push(0);
    } else if (kind === SyntaxKind.OpenBraceToken && top >= 0) {
      templateHoleDepths[top] = (templateHoleDepths[top] ?? 0) + 1;
    } else if (kind === SyntaxKind.CloseBraceToken && top >= 0) {
      if (templateHoleDepths[top] === 0) {
        kind = scanner.reScanTemplateToken(false);
        if (kind === SyntaxKind.TemplateTail) templateHoleDepths.pop();
      } else {
        templateHoleDepths[top] = (templateHoleDepths[top] ?? 0) - 1;
      }
    }
    if (
      kind === SyntaxKind.OpenParenToken &&
      previousKind === SyntaxKind.Identifier &&
      previousText === "locator"
    ) {
      const prefix = source.slice(0, previousStart);
      const lineStart = prefix.lastIndexOf("\n") + 1;
      const preceding = source.slice(0, lineStart).split("\n").length;
      const priorToken = source.slice(0, previousStart).trimEnd().at(-1);
      if (priorToken === ".") {
        calls.push({
          column: previousStart - lineStart + 1,
          line: preceding,
          path,
        });
      }
    }
    previousKind = kind;
    previousText = scanner.getTokenText();
    previousStart = scanner.getTokenStart();
    kind = scanner.scan();
  }
  return calls;
}

test("E2E specは生のlocator呼び出しを持たず共有ヘルパへ識別手順を集約する", async () => {
  const specPaths = (await readdir("e2e"))
    .filter((name) => name.endsWith(".spec.ts"))
    .map((name) => `e2e/${name}`);
  const calls = (
    await Promise.all(
      specPaths.map(async (path) =>
        findRawLocatorCalls(path, await readFile(path, "utf8")),
      ),
    )
  ).flat();

  assert.deepEqual(
    calls,
    [],
    `生のlocator呼び出しはe2e/locators.tsの意味別ヘルパへ移してください:\n${calls
      .map(({ column, line, path }) => `${path}:${line}:${column}`)
      .join("\n")}`,
  );
});
