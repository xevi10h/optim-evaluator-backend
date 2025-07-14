// src/routes/extractLots.ts
import express from 'express';
import { GoogleGenAI } from '@google/genai';
import logger from '../utils/logger';
import { AppError } from '../utils/errors';
import { FileContent, LotInfo, LotExtractionRequest } from '../types';

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
    Ets un expert en anàlisi de licitacions públiques. Analitza els següents documents d'especificacions per identificar si hi ha múltiples lotes i extreure'n la informació.

    DOCUMENTS D'ESPECIFICACIONS:
    ${specsContent}

    INSTRUCCIONS D'ANÀLISI:

    1. CERCA INDICADORS DE LOTES:
       - "Lot", "Lot", "Lotes"
       - "Grup", "Grupos"
       - "Apartado", "Apartados"
       - "Prestació", "Prestacions"
       - Numeració o divisions clares (1., 2., A., B., etc.)

    2. IDENTIFICA CADA LOTE:
       - Número del lote
       - Títol o descripció del lote
       - Descripció addicional si està disponible

    3. CRITERIS PER DETERMINAR LOTES:
       - Si trobes indicacions explícites de múltiples lotes
       - Si hi ha divisions clares amb criteris d'avaluació separats
       - Si hi ha pressupostos o imports diferenciats
       - Si es menciona que es pot presentar proposta per lotes separats

    4. RESPOSTA PREDETERMINADA:
       - Si NO trobes evidència clara de múltiples lotes, retorna un sol lote
       - Si hi ha dubtes, inclina't cap a un sol lote

    EXEMPLES DE LOTES TÍPICS:
    - Lot 1: Serveis de consultoria
    - Lot 2: Desenvolupament de software
    - Lot A: Manteniment d'infraestructures
    - Lot B: Suport tècnic

    FORMAT DE RESPOSTA (JSON estricte):
    [
      {
        "lotNumber": 1,
        "title": "Títol del lote 1",
        "description": "Descripció opcional del lote"
      },
      {
        "lotNumber": 2,
        "title": "Títol del lote 2",
        "description": "Descripció opcional del lote"
      }
    ]

    Si només hi ha un lote o no trobes evidència de múltiples lotes:
    [
      {
        "lotNumber": 1,
        "title": "Lot Únic",
        "description": "Licitació amb un sol lote"
      }
    ]

    IMPORTANT: Sigues conservador. És millor identificar un sol lote quan hi ha dubtes.
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

		logger.info('🔍 Extracting lots information with Gemini...');

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
				return lots.map((lot, index) => ({
					lotNumber: lot.lotNumber || index + 1,
					title: lot.title || `Lot ${lot.lotNumber || index + 1}`,
					description: lot.description,
				}));
			}
		} catch (parseError) {
			logger.warn('Error parsing lots JSON, using default:', parseError);
		}

		// Fallback to single lot
		return [
			{
				lotNumber: 1,
				title: 'Lot Únic',
				description: 'Licitació amb un sol lote',
			},
		];
	} catch (error) {
		logger.error('Error extracting lots:', error);
		// Fallback to single lot
		return [
			{
				lotNumber: 1,
				title: 'Lot Únic',
				description: 'Licitació amb un sol lote',
			},
		];
	}
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

		logger.info('🚀 Starting lots extraction...');

		const extractedLots = await extractLotsFromSpecifications(specifications);

		logger.info(
			`✅ Extracted ${extractedLots.length} lot(s): ${extractedLots.map((l) => l.title).join(', ')}`,
		);

		res.json(extractedLots);
	} catch (error) {
		next(error);
	}
});

export default router;
