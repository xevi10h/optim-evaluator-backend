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
    Avalua el criteri "${criterion}" per al lote "${lot.title}" (Lote ${lot.lotNumber}).

    ESPECIFICACIONS:
    ${specsContent}

    PROPOSTA PER AQUEST LOTE:
    ${proposalContent}

    LOTE A AVALUAR:
    - Número: ${lot.lotNumber}
    - Títol: ${lot.title}
    ${lot.description ? `- Descripció: ${lot.description}` : ''}

    INSTRUCCIONS:
    1. Centra't específicament en aquest lote i criteri
    2. Analitza com la proposta respon als requeriments d'aquest lote
    3. Usa l'escala: INSUFICIENT, REGULAR, COMPLEIX_EXITOSAMENT
    4. Proporciona justificació detallada (mínim 150 paraules)

	IDIOMA DE LA RESPOSTA: Català (sempre en català).
    FORMAT DE RESPOSTA (JSON):
    {
      "score": "INSUFICIENT|REGULAR|COMPLEIX_EXITOSAMENT",
      "justification": "Justificació detallada...",
      "strengths": ["Punt fort 1", "Punt fort 2"],
      "improvements": ["Millora 1", "Millora 2"],
      "references": ["Referència 1", "Referència 2"]
    }
  `;

	try {
		const config = {
			responseMimeType: 'application/json',
			temperature: 0.3,
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
			recommendation: `Aquest lote no pot ser adjudicat ja que no s'ha rebut cap proposta.`,
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
    Genera un resum i recomanació per al lote ${lot.lotNumber}: ${lot.title}.

    RESULTATS:
    ${criteriaResults}

    ESTADÍSTIQUES:
    - Compleix exitosament: ${excellentScores}
    - Regular: ${regularScores}
    - Insuficient: ${insufficientScores}

	IDIOMA DE LA RESPOSTA: Català (sempre en català).
    FORMAT DE RESPOSTA (JSON):
    {
      "summary": "Resum professional del rendiment d'aquest lote...",
      "recommendation": "Recomanació específica per aquest lote...",
      "confidence": 0.85
    }
  `;

	try {
		const config = {
			responseMimeType: 'application/json',
			temperature: 0.3,
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
			recommendation:
				averageScore >= 2.5
					? `Es recomana considerar aquest lote per a adjudicació.`
					: `Es recomana sol·licitar aclariments abans de l'adjudicació d'aquest lote.`,
			confidence: 0.75,
		};
	}
}

async function generateOverallSummary(
	lots: LotEvaluation[],
): Promise<{ summary: string; recommendation: string; confidence: number }> {
	const lotsWithProposals = lots.filter((lot) => lot.hasProposal);
	const lotsWithoutProposals = lots.filter((lot) => !lot.hasProposal);

	if (lotsWithProposals.length === 0) {
		return {
			summary: "No s'han rebut propostes per cap dels lotes de la licitació.",
			recommendation:
				'Es recomana declarar la licitació deserta i iniciar un nou procés.',
			confidence: 1.0,
		};
	}

	const lotSummaries = lotsWithProposals
		.map(
			(lot) => `
    LOTE ${lot.lotNumber}: ${lot.lotTitle}
    Criteris avaluats: ${lot.criteria.length}
    Resum: ${lot.summary}
    Recomanació: ${lot.recommendation}
  `,
		)
		.join('\n---\n');

	const prompt = `
    Genera un resum general i recomanació final per a una licitació amb múltiples lotes.

    LOTES AVALUATS:
    ${lotSummaries}

    ${
			lotsWithoutProposals.length > 0
				? `
    LOTES SENSE PROPOSTA:
    ${lotsWithoutProposals.map((lot) => `- Lote ${lot.lotNumber}: ${lot.lotTitle}`).join('\n')}
    `
				: ''
		}

    ESTADÍSTIQUES GENERALS:
    - Total lotes: ${lots.length}
    - Lotes amb proposta: ${lotsWithProposals.length}
    - Lotes sense proposta: ${lotsWithoutProposals.length}

    INSTRUCCIONS:
    1. Proporciona un resum executiu global
    2. Analitza el rendiment general de la proposta
    3. Dona una recomanació final considerant tots els lotes
    4. Tingues en compte els lotes sense proposta

	IDIOMA DE LA RESPOSTA: Català (sempre en català).
    FORMAT DE RESPOSTA (JSON):
    {
      "summary": "Resum executiu general de la licitació...",
      "recommendation": "Recomanació final per a la licitació completa...",
      "confidence": 0.85
    }
  `;

	try {
		const config = {
			responseMimeType: 'application/json',
			temperature: 0.3,
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
			throw new Error('No overall summary received');
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
		logger.error('Error generating overall summary:', error);

		const totalWithProposals = lotsWithProposals.length;
		const avgConfidence =
			lotsWithProposals.length > 0
				? lotsWithProposals.reduce((sum, lot) => sum + lot.confidence, 0) /
					lotsWithProposals.length
				: 0;

		return {
			summary: `La licitació inclou ${lots.length} lote(s), dels quals ${totalWithProposals} han rebut proposta. L'avaluació mostra resultats ${avgConfidence >= 0.7 ? 'satisfactoris' : 'que requereixen atenció'} en els lotes presentats.`,
			recommendation:
				totalWithProposals > 0
					? `Es recomana procedir amb l'adjudicació dels lotes amb proposta i considerar relicitar els lotes sense proposta.`
					: `Es recomana declarar la licitació deserta.`,
			confidence: avgConfidence,
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
				lotEvaluations.push({
					lotNumber: lot.lotNumber,
					lotTitle: lot.title,
					hasProposal: false,
					criteria: [],
					summary: `No s'ha presentat proposta per al lote ${lot.lotNumber}`,
					recommendation: `Aquest lote no pot ser adjudicat ja que no s'ha rebut cap proposta.`,
					confidence: 1.0,
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
					recommendation: `Es requereix revisió manual dels criteris d'avaluació.`,
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

		// Generate overall summary
		logger.info('📊 Generating overall summary...');
		const {
			summary: overallSummary,
			recommendation: overallRecommendation,
			confidence: overallConfidence,
		} = await generateOverallSummary(lotEvaluations);

		const result: EvaluationResult = {
			lots: lotEvaluations,
			extractedLots: lots,
			overallSummary,
			overallRecommendation,
			overallConfidence,
		};

		logger.info('✅ Evaluation completed successfully');
		res.json(result);
	} catch (error) {
		next(error);
	}
});

export default router;
