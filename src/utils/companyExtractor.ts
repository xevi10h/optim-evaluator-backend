import logger from './logger';

export interface CompanyExtractionResult {
	companyName: string | null;
	confidence: number;
	source: string;
}

export async function extractCompanyFromProposal(
	proposalContent: string,
	proposalName: string,
): Promise<CompanyExtractionResult> {
	try {
		// PATRONS SIMPLIFICATS I DIRECTES per trobar noms d'empresa
		const companyPatterns = [
			// 1. Formes jurídiques clàssiques - PRIORITAT ALTA
			/([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{2,40})[\s]*(?:S\.L\.|S\.A\.|S\.L\.U\.|S\.C\.P\.|C\.B\.|A\.I\.E\.)/gi,
			/(?:S\.L\.|S\.A\.|S\.L\.U\.|S\.C\.P\.|C\.B\.|A\.I\.E\.)[\s]*([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{2,40})/gi,

			// 2. Declaracions explícites d'empresa - PRIORITAT ALTA
			/(?:empresa|companyia|societat)[\s:]*([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{2,40})/gi,
			/(?:raó social|denominació social)[\s:]*([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{2,40})/gi,

			// 3. Presentacions directes - PRIORITAT MITJANA
			/(?:presenta|sol·licita|ofereix)[\s\w,]{0,20}([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{2,40})/gi,
			/(?:representació de|nom de)[\s:]*((?:[A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{2,40})+)/gi,

			// 4. Context amb CIF/NIF - PRIORITAT MITJANA
			/([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{2,40})[\s]*(?:CIF|NIF)[\s:]*[A-Z]?\d{8}[A-Z]?/gi,
			/(?:CIF|NIF)[\s:]*[A-Z]?\d{8}[A-Z]?[\s]*([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{2,40})/gi,

			// 5. Càrrecs directius - PRIORITAT BAIXA
			/(?:administrador|gerent|director|representant) (?:de|d')\s*([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{2,40})/gi,
		];

		const candidates: Array<{
			name: string;
			confidence: number;
			source: string;
		}> = [];

		// Buscar candidats amb els patrons
		companyPatterns.forEach((pattern, index) => {
			const matches = [...proposalContent.matchAll(pattern)];
			matches.forEach((match) => {
				const candidateName = match[1]?.trim();
				if (candidateName && isValidCompanyName(candidateName)) {
					const cleanName = cleanCompanyName(candidateName);

					// Calcular confiança basada en l'ordre del patró
					let confidence = 0.9 - index * 0.1; // Primers patrons més confiança
					if (index === 0 || index === 1) confidence = 0.85; // Formes jurídiques
					if (index === 2 || index === 3) confidence = 0.8; // Declaracions explícites

					candidates.push({
						name: cleanName,
						confidence: Math.max(0.5, confidence),
						source: `Pattern ${index + 1}: ${match[0].substring(0, 50)}...`,
					});
				}
			});
		});

		// Buscar en capçalera del document
		const headerCompany = extractFromHeader(proposalContent);
		if (headerCompany) {
			candidates.push({
				name: headerCompany,
				confidence: 0.7,
				source: 'Document header',
			});
		}

		// Buscar en nom del fitxer com a última opció
		const fileNameCompany = extractFromFileName(proposalName);
		if (fileNameCompany) {
			candidates.push({
				name: fileNameCompany,
				confidence: 0.6,
				source: `File name: ${proposalName}`,
			});
		}

		// Si no trobem res, retornar null
		if (candidates.length === 0) {
			logger.info(`No s'ha pogut identificar l'empresa per "${proposalName}"`);
			return {
				companyName: null,
				confidence: 0,
				source: 'No company patterns found',
			};
		}

		// Ordenar per confiança (més alta primer)
		candidates.sort((a, b) => b.confidence - a.confidence);

		// Agafar el millor candidat
		const bestCandidate = candidates[0];

		// Bonus si el mateix nom apareix múltiples vegades
		const sameNameCount = candidates.filter(
			(c) =>
				normalizeForComparison(c.name) ===
				normalizeForComparison(bestCandidate.name),
		).length;

		if (sameNameCount > 1) {
			bestCandidate.confidence = Math.min(0.95, bestCandidate.confidence + 0.1);
		}

		logger.info(
			`Empresa identificada: "${bestCandidate.name}" amb confiança ${bestCandidate.confidence.toFixed(2)} per "${proposalName}"`,
		);

		return {
			companyName: bestCandidate.name,
			confidence: bestCandidate.confidence,
			source: bestCandidate.source,
		};
	} catch (error) {
		logger.error("Error extraient nom d'empresa:", error);
		return {
			companyName: null,
			confidence: 0,
			source: 'Error during extraction',
		};
	}
}

function extractFromHeader(content: string): string | null {
	// Buscar en les primeres 10 línies
	const firstLines = content.split('\n').slice(0, 10).join('\n');

	const headerPatterns = [
		// Empresa amb forma jurídica en capçalera
		/^[\s]*([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{3,40})[\s]*(?:S\.L\.|S\.A\.|S\.L\.U\.)?[\s]*$/gm,
		// Capçaleres tipus "PROPOSTA DE [EMPRESA]"
		/^[\s]*(?:PROPOSTA|OFERTA)[\s]+(?:DE[\s]+)?([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{3,40})/gim,
	];

	for (const pattern of headerPatterns) {
		const matches = [...firstLines.matchAll(pattern)];
		for (const match of matches) {
			const candidateName = match[1]?.trim();
			if (candidateName && isValidCompanyName(candidateName)) {
				return cleanCompanyName(candidateName);
			}
		}
	}

	return null;
}

function extractFromFileName(fileName: string): string | null {
	const cleanFileName = fileName.replace(/\.[^.]+$/, ''); // Treure extensió

	// Buscar empresa al començament del nom del fitxer
	const match = cleanFileName.match(
		/^([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{3,30})/i,
	);
	if (match && match[1]) {
		const candidate = cleanCompanyName(match[1]);
		if (isValidCompanyName(candidate)) {
			return candidate;
		}
	}

	return null;
}

function normalizeForComparison(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '')
		.trim();
}

function cleanCompanyName(name: string): string {
	return name
		.replace(/^\s*[-•*\d.()]+\s*/, '') // Eliminar bullets i numeració
		.replace(/\s*[-•*\d.()]+\s*$/, '') // Eliminar al final
		.replace(/\s{2,}/g, ' ') // Múltiples espais
		.replace(/["""'']/g, '') // Cometes
		.replace(/^(?:la|el|els|les)\s+/i, '') // Articles definits
		.replace(/\s*,\s*$/, '') // Comes al final
		.trim();
}

function isValidCompanyName(name: string): boolean {
	if (!name || name.length < 3 || name.length > 60) return false;

	// Excloure paraules obvies que no són empreses
	const excludeWords = [
		'proposta',
		'oferta',
		'licitació',
		'document',
		'annex',
		'capítol',
		'punt',
		'apartat',
		'página',
		'pàgina',
		'índex',
		'especificacions',
		'tècnic',
		'administratiu',
		'serveis',
		'projecte',
		'lots',
		'criteris',
		'avaluació',
		'memòria',
		'plec',
		'condicions',
	];

	const lowerName = name.toLowerCase();
	if (
		excludeWords.some(
			(word) => lowerName === word || lowerName.startsWith(word + ' '),
		)
	) {
		return false;
	}

	// Ha de tenir almenys una lletra majúscula
	if (!/[A-ZÁÉÍÓÚÀÈÒÇ]/.test(name)) return false;

	// Ha de tenir almenys 3 lletres
	if (!/[a-zA-ZáéíóúàèòçüñÁÉÍÓÚÀÈÒÇÜÑ]{3,}/.test(name)) return false;

	// No pot ser només majúscules si és molt llarg (probablement és un títol)
	if (name === name.toUpperCase() && name.length > 15) return false;

	return true;
}
