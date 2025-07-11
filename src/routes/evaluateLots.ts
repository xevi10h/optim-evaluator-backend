import express from 'express';
import { GoogleGenAI } from '@google/genai';
import logger from '../utils/logger';
import { AppError } from '../utils/errors';
import {
	FileContent,
	LotInfo,
	EvaluationCriteria,
	LotEvaluation,
	EvaluationResult,
	LotEvaluationRequest,
} from '../types';

const router = express.Router();

const ai = new GoogleGenAI({
	apiKey: process.env.GEMINI_API_KEY!,
});

async function extractCriteriaForLot(
	specifications: FileContent[],
	lot: LotInfo,
): Promise<string[]> {
	const specsContent = specifications
		.map(
			(spec) => `
    === DOCUMENT: ${spec.name} ===
    ${spec.content}
  `,
		)
		.join('\n\n');

	const prompt = `
    Ets un expert en avaluació de licitacions públiques. Extreu els criteris SUBJECTIUS d'avaluació específics per al lote "${lot.title}" (Lote ${lot.lotNumber}).

    DOCUMENTS D'ESPECIFICACIONS:
    ${specsContent}

    LOTE A ANALITZAR:
    - Número: ${lot.lotNumber}
    - Títol: ${lot.title}
    ${lot.description ? `- Descripció: ${lot.description}` : ''}

    INSTRUCCIONS:
    1. CERCA criteris específics per aquest lote o criteris generals aplicables
    2. INCLOU només criteris SUBJECTIUS que requereixin judici de valor
    3. EXCLOU criteris objectius (preu, certificacions, anys d'experiència exactes)
    4. MÀXIM 8 criteris per mantenir l'avaluació manejable

    FORMAT DE RESPOSTA (JSON):
    ["Criteri subjectiu 1", "Criteri subjectiu 2", ...]

    Si no trobes criteris específics per aquest lote, retorna criteris generals aplicables.
  `;

	try {
		const config = {
			responseMimeType: 'application/json',
			temperature: 0.2,
		};

		const contents = [
			{
				role: 'user' as const,
				parts: [{ text: prompt }],
			},
		];

		const response = await ai.models.generateContent({
			model: 'gemini-2.0-flash-lite',
			config,
			contents,
		});

		if (!response?.text) {
			throw new Error('No criteria received for lot');
		}

		try {
			const criteria = JSON.parse(response.text);
			return Array.isArray(criteria) ? criteria.slice(0, 8) : [];
		} catch (parseError) {
			logger.warn(
				'Error parsing criteria JSON, extracting from text:',
				parseError,
			);
			return extractCriteriaFromText(response.text);
		}
	} catch (error) {
		logger.error(`Error extracting criteria for lot ${lot.lotNumber}:`, error);
		return [];
	}
}

function extractCriteriaFromText(text: string): string[] {
	const lines = text.split('\n');
	const criteria: string[] = [];

	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.length > 10 && trimmed.length < 100) {
			const cleaned = trimmed
				.replace(/^[\d\-\*\•\.\)]+\s*/, '')
				.replace(/["\[\]]/g, '');
			if (cleaned.length > 5) {
				criteria.push(cleaned);
			}
		}
	}

	return criteria.slice(0, 8);
}

