import logger from './logger';

export interface CompanyExtractionResult {
	companyName: string | null;
	source: string;
}

/**
 * Extractor tradicional d'empreses - NOMÉS com a fallback quan falla la IA
 * Aquesta versió està simplificada ja que la IA és el mètode principal
 */
export async function extractCompanyFromProposal(
	proposalContent: string,
	proposalName: string,
): Promise<CompanyExtractionResult> {
	try {
		logger.info(`🔄 Using fallback company extraction for "${proposalName}"`);

		// Patrons simplificats per al fallback
		const companyPatterns = [
			// 1. Formes jurídiques - PRIORITAT ALTA
			/([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{3,40})[\s]*(?:S\.L\.|S\.A\.|S\.L\.U\.|S\.C\.P\.|C\.B\.|A\.I\.E\.)/gi,

			// 2. Declaracions explícites - PRIORITAT ALTA
			/(?:empresa|companyia|societat|raó social|denominació social)[\s:]*([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{3,40})/gi,

			// 3. Context amb CIF/NIF - PRIORITAT MITJANA
			/([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{3,40})[\s]*(?:CIF|NIF)[\s:]*[A-Z]?\d{8}[A-Z]?/gi,
		];

		const candidates: Array<{
			name: string;
			source: string;
		}> = [];

		// Buscar candidats amb els patrons simplificats
		companyPatterns.forEach((pattern, index) => {
			const matches = [...proposalContent.matchAll(pattern)];
			matches.forEach((match) => {
				const candidateName = match[1]?.trim();
				if (candidateName && isValidCompanyName(candidateName)) {
					const cleanName = cleanCompanyName(candidateName);

					candidates.push({
						name: cleanName,

						source: `Fallback pattern ${index + 1}`,
					});
				}
			});
		});

		// Buscar en nom del fitxer com a última opció
		const fileNameCompany = extractFromFileName(proposalName);
		if (fileNameCompany) {
			candidates.push({
				name: fileNameCompany,

				source: `Fallback filename: ${proposalName}`,
			});
		}

		if (candidates.length === 0) {
			logger.info(`❌ Fallback extraction failed for "${proposalName}"`);
			return {
				companyName: null,

				source: 'No fallback patterns found',
			};
		}

		const bestCandidate = candidates[0];

		logger.info(
			`⚠️ Fallback extraction for "${proposalName}": ${bestCandidate.name} `,
		);

		return {
			companyName: bestCandidate.name,

			source: bestCandidate.source,
		};
	} catch (error) {
		logger.error('Error in fallback company extraction:', error);
		return {
			companyName: null,
			source: 'Error in fallback extraction',
		};
	}
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

	// No pot ser només majúscules si és molt llarg
	if (name === name.toUpperCase() && name.length > 15) return false;

	return true;
}
