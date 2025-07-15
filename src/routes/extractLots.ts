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
    Ets un expert en anàlisi de licitacions públiques. Analitza els següents documents d'especificacions per identificar si hi ha múltiples lotes i extreure'n la informació detallada.

    DOCUMENTS D'ESPECIFICACIONS:
    ${specsContent}

    INSTRUCCIONS D'ANÀLISI DETALLADA:

    1. CERCA INDICADORS DE LOTES (per ordre de prioritat):
       a) INDICADORS EXPLÍCITS:
          - "Lot", "Lote", "Lotes"
          - "Grup", "Grupos"
          - "Apartado", "Apartados", "Apartat", "Apartats"
          - "Prestació", "Prestacions", "Prestación", "Prestaciones"
          - "Paquet", "Paquets", "Paquete", "Paquetes"
          - "Servei", "Serveis", "Servicio", "Servicios" (amb numeració)
          
       b) INDICADORS ESTRUCTURALS:
          - Numeració clara amb títols (1., 2., A., B., I., II., etc.)
          - Seccions amb pressupostos separats
          - Divisions amb criteris d'avaluació diferenciats
          - Parts amb possibilitat de licitació separada

    2. IDENTIFICA CADA LOTE AMB PRECISIÓ:
       - Número del lote (pot ser numèric, alfabètic o romà)
       - Títol COMPLET i descriptiu del lote
       - Descripció addicional si està disponible al text
       - Àmbit d'aplicació específic

    3. CRITERIS ESTRICTES PER DETERMINAR MÚLTIPLES LOTES:
       - Si es menciona explícitament "lot", "lote" o similars
       - Si hi ha divisions clares amb criteris d'avaluació SEPARATS
       - Si hi ha pressupostos o imports DIFERENCIATS per cada part
       - Si es menciona que es pot presentar proposta per "lotes separats" o "parts diferenciades"
       - Si hi ha terminis d'execució DIFERENTS per cada part
       - Si es mencionen empreses DIFERENTS per cada servei

    4. EXTRACCIÓ DE TÍTOLS PRECISOS:
       - Extreu el títol COMPLET tal com apareix al document
       - Evita títols genèrics com "Serveis" - busca descriptions específiques
       - Inclou l'àmbit geogràfic o temporal si està especificat
       - Mantén la terminologia original del document

    5. RESPOSTA PREDETERMINADA CONSERVADORA:
       - Si NO trobes evidència CLARA de múltiples lotes, retorna un sol lote
       - Si hi ha DUBTES sobre la divisió, inclina't cap a un sol lote
       - La detecció de múltiples lotes requereix evidència EXPLÍCITA

    EXEMPLES DE LOTES BEN IDENTIFICATS:
    - Lot 1: "Serveis de consultoria en transformació digital"
    - Lot 2: "Desenvolupament i implementació de plataforma web"
    - Lot A: "Manteniment d'infraestructures de la zona nord"
    - Lot B: "Manteniment d'infraestructures de la zona sud"

    FORMAT DE RESPOSTA (JSON estricte):
    [
      {
        "lotNumber": 1,
        "title": "Títol complet i específic del lote 1 tal com apareix al document",
        "description": "Descripció opcional extreta del document si està disponible"
      },
      {
        "lotNumber": 2,
        "title": "Títol complet i específic del lote 2 tal com apareix al document", 
        "description": "Descripció opcional extreta del document si està disponible"
      }
    ]

    Si només hi ha un lote o no trobes evidència CLARA de múltiples lotes:
    [
      {
        "lotNumber": 1,
        "title": "Lot Únic",
        "description": "Licitació amb un sol lote segons l'anàlisi del plec de condicions"
      }
    ]

    NOTES IMPORTANTS:
    - Sigues MOLT conservador: millor identificar un sol lote quan hi ha dubtes
    - Els títols han de ser DESCRIPTIUS i ESPECÍFICS, no genèrics
    - Extreu els títols EXACTAMENT com apareixen al document original
    - Si identifiques lotes, assegura't que cada un tingui un àmbit clar i diferenciat
    
    IMPORTANT: Respon en català i sigue conservador en la identificació.
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

		logger.info('🔍 Extracting lots information with enhanced analysis...');

		const response = await ai.models.generateContent({
			model: 'gemini-2.0-flash-lite',
			config,
			contents,
		});

		if (!response?.text) {
			throw new Error('No response received for lots extraction');
		}

		try {
			const lots = JSON.parse(response.text);
			if (Array.isArray(lots) && lots.length > 0) {
				const processedLots = lots.map((lot, index) => {
					const lotNumber = lot.lotNumber || index + 1;
					let title = lot.title || `Lot ${lotNumber}`;

					// Netejar títols massa genèrics
					if (
						title.length < 10 ||
						/^(lot|lote|servei|servicio|prestació|prestación)\s*\d*$/i.test(
							title.trim(),
						)
					) {
						title = `Lot ${lotNumber}`;
					}

					return {
						lotNumber,
						title: title.trim(),
						description: lot.description?.trim() || undefined,
					};
				});

				logger.info(
					`✅ Successfully extracted ${processedLots.length} lot(s): ${processedLots.map((l) => l.title).join(', ')}`,
				);

				return processedLots;
			}
		} catch (parseError) {
			logger.warn(
				'Error parsing lots JSON, using fallback analysis:',
				parseError,
			);

			// Fallback: intentar extreure lots del text directament
			const fallbackLots = extractLotsFromText(response.text);
			if (fallbackLots.length > 0) {
				logger.info(
					`📝 Fallback extraction found ${fallbackLots.length} lot(s)`,
				);
				return fallbackLots;
			}
		}

		// Fallback final a un sol lot
		logger.info('📄 No multiple lots detected, defaulting to single lot');
		return [
			{
				lotNumber: 1,
				title: 'Lot Únic',
				description: "Licitació amb un sol lote segons l'anàlisi automàtica",
			},
		];
	} catch (error) {
		logger.error('Error extracting lots:', error);
		// Fallback a un sol lot en cas d'error
		return [
			{
				lotNumber: 1,
				title: 'Lot Únic',
				description:
					"Licitació amb un sol lote (error en l'anàlisi automàtica)",
			},
		];
	}
}

function extractLotsFromText(text: string): LotInfo[] {
	const lots: LotInfo[] = [];
	const lines = text.split('\n');

	// Buscar patrons de lots en el text
	const lotPatterns = [
		/lot\s*(\d+):?\s*(.+)/gi,
		/lote\s*(\d+):?\s*(.+)/gi,
		/(\d+)\.\s*(.+)/g,
		/([a-z])\.\s*(.+)/gi,
	];

	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.length < 10 || trimmed.length > 100) continue;

		for (const pattern of lotPatterns) {
			const match = trimmed.match(pattern);
			if (match && match.length >= 3) {
				const lotNumber = parseInt(match[1]) || lots.length + 1;
				const title = match[2]?.trim();

				if (title && title.length > 5) {
					lots.push({
						lotNumber,
						title: title.replace(/["""'']/g, '').trim(),
						description: undefined,
					});
					break;
				}
			}
		}

		if (lots.length >= 5) break; // Màxim 5 lots per fallback
	}

	return lots.slice(0, 5); // Limitar a 5 lots màxim
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

		logger.info('🚀 Starting enhanced lots extraction...');

		const extractedLots = await extractLotsFromSpecifications(specifications);

		const lotsDescription =
			extractedLots.length > 1 ? `${extractedLots.length} lots` : '1 lot';

		logger.info(`✅ Extraction completed: ${lotsDescription} identified`);

		// Log detallat dels lots extrets
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
