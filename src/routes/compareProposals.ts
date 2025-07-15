// src/routes/compareProposals.ts - Actualitzat per usar la nova informació d'empreses

import dotenv from 'dotenv';
import express from 'express';
import { GoogleGenAI } from '@google/genai';
import logger from '../utils/logger';
import { AppError } from '../utils/errors';
import {
	LotInfo,
	LotEvaluation,
	ComparisonRequest,
	ComparisonResult,
	ProposalComparison,
} from '../types';

dotenv.config();

const router = express.Router();

const ai = new GoogleGenAI({
	apiKey: process.env.GEMINI_API_KEY!,
});

async function compareProposalsForLot(
	lotInfo: LotInfo,
	evaluatedProposals: LotEvaluation[],
): Promise<ProposalComparison> {
	const proposalEvaluations = evaluatedProposals.map((evaluacio) => {
		// Millor formatació amb informació d'empresa més rica
		const companyDisplay = evaluacio.companyName
			? `EMPRESA: ${evaluacio.companyName} (confiança identificació: ${Math.round(evaluacio.companyConfidence * 100)}%)`
			: `DOCUMENT: ${evaluacio.proposalName} (empresa no identificada - confiança: ${Math.round(evaluacio.companyConfidence * 100)}%)`;

		return `
    === PROPOSTA: ${companyDisplay} ===
    INFORMACIÓ D'EMPRESA:
    - Nom identificat: ${evaluacio.companyName || 'No identificat'}
    - Confiança identificació: ${Math.round(evaluacio.companyConfidence * 100)}%
    - Document original: ${evaluacio.proposalName}
    
    AVALUACIÓ INDIVIDUAL:
    ${evaluacio.criteria
			.map(
				(c) => `
      CRITERI: ${c.criterion}
      PUNTUACIÓ: ${c.score}
      JUSTIFICACIÓ: ${c.justification}
      PUNTS FORTS: ${c.strengths.join(', ')}
      MILLORES: ${c.improvements.join(', ')}
    `,
			)
			.join('\n')}
    
    RESUM: ${evaluacio.summary}
    RECOMANACIÓ: ${evaluacio.recommendation}
    CONFIANÇA AVALUACIÓ: ${evaluacio.confidence}
  `;
	});

	// Crear informació sobre identificació d'empreses per al context
	const companyIdentificationSummary = evaluatedProposals
		.map((prop) => {
			if (prop.companyName) {
				return `- ${prop.companyName}: Empresa identificada amb ${Math.round(prop.companyConfidence * 100)}% de confiança`;
			} else {
				return `- Document "${prop.proposalName}": Empresa no identificada (${Math.round(prop.companyConfidence * 100)}% confiança)`;
			}
		})
		.join('\n');

	const prompt = `
    Ets un expert en avaluació comparativa de licitacions públiques. Compara les següents ${evaluatedProposals.length} propostes per al lot "${lotInfo.title}" (Lot ${lotInfo.lotNumber}).

    ESTAT DE LA IDENTIFICACIÓ D'EMPRESES:
    ${companyIdentificationSummary}

    AVALUACIONS INDIVIDUALS PRÈVIES:
    ${proposalEvaluations.join('\n\n')}

    INSTRUCCIONS CRÍTIQUES:

    1. **COHERÈNCIA ABSOLUTA AMB AVALUACIONS INDIVIDUALS:**
       - Les puntuacions individuals són INALTERABLES
       - Si Proposta A té "COMPLEIX_EXITOSAMENT" i Proposta B té "REGULAR" en un criteri, A SEMPRE guanya
       - Si Proposta A té "REGULAR" i Proposta B té "INSUFICIENT", A SEMPRE guanya
       - Només quan les puntuacions són IGUALS cal analitzar els matisos

    2. **GESTIÓ DE LA IDENTIFICACIÓ D'EMPRESES:**
       - Quan mencionesles propostes, utilitza SEMPRE el nom de l'empresa quan estigui disponible
       - Si no es coneix l'empresa, indica-ho clarament amb frases com "la proposta de l'empresa no identificada" o "el document [nom]"
       - Sigues consistent en la identificació al llarg de tota la resposta
       - Considera la confiança de la identificació quan avaluïs la qualitat de la informació
       - NO inventis noms d'empresa si no estan identificats

    3. **COMPARACIÓ CRITERI PER CRITERI:**
       - Analitza cada criteri individualment
       - Identifica què destaca cada proposta dins del seu nivell de puntuació
       - Proporciona arguments específics per a cada proposta/empresa
       - Estableix un rànquing coherent amb les puntuacions

    4. **RÀNQUING GLOBAL:**
       - Calcula un rànquing global basant-te en:
         * Nombre de "COMPLEIX_EXITOSAMENT" (prioritat màxima)
         * Nombre de "REGULAR" (prioritat mitjana)
         * Nombre de "INSUFICIENT" (penalització)
         * Qualitat dels arguments dins de cada puntuació
       - El rànquing ha de ser coherent amb les puntuacions individuals
       - Pot haver-hi empats quan les puntuacions globals són similars

    5. **ARGUMENTS EQUILIBRATS:**
       - Destaca els punts forts de cada proposta/empresa
       - Sigues específic en els arguments comparatius
       - Proporciona raons objectives per al rànquing
       - Menciona quan una empresa no ha estat identificada per contextualitzar l'anàlisi

    IDIOMA DE LA RESPOSTA: Català (SEMPRE en català).

    FORMAT DE RESPOSTA (JSON):
    {
      "criteriaComparisons": [
        {
          "criterion": "Nom del criteri",
          "proposals": [
            {
              "proposalName": "Nom proposta/document 1",
              "companyName": "Nom empresa 1 o null",
              "score": "PUNTUACIÓ_ORIGINAL",
              "arguments": ["Argument específic 1", "Argument específic 2"],
              "position": 1
            },
            {
              "proposalName": "Nom proposta/document 2", 
              "companyName": "Nom empresa 2 o null",
              "score": "PUNTUACIÓ_ORIGINAL",
              "arguments": ["Argument específic 1", "Argument específic 2"],
              "position": 2
            }
          ]
        }
      ],
      "globalRanking": [
        {
          "proposalName": "Nom proposta/document",
          "companyName": "Nom empresa o null",
          "position": 1,
          "overallScore": "Excepcional|Molt bé|Notable|Millorable|Insuficient",
          "strengths": ["Punt fort principal 1", "Punt fort principal 2"],
          "weaknesses": ["Punt feble principal 1", "Punt feble principal 2"],
          "recommendation": "Recomanació específica per aquesta proposta/empresa, mencionant si l'empresa ha estat identificada o no"
        }
      ],
      "summary": "Resum executiu de la comparació amb recomanacions clares, mencionant les empreses quan sigui possible i notant quines no han estat identificades",
      "confidence": 0.85
    }

    REGLES ESTRICTES:
    - MAI canviar les puntuacions individuals
    - El rànquing ha de ser matemàticament coherent amb les puntuacions
    - Proporciona arguments específics, no generals
    - Sigues objectiu però constructiu
    - Utilitza els noms d'empresa quan estiguin disponibles, i indica clarament quan no
    - Menciona la qualitat de la identificació d'empreses quan sigui rellevant
    - Respon SEMPRE en català
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

		const response = await ai.models.generateContent({
			model: 'gemini-2.0-flash-lite',
			config,
			contents,
		});

		if (!response?.text) {
			throw new Error('No comparison received');
		}

		const jsonMatch = response.text.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			throw new Error('Could not extract JSON from response');
		}

		const comparison = JSON.parse(jsonMatch[0]);

		return {
			lotNumber: lotInfo.lotNumber,
			lotTitle: lotInfo.title,
			proposalNames: evaluatedProposals.map((p) => p.proposalName),
			companyNames: evaluatedProposals.map((p) => p.companyName),
			criteriaComparisons: comparison.criteriaComparisons,
			globalRanking: comparison.globalRanking,
			summary: comparison.summary,
			confidence: comparison.confidence,
		};
	} catch (error) {
		logger.error(
			`Error comparing proposals for lot ${lotInfo.lotNumber}:`,
			error,
		);
		throw new Error('Failed to compare proposals');
	}
}

router.post('/', async (req, res, next) => {
	try {
		if (!process.env.GEMINI_API_KEY) {
			throw new AppError('System API key not configured', 500);
		}

		const { specifications, lotInfo, evaluatedProposals }: ComparisonRequest =
			req.body;

		console.log('Received comparison request:', {
			hasSpecifications: specifications && Array.isArray(specifications),
			specificationsLength: specifications?.length || 0,
			hasLotInfo: !!lotInfo,
			lotInfo: lotInfo,
			hasEvaluatedProposals:
				evaluatedProposals && Array.isArray(evaluatedProposals),
			evaluatedProposalsLength: evaluatedProposals?.length || 0,
			evaluatedProposals: evaluatedProposals?.map((p) => ({
				name: p.proposalName,
				company: p.companyName,
				companyConfidence: p.companyConfidence,
				lotNumber: p.lotNumber,
			})),
		});

		if (
			!specifications ||
			!Array.isArray(specifications) ||
			specifications.length === 0
		) {
			throw new AppError('Specification documents are required', 400);
		}

		if (!lotInfo) {
			throw new AppError('Lot information is required', 400);
		}

		if (
			!evaluatedProposals ||
			!Array.isArray(evaluatedProposals) ||
			evaluatedProposals.length < 2
		) {
			throw new AppError('At least 2 evaluated proposals are required', 400);
		}

		// Log informatiu sobre la identificació d'empreses
		const companiesIdentified = evaluatedProposals.filter(
			(p) => p.companyName && p.companyName.trim().length > 0,
		).length;

		logger.info(
			`🔍 Comparing ${evaluatedProposals.length} proposals for lot ${lotInfo.lotNumber}`,
		);
		logger.info(
			`🏢 Company identification: ${companiesIdentified}/${evaluatedProposals.length} enterprises identified`,
		);

		const comparison = await compareProposalsForLot(
			lotInfo,
			evaluatedProposals,
		);

		const result: ComparisonResult = {
			comparison,
			timestamp: new Date().toISOString(),
		};

		logger.info(`✅ Comparison completed for lot ${lotInfo.lotNumber}`);
		res.json(result);
	} catch (error) {
		next(error);
	}
});

export default router;
