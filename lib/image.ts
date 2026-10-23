/**
 * Strip EXIF/GPS metadata from uploaded photos. sharp re-encodes with no
 * metadata by default and `.rotate()` bakes in the EXIF orientation so pixels
 * stay upright. Applied at every upload boundary before storage or forwarding
 * to the model — phone photos carry GPS coordinates.
 */
import sharp from "sharp";

export interface StrippedImage {
  buf: Buffer;
  contentType: "image/jpeg";
}

export async function stripImageMetadata(input: Buffer): Promise<StrippedImage> {
  const buf = await sharp(input)
    .rotate() // honor EXIF orientation, then drop the tag
    .flatten({ background: "#ffffff" }) // PNG alpha → white for jpeg encode
    .jpeg({ quality: 90 })
    .toBuffer();
  return { buf, contentType: "image/jpeg" };
}

/** Convenience for data URLs; returns a cleaned data URL. */
export async function stripImageDataUrl(dataUrl: string): Promise<string> {
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUrl);
  if (!m) return dataUrl;
  const { buf, contentType } = await stripImageMetadata(Buffer.from(m[2], "base64"));
  return `data:${contentType};base64,${buf.toString("base64")}`;
}
