import dotenv from 'dotenv';
import express from 'express';
import { GoogleGenAI } from '@google/genai';
import logger from '../utils/logger';
import { AppError } from '../utils/errors';
import { FileContent, LotInfo, LotExtractionRequest } from '../types';

dotenv.config();

const router = express.Router();

const ai = new GoogleGenAI({
	apiKey: process.env.GEMINI_API_KEY!,
});

async function extractLotsFromSpecifications(
	specifications: FileContent[],
): Promise<LotInfo[]> {
	const specsContent = specifications
		.map(
			(spec) => `
    === DOCUMENT: ${spec.name} ===
    ${spec.content}
  `,
		)
		.join('\n\n');

	const prompt = `
    Ets un expert en anàlisi de licitacions públiques. Has de trobar TOTS els lots existents i els seus títols específics.

    DOCUMENTS D'ESPECIFICACIONS:
    ${specsContent}

    METODOLOGIA DE DETECCIÓ EXHAUSTIVA:

    1. BUSCA INDICADORS PRIMARIS DE LOTS:
       - "Lot", "Lote", "Lots", "Lotes" seguits de numeració (1, 2, A, B, I, II, etc.)
       - "Grup", "Grupo" amb numeració
       - "Apartado", "Apartat" amb numeració específica de lots
       - "Prestació", "Prestación" amb divisió en lots
       - "Paquet", "Paquete" amb numeració

    2. EXTRACCIÓ PRECISA DE TÍTOLS:
       Quan trobis una menció de lot, busca immediatament després:
       - El títol específic que segueix al número del lot
       - Descripcions que apareixen en la mateixa línia o paràgraf
       - Títols que apareixen en format: "Lot X: [TÍTOL ESPECÍFIC]"
       - Títols que apareixen com: "Lot X - [TÍTOL ESPECÍFIC]"
       - Títols en format taula o llista sota cada lot

    3. PATRONS DE CERCA ESPECÍFICS:
       - "Lot 1: Desenvolupament de plataforma web"
       - "Lote A - Serveis de consultoria IT"  
       - "Lot II. Manteniment d'infraestructures"
       - "Prestació 1: Auditoria de sistemes"
       - "Grup 1 - Formació especialitzada"

    4. CONTEXT D'IDENTIFICACIÓ:
       - Busca seccions dedicades a "divisió en lots"
       - Taules que mostren lots amb títols i pressupostos
       - Índex o sumari que llisti els lots
       - Referències a possibilitat de licitació per lots separats

    5. TÍTOLS ESPECÍFICS VS GENÈRICS:
       INCLOU (són títols vàlids de lots):
       - "Desenvolupament d'aplicació mòbil"
       - "Manteniment d'equipaments zona nord" 
       - "Consultoria en ciberseguretat"
       - "Subministrament d'ordinadors"
       - "Neteja d'edificis administratius"

       EXCLOU (NO són lots, són títols generals):
       - "Licitació per a la contractació de serveis"
       - "Procediment obert per a l'adjudicació"
       - "Contracte de serveis diversos"
       - Títols que no van precedits d'identificació de lot

    6. REGLES DE VALIDACIÓ:
       - Si trobes QUALSEVOL menció explícita de múltiples lots → busca TOTS els títols
       - Cada lot ha de tenir un identificador (número, lletra) i un títol descriptiu
       - Si només trobes "Lot 1" sense més lots → és lot únic
       - Si no trobes cap menció de lots → és lot únic

    7. CASOS ESPECIALS:
       - "Lot únic: [títol]" → 1 lot amb el títol específic
       - "Dividit en X lots:" → busca els X lots i els seus títols
       - "Possibilitat de licitació per lots" → busca els lots esmentats

    INSTRUCCIONS CRÍTIQUES:
    - EXTREU EL TÍTOL COMPLET de cada lot tal com apareix al document
    - NO omitir cap lot que tingui un títol específic
    - NO confondre títols de documents amb títols de lots
    - SI no trobes lots múltiples → retorna lot únic
    - SI trobes lots múltiples → retorna TOTS amb els seus títols reals

    FORMAT DE RESPOSTA (JSON):
    
    Per MÚLTIPLES LOTS:
    [
      {
        "lotNumber": 1,
        "title": "Títol específic del lot 1 tal com apareix al document",
        "description": "Descripció addicional si està disponible"
      },
      {
        "lotNumber": 2, 
        "title": "Títol específic del lot 2 tal com apareix al document",
        "description": "Descripció addicional si està disponible"
      }
    ]

    Per LOT ÚNIC:
    [
      {
        "lotNumber": 1,
        "title": "Lot Únic",
        "description": "Licitació amb un sol lot segons l'anàlisi del plec de condicions"
      }
    ]

    IMPORTANT: Respon NOMÉS amb el JSON. Cerca EXHAUSTIVAMENT tots els títols de lots existents.
  `;

	try {
		const config = {
			responseMimeType: 'application/json',
			temperature: 0.1,
		};

		const contents = [
			{
				role: 'user' as const,
				parts: [{ text: prompt }],
			},
		];

		logger.info('🔍 Performing exhaustive lots title extraction...');

		const response = await ai.models.generateContent({
			model: 'gemini-2.0-flash-lite',
			config,
			contents,
		});

		if (!response?.text) {
			throw new Error('No response received for lots extraction');
		}

		try {
			const cleanedResponse = response.text
				.replace(/```json\n?|\n?```/g, '')
				.trim();
			const lots = JSON.parse(cleanedResponse);

			if (Array.isArray(lots) && lots.length > 0) {
				const processedLots = lots
					.map((lot, index) => {
						const lotNumber = lot.lotNumber || index + 1;
						let title = lot.title || `Lot ${lotNumber}`;

						title = title.trim();

						if (title.length < 5 && lots.length === 1) {
							title = 'Lot Únic';
						}

						if (isInvalidLotTitle(title, lots.length)) {
							title = `Lot ${lotNumber}`;
						}

						return {
							lotNumber,
							title,
							description: lot.description?.trim() || undefined,
						};
					})
					.filter((lot, index, array) => {
						return !isDuplicateLot(lot, array, index);
					});

				if (
					processedLots.length === 1 &&
					processedLots[0].title === 'Lot Únic'
				) {
					logger.info('📄 Single lot detected');
					return processedLots;
				}

				if (processedLots.length > 1) {
					const hasSpecificTitles = processedLots.some(
						(lot) =>
							lot.title !== 'Lot Únic' &&
							lot.title !== `Lot ${lot.lotNumber}` &&
							!isGenericLotTitle(lot.title),
					);

					if (hasSpecificTitles) {
						logger.info(
							`✅ Successfully extracted ${processedLots.length} lots with specific titles: ${processedLots.map((l) => `"${l.title}"`).join(', ')}`,
						);
						return processedLots;
					}
				}

				logger.info(
					'📄 No distinct multiple lots found, defaulting to single lot',
				);
				return [
					{
						lotNumber: 1,
						title: 'Lot Únic',
						description:
							"Licitació amb un sol lot segons l'anàlisi del plec de condicions",
					},
				];
			}
		} catch (parseError) {
			logger.warn(
				'Error parsing lots JSON, using fallback extraction:',
				parseError,
			);

			const fallbackLots = extractLotsFromTextFallback(response.text);
			if (fallbackLots.length > 1) {
				logger.info(`📝 Fallback extraction found ${fallbackLots.length} lots`);
				return fallbackLots;
			}
		}

		logger.info('📄 No multiple lots detected, defaulting to single lot');
		return [
			{
				lotNumber: 1,
				title: 'Lot Únic',
				description: "Licitació amb un sol lot segons l'anàlisi automàtica",
			},
		];
	} catch (error) {
		logger.error('Error extracting lots:', error);
		return [
			{
				lotNumber: 1,
				title: 'Lot Únic',
				description: "Licitació amb un sol lot (error en l'anàlisi automàtica)",
			},
		];
	}
}

