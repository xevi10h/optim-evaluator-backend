import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { validateEvaluation } from '../middleware/validation';
import logger from '../utils/logger';
import { AppError } from '../utils/errors';
import {
	FileContent,
	EvaluationCriteria,
	EvaluationResult,
	EvaluationRequest,
} from '../types';

const router = express.Router();

const ai = new GoogleGenAI({
	apiKey: process.env.GEMINI_API_KEY!,
});

async function extractEvaluationCriteria(
	specifications: FileContent[],
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
    Ets un expert en avaluació de licitacions públiques. Analitza els següents documents d'especificacions per identificar NOMÉS els criteris SUBJECTIUS de valoració que siguin avaluables de manera final.

    DOCUMENTS D'ESPECIFICACIONS:
    ${specsContent}

    FLUX D'ANÀLISI A SEGUIR:
    1. LOCALITZA primer els apartats clau:
       - "Quadre de característiques"
       - "Criteris de valoració"
       - "Criteris d'adjudicació" 
       - "Criteris de puntuació"
       - "Ponderació de l'oferta"
       - "Mètode d'avaluació"

    2. IDENTIFICA només criteris que siguin:
       ✓ Subjectius (requereixen judici de valor)
       ✓ Avaluables segons criteris qualitatius
       ✓ No automàtics (no són càlculs matemàtics)
       ✓ Específics i finals (no categories generals)
       
    3. EXCLOU criteris que siguin:
       ✗ Objectius (certificacions, títols, anys d'experiència específics)
       ✗ Automàtics (preu més baix, puntuació per descompte)
       ✗ Requisits mínims obligatoris
       ✓ Criteris "pare" o contenidors: No incloguis títols generals (com "Memòria Tècnica", "Proposta Tècnica", "Documentació Sobre A") que simplement agrupen altres sub-criteris més detallats. Centra't en els criteris avaluables que tenen la seva pròpia descripció de puntuació.

    4. DISCERNIR LA JERARQUIA: Abans de donar la resposta final, revisa la teva llista. Si un criteri que has extret (p. ex., "Memòria Tècnica") serveix només com a títol per a altres criteris més específics (p. ex., "Metodologia del projecte" i "Planificació de tasques"), elimina el criteri general i conserva només els específics. Extreu l'element més detallat de l'avaluació.

    CRITERIS SUBJECTIUS TÍPICS A BUSCAR:
    - Adequació metodològica de la proposta
    - Qualitat tècnica de la solució proposada
    - Experiència i capacitat de l'equip tècnic
    - Organització i planificació del projecte
    - Valor afegit i innovació
    - Mesures de sostenibilitat ambiental
    - Adequació dels recursos humans
    - Millores sobre els requisits mínims

    IMPORTANT: La valoració sempre s'ha de fer en base a si l'oferta respon adequadament al que es demana en el plec tècnic.

    FORMAT DE RESPOSTA:
    Respon NOMÉS amb un array JSON de strings, sense explicacions:
    ["Criteri subjectiu 1", "Criteri subjectiu 2", ...]

    Màxim 8 criteris per mantenir l'avaluació manejable i efectiva.
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

		logger.info('🧠 Extrayendo criterios de evaluación con Gemini...');

		const response = await ai.models.generateContent({
			model: 'gemini-2.0-flash-lite',
			config,
			contents,
		});

		if (!response?.text) {
			throw new Error(
				'No se han recibido criterios en la respuesta del sistema',
			);
		}

		try {
			const criteria = JSON.parse(response.text);
			return Array.isArray(criteria) ? criteria : [];
		} catch (parseError) {
			logger.warn(
				'Error parseando JSON de criterios, extrayendo del texto:',
				parseError,
			);
			return extractCriteriaFromText(response.text);
		}
	} catch (error) {
		logger.error('Error en la extracción de criterios:', error);
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

async function evaluateCriterion(
	criterion: string,
	specifications: FileContent[],
	proposals: FileContent[],
): Promise<EvaluationCriteria> {
	const specsContent = specifications
		.map(
			(spec) => `
    === PLEC/ESPECIFICACIÓ: ${spec.name} ===
    ${spec.content}
  `,
		)
		.join('\n\n');

	const proposalContent = proposals
		.map(
			(proposal) => `
    === OFERTA: ${proposal.name} ===
    ${proposal.content}
  `,
		)
		.join('\n\n');

	const prompt = `
    Ets un expert tècnic en avaluació de licitacions. Avalua rigorosament el següent criteri subjectiu.

    CRITERI A AVALUAR: "${criterion}"

    DOCUMENTACIÓ DE LICITACIÓ (Plecs):
    ${specsContent}

    OFERTA A AVALUAR:
    ${proposalContent}

    METODOLOGIA D'AVALUACIÓ:
    
    1. ANÀLISI DEL REQUERIMENT:
       - Què especifica exactament el plec per aquest criteri?
       - Quins són els requisits mínims i les expectatives?
       - Hi ha indicadors específics de qualitat mencionats?

    2. AVALUACIÓ DE L'OFERTA:
       - Com respon l'oferta a aquests requeriments?
       - Supera els mínims exigits?
       - Aporta valor afegit o innovació?
       - És coherent amb el què es demana?

    3. ESCALA DE PUNTUACIÓ:
       - INSUFICIENT: No compleix requisits mínims del plec o resposta inadequada
       - REGULAR: Compleix requisits mínims però sense destacar
       - COMPLEIX_EXITOSAMENT: Supera expectatives i aporta valor afegit

    4. JUSTIFICACIÓ DETALLADA (mínim 150 paraules):
       - Explica clarament per què aquesta puntuació
       - Referencia seccions específiques del plec i de l'oferta
       - Sigues concret i objectiu en l'argumentació

    5. PUNTS FORTS (3-5 elements específics):
       - Aspectes que destaquen positivament
       - Valoracions concretes, no genèriques

    6. ÀREES DE MILLORA (2-4 elements específics):
       - Aspectes que podrien millorar-se
       - Suggeriments constructius

    7. REFERÈNCIES (2-3 elements):
       - Seccions específiques del plec consultades
       - Parts de l'oferta analitzades

    FORMAT DE RESPOSTA (JSON estricte):
    {
      "score": "INSUFICIENT|REGULAR|COMPLEIX_EXITOSAMENT",
      "justification": "Justificació detallada d'almenys 150 paraules que expliqui clarament els motius de la puntuació assignada...",
      "strengths": ["Punt fort específic 1", "Punt fort específic 2", "Punt fort específic 3"],
      "improvements": ["Millora específica 1", "Millora específica 2"],
      "references": ["Secció X del plec", "Apartat Y de l'oferta", "Punt Z de les especificacions"]
    }

    Sigues rigorós, objectiu i sempre justifica adequadament la puntuació assignada.
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

		logger.info(`🔍 Evaluando criterio: ${criterion}`);

		const response = await ai.models.generateContent({
			model: 'gemini-2.0-flash-lite',
			config,
			contents,
		});

		if (!response?.text) {
			throw new Error(
				'No se ha recibido respuesta del sistema para el criterio',
			);
		}

		const jsonMatch = response?.text.match(/\{[\s\S]*\}/);
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
			throw new Error('No se ha podido extraer JSON de la respuesta');
		}
	} catch (error) {
		logger.error(`Error evaluando el criterio "${criterion}":`, error);

		return {
			criterion,
			score: 'REGULAR',
			justification: `No se ha podido evaluar automáticamente el criterio "${criterion}". Se requiere revisión manual.`,
			strengths: ['Revisión manual requerida'],
			improvements: ['Evaluación automática fallida'],
			references: ['Error en procesamiento'],
		};
	}
}

async function generateExecutiveSummary(
	criteria: EvaluationCriteria[],
	specifications: FileContent[],
	proposals: FileContent[],
): Promise<{ summary: string; recommendation: string; confidence: number }> {
	const criteriaResults = criteria
		.map(
			(c) => `
    CRITERI: ${c.criterion}
    PUNTUACIÓ: ${c.score}
    JUSTIFICACIÓ: ${c.justification}
    PUNTS FORTS: ${c.strengths.join(', ')}
    MILLORES: ${c.improvements.join(', ')}
  `,
		)
		.join('\n---\n');

	const totalCriteria = criteria.length;
	const excellentScores = criteria.filter(
		(c) => c.score === 'COMPLEIX_EXITOSAMENT',
	).length;
	const regularScores = criteria.filter((c) => c.score === 'REGULAR').length;
	const insufficientScores = criteria.filter(
		(c) => c.score === 'INSUFICIENT',
	).length;

	const prompt = `
    Ets un expert en avaluació de licitacions públiques. Genera un informe executiu professional basat en l'avaluació realitzada.

    RESULTATS DE L'AVALUACIÓ:
    ${criteriaResults}

    RESUM QUANTITATIU:
    - Total criteris avaluats: ${totalCriteria}
    - Compleix exitosament: ${excellentScores}
    - Regular: ${regularScores}  
    - Insuficient: ${insufficientScores}

    DOCUMENTACIÓ DE REFERÈNCIA:
    Plecs: ${specifications.map((spec) => spec.name).join(', ')}
    Ofertes: ${proposals.map((prop) => prop.name).join(', ')}

    INSTRUCCIONS PER L'INFORME:

    1. RESUM EXECUTIU (3-4 paràgrafs professionals):
       - Síntesi dels resultats principals
       - Punts forts globals de l'oferta
       - Àrees de preocupació o millora
       - Avaluació general de la qualitat de la proposta

    2. RECOMANACIÓ FINAL:
       - Clara i justificada
       - Basada en l'anàlisi dels criteris
       - Incloure possibles condicions o recomanacions

    3. NIVELL DE CONFIANÇA (0.0 a 1.0):
       - Basat en la claredat de la documentació
       - Completesa de la informació disponible
       - Qualitat de les respostes de l'oferta

    CRITERIS PER LA RECOMANACIÓ:
    - Si 70%+ criteris són "COMPLEIX_EXITOSAMENT": Recomanació positiva
    - Si majoria "REGULAR" amb alguns "COMPLEIX_EXITOSAMENT": Recomanació amb reserves
    - Si hi ha criteris "INSUFICIENT": Avaluar si són crítics per la funcionalitat

    TO: Professional i objectiu, adequat per a un informe tècnic oficial.
    IDIOMA: Català

    FORMAT DE RESPOSTA (JSON):
    {
      "summary": "Resum executiu professional de 3-4 paràgrafs...",
      "recommendation": "Recomanació final clara i justificada...",
      "confidence": 0.85
    }

    Mantén sempre un to professional i objectiu adequat per a la documentació oficial d'una licitació pública.
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

		logger.info('📝 Generando resumen ejecutivo...');

		const response = await ai.models.generateContent({
			model: 'gemini-2.0-flash-lite',
			config,
			contents,
		});

		if (!response?.text) {
			throw new Error(
				'No se ha recibido respuesta del sistema para el resumen ejecutivo',
			);
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
			throw new Error('No se ha podido extraer JSON de la respuesta');
		}
	} catch (error) {
		logger.error('Error generando el resumen ejecutivo:', error);

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

		const averageScore = scores.reduce((a, b) => a + b, 0) / scores.length;

		return {
			summary: `La proposta ha estat avaluada segons ${criteria.length} criteris principals. Els resultats mostren un rendiment ${averageScore >= 2.5 ? 'satisfactori' : 'que requereix millores'} en la majoria d'aspectes avaluats.`,
			recommendation:
				averageScore >= 2.5
					? 'Es recomana considerar la proposta per a adjudicació, amb les millores suggerides a cada criteri.'
					: "Es recomana sol·licitar aclariments o millores abans de l'adjudicació.",
			confidence: 0.75,
		};
	}
}

// Main evaluation endpoint
router.post('/', validateEvaluation, async (req, res, next) => {
	try {
		if (!process.env.GEMINI_API_KEY) {
			throw new AppError('Clave del sistema no configurada', 500);
		}

		const { specifications, proposals }: EvaluationRequest = req.body;

		if (
			!specifications ||
			!Array.isArray(specifications) ||
			specifications.length === 0
		) {
			throw new AppError('Se requieren documentos de especificaciones', 400);
		}

		if (!proposals || !Array.isArray(proposals) || proposals.length === 0) {
			throw new AppError('Se requieren documentos de propuesta', 400);
		}

		logger.info('🚀 Iniciando evaluación automática...');

		const extractedCriteria = await extractEvaluationCriteria(specifications);
		if (extractedCriteria.length === 0) {
			throw new AppError(
				'No se han podido extraer criterios de evaluación de las especificaciones',
				400,
			);
		}

		logger.info(
			`✅ Extraídos ${extractedCriteria.length} criterios de evaluación`,
		);

		const criteriaEvaluations: EvaluationCriteria[] = [];
		for (const criterion of extractedCriteria) {
			const evaluation = await evaluateCriterion(
				criterion,
				specifications,
				proposals,
			);
			criteriaEvaluations.push(evaluation);
		}

		logger.info('📊 Generando resumen ejecutivo...');
		const { summary, recommendation, confidence } =
			await generateExecutiveSummary(
				criteriaEvaluations,
				specifications,
				proposals,
			);

		const result: EvaluationResult = {
			summary,
			criteria: criteriaEvaluations,
			recommendation,
			confidence,
			extractedCriteria,
		};

		logger.info('✅ Evaluación completada exitosamente');
		res.json(result);
	} catch (error) {
		next(error);
	}
});

// Endpoint to get evaluation criteria only (useful for preview)
router.post('/criteria', validateEvaluation, async (req, res, next) => {
	try {
		if (!process.env.GEMINI_API_KEY) {
			throw new AppError('Clave del sistema no configurada', 500);
		}

		const { specifications }: { specifications: FileContent[] } = req.body;

		if (
			!specifications ||
			!Array.isArray(specifications) ||
			specifications.length === 0
		) {
			throw new AppError('Se requieren documentos de especificaciones', 400);
		}

		logger.info('🔍 Extrayendo criterios para preview...');

		const extractedCriteria = await extractEvaluationCriteria(specifications);

		if (extractedCriteria.length === 0) {
			throw new AppError(
				'No se han podido extraer criterios de evaluación de las especificaciones',
				400,
			);
		}

		logger.info(
			`✅ Extraídos ${extractedCriteria.length} criterios para preview`,
		);

		res.json({
			success: true,
			criteria: extractedCriteria,
			count: extractedCriteria.length,
		});
	} catch (error) {
		next(error);
	}
});

export default router;
