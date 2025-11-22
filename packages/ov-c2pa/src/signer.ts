import { createC2paClient, C2PAManifestOptions, C2PA } from "./index.js";
import { CertProviderConfig } from "./sslSigner.js";

export type SignInput =
  | { fileUrl: string; actions?: string[]; title?: string }
  | { fileBase64: string; mime: string; actions?: string[]; title?: string }
  | { sha256: string; title?: string; actions?: string[]; embed?: false };

export type SignResult = {
  manifest: any;
  manifestHash: string;
  certSummary: { issuerCN: string; root: string; notAfter?: string };
  signedAsset?: Buffer;
};

export interface CertProvider {
  getSigner(profile?: string): Promise<{ certPem: string; keyPem: string; chainPem?: string[] }>;
}

export class SandboxCertProvider implements CertProvider {
  constructor(private cfg: {
    apiUrl: string;
    apiKey: string;
    certificateProfileId: string;
    conformingProductId: string;
    subjectCN?: string;
    subjectO?: string;
    subjectC?: string;
  }) {}

  async getSigner(): Promise<{ certPem: string; keyPem: string; chainPem?: string[] }> {
    // Leverage ov-c2pa's cert provisioning (sandbox mode) by instantiating its client with config
    const client: any = createC2paClient({
      apiUrl: this.cfg.apiUrl,
      apiKey: this.cfg.apiKey,
      certificateProfileId: this.cfg.certificateProfileId,
      conformingProductId: this.cfg.conformingProductId,
      subjectCN: this.cfg.subjectCN,
      subjectO: this.cfg.subjectO,
      subjectC: this.cfg.subjectC,
    } as CertProviderConfig);
    const ensure = (client as any)["ensureSigner"].bind(client);
    const signer = await ensure();
    return { certPem: signer.certificate, keyPem: signer.privateKey, chainPem: signer.chain };
  }
}

export async function sign(input: SignInput, provider: CertProvider): Promise<SignResult> {
  const signer = await provider.getSigner();
  const client = createC2paClient({
    // supply a pre-provisioned signer directly
    apiUrl: "",
    apiKey: "",
    certificateProfileId: "",
    conformingProductId: "",
  } as any);
  // override signer on client
  (client as any)["signer"] = {
    privateKey: signer.keyPem,
    certificate: signer.certPem,
    algorithm: 'ES256'
  };

  let buffer: Buffer | undefined;
  let mime = (input as any).mime || "application/octet-stream";
  if ("fileUrl" in input) {
    const res = await fetch(input.fileUrl);
    const arr = await res.arrayBuffer();
    buffer = Buffer.from(arr);
    mime = res.headers.get('content-type') || mime;
  } else if ("fileBase64" in input) {
    buffer = Buffer.from(input.fileBase64, 'base64');
  }

  const title = (input as any).title || 'C2PA Signed Asset';
  const now = new Date();
  const opts: C2PAManifestOptions = {
    title,
    fileName: title,
    fileSize: buffer ? buffer.byteLength : 0,
    mimeType: buffer ? mime : 'application/octet-stream',
    contentHash: (input as any).sha256 || '',
    snowflake: title,
    mnemonicId: title,
    uploadTime: now
  };

  const { manifest } = await client.generateManifest(buffer || Buffer.from(''), opts);
  const signedAssetOrNull = buffer ? await client.signFile(buffer, mime, manifest) : null;
  const signedAsset = signedAssetOrNull ?? undefined;

  return {
    manifest,
    manifestHash: '',
    certSummary: { issuerCN: 'SSL.com Sandbox', root: 'C2PA Staging Root' },
    signedAsset
  };
}

export async function verify(input: { fileUrl?: string; fileBase64?: string; sha256?: string }): Promise<{ chain: "staging" | "valid" | "invalid"; integrity: "ok" | "mismatch"; manifestHash?: string }>{
  // Minimal placeholder to keep API shape; actual verification can be layered next
  return { chain: 'staging', integrity: 'ok' };
}

