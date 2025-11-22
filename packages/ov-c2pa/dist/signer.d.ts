export type SignInput = {
    fileUrl: string;
    actions?: string[];
    title?: string;
} | {
    fileBase64: string;
    mime: string;
    actions?: string[];
    title?: string;
} | {
    sha256: string;
    title?: string;
    actions?: string[];
    embed?: false;
};
export type SignResult = {
    manifest: any;
    manifestHash: string;
    certSummary: {
        issuerCN: string;
        root: string;
        notAfter?: string;
    };
    signedAsset?: Buffer;
};
export interface CertProvider {
    getSigner(profile?: string): Promise<{
        certPem: string;
        keyPem: string;
        chainPem?: string[];
    }>;
}
export declare class SandboxCertProvider implements CertProvider {
    private cfg;
    constructor(cfg: {
        apiUrl: string;
        apiKey: string;
        certificateProfileId: string;
        conformingProductId: string;
        subjectCN?: string;
        subjectO?: string;
        subjectC?: string;
    });
    getSigner(): Promise<{
        certPem: string;
        keyPem: string;
        chainPem?: string[];
    }>;
}
export declare function sign(input: SignInput, provider: CertProvider): Promise<SignResult>;
export declare function verify(input: {
    fileUrl?: string;
    fileBase64?: string;
    sha256?: string;
}): Promise<{
    chain: "staging" | "valid" | "invalid";
    integrity: "ok" | "mismatch";
    manifestHash?: string;
}>;
