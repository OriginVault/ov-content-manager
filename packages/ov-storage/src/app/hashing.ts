import crypto from "crypto";
import blockhash from "blockhash-core";
import { Jimp, ResizeStrategy } from "jimp";

export function computeSha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export async function computePerceptualHashes(buffer: Buffer): Promise<{
  softPerceptualHash: string;
  mediumPerceptualHash: string;
  precisePerceptualHash: string;
}> {
  const image = await Jimp.read(Buffer.from(buffer));
  const height = 800 / image.width * image.height;
  image.resize({ w: 800, h: height, mode: ResizeStrategy.BILINEAR }).normalize();
  image.normalize();

  const { data, width: w, height: h } = image.bitmap;

  async function getHash(degree: number) {
    return blockhash.bmvbhash({ data, width: w, height: h }, degree);
  }

  const softPerceptualHash = await getHash(8);
  const mediumPerceptualHash = await getHash(16);
  const precisePerceptualHash = await getHash(24);

  return { softPerceptualHash, mediumPerceptualHash, precisePerceptualHash };
}


