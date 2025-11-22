import { Redis } from 'ioredis';
import { loadConfig } from '../config.js';
import logger from '../../logger.js';

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  retryDelayOnFailover?: number;
  maxRetriesPerRequest?: number;
}

export class RedisService {
  private client: Redis | null = null;
  private config: RedisConfig;
  private isConnected: boolean = false;

  constructor() {
    const appConfig = loadConfig();
    this.config = this.parseRedisUrl(appConfig.redis.url);
  }

  parseRedisUrl(url: string): RedisConfig {
    try {
      const parsed = new URL(url);
      return {
        host: parsed.hostname,
        port: parseInt(parsed.port) || 6379,
        password: parsed.password || undefined,
        db: parsed.pathname ? parseInt(parsed.pathname.slice(1)) : 0,
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3
      };
    } catch (error) {
      logger.error('Failed to parse Redis URL, using defaults:', error);
      return {
        host: 'localhost',
        port: 6379,
        password: undefined,
        db: 0,
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3
      };
    }
  }

  async connect(): Promise<void> {
    // Only attempt connection if Redis URL is not localhost or if explicitly configured
    if (this.config.host === 'localhost' || this.config.host === '127.0.0.1') {
      logger.info('Redis not configured or running locally - using memory-based fallbacks');
      this.isConnected = false;
      return;
    }

    try {
      this.client = new Redis(this.config);
      
      this.client.on('connect', () => {
        logger.info('Redis connected successfully');
        this.isConnected = true;
      });

      this.client.on('error', (error: any) => {
        // Only log error once, not repeatedly
        if (!this.isConnected) {
          logger.warn('Redis connection failed - using memory-based fallbacks');
          this.isConnected = false;
        }
      });

      this.client.on('close', () => {
        if (this.isConnected) {
          logger.warn('Redis connection closed');
          this.isConnected = false;
        }
      });

      this.client.on('reconnecting', () => {
        // Don't log reconnection attempts if we're not connected
        if (this.isConnected) {
          logger.info('Redis reconnecting...');
        }
      });

      // Test the connection
      await this.client.ping();
      this.isConnected = true;
      logger.info('Redis connection test successful');
    } catch (error) {
      logger.warn('Redis not available - using memory-based fallbacks');
      this.isConnected = false;
      // Clean up the client if it was created
      if (this.client) {
        this.client.removeAllListeners();
        this.client = null;
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch (error) {
        logger.warn('Error disconnecting Redis:', error);
      }
      this.client = null;
      this.isConnected = false;
      logger.info('Redis disconnected');
    }
  }

  getClient(): Redis | null {
    return this.client;
  }

  isRedisAvailable(): boolean {
    return this.isConnected && this.client !== null;
  }

  // Rate limiting methods
  async incrementRateLimit(key: string, windowMs: number): Promise<number> {
    if (!this.isRedisAvailable()) {
      // Fallback to simple counter (not distributed)
      return 1;
    }
    
    try {
      const client = this.getClient()!;
      const now = Date.now();
      const windowStart = now - windowMs;
      
      // Add current timestamp to sorted set
      await client.zadd(key, now, now.toString());
      
      // Remove old entries outside the window
      await client.zremrangebyscore(key, 0, windowStart);
      
      // Count entries in the window
      const count = await client.zcard(key);
      
      // Set expiry on the key
      await client.expire(key, Math.ceil(windowMs / 1000));
      
      return count;
    } catch (error) {
      logger.warn('Redis rate limiting failed, using fallback:', error);
      return 1;
    }
  }

  async getRateLimitCount(key: string): Promise<number> {
    if (!this.isRedisAvailable()) {
      return 0;
    }
    
    try {
      const client = this.getClient()!;
      return await client.zcard(key);
    } catch (error) {
      logger.warn('Redis get rate limit count failed:', error);
      return 0;
    }
  }

  // Caching methods
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.isRedisAvailable()) {
      return; // Silently fail when Redis is not available
    }
    
    try {
      const client = this.getClient()!;
      if (ttlSeconds) {
        await client.setex(key, ttlSeconds, value);
      } else {
        await client.set(key, value);
      }
    } catch (error) {
      logger.warn('Redis set failed:', error);
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.isRedisAvailable()) {
      return null; // Return null when Redis is not available
    }
    
