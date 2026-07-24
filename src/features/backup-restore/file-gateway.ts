import type { Result } from "../../domain/public.js";
import { err, ok } from "../../domain/public.js";
import type { BackupArtifact, FileError, RestoreInput } from "./contracts.js";
import { MAX_RESTORE_INPUT_BYTES } from "./contracts.js";

export interface FileGateway {
  read(file: File): Promise<Result<RestoreInput, FileError>>;
  download(artifact: BackupArtifact): Result<void, FileError>;
}

/** DOM固有I/Oだけを担う。内容解釈やRepositoryアクセスはしない。 */
export const fileGateway: FileGateway = {
  async read(file) {
    if (file.size > MAX_RESTORE_INPUT_BYTES)
      return err({ code: "size-exceeded" });

    let text: string;
    try {
      text = await file.text();
    } catch {
      return err({ code: "unreadable" });
    }

    return ok({
      text,
      byteLength: new TextEncoder().encode(text).byteLength,
    });
  },

  download(artifact) {
    try {
      const blob = new Blob([artifact.json], { type: artifact.mimeType });
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = artifact.filename;
        anchor.click();
      } finally {
        URL.revokeObjectURL(url);
      }
      return ok(undefined);
    } catch {
      return err({ code: "unreadable" });
    }
  },
};
