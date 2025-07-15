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
	EvaluationResult,
	LotEvaluationRequest,
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

interface CompanyExtractionResult {
	companyName: string; // Ara sempre tindrà un valor, mai serà null
	confidence: number;
	reasoning: string;
}

// FUNCIÓ PRINCIPAL: Extracció d'empresa amb IA
async function extractCompanyWithAI(
	proposalContent: string,
	proposalName: string,
	lotInfo: LotInfo,
	specifications: FileContent[],
): Promise<CompanyExtractionResult> {
	const specsContent = specifications
		.map(
			(spec) => `
    === ESPECIFICACIÓ: ${spec.name} ===
    ${spec.content}
  `,
		)
		.join('\n\n');

	const prompt = `
    Ets un expert en anàlisi de licitacions públiques. Analitza el següent document de proposta per identificar amb precisió el nom de l'empresa que presenta la proposta.

    CONTEXT DE LA LICITACIÓ:
    ${specsContent}

    LOTE ESPECÍFIC:
    - Número: ${lotInfo.lotNumber}
    - Títol: ${lotInfo.title}
    ${lotInfo.description ? `- Descripció: ${lotInfo.description}` : ''}

    DOCUMENT DE PROPOSTA A ANALITZAR:
    Nom del document: ${proposalName}
    
    CONTINGUT DE LA PROPOSTA:
    ${proposalContent}

    INSTRUCCIONS D'IDENTIFICACIÓ D'EMPRESA:

    1. **CERCA SISTEMÀTICA DEL NOM DE L'EMPRESA:**
       - Busca la raó social completa de l'empresa
       - Identifica la denominació oficial que apareix en documents oficials
       - Troba la forma jurídica (S.L., S.A., S.L.U., etc.)
       - Localitza presentacions explícites de l'empresa

    2. **PRIORITAT D'INDICADORS (per ordre d'importància):**
       a) **DECLARACIONS EXPLÍCITES:** "L'empresa...", "La societat...", "Raó social:", "Denominació:"
       b) **SIGNATURES I REPRESENTANTS:** Signatura amb càrrec i empresa
       c) **CAPÇALERES I MEMBRETES:** Nom oficial en capçalera de documents
       d) **DADES FISCALS:** CIF/NIF associat amb nom empresarial
       e) **CONTEXT CONTRACTUAL:** "El contractista...", "L'adjudicatari...", "La mercantil..."

    3. **CRITERIS DE VALIDACIÓ:**
       - El nom ha de ser coherent al llarg del document
       - Ha de tenir sentit com a denominació empresarial
       - Ha de correspondre amb una entitat jurídica real
       - Evita noms genèrics, descripcions de projectes o noms de persones físiques isolats

    4. **EXCLUSIONS:**
       - Noms d'administracions públiques
       - Títols de projectes o serveis
       - Noms de persones sense context empresarial clar
       - Denominacions massa genèriques ("Consultoria", "Serveis", etc.)

    5. **AVALUACIÓ DE CONFIANÇA:**
       - ALTA (0.8-1.0): Múltiples mencions coherents, forma jurídica clara, context oficial
       - MITJANA (0.5-0.7): Algunes mencions, context empresarial clar però menys evidències
       - BAIXA (0.2-0.4): Poques evidències, context dubtós
       - MOLT BAIXA (0.0-0.1): Informació insuficient o contradictòria

    FORMAT DE RESPOSTA (JSON estricte):
    {
      "companyName": "Nom complet de l'empresa tal com apareix oficialment, o 'Empresa no identificada' si no es pot identificar",
      "confidence": 0.85,
      "reasoning": "Explicació detallada de com s'ha identificat l'empresa, incloent on apareix al text i per què es considera fiable aquesta identificació. Si no s'ha pogut identificar, explica què s'ha buscat i per què no s'ha trobat."
    }

    REGLES ESTRICTES:
    - Si NO trobes evidències clares d'una empresa específica → companyName: "Empresa no identificada"
    - La confiança ha de reflectir la solidesa de les evidències trobades (0.0 si no s'identifica)
    - El reasoning ha de ser específic i referenciar parts concretes del text
    - Respon SEMPRE en català
    - NO inventis noms d'empresa si no els trobes explícitament
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
			throw new Error('No response received for company extraction');
		}

		const jsonMatch = response.text.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			throw new Error('Could not extract JSON from response');
		}

		const result = JSON.parse(jsonMatch[0]);

		// Validació i neteja del resultat
		let companyName = result.companyName?.trim() || null;
		const confidence = Math.max(0, Math.min(1, result.confidence || 0));
		const reasoning = result.reasoning || "No s'ha proporcionat raonament";

		// Si no s'ha identificat cap empresa, assignar nom descriptiu
		if (!companyName || companyName.length === 0) {
			companyName = 'Empresa no identificada';
		}

		logger.info(
			`🏢 IA Company extraction for "${proposalName}": ${companyName} (confidence: ${confidence.toFixed(2)})`,
		);

		return {
			companyName,
			confidence,
			reasoning,
		};
	} catch (error) {
		logger.error(
			`Error extracting company with AI for "${proposalName}":`,
			error,
		);

		return {
			companyName: 'Empresa no identificada',
			confidence: 0.0,
			reasoning: `Error en l'extracció automàtica: ${error instanceof Error ? error.message : 'Error desconegut'}`,
		};
	}
}

