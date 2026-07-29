import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { API } from "typescript/unstable/sync";

/**
 * TypeScript 7 exposes compiler ASTs through its sync snapshot API.
 * Keep the snapshot alive for the whole consumer callback because remote AST
 * nodes lazily decode child properties from the snapshot buffer.
 * @template T
 * @param {readonly { readonly path: string, readonly source: string }[]} sources
 * @param {(asts: readonly import("typescript/unstable/ast").SourceFile[]) => T} consume
 * @returns {T}
 */
export const withTypeScriptAsts = (sources, consume) => {
  if (sources.length === 0) return consume([]);
  const directory = mkdtempSync(join(tmpdir(), "pcbp-boundary-ast-"));
  try {
    const paths = sources.map(({ path, source }, index) => {
      const extension = [".ts", ".tsx", ".js", ".jsx"].includes(extname(path))
        ? extname(path)
        : ".ts";
      const file = join(directory, `${index}${extension}`);
      writeFileSync(file, source, "utf8");
      return file;
    });
    const api = new API();
    try {
      const snapshot = api.updateSnapshot({ openFiles: paths });
      try {
        const asts = paths.map((path) => {
          const project = snapshot.getDefaultProjectForFile(path);
          if (project === undefined)
            throw new Error(`TypeScript project unavailable for ${path}`);
          const diagnostics = project.program.getSyntacticDiagnostics(path);
          if (diagnostics.length > 0) {
            const codes = diagnostics.map(({ code }) => `TS${code}`).join(", ");
            throw new Error(
              `TypeScript syntactic diagnostics for ${path}: ${codes}`,
            );
          }
          const sourceFile = project.program.getSourceFile(path);
          if (sourceFile === undefined)
            throw new Error(`TypeScript AST unavailable for ${path}`);
          return sourceFile;
        });
        return consume(asts);
      } finally {
        snapshot.dispose();
      }
    } finally {
      api.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};
