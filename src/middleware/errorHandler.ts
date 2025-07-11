import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';
import { AppError } from '../utils/errors';

export const notFound = (req: Request, res: Response, next: NextFunction) => {
	const error = new AppError(`Ruta no encontrada: ${req.originalUrl}`, 404);
	next(error);
};

export const errorHandler = (
	err: any,
	req: Request,
	res: Response,
	next: NextFunction,
) => {
	let error = { ...err };
	error.message = err.message;

	// Log del error
	logger.error(`${error.message}`, {
		stack: err.stack,
		url: req.originalUrl,
		method: req.method,
		ip: req.ip,
	});

	// Error de Multer (archivos)
	if (err.code === 'LIMIT_FILE_SIZE') {
		const message = 'Archivo demasiado grande. Máximo 10MB permitido.';
		error = new AppError(message, 400);
	}

	if (err.code === 'LIMIT_FILE_COUNT') {
		const message = 'Demasiados archivos. Máximo 10 archivos permitidos.';
		error = new AppError(message, 400);
	}

	// Error de JSON malformado
	if (err instanceof SyntaxError && 'body' in err) {
		const message = 'JSON malformado en el cuerpo de la petición';
		error = new AppError(message, 400);
	}

	// Errores de desarrollo vs producción
	if (process.env.NODE_ENV === 'development') {
		res.status(error.status || 500).json({
			success: false,
			error: error.message,
			stack: err.stack,
			details: error,
		});
	} else {
		// Errores de producción
		if (error instanceof AppError) {
			res.status(error.status).json({
				success: false,
				error: error.message,
			});
		} else {
			res.status(500).json({
				success: false,
				error: 'Error interno del servidor',
			});
		}
	}
};
