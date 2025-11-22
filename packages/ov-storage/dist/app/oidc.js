import { loadConfig } from "./config.js";
import { createRemoteJWKSet, jwtVerify } from "jose";
let cachedDiscovery = null;
let cachedJwks = null;
async function discover() {
    const config = loadConfig();
    if (cachedDiscovery)
        return cachedDiscovery;
    let issuer = config.logto.issuer;
    let jwks_uri = config.logto.jwksUri;
    if (!issuer || !jwks_uri) {
        if (!config.logto.baseUrl) {
            throw new Error("LOGTO_BASE_URL or LOGTO_ISSUER/JWKS_URI must be set");
        }
        const wellKnown = `${config.logto.baseUrl.replace(/\/$/, "")}/.well-known/openid-configuration`;
        const resp = await fetch(wellKnown);
        if (!resp.ok)
            throw new Error(`OIDC discovery failed: ${resp.status}`);
        const json = (await resp.json());
        issuer = issuer || json.issuer;
        jwks_uri = jwks_uri || json.jwks_uri;
    }
    if (!issuer || !jwks_uri)
        throw new Error("Missing issuer or jwks_uri after discovery");
    cachedDiscovery = { issuer, jwks_uri };
    return cachedDiscovery;
}
async function getJwks() {
    if (cachedJwks)
        return cachedJwks;
    const { jwks_uri } = await discover();
    cachedJwks = createRemoteJWKSet(new URL(jwks_uri));
    return cachedJwks;
}
export async function validateBearerToken(authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const { issuer } = await discover();
    const jwks = await getJwks();
    const { payload } = await jwtVerify(token, jwks, {
        issuer,
    });
    const config = loadConfig();
    const allowedAudiences = config.logto.allowedAudiences || [];
    if (allowedAudiences.length > 0) {
        const aud = payload.aud;
        const audList = Array.isArray(aud) ? aud : aud ? [aud] : [];
        const ok = audList.some((a) => allowedAudiences.includes(a));
        if (!ok)
            throw new Error("Invalid audience");
    }
    const allowedClientIds = config.logto.allowedClientIds || [];
    if (allowedClientIds.length > 0) {
        const presented = payload.azp || payload.client_id;
        if (!presented || !allowedClientIds.includes(presented)) {
            throw new Error("Client not allowed");
        }
    }
    // Extract and validate scope for role-based access control
    const scope = payload.scope;
    if (scope) {
        const requiredScopes = config.logto.requiredScopes || [];
        if (requiredScopes.length > 0) {
            const userScopes = scope.split(' ');
            const hasRequiredScope = requiredScopes.some(requiredScope => userScopes.includes(requiredScope));
            if (!hasRequiredScope) {
                throw new Error("Insufficient scope permissions");
            }
        }
    }
    return { payload };
}
