import { redisService } from '../services/redisService.js';
export function createRedisRateLimit(options) {
    const { windowMs, max, message = 'Too many requests, please try again later.', statusCode = 429, keyGenerator = (req) => req.ip, skipSuccessfulRequests = false, skipFailedRequests = false } = options;
    return async (req, res, next) => {
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
            req.rateLimitCount = count;
            next();
        }
        catch (error) {
            // If Redis is unavailable, allow the request to proceed
            console.error('Redis rate limiting error:', error);
            next();
        }
    };
}
// Predefined rate limiters
export const createUserRateLimit = (max, windowMs = 15 * 60 * 1000) => {
    return createRedisRateLimit({
        windowMs,
        max,
        keyGenerator: (req) => {
            // Use user ID if authenticated, otherwise use IP
            return req.auth?.sub || req.ip || 'unknown';
        },
        message: 'User rate limit exceeded'
    });
};
export const createIPRateLimit = (max, windowMs = 15 * 60 * 1000) => {
    return createRedisRateLimit({
        windowMs,
        max,
        keyGenerator: (req) => req.ip || 'unknown',
        message: 'IP rate limit exceeded'
    });
};
export const createUploadRateLimit = (max, windowMs = 60 * 60 * 1000) => {
    return createRedisRateLimit({
        windowMs,
        max,
        keyGenerator: (req) => {
            return req.auth?.sub || req.ip || 'unknown';
        },
        message: 'Upload rate limit exceeded'
    });
};
