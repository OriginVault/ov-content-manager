import cors from "cors";
import { loadConfig } from "./config.js";

const config = loadConfig();

export const strictCors = cors({
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (config.nodeEnv === 'development') return callback(null, true);
    if (!origin) return callback(null, true);
    try {
      const { hostname } = new URL(origin);
      const allowedPattern = /\.?(originvault\.(me|co)|originvault\.box)$/;
      if (allowedPattern.test(hostname)) return callback(null, true);
    } catch (e) {
      return callback(new Error('Invalid origin'));
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
});

// Reflects origin but requires Authorization header to be present
export const openCors = cors({
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin) return callback(null, false);
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
});