async function extractCriteriaForLot(
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

    EXEMPLES DE CRITERIS BEN FORMATS:
    - Criteri: "Metodologia de treball"
      Descripció: "Avalua la qualitat i adequació de la metodologia proposada per desenvolupar els treballs"
      Requisits: "Ha de descriure fases, activitats, cronograma, recursos, i metodologies específiques. Ha d'estar alineada amb els objectius del projecte"
      Context: "És fonamental que la metodologia sigui realista, detallada i adaptada als requeriments específics d'aquest lot"

    FORMAT DE RESPOSTA (JSON estricte):
    [
      {
        "name": "Nom concís del criteri",
        "description": "Descripció detallada del què avalua aquest criteri",
        "requirements": "Requisits específics que ha de complir la proposta per aquest criteri",
        "context": "Context addicional, importància, exemples o notes rellevants"
      }
    ]

    Si no trobes criteris específics per aquest lote, retorna criteris generals aplicables amb les seves descripcions.
    
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

		try {
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
		} catch (parseError) {
			logger.warn(
				'Error parsing enhanced criteria JSON, falling back to simple extraction:',
				parseError,
			);
			return extractSimpleCriteriaFromText(response.text);
		}
	} catch (error) {
		logger.error(
			`Error extracting enhanced criteria for lot ${lot.lotNumber}:`,
			error,
		);
		return [];
	}
}

function extractSimpleCriteriaFromText(text: string): EnhancedCriterion[] {
	const lines = text.split('\n');
	const criteria: EnhancedCriterion[] = [];

	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.length > 10 && trimmed.length < 100) {
			const cleaned = trimmed
				.replace(/^[\d\-\*\•\.\)]+\s*/, '')
				.replace(/["\[\]]/g, '');
			if (cleaned.length > 5) {
				criteria.push({
					name: cleaned,
					description: `Avaluació del criteri: ${cleaned}`,
					requirements:
						'La proposta ha de demostrar competència en aquest àmbit',
					context: 'Criteri extret automàticament del plec de condicions',
				});
			}
		}
	}

	return criteria.slice(0, 8);
}

