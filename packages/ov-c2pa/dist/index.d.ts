import { CertProviderConfig } from "./sslSigner.js";
export type SupportedTypeInfo = {
    format: string;
    extension: string;
};
export declare const C2PA_SUPPORTED_TYPES: Record<string, SupportedTypeInfo>;
export interface C2PAManifestOptions {
    title: string;
    userId?: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    contentHash: string;
    snowflake: string;
    mnemonicId: string;
    uploadTime: Date;
    isAnonymous?: boolean;
    clientIp?: string;
}
export interface C2PAManifestResult {
    success: boolean;
    manifest?: any;
    manifestKey?: string;
    manifestMnemonicId?: string;
    error?: string;
}
export declare class C2PA {
    private c2pa;
    private signer;
    private certConfig?;
    private initializedWithSsl;
    constructor(signerOrConfig?: any | CertProviderConfig);
    private ensureSigner;
    isSupported(mimeType: string): boolean;
    getSupportedTypes(): string[];
    getFileTypeInfo(mimeType: string): SupportedTypeInfo | null;
    generateManifest(fileBuffer: Buffer, options: C2PAManifestOptions): Promise<C2PAManifestResult>;
    getFileCategory(mimeType: string): string;
    getCategorySpecificMetadata(category: string, options: C2PAManifestOptions): any;
    signFile(fileBuffer: Buffer, mimeType: string, manifest: any): Promise<Buffer | null>;
    readManifest(fileBuffer: Buffer, mimeType: string): Promise<any>;
}
export declare function createC2paClient(signerOrConfig?: any | CertProviderConfig): C2PA;
export { sign, verify, SandboxCertProvider } from './signer.js';
export type { SignInput, SignResult, CertProvider } from './signer.js';
