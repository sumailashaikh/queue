import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { supabase } from './config/supabaseClient';
import router from './routes';

dotenv.config();

const app: Express = express();
const port = Number(process.env.PORT) || 4000;

// Middleware
const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'https://queue-frontend.vercel.app',
    /\.vercel\.app$/,
    'https://queue-34eq.onrender.com'
];

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl)
        if (!origin) return callback(null, true);

        const isAllowed = allowedOrigins.some(o =>
            typeof o === 'string' ? o === origin : o.test(origin)
        );

        if (isAllowed) {
            callback(null, true);
        } else {
            console.error(`[CORS] Rejected origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));

app.use(helmet({
    contentSecurityPolicy: false // Disable CSP for easier development if needed
}));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.get('/', (req: Request, res: Response) => {
    res.json({ message: 'Queue Backend API is running' });
});

app.use('/api', router);

// Health Check
app.get('/health', async (req: Request, res: Response) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'queue-backend',
        supabase: supabase ? 'connected' : 'not_initialized'
    });
});

// 404 Handler for undefined routes
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Global Error Handler
app.use((err: any, req: Request, res: Response, next: any) => {
    console.error('SERVER ERROR:', err);
    res.status(err.status || 500).json({
        error: err.message || 'Internal Server Error'
    });
});

// Start Server
app.listen(port, '0.0.0.0', () => {
    console.log(`⚡️[server]: Server is running at http://0.0.0.0:${port}`);
});

