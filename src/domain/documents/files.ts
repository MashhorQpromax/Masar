/** What a kept file may be: a PDF, or a picture a phone or a scanner makes. */
export const FILE_KINDS = ["pdf", "jpeg", "png", "webp"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const isFileKind = (value: unknown): value is FileKind => typeof value === "string" && (FILE_KINDS as readonly string[]).includes(value);

export const FILE_MIME: Record<FileKind, string> = {
  pdf: "application/pdf",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const EXTENSION: Record<FileKind, string> = { pdf: "pdf", jpeg: "jpg", png: "png", webp: "webp" };

/** What a file picker is told to offer. */
export const FILE_ACCEPT = Object.values(FILE_MIME).join(",");

/** The most one file may weigh. A request to the server carries one file, and the host caps a request at 4.5 MB. */
export const FILE_MAX_BYTES = 4 * 1024 * 1024;

/** The most files one paper holds: a statement photographed page by page fits, a mistake does not run away. */
export const PAPER_MAX_FILES = 12;

/** A picture's longer side after it is made smaller in the browser. A4 stays readable and the file stays light. */
export const IMAGE_MAX_SIDE = 2200;

const starts = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte);

/**
 * What a file really is, read from its first bytes. The name and the type a browser sends are not
 * trusted: a file is kept only when its own bytes say it is one of the kinds above.
 */
export function fileKind(bytes: Uint8Array): FileKind | null {
  if (starts(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";
  if (starts(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (starts(bytes, [0x52, 0x49, 0x46, 0x46]) && starts(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "webp";
  return null;
}

const NAME_MAX = 80;

/**
 * A file name safe to store and to send back in a header: no folders, no control characters, a length
 * that fits, and the extension of what the file really is.
 */
export function cleanFileName(name: string, kind: FileKind): string {
  const base = (name.split(/[\\/]/).pop() ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, "")
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .replace(/[<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  const stem = [...base].slice(0, NAME_MAX).join("").trim();
  return `${stem || "file"}.${EXTENSION[kind]}`;
}
