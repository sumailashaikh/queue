import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { supabase } from './config/supabaseClient';
import router from './routes';

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(helmet());
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
    console.log('Health check requested');
    let supabaseStatus = 'unknown';
    try {
        if (supabase) {
            supabaseStatus = 'connected_client_initialized';
        }
    } catch (err: any) {
        supabaseStatus = 'error: ' + err.message;
    }

    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'queue-backend',
        supabase: supabaseStatus
    });
});

// Start Server
app.listen(Number(port), '0.0.0.0', () => {
    console.log(`⚡️[server]: Server is running at http://0.0.0.0:${port}`);
});

