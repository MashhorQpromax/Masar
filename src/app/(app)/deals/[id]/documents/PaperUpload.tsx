"use client";

import { useId, useRef, useState, useTransition } from "react";
import { paperError } from "@/copy/documents";
import { ltr } from "@/copy/format";
import { FILE_ACCEPT, FILE_MAX_BYTES, IMAGE_MAX_SIDE } from "@/domain/documents/files";
import { PlusIcon, UploadIcon } from "@/ui/icons";
import { uploadPaperFile } from "./actions";

/** A picture this light and this small is sent as it is. */
const LIGHT_BYTES = 900 * 1024;

/**
 * A phone photo is several megabytes, most of it detail a paper does not have. It is drawn smaller and
 * saved as a JPEG here, in the browser, so it goes up fast on mobile data and the paper stays readable.
 * A PDF goes as it is.
 */
async function lighter(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  const picture = await createImageBitmap(file, { imageOrientation: "from-image" });
  const longer = Math.max(picture.width, picture.height);
  if (file.size <= LIGHT_BYTES && longer <= IMAGE_MAX_SIDE) {
    picture.close();
    return file;
  }
  const scale = Math.min(1, IMAGE_MAX_SIDE / longer);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(picture.width * scale));
  canvas.height = Math.max(1, Math.round(picture.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no canvas");
  // A see-through picture gets a white page behind it, as paper is.
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(picture, 0, 0, canvas.width, canvas.height);
  picture.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob) throw new Error("no picture");
  return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, { type: "image/jpeg" });
}

/**
 * One button: pick the files of a paper and they go up, one after another. There is nothing else to
 * fill in, so choosing the files sends them.
 */
export function PaperUpload({ dealId, code, name, more }: { dealId: number; code: string; name: string; more: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ at: number; of: number } | null>(null);
  const [busy, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const id = useId();

  function picked(files: File[]) {
    if (!files.length) return;
    setError(null);
    start(async () => {
      for (const [index, file] of files.entries()) {
        setProgress({ at: index + 1, of: files.length });
        let ready: File;
        try {
          ready = await lighter(file);
        } catch {
          setError("UNREADABLE");
          break;
        }
        // Checked here first: the server never receives a file it would refuse for its size.
        if (ready.size > FILE_MAX_BYTES) {
          setError("FILE_TOO_LARGE");
          break;
        }
        const body = new FormData();
        body.set("file", ready);
        const answer = await uploadPaperFile(dealId, code, body);
        if (answer.error) {
          setError(answer.error);
          break;
        }
      }
      setProgress(null);
      if (input.current) input.current.value = "";
    });
  }

  return (
    <div className="upload paper-upload">
      <input
        ref={input}
        id={id}
        className="upload-input"
        type="file"
        accept={FILE_ACCEPT}
        multiple
        disabled={busy}
        aria-label={`ارفع ${name}`}
        onChange={(event) => picked([...(event.target.files ?? [])])}
      />
      <label htmlFor={id} className={more ? "file file-more" : "btn btn--soft"} aria-busy={busy}>
        {more ? <PlusIcon size={16} /> : <UploadIcon size={16} />}
        {busy && progress ? (progress.of > 1 ? `يرفع ${ltr(progress.at)} من ${ltr(progress.of)}` : "يرفع") : more ? <span className="sr-only">أضف ملفاً إلى {name}</span> : "ارفع"}
      </label>
      {error && (
        <p key={error} role="alert" className="said" data-bad>
          {paperError(error)}
        </p>
      )}
    </div>
  );
}
