// Load TypeScript's published JavaScript artifacts directly. The query suffix
// prevents the repository's tsx test hook from rewriting dependency .js paths
// to non-existent TypeScript source paths during the full test run.
const scannerModule = "../node_modules/typescript/dist/ast/scanner.js?tooling";
const syntaxKindModule =
  "../node_modules/typescript/dist/enums/syntaxKind.js?tooling";

/** @type {typeof import("typescript/unstable/ast/scanner").createScanner} */
export const createScanner = (await import(scannerModule)).createScanner;
/** @type {typeof import("typescript/unstable/ast").SyntaxKind} */
export const SyntaxKind = (await import(syntaxKindModule)).SyntaxKind;
