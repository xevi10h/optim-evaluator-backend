import winston from 'winston';

const logger = winston.createLogger({
	level: process.env.LOG_LEVEL || 'info',
	format: winston.format.combine(
		winston.format.timestamp(),
		winston.format.errors({ stack: true }),
		winston.format.colorize(),
		winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
			let log = `${timestamp} [${level}]: ${message}`;

			if (stack) {
				log += `\n${stack}`;
			}

			if (Object.keys(meta).length > 0) {
				log += `\n${JSON.stringify(meta, null, 2)}`;
			}

			return log;
		}),
	),
	transports: [
		new winston.transports.Console({
			format: winston.format.combine(
				winston.format.colorize(),
				winston.format.simple(),
			),
		}),
	],
});

// En producción, añadir también logging a archivo
if (process.env.NODE_ENV === 'production') {
	logger.add(
		new winston.transports.File({
			filename: 'logs/error.log',
			level: 'error',
			format: winston.format.combine(
				winston.format.timestamp(),
				winston.format.json(),
			),
		}),
	);

	logger.add(
		new winston.transports.File({
			filename: 'logs/combined.log',
			format: winston.format.combine(
				winston.format.timestamp(),
				winston.format.json(),
			),
		}),
	);
}

export default logger;
