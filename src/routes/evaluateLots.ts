import dotenv from 'dotenv';
import express from 'express';
import { GoogleGenAI } from '@google/genai';
import logger from '../utils/logger';
import { AppError } from '../utils/errors';
import { extractCompanyFromProposal } from '../utils/companyExtractor';
import {
	FileContent,
	LotInfo,
	EvaluationCriteria,
	LotEvaluation,
	EvaluationResult,
	LotEvaluationRequest,
} from '../types';

dotenv.config();

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
    Ets un expert en avaluació de licitacions públiques. Extreu els criteris SUBJECTIUS d'avaluació específics per al lote "${lot.title}" (Lot ${lot.lotNumber}).

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
    
    IMPORTANT: Respon SEMPRE en català.
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
	proposalName: string,
	companyName: string | null,
): Promise<EvaluationCriteria> {
	const specsContent = specifications
		.map(
			(spec) => `
    === ESPECIFICACIÓ: ${spec.name} ===
    ${spec.content}
  `,
		)
		.join('\n\n');

	const companyInfo = companyName
		? `EMPRESA: ${companyName}`
		: `DOCUMENT: ${proposalName} (empresa no identificada)`;

	const prompt = `
    Ets un expert tècnic en avaluació de licitacions amb criteris d'avaluació EXTREMADAMENT RIGOROSOS sobre la cobertura de requisits. 

    AVALUA amb MÀXIMA ESTRICTESA el criteri "${criterion}" per al lote "${lot.title}" (Lot ${lot.lotNumber}) de la proposta "${companyInfo}".

    ESPECIFICACIONS:
    ${specsContent}

    PROPOSTA "${companyInfo}" PER AQUEST LOTE:
    ${proposalContent}

    LOTE A AVALUAR:
    - Número: ${lot.lotNumber}
    - Títol: ${lot.title}
    ${lot.description ? `- Descripció: ${lot.description}` : ''}

    ⚠️ INSTRUCCIONS D'AVALUACIÓ ULTRA-ESTRICTA ⚠️

    🔍 **FASE 1 - VERIFICACIÓ D'EXISTÈNCIA (OBLIGATÒRIA):**
    
    1. **CERCA EXHAUSTIVA OBLIGATÒRIA:**
       - Busca ESPECÍFICAMENT el criteri "${criterion}" en el text de la proposta
       - Cerca SINÒNIMS, PARAULES CLAU i CONCEPTES RELACIONATS amb "${criterion}"
       - Identifica si hi ha una SECCIÓ DEDICADA, un APARTAT ESPECÍFIC o una MENCIÓ DIRECTA
       - Comprova si es tracta aquest tema de manera EXPLÍCITA o IMPLÍCITA
    
    2. **REGLA ESTRICTA D'EXISTÈNCIA:**
       - Si NO trobes CAP MENCIÓ, CAP REFERÈNCIA, CAP TRACTAMENT del criteri "${criterion}" → AUTOMÀTICAMENT "INSUFICIENT"
       - Si la proposta parla d'altres temes però IGNORA completament aquest criteri → AUTOMÀTICAMENT "INSUFICIENT"
       - Si NO hi ha un apartat, secció o menció que abordi aquest criteri → AUTOMÀTICAMENT "INSUFICIENT"
       - Si la resposta és genèrica sense connexió clara amb el criteri específic → AUTOMÀTICAMENT "INSUFICIENT"

    🔍 **FASE 2 - AVALUACIÓ DE QUALITAT (NOMÉS SI EXISTEIX):**
    
    NOMÉS si la proposta SÍ tracta específicament el criteri, llavors avalua la qualitat:
    
    - **INSUFICIENT**: 
      * NO tracta el criteri (cas automàtic de la Fase 1)
      * O tracta el criteri però de manera clarament inadequada, superficial o errònia
      * Menció molt superficial sense desenvolupament real
      
    - **REGULAR**: 
      * Tracta el criteri de manera acceptable però estàndard
      * Compleix requisits mínims amb resposta correcta però sense destacar
      * Demostra comprensió bàsica però sense profunditat especial
      
    - **COMPLEIX_EXITOSAMENT** (EXTREMADAMENT EXIGENT): 
      * Tracta el criteri amb EXCEL·LÈNCIA i PROFUNDITAT excepcionals
      * Demostra EXPERTESA tècnica i comprensió SUPERIOR
      * Inclou detalls CONCRETS, ESPECÍFICS i INNOVADORS
      * Va MOLT MÉS ENLLÀ dels requisits mínims
      * Solució que seria DIFÍCIL de superar per un competidor

    🚨 **ENFOCAMENT ULTRA-CRÍTIC:**
    - Sigues IMPLACABLE en la verificació d'existència del criteri
    - NO acceptis respostes genèriques que no tractin específicament el criteri
    - NO donis "REGULAR" si no hi ha tractament específic i clar del criteri
    - "COMPLEIX_EXITOSAMENT" només per a respostes EXCEPCIONALS
    - Si tens QUALSEVOL DUBTE sobre si tracta el criteri → "INSUFICIENT"

    🔎 **EXEMPLES DE VERIFICACIÓ:**
    - Criteri: "Metodologia de treball" → Buscar seccions sobre metodologia, processos, approach, etc.
    - Criteri: "Gestió de riscos" → Buscar mencions de riscos, mitigació, contingències, etc.
    - Criteri: "Equip tècnic" → Buscar informació d'equip, perfils, organització, etc.

    IDIOMA DE LA RESPOSTA: Català (SEMPRE en català).
    
    FORMAT DE RESPOSTA (JSON):
    {
      "score": "INSUFICIENT|REGULAR|COMPLEIX_EXITOSAMENT",
      "justification": "PRIMER explica si es tracta ESPECÍFICAMENT el criteri '${criterion}' en la proposta (cita on ho trobes o confirma que no hi és). DESPRÉS avalua la qualitat si existeix...",
      "strengths": ["Punt fort específic 1", "Punt fort específic 2"],
      "improvements": ["Millora concreta 1", "Millora concreta 2", "Millora concreta 3"],
      "references": ["Cita específica del text on es tracta el criteri", "Altra cita relacionada"],
      "criterionFound": true/false
    }

    ⚠️ REGLES INFLEXIBLES:
    1. Si NO trobes tractament específic del criteri "${criterion}" → SEMPRE "INSUFICIENT" + "criterionFound": false
    2. Si la proposta parla d'altres temes sense tractar aquest criteri → SEMPRE "INSUFICIENT"
    3. En cas de DUBTE sobre si tracta el criteri → SEMPRE "INSUFICIENT"
    4. SEMPRE indica clarament si has trobat el criteri amb "criterionFound": true/false
    5. Les "references" han de ser cites literals del text on es tracta el criteri
    6. Respon SEMPRE en català
  `;

	try {
		const config = {
			responseMimeType: 'application/json',
			temperature: 0.01,
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

			if (evaluation.criterionFound === false) {
				evaluation.score = 'INSUFICIENT';
				if (!evaluation.justification.includes('no es tracta')) {
					evaluation.justification = `El criteri "${criterion}" NO es tracta en absolut en la proposta. ${evaluation.justification}`;
				}
			}

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
			`Error evaluating criterion "${criterion}" for lot ${lot.lotNumber} company ${companyName || proposalName}:`,
			error,
		);

		return {
			criterion,
			score: 'INSUFICIENT',
			justification: `ERROR CRÍTIC: No s'ha pogut avaluar automàticament el criteri "${criterion}" per al lote ${lot.lotNumber} de l'empresa ${companyName || proposalName}. Donat que no es pot verificar si la proposta tracta aquest criteri específic, s'assigna puntuació INSUFICIENT per precaució. REVISIÓ MANUAL URGENT REQUERIDA per determinar si la proposta aborda específicament aquest criteri.`,
			strengths: [],
			improvements: [
				'Verificació manual urgent si la proposta tracta aquest criteri',
				'Anàlisi detallat de la cobertura del criteri específic',
				'Validació de la qualitat de la resposta si existeix',
				'Revisió de la coherència amb les especificacions del lote',
			],
			references: [
				'ERROR EN PROCESSAMENT AUTOMÀTIC - REVISIÓ MANUAL REQUERIDA',
			],
		};
	}
}