async function evaluateLotCriterion(
	criterion: EnhancedCriterion,
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

    AVALUA amb MÀXIMA ESTRICTESA el criteri "${criterion.name}" per al lote "${lot.title}" (Lot ${lot.lotNumber}) de la proposta "${companyInfo}".

    ESPECIFICACIONS:
    ${specsContent}

    PROPOSTA "${companyInfo}" PER AQUEST LOTE:
    ${proposalContent}

    LOTE A AVALUAR:
    - Número: ${lot.lotNumber}
    - Títol: ${lot.title}
    ${lot.description ? `- Descripció: ${lot.description}` : ''}

    CRITERI D'AVALUACIÓ AMB CONTEXT COMPLET:
    - CRITERI: ${criterion.name}
    - DESCRIPCIÓ: ${criterion.description}
    - REQUISITS: ${criterion.requirements}
    - CONTEXT: ${criterion.context}

    ⚠️ INSTRUCCIONS D'AVALUACIÓ ULTRA-ESTRICTA ⚠️

    🔍 **FASE 1 - VERIFICACIÓ D'EXISTÈNCIA (OBLIGATÒRIA):**
    
    1. **CERCA EXHAUSTIVA OBLIGATÒRIA:**
       - Busca ESPECÍFICAMENT aspectes relacionats amb "${criterion.name}" en el text de la proposta
       - Considera la DESCRIPCIÓ: "${criterion.description}"
       - Verifica si es compleixen els REQUISITS: "${criterion.requirements}"
       - Tingues en compte el CONTEXT: "${criterion.context}"
       - Cerca SINÒNIMS, PARAULES CLAU i CONCEPTES RELACIONATS
       - Identifica si hi ha una SECCIÓ DEDICADA, un APARTAT ESPECÍFIC o una MENCIÓ DIRECTA
       - Comprova si es tracta aquest tema de manera EXPLÍCITA o IMPLÍCITA
    
    2. **REGLA ESTRICTA D'EXISTÈNCIA:**
       - Si NO trobes CAP MENCIÓ, CAP REFERÈNCIA, CAP TRACTAMENT del criteri "${criterion.name}" → AUTOMÀTICAMENT "INSUFICIENT"
       - Si la proposta parla d'altres temes però IGNORA completament aquest criteri → AUTOMÀTICAMENT "INSUFICIENT"
       - Si NO hi ha un apartat, secció o menció que abordi aquest criteri → AUTOMÀTICAMENT "INSUFICIENT"
       - Si la resposta és genèrica sense connexió clara amb el criteri específic → AUTOMÀTICAMENT "INSUFICIENT"

    🔍 **FASE 2 - AVALUACIÓ DE QUALITAT I COMPLETITUD (NOMÉS SI EXISTEIX):**
    
    NOMÉS si la proposta SÍ tracta específicament el criteri, llavors avalua amb aquests estàndards ULTRA-EXIGENTS:
    
    - **INSUFICIENT**: 
      * NO tracta el criteri (cas automàtic de la Fase 1)
      * O tracta el criteri però de manera clarament inadequada, superficial o errònia
      * Menció molt superficial sense desenvolupament real
      * No compleix els requisits mínims especificats
      
    - **REGULAR**: 
      * Tracta el criteri de manera acceptable però estàndard
      * Compleix els requisits mínims especificats però sense destacar
      * Demostra comprensió bàsica però sense profunditat especial
      * Resposta correcta però genèrica, sense adaptació específica al lot
      
    - **COMPLEIX_EXITOSAMENT** (EXTREMADAMENT EXIGENT): 
      * Tracta el criteri amb EXCEL·LÈNCIA i PROFUNDITAT excepcionals
      * Demostra EXPERTESA tècnica i comprensió SUPERIOR
      * Compleix TOTS els requisits especificats amb CREIX
      * Inclou detalls CONCRETS, ESPECÍFICS i INNOVADORS adaptats al lot
      * Va MOLT MÉS ENLLÀ dels requisits mínims amb valor afegit
      * Solució que seria DIFÍCIL de superar per un competidor
      * Demostra comprensió profunda del context específic del lot

    🚨 **ENFOCAMENT ULTRA-CRÍTIC:**
    - Sigues IMPLACABLE en la verificació d'existència del criteri
    - NO acceptis respostes genèriques que no tractin específicament el criteri
    - NO donis "REGULAR" si no hi ha tractament específic i clar del criteri
    - "COMPLEIX_EXITOSAMENT" només per a respostes EXCEPCIONALS que demostrin expertesa superior
    - Si tens QUALSEVOL DUBTE sobre si tracta el criteri → "INSUFICIENT"

    🔎 **VERIFICACIÓ ESPECÍFICA PER AQUEST CRITERI:**
    - CRITERI: "${criterion.name}"
    - BUSCA: Seccions que tractin aspectes relacionats amb "${criterion.description}"
    - VERIFICA: Que es compleixin els requisits "${criterion.requirements}"
    - CONSIDERA: El context "${criterion.context}"

    IDIOMA DE LA RESPOSTA: Català (SEMPRE en català).
    
    FORMAT DE RESPOSTA (JSON):
    {
      "score": "INSUFICIENT|REGULAR|COMPLEIX_EXITOSAMENT",
      "justification": "PRIMER explica si es tracta ESPECÍFICAMENT el criteri '${criterion.name}' en la proposta (cita on ho trobes o confirma que no hi és). Considera la descripció: '${criterion.description}' i els requisits: '${criterion.requirements}'. DESPRÉS avalua la qualitat si existeix...",
      "strengths": ["Punt fort específic relacionat amb ${criterion.name}", "Altre punt fort específic"],
      "improvements": ["Millora concreta per ${criterion.name}", "Altra millora concreta", "Tercera millora concreta"],
      "references": ["Cita específica del text on es tracta ${criterion.name}", "Altra cita relacionada"],
      "criterionFound": true/false
    }

    ⚠️ REGLES INFLEXIBLES:
    1. Si NO trobes tractament específic del criteri "${criterion.name}" → SEMPRE "INSUFICIENT" + "criterionFound": false
    2. Si la proposta parla d'altres temes sense tractar aquest criteri → SEMPRE "INSUFICIENT"
    3. En cas de DUBTE sobre si tracta el criteri → SEMPRE "INSUFICIENT"
    4. SEMPRE indica clarament si has trobat el criteri amb "criterionFound": true/false
    5. Les "references" han de ser cites literals del text on es tracta el criteri
    6. Considereu sempre el context complet del criteri: nom, descripció, requisits i context
    7. Respon SEMPRE en català
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
					evaluation.justification = `El criteri "${criterion.name}" NO es tracta en absolut en la proposta. ${evaluation.justification}`;
				}
			}

			return {
				criterion: criterion.name,
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
			`Error evaluating criterion "${criterion.name}" for lot ${lot.lotNumber} company ${companyName || proposalName}:`,
			error,
		);

		return {
			criterion: criterion.name,
			score: 'INSUFICIENT',
			justification: `ERROR CRÍTIC: No s'ha pogut avaluar automàticament el criteri "${criterion.name}" per al lote ${lot.lotNumber} de l'empresa ${companyName || proposalName}. Donat que no es pot verificar si la proposta tracta aquest criteri específic, s'assigna puntuació INSUFICIENT per precaució. REVISIÓ MANUAL URGENT REQUERIDA per determinar si la proposta aborda específicament aquest criteri. Context del criteri: ${criterion.description}`,
			strengths: [],
			improvements: [
				'Verificació manual urgent si la proposta tracta aquest criteri',
				'Anàlisi detallat de la cobertura del criteri específic',
				'Validació de la qualitat de la resposta si existeix',
				'Revisió de la coherència amb les especificacions del lote',
				`Consideració del context: ${criterion.context}`,
			],
			references: [
				'ERROR EN PROCESSAMENT AUTOMÀTIC - REVISIÓ MANUAL REQUERIDA',
				`Criteri: ${criterion.name} - ${criterion.description}`,
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

    RESULTATS D'AVALUACIÓ:
    ${criteriaResults}

    ESTADÍSTIQUES:
    - Compleix exitosament: ${excellentScores}
    - Regular: ${regularScores}
    - Insuficient: ${insufficientScores}
    - Total criteris: ${criteria.length}

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

				allLotEvaluations.push({
					lotNumber: lot.lotNumber,
					lotTitle: lot.title,
					proposalName: '',
					companyName: null,
					companyConfidence: 0,
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

				const proposalContent = proposalFiles
					.map((p) => `=== ${p.name} ===\n${p.content}`)
					.join('\n\n');

				// CANVI PRINCIPAL: Usar la IA per extreure l'empresa
				const companyExtraction = await extractCompanyWithAI(
					proposalContent,
					proposalName,
					lot,
					specifications,
				);

				logger.info(
					`🏢 AI Company extraction for "${proposalName}": ${companyExtraction.companyName} (confidence: ${companyExtraction.confidence.toFixed(2)})`,
				);
				logger.info(`📝 Reasoning: ${companyExtraction.reasoning}`);

				// Extreure criteris amb context complet
				const enhancedCriteria = await extractCriteriaForLot(
					specifications,
					lot,
				);

				if (enhancedCriteria.length === 0) {
					logger.warn(`No criteria found for lot ${lot.lotNumber}`);
					allLotEvaluations.push({
						lotNumber: lot.lotNumber,
						lotTitle: lot.title,
						proposalName,
						companyName: companyExtraction.companyName,
						companyConfidence: companyExtraction.confidence,
						hasProposal: true,
						criteria: [],
						summary: `No s'han pogut extreure criteris d'avaluació per al lote ${lot.lotNumber}`,
						recommendation: `Es requereix revisió manual dels criteris d'avaluació per aquest lote. Cal considerar: Estan ben definits els requisits al plec? Hi ha criteris implícits que caldria explicitar?`,
						confidence: 0.3,
					});
					continue;
				}

				logger.info(
					`📊 Found ${enhancedCriteria.length} enhanced criteria for lot ${lot.lotNumber}`,
				);

				const criteriaEvaluations: EvaluationCriteria[] = [];
				for (const enhancedCriterion of enhancedCriteria) {
					const evaluation = await evaluateLotCriterion(
						enhancedCriterion,
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

				allLotEvaluations.push({
					lotNumber: lot.lotNumber,
					lotTitle: lot.title,
					proposalName,
					companyName: companyExtraction.companyName,
					companyConfidence: companyExtraction.confidence,
					hasProposal: true,
					criteria: criteriaEvaluations,
					summary,
					recommendation,
					confidence,
				});

				logger.info(
					`✅ Completed evaluation for "${companyExtraction.companyName}" in lot ${lot.lotNumber}`,
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
