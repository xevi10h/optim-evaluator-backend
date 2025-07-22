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
    === DOCUMENT COMPLET: ${spec.name} ===
    ${spec.content}
  `,
		)
		.join('\n\n');

	const prompt = `
    Ets un expert en anàlisi de licitacions públiques amb màxima precisió. Extreu els criteris SUBJECTIUS d'avaluació específics per al lote "${lot.title}" (Lot ${lot.lotNumber}) amb MÀXIM DETALL i CONTEXT ABSOLUT.

    DOCUMENTS D'ESPECIFICACIONS COMPLETES:
    ${specsContent}

    INFORMACIÓ ESPECÍFICA DEL LOTE:
    - Número: ${lot.lotNumber}
    - Títol: ${lot.title}
    ${lot.description ? `- Descripció: ${lot.description}` : ''}

    INSTRUCCIONS D'EXTRACCIÓ EXHAUSTIVA I IMPECABLE:
    
    1. ANALITZA PROFUNDAMENT tot el context del lote dins les especificacions
    2. IDENTIFICA amb precisió absoluta tots els elements OBLIGATORIS del lote
    3. DETERMINA exactament què serveis/productes ha de proporcionar aquest lote
    4. ESPECIFICA amb màxim detall tots els deliverables esperats
    5. EXTREU criteris SUBJECTIUS amb descripció COMPLETA i INFALIBLE
    6. DEFINEIX per cada criteri exactament què ha d'aparèixer a la proposta
    7. ESTABLEIX el context COMPLET per detectar propostes inadequades
    8. MÀXIM 8 criteris que cobreixin TOTS els aspectes CRÍTICS

    REQUERIMENTS CRÍTICS PER CADA CRITERI:
    - Nom específic i precís del criteri
    - Descripció EXHAUSTIVA de què avalua dins aquest lote concret
    - Requisits OBLIGATORIS detallats que ha de contenir la proposta
    - Context COMPLET: objectiu, importància, exemples concrets, indicadors de qualitat
    - Elements ESPECÍFICS que han d'aparèixer per aprovar el criteri
    - Paraules clau o conceptes que obligatòriament ha de mencionar la proposta

    INFORMACIÓ ESSENCIAL PER DETECCIÓ D'INADEQUACIÓ:
    - Àmbit d'actuació ESPECÍFIC del lote
    - Serveis/productes CONCRETS que ha de proporcionar
    - Metodologia o enfoc REQUERIT
    - Deliverables ESPECÍFICS i mesurables
    - Aspectes tècnics CRÍTICS i obligatoris
    - Innovació o valor afegit ESPERAT
    - Terminis i fases de lliurament ESPECÍFICS

    FORMAT DE RESPOSTA (JSON estricte):
    [
      {
        "name": "Nom específic i precís del criteri",
        "description": "Descripció EXHAUSTIVA del què avalua aquest criteri dins del context ESPECÍFIC d'aquest lote, incloent tots els aspectes tècnics, metodològics i de qualitat que ha de cobrir obligatòriament",
        "requirements": "Llista DETALLADA i ESPECÍFICA dels requisits OBLIGATORIS: què exactament ha d'aparèixer a la proposta, quins conceptes ha de mencionar, quins deliverables ha de proposar, quina metodologia ha de descriure per superar aquest criteri",
        "context": "Context COMPLET del criteri: objectiu específic dins del lote, importància crítica, relació amb altres criteris, exemples concrets d'allò que s'espera, paraules clau que han d'aparèixer, indicadors de qualitat esperats, i com detectar si una proposta NO compleix aquest criteri específic"
      }
    ]

    CRITICITAT ABSOLUTA:
    Aquesta informació determinarà si una proposta és ADEQUADA o INADEQUADA per al lote. Sigues IMPLACABLEMENT específic per poder detectar:
    - Propostes genèriques sense relació amb el lote
    - Propostes per altres lotes
    - Propostes que no cobreixen criteris obligatoris
    - Propostes superficials sense profunditat tècnica

    IMPORTANT: Respon SEMPRE en català amb màxima precisió i especificitat.
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
    === ESPECIFICACIÓ COMPLETA: ${spec.name} ===
    ${spec.content}
  `,
		)
		.join('\n\n');

	const criteriaContext = enhancedCriteria
		.map(
			(criterion, index) => `
    CRITERI ${index + 1}: ${criterion.name}
    DESCRIPCIÓ COMPLETA: ${criterion.description}
    REQUISITS OBLIGATORIS: ${criterion.requirements}
    CONTEXT I DETECCIÓ: ${criterion.context}
    
    REGLA ABSOLUTA PER AQUEST CRITERI:
    - Si la proposta NO menciona ESPECÍFICAMENT aquest criteri → AUTOMÀTICAMENT "INSUFICIENT"
    - Si la proposta menciona però NO desenvolupa adequadament → AUTOMÀTICAMENT "INSUFICIENT"
    - Si la proposta desenvolupa superficialment sense profunditat → AUTOMÀTICAMENT "INSUFICIENT"
    - Només si compleix TOTS els requisits amb profunditat → "REGULAR" o superior
  `,
		)
		.join('\n\n');

	const prompt = `
    Ets un avaluador EXTREMADAMENT RIGORÓS de licitacions amb criteris ABSOLUTAMENT IMPLACABLES. La teva tasca és detectar i descartar propostes inadequades.

    METODOLOGIA D'AVALUACIÓ EN DUES FASES OBLIGATÒRIES:

    === FASE 1: ANÀLISI PRÈVIA DE COHERÈNCIA (OBLIGATÒRIA) ===
    
    ABANS de qualsevol avaluació, determina si aquesta proposta és COHERENT amb aquest lote específic:
    
    1. VERIFICA COHERÈNCIA TEMÀTICA:
       - La proposta parla dels mateixos serveis/productes que el lote?
       - Menciona elements específics descrits al lote?
       - L'enfoc proposat té relació directa amb els objectius del lote?
    
    2. VERIFICA ESPECIFICITAT:
       - La proposta és específica per aquest lote o és genèrica?
       - Fa referència a aspectes concrets del plec de condicions?
       - Proposa deliverables coherents amb els requeriments?
    
    3. DECISIÓ DE COHERÈNCIA:
       - Si la proposta NO és coherent amb el lote → ATURAR AVALUACIÓ → TOTS els criteris "INSUFICIENT"
       - Si la proposta sembla per un altre lote → ATURAR AVALUACIÓ → TOTS els criteris "INSUFICIENT"  
       - Si la proposta és massa genèrica → ATURAR AVALUACIÓ → TOTS els criteris "INSUFICIENT"
       - Només si la proposta és COHERENT i ESPECÍFICA → CONTINUAR a Fase 2

    === FASE 2: AVALUACIÓ CRITERI PER CRITERI (NOMÉS SI PASSA FASE 1) ===

    ESPECIFICACIONS COMPLETES DEL LOTE:
    ${specsContent}

    INFORMACIÓ DEL LOTE A AVALUAR:
    - Número: ${lot.lotNumber}
    - Títol: ${lot.title}
    ${lot.description ? `- Descripció: ${lot.description}` : ''}

    PROPOSTA SOTA EXAMEN:
    Document: ${proposalName}
    Contingut: ${proposalContent}

    CRITERIS D'AVALUACIÓ ESPECÍFICS:
    ${criteriaContext}

    INSTRUCCIONS D'EXTRACCIÓ D'EMPRESA:
    1. Localitza la raó social EXACTA de l'empresa
    2. Busca formes jurídiques oficials (S.L., S.A., S.L.U., etc.)
    3. PRIORITAT: signatures, capçaleres, declaracions explícites
    4. Si NO identifiques empresa → "Empresa no identificada"
    5. Confiança: ALTA (0.8-1.0), MITJANA (0.5-0.7), BAIXA (0.2-0.4)

    REGLES D'AVALUACIÓ ABSOLUTAMENT INFEXIBLES:

    PER CADA CRITERI INDIVIDUAL:
    1. BUSCA ESPECÍFICAMENT elements del criteri a la proposta
    2. SI NO TROBA MENCIÓ ESPECÍFICA → AUTOMÀTICAMENT "INSUFICIENT"
    3. SI TROBA MENCIÓ PERÒ SENSE DESENVOLUPAMENT → AUTOMÀTICAMENT "INSUFICIENT"  
    4. SI TROBA DESENVOLUPAMENT SUPERFICIAL → AUTOMÀTICAMENT "INSUFICIENT"
    5. SI TROBA DESENVOLUPAMENT ACCEPTABLE → MÀXIM "REGULAR"
    6. SI TROBA EXCEL·LÈNCIA EXCEPCIONAL → "COMPLEIX_EXITOSAMENT"

    CRITERIS PUNTUACIÓ IMPLACABLES:
    - INSUFICIENT: No menciona, tracta superficialment, genèricament o inadequadament el criteri
    - REGULAR: Tracta el criteri amb profunditat acceptable i específica per al lote
    - COMPLEIX_EXITOSAMENT: Expertesa excepcional, innovació i especificitat màxima per al criteri

    SI EN QUALSEVOL MOMENT detectes que:
    - La proposta no correspon a aquest lote específic
    - És massa genèrica o estàndard
    - No cobreix elements essencials del lote
    - Sembla ser per un altre lote o servei
    → ATURAR IMMEDIATAMENT → TOTS els criteris "INSUFICIENT"

    FORMAT DE RESPOSTA (JSON):
    {
      "companyName": "Nom complet exacte de l'empresa o 'Empresa no identificada'",
      "companyConfidence": 0.85,
      "companyReasoning": "Explicació detallada de la identificació",
      "criteria": [
        {
          "criterion": "Nom exacte del criteri",
          "score": "INSUFICIENT|REGULAR|COMPLEIX_EXITOSAMENT",
          "justification": "Explicació DETALLADA de per què aquesta puntuació: si menciona el criteri, com el desenvolupa, si compleix els requisits específics per aquest lote, i per què mereix aquesta puntuació",
          "strengths": ["Punt fort específic 1", "Punt fort específic 2"],
          "improvements": ["Millora concreta 1", "Millora concreta 2"],
          "references": ["Referència específica del text 1", "Referència específica 2"]
        }
      ],
      "summary": "PRIMER indica si la proposta és coherent amb el lote, després resum crític del rendiment: quants criteris cobreix adequadament vs quants són insuficients",
      "recommendation": "Recomanació IMPLACABLE: si la proposta és adequada per aquest lote específic, quins són els seus problemes greus, i si hauria de ser acceptada o rebutjada",
      "confidence": 0.85
    }

    REGLES ABSOLUTAMENT INNEGOCIABLES:
    - Si proposta NO coherent amb lote → TOTS criteris "INSUFICIENT"
    - Si criteri NO mencionat específicament → SEMPRE "INSUFICIENT"
    - Si criteri mencionat però NO desenvolupat → SEMPRE "INSUFICIENT"
    - NO siguis condescendent: sigues ABSOLUTAMENT IMPLACABLE
    - Requereix EVIDÈNCIA ESPECÍFICA per cada criteri
    - NO acceptis respostes genèriques o superficials
    - Temperatura d'avaluació: MÀXIMA SEVERITAT
    - Idioma: català SEMPRE
  `;

	try {
		const config = {
			responseMimeType: 'application/json',
			temperature: 0.0001,
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
			`🚀 Starting ultra-strict evaluation for lot ${lotInfo.lotNumber}: ${lotInfo.title}`,
		);

		logger.info(
			`🔍 Extracting ultra-detailed criteria for lot ${lotInfo.lotNumber}...`,
		);
		const enhancedCriteria = await extractLotCriteria(specifications, lotInfo);

		if (enhancedCriteria.length === 0) {
			throw new AppError(`No criteria found for lot ${lotInfo.lotNumber}`, 400);
		}

		logger.info(
			`📊 Found ${enhancedCriteria.length} ultra-detailed criteria for lot ${lotInfo.lotNumber}`,
		);

		const groupedProposals = groupProposalsByName(proposals);
		const lotEvaluations: LotEvaluation[] = [];

		if (groupedProposals.size === 0) {
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
			for (const [proposalName, proposalFiles] of groupedProposals) {
				logger.info(
					`📋 Ultra-strict evaluation of proposal "${proposalName}" for lot ${lotInfo.lotNumber}`,
				);

				const proposalContent = proposalFiles
					.map((p) => `=== ${p.name} ===\n${p.content}`)
					.join('\n\n');

				const evaluation = await evaluateProposalWithCompanyExtraction(
					enhancedCriteria,
					lotInfo,
					specifications,
					proposalContent,
					proposalName,
				);

				const insufficientCount = evaluation.criteria.filter(
					(c) => c.score === 'INSUFICIENT',
				).length;
				logger.info(
					`🏢 Ultra-strict evaluation completed for "${proposalName}": Company "${evaluation.companyName}" - ${insufficientCount}/${evaluation.criteria.length} insufficient criteria`,
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
			`✅ Lot ${lotInfo.lotNumber} ultra-strict evaluation completed successfully`,
		);
		res.json(result);
	} catch (error) {
		next(error);
	}
});

export default router;