async function generateLotSummary(
	lot: LotInfo,
	criteria: EvaluationCriteria[],
	hasProposal: boolean,
	proposalName: string,
	companyName: string | null,
): Promise<{ summary: string; recommendation: string; confidence: number }> {
	if (!hasProposal) {
		return {
			summary: `No s'ha presentat proposta per al lote ${lot.lotNumber}: ${lot.title}`,
			recommendation: `Aquest lote no ha rebut cap proposta, pel que no es pot procedir amb l'avaluació. Cal considerar les següents qüestions: Convé relicitar aquest lote específic? Els requisits són adequats per al mercat? Hi ha barreres d'entrada que cal revisar?`,
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

	const companyInfo = companyName
		? `l'empresa "${companyName}"`
		: `la proposta "${proposalName}" (empresa no identificada)`;

	const prompt = `
    Genera un resum i recomanació analítica per al lote ${lot.lotNumber}: ${lot.title} de ${companyInfo}.

    RESULTATS:
    ${criteriaResults}

    ESTADÍSTIQUES:
    - Compleix exitosament: ${excellentScores}
    - Regular: ${regularScores}
    - Insuficient: ${insufficientScores}

    INSTRUCCIONS:
    1. RESUM: Síntesi professional del rendiment d'aquesta proposta per aquest lote
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

	IDIOMA DE LA RESPOSTA: Català (SEMPRE en català).
    FORMAT DE RESPOSTA (JSON):
    {
      "summary": "Resum professional del rendiment d'aquesta proposta per aquest lote...",
      "recommendation": "Anàlisi dels punts forts, àrees d'atenció i preguntes clau per a la reflexió sobre aquesta proposta específica per aquest lote...",
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
		logger.error(
			`Error generating summary for lot ${lot.lotNumber} company ${companyName || proposalName}:`,
			error,
		);

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

		const companyDisplay = companyName || `la proposta "${proposalName}"`;

		return {
			summary: `La proposta de ${companyDisplay} per al lote ${lot.lotNumber} ha estat avaluada segons ${criteria.length} criteris. Els resultats mostren un rendiment ${averageScore >= 2.5 ? 'satisfactori' : 'que requereix millores'}.`,
			recommendation: `Cal analitzar internament si aquesta proposta s'adequa als objectius específics del lote ${lot.lotNumber}. Es recomana revisar els aspectes destacats i considerar les àrees que necessiten atenció.`,
			confidence: 0.75,
		};
	}
}

