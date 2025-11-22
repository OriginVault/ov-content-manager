"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const redisService_1 = require("../redisService");
// Mock Redis
jest.mock('ioredis');
describe('RedisService', () => {
    let mockRedisClient;
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
    });
    afterEach(() => __awaiter(void 0, void 0, void 0, function* () {
        yield redisService_1.redisService.disconnect();
        jest.clearAllMocks();
    }));
    describe('Connection', () => {
        it('should connect to Redis successfully', () => __awaiter(void 0, void 0, void 0, function* () {
            yield redisService_1.redisService.connect();
            expect(mockRedisClient.on).toHaveBeenCalledWith('connect', expect.any(Function));
            expect(mockRedisClient.on).toHaveBeenCalledWith('error', expect.any(Function));
            expect(mockRedisClient.on).toHaveBeenCalledWith('close', expect.any(Function));
            expect(mockRedisClient.on).toHaveBeenCalledWith('reconnecting', expect.any(Function));
            expect(mockRedisClient.ping).toHaveBeenCalled();
        }));
        it('should disconnect from Redis', () => __awaiter(void 0, void 0, void 0, function* () {
            yield redisService_1.redisService.connect();
            yield redisService_1.redisService.disconnect();
            expect(mockRedisClient.quit).toHaveBeenCalled();
        }));
        it('should return null when getting client without connection', () => {
            expect(redisService_1.redisService.getClient()).toBeNull();
        });
    });
    describe('Rate Limiting', () => {
        beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
            yield redisService_1.redisService.connect();
        }));
        it('should increment rate limit counter', () => __awaiter(void 0, void 0, void 0, function* () {
            const count = yield redisService_1.redisService.incrementRateLimit('test-key', 60000);
            expect(mockRedisClient.zadd).toHaveBeenCalledWith('test-key', expect.any(Number), expect.any(String));
            expect(mockRedisClient.zremrangebyscore).toHaveBeenCalledWith('test-key', 0, expect.any(Number));
            expect(mockRedisClient.zcard).toHaveBeenCalledWith('test-key');
            expect(mockRedisClient.expire).toHaveBeenCalledWith('test-key', 60);
            expect(count).toBe(1);
        }));
        it('should get rate limit count', () => __awaiter(void 0, void 0, void 0, function* () {
            const count = yield redisService_1.redisService.getRateLimitCount('test-key');
            expect(mockRedisClient.zcard).toHaveBeenCalledWith('test-key');
            expect(count).toBe(1);
        }));
    });
    describe('Caching', () => {
        beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
            yield redisService_1.redisService.connect();
        }));
        it('should set and get cache values', () => __awaiter(void 0, void 0, void 0, function* () {
            yield redisService_1.redisService.set('test-key', 'test-value');
            expect(mockRedisClient.set).toHaveBeenCalledWith('test-key', 'test-value');
            const value = yield redisService_1.redisService.get('test-key');
            expect(mockRedisClient.get).toHaveBeenCalledWith('test-key');
            expect(value).toBe('test-value');
        }));
        it('should set cache with TTL', () => __awaiter(void 0, void 0, void 0, function* () {
            yield redisService_1.redisService.setex('test-key', 300, 'test-value');
            expect(mockRedisClient.setex).toHaveBeenCalledWith('test-key', 300, 'test-value');
        }));
        it('should delete cache keys', () => __awaiter(void 0, void 0, void 0, function* () {
            yield redisService_1.redisService.del('test-key');
            expect(mockRedisClient.del).toHaveBeenCalledWith('test-key');
        }));
        it('should check if key exists', () => __awaiter(void 0, void 0, void 0, function* () {
            const exists = yield redisService_1.redisService.exists('test-key');
            expect(mockRedisClient.exists).toHaveBeenCalledWith('test-key');
            expect(exists).toBe(1);
        }));
    });
    describe('Hash Operations', () => {
        beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
            yield redisService_1.redisService.connect();
        }));
        it('should set hash field', () => __awaiter(void 0, void 0, void 0, function* () {
            yield redisService_1.redisService.hset('test-hash', 'field', 'value');
            expect(mockRedisClient.hset).toHaveBeenCalledWith('test-hash', 'field', 'value');
        }));
        it('should get hash field', () => __awaiter(void 0, void 0, void 0, function* () {
            const value = yield redisService_1.redisService.hget('test-hash', 'field');
            expect(mockRedisClient.hget).toHaveBeenCalledWith('test-hash', 'field');
            expect(value).toBe('test-value');
        }));
        it('should get all hash fields', () => __awaiter(void 0, void 0, void 0, function* () {
            const fields = yield redisService_1.redisService.hgetall('test-hash');
            expect(mockRedisClient.hgetall).toHaveBeenCalledWith('test-hash');
            expect(fields).toEqual({ key: 'value' });
        }));
        it('should delete hash fields', () => __awaiter(void 0, void 0, void 0, function* () {
            yield redisService_1.redisService.hdel('test-hash', 'field1', 'field2');
            expect(mockRedisClient.hdel).toHaveBeenCalledWith('test-hash', 'field1', 'field2');
        }));
    });
    describe('List Operations', () => {
        beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
            yield redisService_1.redisService.connect();
        }));
        it('should push to list', () => __awaiter(void 0, void 0, void 0, function* () {
            yield redisService_1.redisService.lpush('test-list', 'value1', 'value2');
            expect(mockRedisClient.lpush).toHaveBeenCalledWith('test-list', 'value1', 'value2');
        }));
        it('should pop from list', () => __awaiter(void 0, void 0, void 0, function* () {
            const value = yield redisService_1.redisService.rpop('test-list');
            expect(mockRedisClient.rpop).toHaveBeenCalledWith('test-list');
            expect(value).toBe('test-value');
        }));
        it('should get list length', () => __awaiter(void 0, void 0, void 0, function* () {
            const length = yield redisService_1.redisService.llen('test-list');
            expect(mockRedisClient.llen).toHaveBeenCalledWith('test-list');
            expect(length).toBe(1);
        }));
    });
    describe('Health Check', () => {
        beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
            yield redisService_1.redisService.connect();
        }));
        it('should ping Redis', () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield redisService_1.redisService.ping();
            expect(mockRedisClient.ping).toHaveBeenCalled();
            expect(result).toBe('PONG');
        }));
        it('should get Redis info', () => __awaiter(void 0, void 0, void 0, function* () {
            const info = yield redisService_1.redisService.info();
            expect(mockRedisClient.info).toHaveBeenCalled();
            expect(info).toBe('redis_version:7.0.0');
        }));
    });
    describe('URL Parsing', () => {
        it('should parse Redis URL correctly', () => __awaiter(void 0, void 0, void 0, function* () {
            // Test the parseRedisUrl method directly
            const redisService = new (require('../redisService').RedisService)();
            const config = redisService.parseRedisUrl('redis://user:pass@localhost:6379/1');
            expect(config.host).toBe('localhost');
            expect(config.port).toBe(6379);
            expect(config.password).toBe('pass');
            expect(config.db).toBe(1);
        }));
        it('should handle invalid Redis URL gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            // Test the parseRedisUrl method directly with invalid URL
            const redisService = new (require('../redisService').RedisService)();
            const config = redisService.parseRedisUrl('invalid-url');
            expect(config.host).toBe('localhost');
            expect(config.port).toBe(6379);
            expect(config.password).toBeUndefined();
            expect(config.db).toBe(0);
        }));
    });
});
