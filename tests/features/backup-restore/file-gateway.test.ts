import assert from "node:assert/strict";
import test from "node:test";

import { fileGateway } from "../../../src/features/backup-restore/file-gateway.js";

const jsonFile = (text: string, name = "backup.json"): File =>
  new File([text], name, { type: "application/json" });

test("読取前にサイズ確認しtextと実UTF-8バイト数を返す", async () => {
  const text = '{"note":"架空日本語データ"}';
  const file = jsonFile(text);

  const result = await fileGateway.read(file);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.text, text);
  assert.equal(
    result.value.byteLength,
    new TextEncoder().encode(text).byteLength,
  );
  assert.notEqual(result.value.byteLength, text.length);
});

test("サイズ超過ファイルは本文読取前にsize-exceededとして拒否される", async () => {
  let textCalled = false;
  const oversized = {
    size: 16 * 1024 * 1024 + 1,
    text: async () => {
      textCalled = true;
      return "";
    },
  } as unknown as File;

  const result = await fileGateway.read(oversized);

  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.error, { code: "size-exceeded" });
  assert.equal(textCalled, false);
});

test("本文読取に失敗した場合はunreadableとして拒否される", async () => {
  const unreadable = {
    size: 10,
    text: async () => {
      throw new Error("架空の読取失敗");
    },
  } as unknown as File;

  const result = await fileGateway.read(unreadable);

  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.error, { code: "unreadable" });
});

test("artifactをBlobとしてダウンロードしobject URLを操作後に破棄する", async () => {
  const originalCreateElement = document.createElement.bind(document);
  const originalCreateObjectURL = URL.createObjectURL.bind(URL);
  const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);
  const originalClick = HTMLAnchorElement.prototype.click;

  const createdUrls: string[] = [];
  const revokedUrls: string[] = [];
  const blobs: Blob[] = [];
  let clickedHref: string | undefined;
  let clickedDownload: string | undefined;

  URL.createObjectURL = ((blob: Blob) => {
    blobs.push(blob);
    const url = originalCreateObjectURL(blob);
    createdUrls.push(url);
    return url;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((url: string) => {
    revokedUrls.push(url);
    return originalRevokeObjectURL(url);
  }) as typeof URL.revokeObjectURL;
  HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    clickedHref = this.href;
    clickedDownload = this.download;
  };

  try {
    const artifact = {
      filename: "pc-build-planner-backup-2026-07-24.json",
      mimeType: "application/json" as const,
      json: '{"note":"架空バックアップ本文"}',
      byteLength: 10,
    };

    const result = fileGateway.download(artifact);

    assert.equal(result.ok, true);
    assert.equal(createdUrls.length, 1);
    assert.equal(revokedUrls.length, 1);
    assert.equal(revokedUrls[0], createdUrls[0]);
    assert.equal(blobs[0]?.type, "application/json");
    const blobText = await blobs[0]?.text();
    assert.equal(blobText, artifact.json);
    assert.equal(clickedDownload, artifact.filename);
    assert.ok(clickedHref?.startsWith("blob:"));
  } finally {
    document.createElement = originalCreateElement;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    HTMLAnchorElement.prototype.click = originalClick;
  }
});