function groupProposalsByName(
	proposals: FileContent[],
): Map<string, FileContent[]> {
	const grouped = new Map<string, FileContent[]>();

	proposals.forEach((proposal) => {
		const baseName = proposal.name.replace(/\s*\(.*?\)\s*/g, '').trim();

		if (!grouped.has(baseName)) {
			grouped.set(baseName, []);
		}
		grouped.get(baseName)!.push(proposal);
	});

	return grouped;
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

		const allLotEvaluations: LotEvaluation[] = [];

		for (const lot of lots) {
			logger.info(`🔍 Evaluating lot ${lot.lotNumber}: ${lot.title}`);

			const lotProposals = proposals.filter(
				(p) => p.lotNumber === lot.lotNumber,
			);

			if (lotProposals.length === 0) {
				logger.info(`⚠️ No proposal found for lot ${lot.lotNumber}`);
				const { summary, recommendation, confidence } =
					await generateLotSummary(lot, [], false, '', null);

				// CORREGIT: Afegir companyName i companyConfidence
				allLotEvaluations.push({
					lotNumber: lot.lotNumber,
					lotTitle: lot.title,
					proposalName: '',
					companyName: null, // AFEGIT
					companyConfidence: 0, // AFEGIT
					hasProposal: false,
					criteria: [],
					summary,
					recommendation,
					confidence,
				});
				continue;
			}

			const groupedProposals = groupProposalsByName(lotProposals);

			for (const [proposalName, proposalFiles] of groupedProposals) {
				logger.info(
					`📋 Evaluating proposal "${proposalName}" for lot ${lot.lotNumber}`,
				);

				// Extreure nom de l'empresa del contingut de la proposta
				const proposalContent = proposalFiles
					.map((p) => `=== ${p.name} ===\n${p.content}`)
					.join('\n\n');

				const companyExtraction = await extractCompanyFromProposal(
					proposalContent,
					proposalName,
				);

				logger.info(
					`🏢 Company extraction for "${proposalName}": ${companyExtraction.companyName || 'Not found'} (confidence: ${companyExtraction.confidence})`,
				);

				const criteria = await extractCriteriaForLot(specifications, lot);

				if (criteria.length === 0) {
					logger.warn(`No criteria found for lot ${lot.lotNumber}`);
					// CORREGIT: Afegir companyName i companyConfidence
					allLotEvaluations.push({
						lotNumber: lot.lotNumber,
						lotTitle: lot.title,
						proposalName,
						companyName: companyExtraction.companyName, // AFEGIT
						companyConfidence: companyExtraction.confidence, // AFEGIT
						hasProposal: true,
						criteria: [],
						summary: `No s'han pogut extreure criteris d'avaluació per al lote ${lot.lotNumber}`,
						recommendation: `Es requereix revisió manual dels criteris d'avaluació per aquest lote. Cal considerar: Estan ben definits els requisits al plec? Hi ha criteris implícits que caldria explicitar?`,
						confidence: 0.3,
					});
					continue;
				}

				const criteriaEvaluations: EvaluationCriteria[] = [];
				for (const criterion of criteria) {
					const evaluation = await evaluateLotCriterion(
						criterion,
						lot,
						specifications,
						proposalContent,
						proposalName,
						companyExtraction.companyName,
					);
					criteriaEvaluations.push(evaluation);
				}

				const { summary, recommendation, confidence } =
					await generateLotSummary(
						lot,
						criteriaEvaluations,
						true,
						proposalName,
						companyExtraction.companyName,
					);

				// CORREGIT: Afegir companyName i companyConfidence
				allLotEvaluations.push({
					lotNumber: lot.lotNumber,
					lotTitle: lot.title,
					proposalName,
					companyName: companyExtraction.companyName, // AFEGIT
					companyConfidence: companyExtraction.confidence, // AFEGIT
					hasProposal: true,
					criteria: criteriaEvaluations,
					summary,
					recommendation,
					confidence,
				});

				logger.info(
					`✅ Completed evaluation for "${companyExtraction.companyName || proposalName}" in lot ${lot.lotNumber}`,
				);
			}
		}

		const result: EvaluationResult = {
			lots: allLotEvaluations,
			extractedLots: lots,
			overallSummary: '',
			overallRecommendation: '',
			overallConfidence:
				allLotEvaluations.length > 0
					? allLotEvaluations.reduce((sum, lot) => sum + lot.confidence, 0) /
						allLotEvaluations.length
					: 0,
		};

		logger.info('✅ Evaluation completed successfully');
		res.json(result);
	} catch (error) {
		next(error);
	}
});

export default router;
