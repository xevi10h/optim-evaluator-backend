import express from 'express';
import multer from 'multer';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import { validateUpload } from '../middleware/validation';
import logger from '../utils/logger';
import { AppError } from '../utils/errors';
import { ProcessedFile, UploadResponse, SUPPORTED_FILE_TYPES } from '../types';

const router = express.Router();

// Configuración de multer para manejar archivos en memoria
const storage = multer.memoryStorage();
const upload = multer({
	storage,
	limits: {
		fileSize: 10 * 1024 * 1024, // 10MB
		files: 10, // máximo 10 archivos
	},
	fileFilter: (req, file, cb) => {
		const allowedExtensions = ['.pdf', '.docx', '.doc', '.txt'];
		const fileExtension = file.originalname
			.toLowerCase()
			.slice(file.originalname.lastIndexOf('.'));

		if (
			SUPPORTED_FILE_TYPES.includes(file.mimetype as any) ||
			allowedExtensions.includes(fileExtension)
		) {
			cb(null, true);
		} else {
			cb(
				new AppError(`Tipo de archivo no soportado: ${file.originalname}`, 400),
			);
		}
	},
});

// Función para extraer texto de PDF usando pdf-parse
async function extractPDFText(
	buffer: Buffer,
	filename: string,
): Promise<string> {
	try {
		logger.info(`📄 Extrayendo texto de PDF: ${filename}`);

		const data = await pdf(buffer, {
			max: 100, // máximo 100 páginas
			version: 'v1.10.100', // versión específica de PDF.js
		});

		logger.info(
			`✅ PDF procesado: ${filename} - ${data.numpages} páginas, ${data.text.length} caracteres`,
		);

		if (!data.text || data.text.trim().length < 50) {
			throw new AppError(`PDF sin contenido suficiente: ${filename}`, 400);
		}

		return data.text;
	} catch (error) {
		logger.error(`❌ Error extrayendo PDF ${filename}:`, error);
		throw new AppError(
			`Error procesando PDF ${filename}: ${error instanceof Error ? error.message : 'Error desconocido'}`,
			400,
		);
	}
}

// Función para extraer texto de documentos Word
async function extractWordText(
	buffer: Buffer,
	filename: string,
): Promise<string> {
	try {
		logger.info(`📝 Extrayendo texto de Word: ${filename}`);

		const result = await mammoth.extractRawText({ buffer });

		if (!result.value || result.value.trim().length < 10) {
			throw new AppError(`Documento Word vacío: ${filename}`, 400);
		}

		logger.info(
			`✅ Word procesado: ${filename} - ${result.value.length} caracteres`,
		);

		return result.value;
	} catch (error) {
		logger.error(`❌ Error extrayendo Word ${filename}:`, error);
		throw new AppError(
			`Error procesando Word ${filename}: ${error instanceof Error ? error.message : 'Error desconocido'}`,
			400,
		);
	}
}

// Función para procesar archivo de texto plano
function extractTextContent(buffer: Buffer, filename: string): string {
	try {
		logger.info(`📄 Procesando texto plano: ${filename}`);

		const text = buffer.toString('utf-8');

		if (!text || text.trim().length < 10) {
			throw new AppError(`Archivo de texto vacío: ${filename}`, 400);
		}

		logger.info(
			`✅ Texto plano procesado: ${filename} - ${text.length} caracteres`,
		);

		return text;
	} catch (error) {
		logger.error(`❌ Error procesando texto ${filename}:`, error);
		throw new AppError(
			`Error procesando texto ${filename}: ${error instanceof Error ? error.message : 'Error desconocido'}`,
			400,
		);
	}
}

// Función para limpiar el contenido extraído
function cleanTextContent(text: string): string {
	return text
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.replace(/[ \t]+/g, ' ')
		.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, '')
		.replace(/\s+/g, ' ')
		.split('\n')
		.map((line) => line.trim())
		.join('\n')
		.replace(/\n{2,}/g, '\n\n')
		.trim();
}

// Endpoint principal para subir archivos
router.post(
	'/',
	upload.array('files', 10),
	validateUpload,
	async (req, res, next) => {
		try {
			const { type } = req.body;
			const files = req.files as Express.Multer.File[];

			if (!files || files.length === 0) {
				throw new AppError('No se han proporcionado archivos', 400);
			}

			if (!type || !['specification', 'proposal'].includes(type)) {
				throw new AppError('Tipo de archivo no válido', 400);
			}

			logger.info(`🔄 Procesando ${files.length} archivo(s) de tipo: ${type}`);

			const processedFiles: ProcessedFile[] = [];

			for (const file of files) {
				try {
					let content = '';
					const filename = file.originalname;

					// Determinar el tipo de archivo y procesarlo
					if (
						file.mimetype === 'application/pdf' ||
						filename.toLowerCase().endsWith('.pdf')
					) {
						content = await extractPDFText(file.buffer, filename);
					} else if (
						file.mimetype.includes('word') ||
						filename.toLowerCase().endsWith('.docx') ||
						filename.toLowerCase().endsWith('.doc')
					) {
						content = await extractWordText(file.buffer, filename);
					} else if (
						file.mimetype === 'text/plain' ||
						filename.toLowerCase().endsWith('.txt')
					) {
						content = extractTextContent(file.buffer, filename);
					} else {
						throw new AppError(
							`Tipo de archivo no soportado: ${filename}`,
							400,
						);
					}

					// Limpiar el contenido
					const cleanedContent = cleanTextContent(content);

					processedFiles.push({
						name: filename,
						content: cleanedContent,
						type: type as 'specification' | 'proposal',
						success: true,
						extractedLength: cleanedContent.length,
					});

					logger.info(
						`✅ Archivo procesado exitosamente: ${filename} (${cleanedContent.length} caracteres)`,
					);
				} catch (error) {
					logger.error(`❌ Error procesando ${file.originalname}:`, error);

					processedFiles.push({
						name: file.originalname,
						content: '',
						type: type as 'specification' | 'proposal',
						success: false,
						error: error instanceof Error ? error.message : 'Error desconocido',
					});
				}
			}

			const summary = {
				total: files.length,
				successful: processedFiles.filter((f) => f.success).length,
				failed: processedFiles.filter((f) => !f.success).length,
			};

			logger.info(
				`📊 Resumen de procesamiento: ${summary.successful}/${summary.total} exitosos`,
			);

			const response: UploadResponse = {
				success: true,
				files: processedFiles,
				summary,
			};

			res.json(response);
		} catch (error) {
			next(error);
		}
	},
);

export default router;
