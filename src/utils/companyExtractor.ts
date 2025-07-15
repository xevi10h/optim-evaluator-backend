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
		// Patrons per identificar noms d'empreses
		const companyPatterns = [
			// Patrons específics catalans i espanyols
			/(?:empresa|companyia|societat|entitat|organització|corporació|grup|consultora|studio|estudi)[\s:]*([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{2,50})/gi,
			/(?:S\.L\.|S\.A\.|S\.L\.U\.|S\.C\.P\.|C\.B\.|A\.I\.E\.)[\s]*([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{2,50})/gi,
			/([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{2,50})[\s]*(?:S\.L\.|S\.A\.|S\.L\.U\.|S\.C\.P\.|C\.B\.|A\.I\.E\.)/gi,

			// Patrons per capçaleres i signatures
			/(?:nom de l'empresa|empresa|companyia|entitat|raó social|denominació social)[\s:]*([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{2,50})/gi,
			/(?:presentada per|oferta de|proposta de|empresa licitadora)[\s:]*([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{2,50})/gi,

			// Patrons per identificar en context de documentació oficial
			/(?:CIF|NIF)[\s:]*[A-Z]?[\d-]+[\s]*([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{2,50})/gi,
			/([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{2,50})[\s]*(?:CIF|NIF)[\s:]*[A-Z]?[\d-]+/gi,

			// Patrons per identificar al començament del document
			/^[\s]*([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{2,50})[\s]*(?:S\.L\.|S\.A\.|S\.L\.U\.|Ltd|Inc|Corp)/gm,
		];

		const candidates: Array<{
			name: string;
			confidence: number;
			source: string;
		}> = [];

		// Buscar candidats amb diferents patrons
		for (const pattern of companyPatterns) {
			const matches = [...proposalContent.matchAll(pattern)];
			for (const match of matches) {
				const candidateName = match[1]?.trim();
				if (
					candidateName &&
					candidateName.length >= 3 &&
					candidateName.length <= 80
				) {
					const cleanName = cleanCompanyName(candidateName);
					if (isValidCompanyName(cleanName)) {
						candidates.push({
							name: cleanName,
							confidence: calculateConfidence(cleanName, match[0]),
							source: `Pattern match: ${match[0].trim()}`,
						});
					}
				}
			}
		}

		// Intentar extreure del nom del fitxer
		const fileNameCompany = extractFromFileName(proposalName);
		if (fileNameCompany) {
			candidates.push({
				name: fileNameCompany,
				confidence: 0.7,
				source: `File name: ${proposalName}`,
			});
		}

		// Buscar patrons en les primeres línies del document
		const firstLines = proposalContent.split('\n').slice(0, 20).join('\n');
		const headerPatterns = [
			/^[\s]*([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{3,50})[\s]*$/gm,
			/(?:PROPOSTA|OFERTA|LICITACIÓ)[\s]+([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{3,50})/gi,
		];

		for (const pattern of headerPatterns) {
			const matches = [...firstLines.matchAll(pattern)];
			for (const match of matches) {
				const candidateName = match[1]?.trim();
				if (candidateName && isValidCompanyName(candidateName)) {
					candidates.push({
						name: cleanCompanyName(candidateName),
						confidence: 0.8,
						source: `Header match: ${match[0].trim()}`,
					});
				}
			}
		}

		// Seleccionar el millor candidat
		if (candidates.length === 0) {
			return {
				companyName: null,
				confidence: 0,
				source: 'No company name patterns found',
			};
		}

		// Ordenar per confiança i seleccionar el millor
		candidates.sort((a, b) => b.confidence - a.confidence);
		const bestCandidate = candidates[0];

		logger.info(
			`Empresa extreta: "${bestCandidate.name}" amb confiança ${bestCandidate.confidence} per "${proposalName}"`,
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

function cleanCompanyName(name: string): string {
	return name
		.replace(/^\s*[-•*\d.()]+\s*/, '') // Eliminar bullets i numeració
		.replace(/\s*[-•*\d.()]+\s*$/, '') // Eliminar al final
		.replace(/\s{2,}/g, ' ') // Múltiples espais
		.replace(/["""'']/g, '') // Cometes
		.trim();
}

function isValidCompanyName(name: string): boolean {
	if (!name || name.length < 3 || name.length > 80) return false;

	// Excloure paraules comunes que no són noms d'empresa
	const excludePatterns = [
		/^(proposta|oferta|licitació|document|annex|capítol|punt|apartat|secció)$/i,
		/^(página|pàgina|page|índex|índice|table|taula)$/i,
		/^(especificacions|especificaciones|requirements|requisits)$/i,
		/^(tècnic|técnico|technical|administratiu|administrativo)$/i,
		/^(serveis|servicios|services|consulting|consultoria)$/i,
		/^(projecte|proyecto|project|programa|programme)$/i,
		/^\d+[\s\w]*$/,
		/^[a-z\s]{1,3}$/i,
	];

	for (const pattern of excludePatterns) {
		if (pattern.test(name)) return false;
	}

	// Ha de tenir almenys una lletra majúscula
	if (!/[A-ZÁÉÍÓÚÀÈÒÇ]/.test(name)) return false;

	// No pot ser només majúscules (probablement acronim o títol de secció)
	if (name === name.toUpperCase() && name.length > 10) return false;

	return true;
}

function calculateConfidence(name: string, context: string): number {
	let confidence = 0.5;

	// Incrementar confiança per formes jurídiques
	if (/S\.L\.|S\.A\.|S\.L\.U\.|Ltd|Inc|Corp/i.test(context)) {
		confidence += 0.3;
	}

	// Incrementar confiança per contextos específics
	if (/(?:empresa|companyia|societat|entitat|organització)/i.test(context)) {
		confidence += 0.2;
	}

	// Incrementar confiança per CIF/NIF
	if (/CIF|NIF/i.test(context)) {
		confidence += 0.2;
	}

	// Reduir confiança per noms molt curts o molt llargs
	if (name.length < 5) confidence -= 0.1;
	if (name.length > 40) confidence -= 0.1;

	// Incrementar confiança per noms amb múltiples paraules capitalitzades
	const capitalizedWords = name
		.split(' ')
		.filter((word) => word.length > 0 && word[0] === word[0].toUpperCase());
	if (capitalizedWords.length >= 2) {
		confidence += 0.1;
	}

	return Math.min(1.0, Math.max(0.1, confidence));
}

function extractFromFileName(fileName: string): string | null {
	// Intentar extreure nom d'empresa del nom del fitxer
	const cleanFileName = fileName.replace(/\.[^.]+$/, ''); // Eliminar extensió

	const patterns = [
		/([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{3,30})(?:_proposta|_oferta|_licitacio|[\s_-])/i,
		/^([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{3,30})/i,
	];

	for (const pattern of patterns) {
		const match = cleanFileName.match(pattern);
		if (match && match[1]) {
			const candidate = cleanCompanyName(match[1]);
			if (isValidCompanyName(candidate)) {
				return candidate;
			}
		}
	}

	return null;
}
