export class AppError extends Error {
	public status: number;
	public isOperational: boolean;

	constructor(message: string, status: number = 500) {
		super(message);
		this.status = status;
		this.isOperational = true;

		Error.captureStackTrace(this, this.constructor);
	}
}

export class ValidationError extends AppError {
	constructor(message: string) {
		super(message, 400);
		this.name = 'ValidationError';
	}
}

export class NotFoundError extends AppError {
	constructor(message: string = 'Recurso no encontrado') {
		super(message, 404);
		this.name = 'NotFoundError';
	}
}

export class UnauthorizedError extends AppError {
	constructor(message: string = 'No autorizado') {
		super(message, 401);
		this.name = 'UnauthorizedError';
	}
}

export class InternalServerError extends AppError {
	constructor(message: string = 'Error interno del servidor') {
		super(message, 500);
		this.name = 'InternalServerError';
	}
}
