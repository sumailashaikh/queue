import { Request, Response, NextFunction } from 'express';

const rateLimitMap = new Map<string, { count: number, lastReset: number }>();

export const basicRateLimiter = (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute
    const maxRequests = 100; // 100 requests per minute to accommodate polling

    const rateData = rateLimitMap.get(ip) || { count: 0, lastReset: now };

    if (now - rateData.lastReset > windowMs) {
        rateData.count = 0;
        rateData.lastReset = now;
    }

    rateData.count++;
    rateLimitMap.set(ip, rateData);

    if (rateData.count > maxRequests) {
        return res.status(429).json({
            status: 'error',
            message: 'Too many requests. Please try again later.'
        });
    }

    next();
};
