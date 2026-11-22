import "server-only";

/** True when the bytes start the way every PDF does. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length > 5 && new TextDecoder("latin1").decode(bytes.subarray(0, 5)) === "%PDF-";
}

/** A SIMAH report runs to a dozen pages. A file far longer is not one, and is not read. */
const MAX_PAGES = 60;

/** The text of each page of a PDF. Throws when the file cannot be read as one. */
export async function pdfPages(bytes: Uint8Array): Promise<string[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  if (pdf.numPages > MAX_PAGES) throw new Error(`too many pages: ${pdf.numPages}`);
  const { text } = await extractText(pdf, { mergePages: false });
  return text;
}
