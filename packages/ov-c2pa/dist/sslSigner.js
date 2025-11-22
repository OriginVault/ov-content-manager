import forge from "node-forge";
import crypto from "crypto";
export async function createEcKeyAndCsr(commonName, org, country) {
    // Use Node.js crypto for EC key generation (P-256)
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'prime256v1', // P-256
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    // Convert PEM to forge format for CSR creation
    const forgePrivateKey = forge.pki.privateKeyFromPem(privateKey);
    const forgePublicKey = forge.pki.publicKeyFromPem(publicKey);
    const csr = forge.pki.createCertificationRequest();
    csr.publicKey = forgePublicKey;
    csr.setSubject([
        { name: 'commonName', value: commonName },
        ...(org ? [{ name: 'organizationName', value: org }] : []),
        ...(country ? [{ name: 'countryName', value: country }] : []),
    ]);
    csr.sign(forgePrivateKey, forge.md.sha256.create());
    const privateKeyPem = privateKey;
    const csrPem = forge.pki.certificationRequestToPem(csr);
    return { privateKeyPem, csrPem };
}
export async function requestSandboxCertificate(cfg, csrPem) {
    const body = {
        certificate_profile_id: cfg.certificateProfileId,
        certificate_signing_request: csrPem,
        conforming_product_id: cfg.conformingProductId,
        experimental: {
            CN: cfg.subjectCN || 'OriginVault C2PA',
            O: cfg.subjectO || 'OriginVault',
            C: cfg.subjectC || 'US'
        }
    };
    const res = await fetch(`${cfg.apiUrl}/certificate-requests`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cfg.apiKey}`
        },
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`SSL.com API error ${res.status}: ${text}`);
    }
    const data = await res.json();
    // assuming data.certificate contains PEM chain or leaf; prefer leaf PEM
    return data.certificate;
}
export async function provisionSandboxCert(cfg) {
    const { privateKeyPem, csrPem } = await createEcKeyAndCsr(cfg.subjectCN || 'OriginVault C2PA', cfg.subjectO || 'OriginVault', cfg.subjectC || 'US');
    const certPem = await requestSandboxCertificate(cfg, csrPem);
    return { privateKeyPem, certificatePem: certPem };
}
