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
		// PATRONS PRIORITARIS: Empreses que es presenten explícitament
		const highPriorityPatterns = [
			// Presentacions explícites d'empreses
			/(?:em presento|ens presentem|presenta la seva candidatura|presenta aquesta proposta|proposta presentada per|sol·licita participar)[\s\w,]{0,50}(?:la )?(?:empresa|companyia|societat|entitat)[\s:]*((?:[A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{2,50})+)/gi,

			// Declaracions formals d'empresa
			/(?:raó social|denominació social|nom de l'empresa|empresa licitadora|empresa sol·licitant|empresa contractista)[\s:]*([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{2,50})/gi,

			// Empreses amb forma jurídica que es presenten
			/^([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{3,50})[\s,]*(?:S\.L\.|S\.A\.|S\.L\.U\.|S\.C\.P\.|C\.B\.|A\.I\.E\.)[\s,]*(?:es presenta|presenta|sol·licita|manifesta|ofereix)/gim,

			// Empreses amb CIF/NIF que es presenten
			/([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{3,50})[\s,]*(?:amb (?:CIF|NIF))[\s:]*[A-Z]?\d{8}[A-Z]?[\s,]*(?:es presenta|presenta|manifesta|sol·licita)/gi,

			// Representació legal
			/(?:en representació de|representant de|en nom de|actuant per compte de)[\s:]*((?:[A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{2,50})+)/gi,

			// Càrrecs directius
			/(?:administrador|gerent|director|representant legal|conseller delegat|CEO|president) (?:de|d')\s*([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{3,50})/gi,

			// Signatures i declaracions
			/(?:signat per|signatura de|declara|manifesta)[\s\w,]{0,30}([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{3,50})[\s,]*(?:S\.L\.|S\.A\.|S\.L\.U\.)/gi,
		];

		// PATRONS SECUNDARIS: Formes jurídiques sense context de presentació
		const legalFormPatterns = [
			/([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{2,50})[\s]*(?:S\.L\.|S\.A\.|S\.L\.U\.|S\.C\.P\.|C\.B\.|A\.I\.E\.)/gi,
			/(?:S\.L\.|S\.A\.|S\.L\.U\.|S\.C\.P\.|C\.B\.|A\.I\.E\.)[\s]*([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{2,50})/gi,
		];

		// PATRONS TERCIARIS: Context empresarial general
		const contextualPatterns = [
			/(?:empresa|companyia|societat|entitat|organització|corporació|grup|consultora)[\s:]*([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{2,50})/gi,
			/(?:CIF|NIF)[\s:]*[A-Z]?\d{8}[A-Z]?[\s]*([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{2,50})/gi,
			/([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{2,50})[\s]*(?:CIF|NIF)[\s:]*[A-Z]?\d{8}[A-Z]?/gi,
		];

		const candidates: Array<{
			name: string;
			confidence: number;
			source: string;
			priority: number;
		}> = [];

		// 1. PRIORITAT ALTA: Empreses que es presenten explícitament (0.85-0.95)
		highPriorityPatterns.forEach((pattern, index) => {
			const matches = [...proposalContent.matchAll(pattern)];
			matches.forEach((match) => {
				const candidateName = match[1]?.trim();
				if (candidateName && isValidCompanyName(candidateName)) {
					const cleanName = cleanCompanyName(candidateName);
					candidates.push({
						name: cleanName,
						confidence: 0.85 + index * 0.01, // 0.85-0.95
						source: `High priority presentation: ${match[0].substring(0, 80)}...`,
						priority: 1,
					});
				}
			});
		});

		// 2. PRIORITAT MITJANA: Formes jurídiques (0.70-0.80)
		legalFormPatterns.forEach((pattern, index) => {
			const matches = [...proposalContent.matchAll(pattern)];
			matches.forEach((match) => {
				const candidateName = match[1]?.trim();
				if (candidateName && isValidCompanyName(candidateName)) {
					const cleanName = cleanCompanyName(candidateName);
					// Només afegir si no tenim ja un candidat d'alta prioritat amb el mateix nom
					const existingHighPriority = candidates.find(
						(c) =>
							c.priority === 1 &&
							normalizeForComparison(c.name) ===
								normalizeForComparison(cleanName),
					);
					if (!existingHighPriority) {
						candidates.push({
							name: cleanName,
							confidence: 0.7 + index * 0.02,
							source: `Legal form: ${match[0].trim()}`,
							priority: 2,
						});
					}
				}
			});
		});

		// 3. PRIORITAT BAIXA: Context empresarial (0.50-0.65)
		contextualPatterns.forEach((pattern, index) => {
			const matches = [...proposalContent.matchAll(pattern)];
			matches.forEach((match) => {
				const candidateName = match[1]?.trim();
				if (candidateName && isValidCompanyName(candidateName)) {
					const cleanName = cleanCompanyName(candidateName);
					// Només afegir si no tenim ja candidats de prioritat superior
					const existingHigherPriority = candidates.find(
						(c) =>
							(c.priority === 1 || c.priority === 2) &&
							normalizeForComparison(c.name) ===
								normalizeForComparison(cleanName),
					);
					if (!existingHigherPriority) {
						candidates.push({
							name: cleanName,
							confidence: 0.5 + index * 0.02,
							source: `Contextual: ${match[0].trim()}`,
							priority: 3,
						});
					}
				}
			});
		});

		// 4. Buscar en capçaleres del document (prioritat 3)
		const headerCompany = extractFromHeader(proposalContent);
		if (headerCompany) {
			// Verificar si ja tenim aquest nom amb prioritat superior
			const existingHigherPriority = candidates.find(
				(c) =>
					c.priority <= 2 &&
					normalizeForComparison(c.name) ===
						normalizeForComparison(headerCompany),
			);
			if (!existingHigherPriority) {
				candidates.push({
					name: headerCompany,
					confidence: 0.65,
					source: 'Document header analysis',
					priority: 3,
				});
			}
		}

		// 5. Extreure del nom del fitxer (prioritat més baixa)
		const fileNameCompany = extractFromFileName(proposalName);
		if (fileNameCompany) {
			const existingAny = candidates.find(
				(c) =>
					normalizeForComparison(c.name) ===
					normalizeForComparison(fileNameCompany),
			);
			if (!existingAny) {
				candidates.push({
					name: fileNameCompany,
					confidence: 0.55,
					source: `File name: ${proposalName}`,
					priority: 4,
				});
			}
		}

		if (candidates.length === 0) {
			return {
				companyName: null,
				confidence: 0,
				source: 'No company name patterns found',
			};
		}

		// Ordenar per prioritat i després per confiança
		candidates.sort((a, b) => {
			if (a.priority !== b.priority) {
				return a.priority - b.priority; // Prioritat més baixa primer
			}
			return b.confidence - a.confidence; // Confiança més alta primer dins la mateixa prioritat
		});

		const bestCandidate = candidates[0];

		// Bonus de confiança si hi ha múltiples candidats del mateix nom en diferents prioritats
		const sameNameCandidates = candidates.filter(
			(c) =>
				normalizeForComparison(c.name) ===
				normalizeForComparison(bestCandidate.name),
		);
		if (sameNameCandidates.length > 1) {
			bestCandidate.confidence = Math.min(0.95, bestCandidate.confidence + 0.1);
		}

		logger.info(
			`Empresa extreta: "${bestCandidate.name}" amb confiança ${bestCandidate.confidence.toFixed(2)} (prioritat ${bestCandidate.priority}) per "${proposalName}"`,
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
	// Buscar en les primeres 15 línies del document
	const firstLines = content.split('\n').slice(0, 15).join('\n');

	const headerPatterns = [
		// Línies que contenen només un nom d'empresa
		/^[\s]*([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{3,50})[\s]*(?:S\.L\.|S\.A\.|S\.L\.U\.)?[\s]*$/gm,

		// Presentacions directes en capçalera
		/^[\s]*(?:PROPOSTA|OFERTA|LICITACIÓ)[\s]+(?:DE[\s]+)?([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{3,50})/gim,

		// Capçaleres amb empresa i forma jurídica
		/^[\s]*([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{3,50})[\s]+(?:S\.L\.|S\.A\.|S\.L\.U\.)[\s]*$/gm,

		// Empreses en els primers paràgrafs
		/^[\s]*Empresa[\s:]+([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{3,50})/gim,
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
		.replace(/^(?:la|el|els|les)\s+/i, '') // Articles definits al començament
		.replace(/\s*,\s*$/, '') // Comes al final
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
		/^(lots?|lotes?)$/i,
		/^(criteris?|criterios?)$/i,
		/^(avaluació|evaluación|evaluation)$/i,
		/^(memòria|memoria|memory)$/i,
		/^(plec|pliego|specifications)$/i,
		/^(condicions|condiciones|conditions)$/i,
		/^\d+[\s\w]*$/,
		/^[a-z\s]{1,3}$/i,
	];

	for (const pattern of excludePatterns) {
		if (pattern.test(name)) return false;
	}

	// Ha de tenir almenys una lletra majúscula
	if (!/[A-ZÁÉÍÓÚÀÈÒÇ]/.test(name)) return false;

	// No pot ser només majúscules llargues (probablement acronim o títol de secció)
	if (name === name.toUpperCase() && name.length > 20) return false;

	// Ha de tenir almenys una lletra
	if (!/[a-zA-ZáéíóúàèòçüñÁÉÍÓÚÀÈÒÇÜÑ]/.test(name)) return false;

	// No pot tenir només números i símbols
	if (!/[a-zA-ZáéíóúàèòçüñÁÉÍÓÚÀÈÒÇÜÑ]{3,}/.test(name)) return false;

	return true;
}

function extractFromFileName(fileName: string): string | null {
	// Intentar extreure nom d'empresa del nom del fitxer
	const cleanFileName = fileName.replace(/\.[^.]+$/, ''); // Eliminar extensió

	const patterns = [
		// Empresa seguida de proposta/oferta
		/^([A-ZÁÉÍÓÚÀÈÒÇ][A-Za-záéíóúàèòç\s&,.-]{3,30})[\s_-](?:proposta|oferta|licitacio|proposal|offer)/i,

		// Primer nom si sembla una empresa
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
