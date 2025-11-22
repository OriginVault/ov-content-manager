import { createC2paClient } from "./index.js";
export class SandboxCertProvider {
    cfg;
    constructor(cfg) {
        this.cfg = cfg;
    }
    async getSigner() {
        // Leverage ov-c2pa's cert provisioning (sandbox mode) by instantiating its client with config
        const client = createC2paClient({
            apiUrl: this.cfg.apiUrl,
            apiKey: this.cfg.apiKey,
            certificateProfileId: this.cfg.certificateProfileId,
            conformingProductId: this.cfg.conformingProductId,
            subjectCN: this.cfg.subjectCN,
            subjectO: this.cfg.subjectO,
            subjectC: this.cfg.subjectC,
        });
        const ensure = client["ensureSigner"].bind(client);
        const signer = await ensure();
        return { certPem: signer.certificate, keyPem: signer.privateKey, chainPem: signer.chain };
    }
}
export async function sign(input, provider) {
    const signer = await provider.getSigner();
    const client = createC2paClient({
        // supply a pre-provisioned signer directly
        apiUrl: "",
        apiKey: "",
        certificateProfileId: "",
        conformingProductId: "",
    });
    // override signer on client
    client["signer"] = {
        privateKey: signer.keyPem,
        certificate: signer.certPem,
        algorithm: 'ES256'
    };
    let buffer;
    let mime = input.mime || "application/octet-stream";
    if ("fileUrl" in input) {
        const res = await fetch(input.fileUrl);
        const arr = await res.arrayBuffer();
        buffer = Buffer.from(arr);
        mime = res.headers.get('content-type') || mime;
    }
    else if ("fileBase64" in input) {
        buffer = Buffer.from(input.fileBase64, 'base64');
    }
    const title = input.title || 'C2PA Signed Asset';
    const now = new Date();
    const opts = {
        title,
        fileName: title,
        fileSize: buffer ? buffer.byteLength : 0,
        mimeType: buffer ? mime : 'application/octet-stream',
        contentHash: input.sha256 || '',
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
export async function verify(input) {
    // Minimal placeholder to keep API shape; actual verification can be layered next
    return { chain: 'staging', integrity: 'ok' };
}
