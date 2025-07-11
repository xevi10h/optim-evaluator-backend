import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../utils/errors';

const uploadSchema = z.object({
	type: z.enum(['specification', 'proposal']),
});

const evaluationSchema = z.object({
	specifications: z
		.array(
			z.object({
				name: z.string(),
				content: z
					.string()
					.min(50, 'El contenido debe tener al menos 50 caracteres'),
				type: z.literal('specification'),
			}),
		)
		.min(1, 'Se requiere al menos un documento de especificaciones'),
	proposals: z
		.array(
			z.object({
				name: z.string(),
				content: z
					.string()
					.min(50, 'El contenido debe tener al menos 50 caracteres'),
				type: z.literal('proposal'),
			}),
		)
		.min(1, 'Se requiere al menos un documento de propuesta'),
});

export const validateUpload = (
	req: Request,
	res: Response,
	next: NextFunction,
) => {
	try {
		uploadSchema.parse(req.body);
		next();
	} catch (error) {
		if (error instanceof z.ZodError) {
			const message = error.errors.map((err) => err.message).join(', ');
			return next(new AppError(message, 400));
		}
		next(error);
	}
};

export const validateEvaluation = (
	req: Request,
	res: Response,
	next: NextFunction,
) => {
	try {
		evaluationSchema.parse(req.body);
		next();
	} catch (error) {
		if (error instanceof z.ZodError) {
			const message = error.message || 'Error de validación';
			return next(new AppError(message, 400));
		}
		next(error);
	}
};
