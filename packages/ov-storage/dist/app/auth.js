import { validateBearerToken } from "./oidc.js";
export async function requireAuth(req, res, next) {
    try {
        const authHeader = (req.headers["authorization"] || req.headers["Authorization"]);
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            res.status(401).json({ error: "Missing or invalid Authorization header" });
            return;
        }
        const { payload } = await validateBearerToken(authHeader);
        req.auth = {
            sub: payload.sub,
            aud: payload.aud,
            azp: payload.azp,
            client_id: payload.client_id,
            scope: payload.scope
        };
        next();
    }
    catch (e) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }
}
/**
 * Helper function to check if user has a specific scope
 * Usage: assert(hasScope(req, 'read:products'));
 */
export function hasScope(req, requiredScope) {
    const scope = req.auth?.scope;
    if (!scope)
        return false;
    const userScopes = scope.split(' ');
    return userScopes.includes(requiredScope);
}
/**
 * Middleware to require a specific scope
 * Usage: router.get('/products', requireScope('read:products'), handler);
 */
export function requireScope(requiredScope) {
    return (req, res, next) => {
        if (!hasScope(req, requiredScope)) {
            res.status(403).json({ error: `Insufficient scope. Required: ${requiredScope}` });
            return;
        }
        next();
    };
}