async function evaluateLotCriterion(
	criterion: string,
	lot: LotInfo,
	specifications: FileContent[],
	proposalContent: string,
): Promise<EvaluationCriteria> {
	const specsContent = specifications
		.map(
			(spec) => `
    === ESPECIFICACIÓ: ${spec.name} ===
    ${spec.content}
  `,
		)
		.join('\n\n');

	const prompt = `
    Ets un expert tècnic en avaluació de licitacions amb estàndards d'avaluació rigorosos. Avalua el criteri "${criterion}" per al lote "${lot.title}" (Lote ${lot.lotNumber}) amb criteris estrictes però justos.

    ESPECIFICACIONS:
    ${specsContent}

    PROPOSTA PER AQUEST LOTE:
    ${proposalContent}

    LOTE A AVALUAR:
    - Número: ${lot.lotNumber}
    - Títol: ${lot.title}
    ${lot.description ? `- Descripció: ${lot.description}` : ''}

    INSTRUCCIONS D'AVALUACIÓ RIGOROSA:
    1. Centra't específicament en aquest lote i criteri
    2. Analitza com la proposta respon als requeriments d'aquest lote
    3. Usa l'escala amb criteris estrictes: 
       - INSUFICIENT: No compleix requisits mínims o resposta inadequada
       - REGULAR: Compleix requisits mínims de manera adequada però estàndard
       - COMPLEIX_EXITOSAMENT: **NOMÉS** quan supera clarament expectatives, aporta valor excepcional i demostra expertesa superior
    4. Proporciona justificació detallada (mínim 150 paraules)
    5. Sigues conservador amb puntuacions altes - "COMPLEIX_EXITOSAMENT" ha de ser realment excepcional

    CRITERIS ESTRICTES PER "COMPLEIX_EXITOSAMENT":
    - Demostra comprensió excepcional dels requeriments específics del lote
    - Aporta solucions innovadores o especialment ben fonamentades
    - Proporciona detalls concrets que mostren expertesa superior
    - Supera clarament les expectatives mínimes

	IDIOMA DE LA RESPOSTA: Català (sempre en català).
    FORMAT DE RESPOSTA (JSON):
    {
      "score": "INSUFICIENT|REGULAR|COMPLEIX_EXITOSAMENT",
      "justification": "Justificació detallada amb criteris rigorosos...",
      "strengths": ["Punt fort 1", "Punt fort 2"],
      "improvements": ["Millora 1", "Millora 2"],
      "references": ["Referència 1", "Referència 2"]
    }
  `;

	try {
		const config = {
			responseMimeType: 'application/json',
			temperature: 0.1, // Reducida para mayor rigor
		};

		const contents = [
			{
				role: 'user' as const,
				parts: [{ text: prompt }],
			},
		];

		const response = await ai.models.generateContent({
			model: 'gemini-2.0-flash-lite',
			config,
			contents,
		});

		if (!response?.text) {
			throw new Error('No evaluation received for criterion');
		}

		const jsonMatch = response.text.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			const evaluation = JSON.parse(jsonMatch[0]);
			return {
				criterion,
				score: evaluation.score,
				justification: evaluation.justification,
				strengths: evaluation.strengths || [],
				improvements: evaluation.improvements || [],
				references: evaluation.references || [],
			};
		} else {
			throw new Error('Could not extract JSON from response');
		}
	} catch (error) {
		logger.error(
			`Error evaluating criterion "${criterion}" for lot ${lot.lotNumber}:`,
			error,
		);

		return {
			criterion,
			score: 'REGULAR',
			justification: `No s'ha pogut evaluar automàticament el criteri "${criterion}" per al lote ${lot.lotNumber}. Es requereix revisió manual.`,
			strengths: ['Revisió manual requerida'],
			improvements: ['Avaluació automàtica fallida'],
			references: ['Error en processament'],
		};
	}
}

async function generateLotSummary(
	lot: LotInfo,
	criteria: EvaluationCriteria[],
	hasProposal: boolean,
): Promise<{ summary: string; recommendation: string; confidence: number }> {
	if (!hasProposal) {
		return {
			summary: `No s'ha presentat proposta per al lote ${lot.lotNumber}: ${lot.title}`,
			recommendation: `Aquest lote no ha rebut cap proposta, pel que no es pot procedir amb l'avaluació. Cal considerar les següents preguntes: ¿Convé relicitar aquest lote específic? ¿Els requisits són adequats per al mercat? ¿Hi ha barreres d'entrada que cal revisar?`,
			confidence: 1.0,
		};
	}

	const criteriaResults = criteria
		.map(
			(c) => `
    CRITERI: ${c.criterion}
    PUNTUACIÓ: ${c.score}
    JUSTIFICACIÓ: ${c.justification}
  `,
		)
		.join('\n---\n');

	const excellentScores = criteria.filter(
		(c) => c.score === 'COMPLEIX_EXITOSAMENT',
	).length;
	const regularScores = criteria.filter((c) => c.score === 'REGULAR').length;
	const insufficientScores = criteria.filter(
		(c) => c.score === 'INSUFICIENT',
	).length;

	const prompt = `
    Genera un resum i recomanació analítica per al lote ${lot.lotNumber}: ${lot.title}.

    RESULTATS:
    ${criteriaResults}

    ESTADÍSTIQUES:
    - Compleix exitosament: ${excellentScores}
    - Regular: ${regularScores}
    - Insuficient: ${insufficientScores}

    INSTRUCCIONS:
    1. RESUM: Síntesi professional del rendiment d'aquest lote
    2. RECOMANACIÓ ANALÍTICA (NO decisiva):
       - Identifica els aspectes més destacables de la proposta per aquest lote
       - Assenyala les àrees que requereixen atenció o aclariment
       - Planteja preguntes clau específiques per aquest lote:
         * Sobre l'adequació tècnica de la solució proposada
         * Sobre la viabilitat de la implementació per aquest lote específic
         * Sobre el valor real que aporta aquesta proposta al lote
         * Sobre possibles riscos o consideracions especials
       - NO facis recomanacions directives de contractació
       - Proporciona elements per a l'anàlisi interna de l'equip

	IDIOMA DE LA RESPOSTA: Català (sempre en català).
    FORMAT DE RESPOSTA (JSON):
    {
      "summary": "Resum professional del rendiment d'aquest lote...",
      "recommendation": "Anàlisi dels punts forts, àrees d'atenció i preguntes clau per a la reflexió sobre aquest lote específic...",
      "confidence": 0.85
    }
  `;

	try {
		const config = {
			responseMimeType: 'application/json',
			temperature: 0.2,
		};

		const contents = [
			{
				role: 'user' as const,
				parts: [{ text: prompt }],
			},
		];

		const response = await ai.models.generateContent({
			model: 'gemini-2.0-flash-lite',
			config,
			contents,
		});

		if (!response?.text) {
			throw new Error('No summary received for lot');
		}

		const jsonMatch = response.text.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			const summary = JSON.parse(jsonMatch[0]);
			return {
				summary: summary.summary,
				recommendation: summary.recommendation,
				confidence: summary.confidence,
			};
		} else {
			throw new Error('Could not extract JSON from response');
		}
	} catch (error) {
		logger.error(`Error generating summary for lot ${lot.lotNumber}:`, error);

		const scores = criteria.map((c) => {
			switch (c.score) {
				case 'COMPLEIX_EXITOSAMENT':
					return 3;
				case 'REGULAR':
					return 2;
				case 'INSUFICIENT':
					return 1;
				default:
					return 2;
			}
		});

		const averageScore =
			scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 2;

		return {
			summary: `El lote ${lot.lotNumber} ha estat evaluat segons ${criteria.length} criteris. Els resultats mostren un rendiment ${averageScore >= 2.5 ? 'satisfactori' : 'que requereix millores'}.`,
			recommendation: `Cal analitzar internament si aquesta proposta s'adequa als objectius específics del lote ${lot.lotNumber}. Es recomana revisar els aspectes destacats i considerar les àrees que necessiten atenció.`,
			confidence: 0.75,
		};
	}
}

