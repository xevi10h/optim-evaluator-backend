import dotenv from 'dotenv';
import express from 'express';
import { GoogleGenAI } from '@google/genai';
import logger from '../utils/logger';
import { AppError } from '../utils/errors';
import {
	FileContent,
	LotInfo,
	EvaluationCriteria,
	LotEvaluation,
	SingleLotEvaluationRequest,
	SingleLotEvaluationResult,
} from '../types';

dotenv.config();

const router = express.Router();

const ai = new GoogleGenAI({
	apiKey: process.env.GEMINI_API_KEY!,
});

interface EnhancedCriterion {
	name: string;
	description: string;
	requirements: string;
	context: string;
}

interface ProposalEvaluationResult {
	companyName: string;
	companyConfidence: number;
	companyReasoning: string;
	criteria: EvaluationCriteria[];
	summary: string;
	recommendation: string;
	confidence: number;
}

async function extractLotCriteria(
	specifications: FileContent[],
	lot: LotInfo,
): Promise<EnhancedCriterion[]> {
	const specsContent = specifications
		.map(
			(spec) => `
    === DOCUMENT: ${spec.name} ===
    ${spec.content}
  `,
		)
		.join('\n\n');

	const prompt = `
    Ets un expert en anàlisi de licitacions públiques. Extreu els criteris SUBJECTIUS d'avaluació específics per al lote "${lot.title}" (Lot ${lot.lotNumber}) i proporciona context detallat per cada criteri.

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
    5. PER CADA CRITERI, proporciona:
       - Nom del criteri (concís)
       - Descripció detallada (què avalua exactament)
       - Requisits específics (què ha de complir una proposta)
       - Context addicional (importància, exemples, notes)

    FORMAT DE RESPOSTA (JSON estricte):
    [
      {
        "name": "Nom concís del criteri",
        "description": "Descripció detallada del què avalua aquest criteri",
        "requirements": "Requisits específics que ha de complir la proposta per aquest criteri",
        "context": "Context addicional, importància, exemples o notes rellevants"
      }
    ]

    IMPORTANT: Respon SEMPRE en català i assegura't que cada criteri tingui la seva descripció completa.
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

		const criteria = JSON.parse(response.text);
		if (Array.isArray(criteria)) {
			return criteria.slice(0, 8).map((criterion) => ({
				name: criterion.name || 'Criteri sense nom',
				description: criterion.description || 'Descripció no disponible',
				requirements: criterion.requirements || 'Requisits no especificats',
				context: criterion.context || 'Context no disponible',
			}));
		}
		return [];
	} catch (error) {
		logger.error(`Error extracting criteria for lot ${lot.lotNumber}:`, error);
		throw new Error('Failed to extract lot criteria');
	}
}

async function evaluateProposalWithCompanyExtraction(
	enhancedCriteria: EnhancedCriterion[],
	lot: LotInfo,
	specifications: FileContent[],
	proposalContent: string,
	proposalName: string,
): Promise<ProposalEvaluationResult> {
	const specsContent = specifications
		.map(
			(spec) => `
    === ESPECIFICACIÓ: ${spec.name} ===
    ${spec.content}
  `,
		)
		.join('\n\n');

	const criteriaContext = enhancedCriteria
		.map(
			(criterion) => `
    CRITERI: ${criterion.name}
    DESCRIPCIÓ: ${criterion.description}
    REQUISITS: ${criterion.requirements}
    CONTEXT: ${criterion.context}
  `,
		)
		.join('\n\n');

	const prompt = `
    Ets un expert tècnic en avaluació de licitacions amb criteris d'avaluació EXTREMADAMENT RIGOROSOS.

    TASCA DUAL:
    1. EXTREU amb precisió el nom de l'empresa que presenta la proposta
    2. AVALUA amb MÀXIMA ESTRICTESA cada criteri per aquesta proposta

    ESPECIFICACIONS:
    ${specsContent}

    PROPOSTA PER AVALUAR:
    Document: ${proposalName}
    Contingut: ${proposalContent}

    LOTE:
    - Número: ${lot.lotNumber}
    - Títol: ${lot.title}
    ${lot.description ? `- Descripció: ${lot.description}` : ''}

    CRITERIS A AVALUAR:
    ${criteriaContext}

    INSTRUCCIONS D'EXTRACCIÓ D'EMPRESA:
    1. Busca la raó social completa de l'empresa
    2. Identifica denominacions oficials amb forma jurídica (S.L., S.A., etc.)
    3. PRIORITAT: Declaracions explícites, signatures, capçaleres oficials
    4. Si NO trobes empresa específica → "Empresa no identificada"
    5. Avalua confiança: ALTA (0.8-1.0), MITJANA (0.5-0.7), BAIXA (0.2-0.4)

    INSTRUCCIONS D'AVALUACIÓ ULTRA-ESTRICTA:
    Per cada criteri:
    1. CERCA EXHAUSTIVA: Busca específicament aspectes relacionats amb el criteri
    2. REGLA ESTRICTA: Si NO tracta el criteri → AUTOMÀTICAMENT "INSUFICIENT"
    3. PUNTUACIONS:
       - INSUFICIENT: No tracta el criteri O tracta inadequadament
       - REGULAR: Tracta acceptablement però sense destacar
       - COMPLEIX_EXITOSAMENT: Excel·lència excepcional, expertesa superior

    IDIOMA: Català (SEMPRE)

    FORMAT DE RESPOSTA (JSON):
    {
      "companyName": "Nom complet de l'empresa o 'Empresa no identificada'",
      "companyConfidence": 0.85,
      "companyReasoning": "Explicació de com s'ha identificat l'empresa",
      "criteria": [
        {
          "criterion": "Nom del criteri",
          "score": "INSUFICIENT|REGULAR|COMPLEIX_EXITOSAMENT",
          "justification": "Explicació detallada de l'avaluació",
          "strengths": ["Punt fort 1", "Punt fort 2"],
          "improvements": ["Millora 1", "Millora 2"],
          "references": ["Referència 1", "Referència 2"]
        }
      ],
      "summary": "Resum del rendiment global de la proposta",
      "recommendation": "Anàlisi i recomanacions específiques",
      "confidence": 0.85
    }

    REGLES INFLEXIBLES:
    - Si NO trobes tractament específic d'un criteri → SEMPRE "INSUFICIENT"
    - NO inventis noms d'empresa si no els trobes explícitament
    - Sigues IMPLACABLE en la verificació d'existència dels criteris
    - Respon SEMPRE en català
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
			throw new Error('No evaluation received');
		}

		const jsonMatch = response.text.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			throw new Error('Could not extract JSON from response');
		}

		const evaluation = JSON.parse(jsonMatch[0]);

		return {
			companyName: evaluation.companyName || 'Empresa no identificada',
			companyConfidence: Math.max(
				0,
				Math.min(1, evaluation.companyConfidence || 0),
			),
			companyReasoning:
				evaluation.companyReasoning || "No s'ha proporcionat raonament",
			criteria: evaluation.criteria || [],
			summary: evaluation.summary || 'Resum no disponible',
			recommendation: evaluation.recommendation || 'Recomanació no disponible',
			confidence: Math.max(0, Math.min(1, evaluation.confidence || 0.5)),
		};
	} catch (error) {
		logger.error(
			`Error evaluating proposal "${proposalName}" for lot ${lot.lotNumber}:`,
			error,
		);
		throw new Error(`Failed to evaluate proposal: ${proposalName}`);
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

		const { specifications, proposals, lotInfo }: SingleLotEvaluationRequest =
			req.body;

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

		if (!lotInfo) {
			throw new AppError('Lot information is required', 400);
		}

		logger.info(
			`🚀 Starting evaluation for lot ${lotInfo.lotNumber}: ${lotInfo.title}`,
		);

		// Step 1: Extract criteria for this lot (only once)
		logger.info(`🔍 Extracting criteria for lot ${lotInfo.lotNumber}...`);
		const enhancedCriteria = await extractLotCriteria(specifications, lotInfo);

		if (enhancedCriteria.length === 0) {
			throw new AppError(`No criteria found for lot ${lotInfo.lotNumber}`, 400);
		}

		logger.info(
			`📊 Found ${enhancedCriteria.length} criteria for lot ${lotInfo.lotNumber}`,
		);

		// Step 2: Group proposals by name and evaluate each
		const groupedProposals = groupProposalsByName(proposals);
		const lotEvaluations: LotEvaluation[] = [];

		if (groupedProposals.size === 0) {
			// No proposals for this lot
			lotEvaluations.push({
				lotNumber: lotInfo.lotNumber,
				lotTitle: lotInfo.title,
				proposalName: '',
				companyName: null,
				companyConfidence: 0,
				hasProposal: false,
				criteria: [],
				summary: `No s'ha presentat proposta per al lote ${lotInfo.lotNumber}`,
				recommendation: `Aquest lote no ha rebut cap proposta. Cal considerar relicitar aquest lote específic.`,
				confidence: 1.0,
			});
		} else {
			// Evaluate each proposal group
			for (const [proposalName, proposalFiles] of groupedProposals) {
				logger.info(
					`📋 Evaluating proposal "${proposalName}" for lot ${lotInfo.lotNumber}`,
				);

				const proposalContent = proposalFiles
					.map((p) => `=== ${p.name} ===\n${p.content}`)
					.join('\n\n');

				// Step 3: Evaluate proposal AND extract company in single AI call
				const evaluation = await evaluateProposalWithCompanyExtraction(
					enhancedCriteria,
					lotInfo,
					specifications,
					proposalContent,
					proposalName,
				);

				logger.info(
					`🏢 Evaluation completed for "${proposalName}": Company "${evaluation.companyName}" (confidence: ${evaluation.companyConfidence.toFixed(2)})`,
				);

				lotEvaluations.push({
					lotNumber: lotInfo.lotNumber,
					lotTitle: lotInfo.title,
					proposalName,
					companyName:
						evaluation.companyName === 'Empresa no identificada'
							? null
							: evaluation.companyName,
					companyConfidence: evaluation.companyConfidence,
					hasProposal: true,
					criteria: evaluation.criteria,
					summary: evaluation.summary,
					recommendation: evaluation.recommendation,
					confidence: evaluation.confidence,
				});
			}
		}

		const result: SingleLotEvaluationResult = {
			lotNumber: lotInfo.lotNumber,
			lotTitle: lotInfo.title,
			evaluations: lotEvaluations,
			extractedCriteria: enhancedCriteria.length,
			processingTime: Date.now(),
		};

		logger.info(
			`✅ Lot ${lotInfo.lotNumber} evaluation completed successfully`,
		);
		res.json(result);
	} catch (error) {
		next(error);
	}
});

export default router;
