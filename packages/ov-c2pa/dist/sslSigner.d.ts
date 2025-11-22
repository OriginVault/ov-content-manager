export interface CertProviderConfig {
    apiUrl: string;
    apiKey: string;
    certificateProfileId: string;
    conformingProductId: string;
    subjectCN?: string;
    subjectO?: string;
    subjectC?: string;
}
export interface CertMaterial {
    privateKeyPem: string;
    certificatePem: string;
}
export declare function createEcKeyAndCsr(commonName: string, org?: string, country?: string): Promise<{
    privateKeyPem: string;
    csrPem: string;
}>;
export declare function requestSandboxCertificate(cfg: CertProviderConfig, csrPem: string): Promise<string>;
export declare function provisionSandboxCert(cfg: CertProviderConfig): Promise<CertMaterial>;
