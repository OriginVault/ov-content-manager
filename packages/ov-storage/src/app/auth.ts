import { Request, Response, NextFunction } from "express";
import { validateBearerToken } from "./oidc.js";

declare global {
  namespace Express {
    interface Request {
      auth?: { sub?: string; aud?: string | string[]; azp?: string; client_id?: string; scope?: string };
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = (req.headers["authorization"] || req.headers["Authorization"]) as string | undefined;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or invalid Authorization header" });
      return;
    }
    const { payload } = await validateBearerToken(authHeader);
    req.auth = { 
      sub: payload.sub, 
      aud: payload.aud, 
      azp: (payload as any).azp, 
      client_id: (payload as any).client_id,
      scope: (payload as any).scope
    };
    next();
  } catch (e: any) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
}

/**
 * Helper function to check if user has a specific scope
 * Usage: assert(hasScope(req, 'read:products'));
 */
export function hasScope(req: Request, requiredScope: string): boolean {
  const scope = req.auth?.scope;
  if (!scope) return false;
  const userScopes = scope.split(' ');
  return userScopes.includes(requiredScope);
}

/**
 * Middleware to require a specific scope
 * Usage: router.get('/products', requireScope('read:products'), handler);
 */
export function requireScope(requiredScope: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!hasScope(req, requiredScope)) {
      res.status(403).json({ error: `Insufficient scope. Required: ${requiredScope}` });
      return;
    }
    next();
  };
}