router.post('/', async (req, res, next) => {
	try {
		if (!process.env.GEMINI_API_KEY) {
			throw new AppError('System API key not configured', 500);
		}

		const { specifications, proposals, lots }: LotEvaluationRequest = req.body;

		if (
			!specifications ||
			!Array.isArray(specifications) ||
			specifications.length === 0
		) {
			throw new AppError('Specification documents are required', 400);
		}

		if (!proposals || !Array.isArray(proposals)) {
			throw new AppError('Proposals array is required', 400);
		}

		if (!lots || !Array.isArray(lots) || lots.length === 0) {
			throw new AppError('Lots information is required', 400);
		}

		logger.info(`🚀 Starting evaluation for ${lots.length} lot(s)...`);

		const lotEvaluations: LotEvaluation[] = [];

		for (const lot of lots) {
			logger.info(`🔍 Evaluating lot ${lot.lotNumber}: ${lot.title}`);

			// Check if there are proposals for this lot
			const lotProposals = proposals.filter(
				(p) => p.lotNumber === lot.lotNumber,
			);
			const hasProposal = lotProposals.length > 0;

			if (!hasProposal) {
				logger.info(`⚠️ No proposal found for lot ${lot.lotNumber}`);
				const { summary, recommendation, confidence } =
					await generateLotSummary(lot, [], false);

				lotEvaluations.push({
					lotNumber: lot.lotNumber,
					lotTitle: lot.title,
					hasProposal: false,
					criteria: [],
					summary,
					recommendation,
					confidence,
				});
				continue;
			}

			// Extract criteria for this lot
			const criteria = await extractCriteriaForLot(specifications, lot);

			if (criteria.length === 0) {
				logger.warn(`No criteria found for lot ${lot.lotNumber}`);
				lotEvaluations.push({
					lotNumber: lot.lotNumber,
					lotTitle: lot.title,
					hasProposal: true,
					criteria: [],
					summary: `No s'han pogut extraure criteris d'avaluació per al lote ${lot.lotNumber}`,
					recommendation: `Es requereix revisió manual dels criteris d'avaluació per aquest lote. Cal considerar: ¿Estan ben definits els requisits al plec? ¿Hi ha criteris implícits que caldria explicitar?`,
					confidence: 0.3,
				});
				continue;
			}

			// Combine all proposal content for this lot
			const lotProposalContent = lotProposals
				.map((p) => `=== ${p.name} ===\n${p.content}`)
				.join('\n\n');

			// Evaluate each criterion for this lot
			const criteriaEvaluations: EvaluationCriteria[] = [];
			for (const criterion of criteria) {
				const evaluation = await evaluateLotCriterion(
					criterion,
					lot,
					specifications,
					lotProposalContent,
				);
				criteriaEvaluations.push(evaluation);
			}

			// Generate summary for this lot
			const { summary, recommendation, confidence } = await generateLotSummary(
				lot,
				criteriaEvaluations,
				hasProposal,
			);

			lotEvaluations.push({
				lotNumber: lot.lotNumber,
				lotTitle: lot.title,
				hasProposal: true,
				criteria: criteriaEvaluations,
				summary,
				recommendation,
				confidence,
			});

			logger.info(`✅ Completed evaluation for lot ${lot.lotNumber}`);
		}

		// For the result, we only return individual lot evaluations
		// No overall summary/recommendation needed
		const result: EvaluationResult = {
			lots: lotEvaluations,
			extractedLots: lots,
			overallSummary: '', // No longer needed
			overallRecommendation: '', // No longer needed
			overallConfidence:
				lotEvaluations.length > 0
					? lotEvaluations.reduce((sum, lot) => sum + lot.confidence, 0) /
						lotEvaluations.length
					: 0,
		};

		logger.info('✅ Evaluation completed successfully');
		res.json(result);
	} catch (error) {
		next(error);
	}
});

export default router;
