import { RedisService } from '../redisService.js';
import { redisService } from '../redisService.js';

// Mock Redis
jest.mock('ioredis');

describe('RedisService', () => {
  let mockRedisClient: any;

  beforeEach(() => {
    mockRedisClient = {
      on: jest.fn(),
      ping: jest.fn().mockResolvedValue('PONG'),
      quit: jest.fn().mockResolvedValue('OK'),
      zadd: jest.fn().mockResolvedValue(1),
      zremrangebyscore: jest.fn().mockResolvedValue(0),
      zcard: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      setex: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue('test-value'),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      exists: jest.fn().mockResolvedValue(1),
      hset: jest.fn().mockResolvedValue(1),
      hget: jest.fn().mockResolvedValue('test-value'),
      hgetall: jest.fn().mockResolvedValue({ key: 'value' }),
      hdel: jest.fn().mockResolvedValue(1),
      lpush: jest.fn().mockResolvedValue(1),
      rpop: jest.fn().mockResolvedValue('test-value'),
      llen: jest.fn().mockResolvedValue(1),
      info: jest.fn().mockResolvedValue('redis_version:7.0.0'),
      flushall: jest.fn().mockResolvedValue('OK'),
      keys: jest.fn().mockResolvedValue(['key1', 'key2']),
      call: jest.fn()
    };

    const Redis = require('ioredis');
    Redis.mockImplementation(() => mockRedisClient);
    
    // Mock the isRedisAvailable method to return true for tests
    jest.spyOn(redisService, 'isRedisAvailable').mockReturnValue(true);
  });

  afterEach(async () => {
    await redisService.disconnect();
    jest.clearAllMocks();
  });

  describe('Connection', () => {
    it('should connect to Redis successfully', async () => {
      await redisService.connect();
      expect(mockRedisClient.on).toHaveBeenCalledWith('connect', expect.any(Function));
      expect(mockRedisClient.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockRedisClient.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockRedisClient.on).toHaveBeenCalledWith('reconnecting', expect.any(Function));
      expect(mockRedisClient.ping).toHaveBeenCalled();
    });

    it('should disconnect from Redis', async () => {
      await redisService.connect();
      await redisService.disconnect();
      expect(mockRedisClient.quit).toHaveBeenCalled();
    });

    it('should return null when getting client without connection', () => {
      expect(redisService.getClient()).toBeNull();
    });
  });

  describe('Rate Limiting', () => {
    beforeEach(async () => {
      await redisService.connect();
    });

    it('should increment rate limit counter', async () => {
      const count = await redisService.incrementRateLimit('test-key', 60000);
      expect(mockRedisClient.zadd).toHaveBeenCalledWith('test-key', expect.any(Number), expect.any(String));
      expect(mockRedisClient.zremrangebyscore).toHaveBeenCalledWith('test-key', 0, expect.any(Number));
      expect(mockRedisClient.zcard).toHaveBeenCalledWith('test-key');
      expect(mockRedisClient.expire).toHaveBeenCalledWith('test-key', 60);
      expect(count).toBe(1);
    });

    it('should get rate limit count', async () => {
      const count = await redisService.getRateLimitCount('test-key');
      expect(mockRedisClient.zcard).toHaveBeenCalledWith('test-key');
      expect(count).toBe(1);
    });
  });

  describe('Caching', () => {
    beforeEach(async () => {
      await redisService.connect();
    });

    it('should set and get cache values', async () => {
      await redisService.set('test-key', 'test-value');
      expect(mockRedisClient.set).toHaveBeenCalledWith('test-key', 'test-value');

      const value = await redisService.get('test-key');
      expect(mockRedisClient.get).toHaveBeenCalledWith('test-key');
      expect(value).toBe('test-value');
    });

    it('should set cache with TTL', async () => {
      await redisService.setex('test-key', 300, 'test-value');
      expect(mockRedisClient.setex).toHaveBeenCalledWith('test-key', 300, 'test-value');
    });

    it('should delete cache keys', async () => {
      await redisService.del('test-key');
      expect(mockRedisClient.del).toHaveBeenCalledWith('test-key');
    });

    it('should check if key exists', async () => {
      const exists = await redisService.exists('test-key');
      expect(mockRedisClient.exists).toHaveBeenCalledWith('test-key');
      expect(exists).toBe(1);
    });
  });

  describe('Hash Operations', () => {
    beforeEach(async () => {
      await redisService.connect();
    });

    it('should set hash field', async () => {
      await redisService.hset('test-hash', 'field', 'value');
      expect(mockRedisClient.hset).toHaveBeenCalledWith('test-hash', 'field', 'value');
    });

    it('should get hash field', async () => {
      const value = await redisService.hget('test-hash', 'field');
      expect(mockRedisClient.hget).toHaveBeenCalledWith('test-hash', 'field');
      expect(value).toBe('test-value');
    });

    it('should get all hash fields', async () => {
      const fields = await redisService.hgetall('test-hash');
      expect(mockRedisClient.hgetall).toHaveBeenCalledWith('test-hash');
      expect(fields).toEqual({ key: 'value' });
    });

    it('should delete hash fields', async () => {
      await redisService.hdel('test-hash', 'field1', 'field2');
      expect(mockRedisClient.hdel).toHaveBeenCalledWith('test-hash', 'field1', 'field2');
    });
  });

  describe('List Operations', () => {
    beforeEach(async () => {
      await redisService.connect();
    });

    it('should push to list', async () => {
      await redisService.lpush('test-list', 'value1', 'value2');
      expect(mockRedisClient.lpush).toHaveBeenCalledWith('test-list', 'value1', 'value2');
    });

    it('should pop from list', async () => {
      const value = await redisService.rpop('test-list');
      expect(mockRedisClient.rpop).toHaveBeenCalledWith('test-list');
      expect(value).toBe('test-value');
    });

    it('should get list length', async () => {
      const length = await redisService.llen('test-list');
      expect(mockRedisClient.llen).toHaveBeenCalledWith('test-list');
      expect(length).toBe(1);
    });
  });

  describe('Health Check', () => {
    beforeEach(async () => {
      await redisService.connect();
    });

    it('should ping Redis', async () => {
      const result = await redisService.ping();
      expect(mockRedisClient.ping).toHaveBeenCalled();
      expect(result).toBe('PONG');
    });

    it('should get Redis info', async () => {
      const info = await redisService.info();
      expect(mockRedisClient.info).toHaveBeenCalled();
      expect(info).toBe('redis_version:7.0.0');
    });
  });

  describe('URL Parsing', () => {
    it('should parse Redis URL correctly', async () => {
      // Test the parseRedisUrl method directly
      const redisService = new (require('../redisService').RedisService)();
      const config = (redisService as any).parseRedisUrl('redis://user:pass@localhost:6379/1');
      
      expect(config.host).toBe('localhost');
      expect(config.port).toBe(6379);
      expect(config.password).toBe('pass');
      expect(config.db).toBe(1);
    });

    it('should handle invalid Redis URL gracefully', async () => {
      // Test the parseRedisUrl method directly with invalid URL
      const redisService = new (require('../redisService').RedisService)();
      const config = (redisService as any).parseRedisUrl('invalid-url');
      
      expect(config.host).toBe('localhost');
      expect(config.port).toBe(6379);
      expect(config.password).toBeUndefined();
      expect(config.db).toBe(0);
    });
  });
});