function extractLotsFromTextFallback(text: string): LotInfo[] {
	const lots: LotInfo[] = [];
	const lines = text.split('\n');

	const lotPatterns = [
		/lot\s*(\d+|[a-z]|[ivx]+)[\s\-:\.]*([^"'\n]{10,80})/gi,
		/lote\s*(\d+|[a-z]|[ivx]+)[\s\-:\.]*([^"'\n]{10,80})/gi,
		/grup\s*(\d+|[a-z])[\s\-:\.]*([^"'\n]{10,80})/gi,
		/prestaci[oó]n?\s*(\d+|[a-z])[\s\-:\.]*([^"'\n]{10,80})/gi,
	];

	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.length < 15 || trimmed.length > 150) continue;

		for (const pattern of lotPatterns) {
			const matches = [...trimmed.matchAll(pattern)];
			matches.forEach((match) => {
				const lotId = match[1]?.trim();
				const title = match[2]?.trim();

				if (lotId && title && title.length > 10 && !isGenericLotTitle(title)) {
					const lotNumber = isNaN(parseInt(lotId))
						? lots.length + 1
						: parseInt(lotId);

					lots.push({
						lotNumber,
						title: cleanLotTitle(title),
						description: undefined,
					});
				}
			});
		}

		if (lots.length >= 10) break;
	}

	return lots.slice(0, 8);
}

function cleanLotTitle(title: string): string {
	return title
		.replace(/^[\s\-:\.]+|[\s\-:\.]+$/g, '')
		.replace(/["'"""'']/g, '')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

function isInvalidLotTitle(title: string, totalLots: number): boolean {
	if (totalLots === 1) return false;

	const invalidPatterns = [
		/^licitaci[oó]n?\s+/i,
		/^contracte\s+/i,
		/^procediment\s+/i,
		/^expedient\s+/i,
		/^plec\s+de\s+/i,
		/^document\s+/i,
		/^objecte\s+del\s+contracte/i,
	];

	return invalidPatterns.some((pattern) => pattern.test(title));
}

function isGenericLotTitle(title: string): boolean {
	const genericTerms = [
		'lot únic',
		'lote único',
		'lot general',
		'servei general',
		'prestació general',
		'contracte',
		'licitació',
		'procediment',
	];

	const lowerTitle = title.toLowerCase();
	return genericTerms.some(
		(term) =>
			lowerTitle === term ||
			lowerTitle.startsWith(term + ' ') ||
			lowerTitle.endsWith(' ' + term),
	);
}

function isDuplicateLot(
	lot: LotInfo,
	allLots: LotInfo[],
	currentIndex: number,
): boolean {
	for (let i = 0; i < currentIndex; i++) {
		const otherLot = allLots[i];

		if (
			lot.title.toLowerCase().trim() === otherLot.title.toLowerCase().trim()
		) {
			return true;
		}

		const similarity = calculateTitleSimilarity(lot.title, otherLot.title);
		if (similarity > 0.8) {
			return true;
		}
	}

	return false;
}

function calculateTitleSimilarity(title1: string, title2: string): number {
	const clean1 = title1
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, '')
		.trim();
	const clean2 = title2
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, '')
		.trim();

	if (clean1 === clean2) return 1;

	const words1 = clean1.split(/\s+/);
	const words2 = clean2.split(/\s+/);

	const commonWords = words1.filter(
		(word) => word.length > 2 && words2.includes(word),
	).length;

	const totalUniqueWords = new Set([...words1, ...words2]).size;

	return commonWords / totalUniqueWords;
}

router.post('/', async (req, res, next) => {
	try {
		if (!process.env.GEMINI_API_KEY) {
			throw new AppError('System API key not configured', 500);
		}

		const { specifications }: LotExtractionRequest = req.body;

		if (
			!specifications ||
			!Array.isArray(specifications) ||
			specifications.length === 0
		) {
			throw new AppError('Specification documents are required', 400);
		}

		logger.info(
			'🚀 Starting exhaustive lots extraction with title detection...',
		);

		const extractedLots = await extractLotsFromSpecifications(specifications);

		const lotsDescription =
			extractedLots.length > 1 ? `${extractedLots.length} lots` : '1 lot';

		logger.info(`✅ Extraction completed: ${lotsDescription} identified`);

		extractedLots.forEach((lot, index) => {
			logger.info(
				`📋 Lot ${lot.lotNumber}: "${lot.title}"${lot.description ? ` - ${lot.description}` : ''}`,
			);
		});

		res.json(extractedLots);
	} catch (error) {
		next(error);
	}
});

export default router;
