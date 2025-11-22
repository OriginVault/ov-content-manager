import { Request, Response, NextFunction } from 'express';
import { redisService } from '../services/redisService.js';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  message?: string;
  statusCode?: number;
  keyGenerator?: (req: Request) => string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

export function createRedisRateLimit(options: RateLimitOptions) {
  const {
    windowMs,
    max,
    message = 'Too many requests, please try again later.',
    statusCode = 429,
    keyGenerator = (req: Request) => req.ip,
    skipSuccessfulRequests = false,
    skipFailedRequests = false
  } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = `rate_limit:${keyGenerator(req)}`;
      const count = await redisService.incrementRateLimit(key, windowMs);

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, max - count));
      res.setHeader('X-RateLimit-Reset', new Date(Date.now() + windowMs).toISOString());

      if (count > max) {
        return res.status(statusCode).json({
          error: message,
          retryAfter: Math.ceil(windowMs / 1000)
        });
      }

      // Store the count in the request for potential use
      (req as any).rateLimitCount = count;

      next();
    } catch (error) {
      // If Redis is unavailable, allow the request to proceed
      console.error('Redis rate limiting error:', error);
      next();
    }
  };
}

// Predefined rate limiters
export const createUserRateLimit = (max: number, windowMs: number = 15 * 60 * 1000) => {
  return createRedisRateLimit({
    windowMs,
    max,
    keyGenerator: (req: Request) => {
      // Use user ID if authenticated, otherwise use IP
      return req.auth?.sub || req.ip || 'unknown';
    },
    message: 'User rate limit exceeded'
  });
};

export const createIPRateLimit = (max: number, windowMs: number = 15 * 60 * 1000) => {
  return createRedisRateLimit({
    windowMs,
    max,
    keyGenerator: (req: Request) => req.ip || 'unknown',
    message: 'IP rate limit exceeded'
  });
};

export const createUploadRateLimit = (max: number, windowMs: number = 60 * 60 * 1000) => {
  return createRedisRateLimit({
    windowMs,
    max,
    keyGenerator: (req: Request) => {
      return req.auth?.sub || req.ip || 'unknown';
    },
    message: 'Upload rate limit exceeded'
  });
};
