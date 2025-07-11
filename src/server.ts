import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

import uploadRoutes from './routes/upload';
import extractLotsRoutes from './routes/extractLots';
import evaluateLotsRoutes from './routes/evaluateLots';
import logger from './utils/logger';
import { errorHandler, notFound } from './middleware/errorHandler';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(
	helmet({
		crossOriginEmbedderPolicy: false,
	}),
);

// CORS configuration
app.use(
	cors({
		origin: process.env.FRONTEND_URL || 'http://localhost:3000',
		credentials: true,
		methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
		allowedHeaders: ['Content-Type', 'Authorization'],
	}),
);

// Rate limiting
const limiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 100, // limit each IP to 100 requests per windowMs
	message: 'Demasiadas peticiones desde esta IP, inténtalo de nuevo más tarde.',
});
app.use('/api/', limiter);

// Compression
app.use(compression());

// Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Logging
app.use((req, res, next) => {
	logger.info(`${req.method} ${req.path} - ${req.ip}`);
	next();
});

// Health check
app.get('/health', (req, res) => {
	res.json({
		status: 'OK',
		timestamp: new Date().toISOString(),
		version: process.env.npm_package_version || '1.0.0',
	});
});

// API Routes
app.use('/api/upload', uploadRoutes);
app.use('/api/extract-lots', extractLotsRoutes);
app.use('/api/evaluate-lots', evaluateLotsRoutes);

// Error handling
app.use(notFound);
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', () => {
	logger.info('SIGTERM recibido, cerrando servidor...');
	process.exit(0);
});

process.on('SIGINT', () => {
	logger.info('SIGINT recibido, cerrando servidor...');
	process.exit(0);
});

app.listen(PORT, () => {
	logger.info(`🚀 Servidor ejecutándose en puerto ${PORT}`);
	logger.info(`📚 Documentación disponible en http://localhost:${PORT}/health`);
});
