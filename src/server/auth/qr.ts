import "server-only";
import QRCode from "qrcode";

/** A QR code as one SVG path on a grid of `size` units, so the page draws it in its own colours. */
export interface QrDrawing {
  size: number;
  path: string;
}

export function qrDrawing(text: string): QrDrawing {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  const { size } = modules;
  let path = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!modules.get(y, x)) continue;
      let run = 1;
      while (x + run < size && modules.get(y, x + run)) run++;
      path += `M${x} ${y}h${run}v1h-${run}z`;
      x += run;
    }
  }
  return { size, path };
}
