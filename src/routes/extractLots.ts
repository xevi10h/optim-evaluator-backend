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
    Ets un expert en anàlisi de licitacions públiques. La teva tasca és determinar si aquesta licitació té múltiples LOTS ESPECÍFICS o només un lot únic.

    DOCUMENTS D'ESPECIFICACIONS:
    ${specsContent}

    REGLES FONAMENTALS PER A LA DETECCIÓ DE LOTS:

    1. INDICADORS OBLIGATORIS DE MÚLTIPLES LOTS:
       - DIVISIÓ EXPLÍCITA amb paraules: "Lot", "Lote", "Lots", "Lotes"
       - NUMERACIÓ CLARA de lots: "Lot 1", "Lot 2", "Lote A", "Lote B"
       - PRESSUPOSTOS SEPARATS per cada lot clarament identificat
       - POSSIBILITAT EXPLÍCITA de presentar ofertes per lots separats
       - CRITERIS D'AVALUACIÓ DIFERENTS per cada lot específic

    2. EL QUE NO SON LOTS (EXCLUSIONS CRÍTIQUES):
       - Títols generals de la licitació o contracte
       - Seccions, capítols o apartats que són parts del mateix lot
       - Divisions administratives o organitzatives
       - Fases temporals del mateix projecte
       - Activitats diferents dins del mateix lot
       - Prestacions complementàries del mateix lot

    3. ANÀLISI ESTRICTA:
       - Si trobes paraules com "Lot" seguides de numeració → ANALITZA si són realment lots independents
       - Si NO trobes la paraula "Lot" o similar → És un lot únic SEMPRE
       - Si trobes divisions però sense possibilitat de licitació separada → És un lot únic
       - Si trobes "Lot únic" o "Un sol lot" → És un lot únic

    4. VALIDACIÓ FINAL:
       - Cada lot identificat ha de tenir:
         * Nom específic i descriptiu
         * Possibilitat real de licitació independent
         * Pressupost o valoració separada (si disponible)
         * Criteris propis o diferenciats

    5. EXTRACCIÓ DE TÍTOLS:
       - Extreu NOMÉS el nom específic de cada lot, NO el títol general de la licitació
       - Els títols han de ser descriptius del contingut específic del lot
       - Evita duplicar informació del títol general en cada lot

    CASOS D'ÚS:
    - Si trobes "Licitació de serveis informàtics" amb "Lot 1: Desenvolupament web" i "Lot 2: Manteniment" → 2 lots
    - Si trobes "Licitació de neteja" sense mencions de lots → 1 lot únic
    - Si trobes "Contracte de consultoria" amb divisions però sense lots explícits → 1 lot únic
    - Si trobes "Lot únic: Serveis de consultoria" → 1 lot únic

    FORMAT DE RESPOSTA (JSON estricte):
    
    Per MÚLTIPLES LOTS (només si hi ha evidència explícita):
    [
      {
        "lotNumber": 1,
        "title": "Nom específic del lot 1 (NO el títol general de la licitació)",
        "description": "Descripció específica del lot si disponible"
      },
      {
        "lotNumber": 2,
        "title": "Nom específic del lot 2 (NO el títol general de la licitació)",
        "description": "Descripció específica del lot si disponible"
      }
    ]

    Per LOT ÚNIC (cas per defecte quan hi ha dubtes):
    [
      {
        "lotNumber": 1,
        "title": "Lot Únic",
        "description": "Licitació amb un sol lot segons l'anàlisi del plec de condicions"
      }
    ]

    PRINCIPI CONSERVADOR: En cas de dubte, retorna SEMPRE un lot únic. Només identifica múltiples lots quan hi hagi evidència EXPLÍCITA i CLARA.

    IMPORTANT: Respon NOMÉS amb el JSON, sense explicacions addicionals.
  `;

	try {
		const config = {
			responseMimeType: 'application/json',
			temperature: 0.05,
		};

		const contents = [
			{
				role: 'user' as const,
				parts: [{ text: prompt }],
			},
		];

		logger.info('🔍 Analyzing lots with improved detection logic...');

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

						if (title.length < 5) {
							title = `Lot ${lotNumber}`;
						}

						if (isGenericLicitationTitle(title)) {
							title = `Lot ${lotNumber}`;
						}

						return {
							lotNumber,
							title,
							description: lot.description?.trim() || undefined,
						};
					})
					.filter((lot, index, array) => {
						if (array.length === 1) return true;

						return !isDuplicateOrGeneric(lot, array, index);
					});

				if (processedLots.length <= 1) {
					logger.info('📄 Analysis resulted in single lot');
					return [
						{
							lotNumber: 1,
							title: 'Lot Únic',
							description:
								"Licitació amb un sol lot segons l'anàlisi automàtica",
						},
					];
				}

				logger.info(
					`✅ Successfully extracted ${processedLots.length} lots: ${processedLots.map((l) => l.title).join(', ')}`,
				);

				return processedLots;
			}
		} catch (parseError) {
			logger.warn(
				'Error parsing lots JSON, defaulting to single lot:',
				parseError,
			);
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

function isGenericLicitationTitle(title: string): boolean {
	const genericPatterns = [
		/^licitaci[oó]n?\s+de\s+/i,
		/^contracte\s+de\s+/i,
		/^servei[so]?\s+de\s+/i,
		/^prestaci[oó]n?\s+de\s+/i,
		/^subministrament\s+de\s+/i,
		/^obra[es]?\s+de\s+/i,
		/^procediment\s+/i,
		/^expedient\s+/i,
		/^plec\s+de\s+/i,
		/^document\s+/i,
	];

	return genericPatterns.some((pattern) => pattern.test(title));
}

function isDuplicateOrGeneric(
	lot: LotInfo,
	allLots: LotInfo[],
	currentIndex: number,
): boolean {
	const currentTitle = lot.title.toLowerCase().trim();

	if (currentTitle === 'lot únic' && allLots.length > 1) {
		return true;
	}

	for (let i = 0; i < allLots.length; i++) {
		if (i === currentIndex) continue;

		const otherTitle = allLots[i].title.toLowerCase().trim();

		if (currentTitle === otherTitle) {
			return i < currentIndex;
		}

		if (
			currentTitle.includes(otherTitle) ||
			otherTitle.includes(currentTitle)
		) {
			if (currentTitle.length < otherTitle.length) {
				return true;
			}
		}
	}

	return false;
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

		logger.info('🚀 Starting improved lots extraction...');

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