    try {
      const client = this.getClient()!;
      return await client.get(key);
    } catch (error) {
      logger.warn('Redis get failed:', error);
      return null;
    }
  }

  async setex(key: string, ttlSeconds: number, value: string): Promise<void> {
    if (!this.isRedisAvailable()) {
      return; // Silently fail when Redis is not available
    }
    
    try {
      const client = this.getClient()!;
      await client.setex(key, ttlSeconds, value);
    } catch (error) {
      logger.warn('Redis setex failed:', error);
    }
  }

  async del(key: string): Promise<number> {
    if (!this.isRedisAvailable()) {
      return 0; // Return 0 when Redis is not available
    }
    
    try {
      const client = this.getClient()!;
      return await client.del(key);
    } catch (error) {
      logger.warn('Redis del failed:', error);
      return 0;
    }
  }

  async exists(key: string): Promise<number> {
    if (!this.isRedisAvailable()) {
      return 0; // Return 0 when Redis is not available
    }
    
    try {
      const client = this.getClient()!;
      return await client.exists(key);
    } catch (error) {
      logger.warn('Redis exists failed:', error);
      return 0;
    }
  }

  // Hash operations for complex data
  async hset(key: string, field: string, value: string): Promise<number> {
    if (!this.isRedisAvailable()) {
      return 0;
    }
    
    try {
      const client = this.getClient()!;
      return await client.hset(key, field, value);
    } catch (error) {
      logger.warn('Redis hset failed:', error);
      return 0;
    }
  }

  async hget(key: string, field: string): Promise<string | null> {
    if (!this.isRedisAvailable()) {
      return null;
    }
    
    try {
      const client = this.getClient()!;
      return await client.hget(key, field);
    } catch (error) {
      logger.warn('Redis hget failed:', error);
      return null;
    }
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    if (!this.isRedisAvailable()) {
      return {};
    }
    
    try {
      const client = this.getClient()!;
      return await client.hgetall(key);
    } catch (error) {
      logger.warn('Redis hgetall failed:', error);
      return {};
    }
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    if (!this.isRedisAvailable()) {
      return 0;
    }
    
    try {
      const client = this.getClient()!;
      return await client.hdel(key, ...fields);
    } catch (error) {
      logger.warn('Redis hdel failed:', error);
      return 0;
    }
  }

  // List operations
  async lpush(key: string, ...values: string[]): Promise<number> {
    if (!this.isRedisAvailable()) {
      return 0;
    }
    
    try {
      const client = this.getClient()!;
      return await client.lpush(key, ...values);
    } catch (error) {
      logger.warn('Redis lpush failed:', error);
      return 0;
    }
  }

  async rpop(key: string): Promise<string | null> {
    if (!this.isRedisAvailable()) {
      return null;
    }
    
    try {
      const client = this.getClient()!;
      return await client.rpop(key);
    } catch (error) {
      logger.warn('Redis rpop failed:', error);
      return null;
    }
  }

  async llen(key: string): Promise<number> {
    if (!this.isRedisAvailable()) {
      return 0;
    }
    
    try {
      const client = this.getClient()!;
      return await client.llen(key);
    } catch (error) {
      logger.warn('Redis llen failed:', error);
      return 0;
    }
  }

  // Health check
  async ping(): Promise<string> {
    if (!this.isRedisAvailable()) {
      return 'Redis not available';
    }
    
    try {
      const client = this.getClient()!;
      return await client.ping();
    } catch (error) {
      logger.warn('Redis ping failed:', error);
      return 'Redis ping failed';
    }
  }

  // Get Redis info
  async info(): Promise<string> {
    if (!this.isRedisAvailable()) {
      return 'Redis not available';
    }
    
    try {
      const client = this.getClient()!;
      return await client.info();
    } catch (error) {
      logger.warn('Redis info failed:', error);
      return 'Redis info failed';
    }
  }

  // Clear all data (use with caution)
  async flushall(): Promise<void> {
    if (!this.isRedisAvailable()) {
      return;
    }
    
    try {
      const client = this.getClient()!;
      await client.flushall();
    } catch (error) {
      logger.warn('Redis flushall failed:', error);
    }
  }
}

// Export singleton instance
export const redisService = new RedisService();
