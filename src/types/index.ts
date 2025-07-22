export interface FileContent {
	name: string;
	content: string;
	type: 'specification' | 'proposal';
	lotNumber?: number;
}

export interface LotInfo {
	lotNumber: number;
	title: string;
	description?: string;
}

export interface EvaluationCriteria {
	criterion: string;
	score: 'INSUFICIENT' | 'REGULAR' | 'COMPLEIX_EXITOSAMENT';
	justification: string;
	strengths: string[];
	improvements: string[];
	references: string[];
}

export interface LotEvaluation {
	lotNumber: number;
	lotTitle: string;
	proposalName: string;
	companyName: string | null;
	companyConfidence: number;
	hasProposal: boolean;
	criteria: EvaluationCriteria[];
	summary: string;
	recommendation: string;
	confidence: number;
}

// New single lot evaluation types
export interface SingleLotEvaluationRequest {
	specifications: FileContent[];
	proposals: FileContent[]; // Only proposals for this specific lot
	lotInfo: LotInfo; // Single lot info instead of array
}

export interface SingleLotEvaluationResult {
	lotNumber: number;
	lotTitle: string;
	evaluations: LotEvaluation[];
	extractedCriteria: number;
	processingTime: number;
}

// Updated evaluation result for frontend
export interface EvaluationResult {
	lots: LotEvaluation[];
	extractedLots: LotInfo[];
	overallSummary: string;
	overallRecommendation: string;
	overallConfidence: number;
	// New fields for tracking progress
	completedLots?: number;
	totalLots?: number;
	isComplete?: boolean;
}

// Progress tracking for frontend
export interface EvaluationProgress {
	currentLot: number;
	totalLots: number;
	currentLotTitle: string;
	isEvaluating: boolean;
	completedEvaluations: LotEvaluation[];
}

export interface CriterionComparison {
	criterion: string;
	proposals: Array<{
		proposalName: string;
		companyName: string | null;
		score: 'INSUFICIENT' | 'REGULAR' | 'COMPLEIX_EXITOSAMENT';
		arguments: string[];
		position: number;
	}>;
}

export interface ComparisonRanking {
	proposalName: string;
	companyName: string | null;
	position: number;
	overallScore:
		| 'Excepcional'
		| 'Molt bé'
		| 'Notable'
		| 'Millorable'
		| 'Insuficient';
	strengths: string[];
	weaknesses: string[];
	recommendation: string;
}

export interface ProposalComparison {
	lotNumber: number;
	lotTitle: string;
	proposalNames: string[];
	companyNames: (string | null)[];
	criteriaComparisons: CriterionComparison[];
	globalRanking: ComparisonRanking[];
	summary: string;
	confidence: number;
}

export interface ComparisonRequest {
	specifications: FileContent[];
	lotInfo: LotInfo;
	evaluatedProposals: LotEvaluation[];
}

export interface ComparisonResult {
	comparison: ProposalComparison;
	timestamp: string;
}

export interface ProcessedFile {
	name: string;
	content: string;
	type: 'specification' | 'proposal';
	success: boolean;
	extractedLength?: number;
	error?: string;
}

export interface UploadResponse {
	success: boolean;
	files: ProcessedFile[];
	summary: {
		total: number;
		successful: number;
		failed: number;
	};
}

export interface LotExtractionRequest {
	specifications: FileContent[];
}

export interface CriteriaExtractionRequest {
	specifications: FileContent[];
}

export interface CriteriaExtractionResponse {
	success: boolean;
	criteria: string[];
	count: number;
}

export interface APIError {
	message: string;
	status: number;
	code?: string;
}

export const SUPPORTED_FILE_TYPES = [
	'application/pdf',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'application/msword',
	'text/plain',
] as const;

export const EVALUATION_SCORES = {
	INSUFICIENT: 'INSUFICIENT',
	REGULAR: 'REGULAR',
	COMPLEIX_EXITOSAMENT: 'COMPLEIX_EXITOSAMENT',
} as const;

export const SCORE_VALUES = {
	INSUFICIENT: 1,
	REGULAR: 2,
	COMPLEIX_EXITOSAMENT: 3,
} as const;

export const RECOMMENDATION_TYPES = {
	POSITIVE: 'positive',
	CONDITIONAL: 'conditional',
	NEGATIVE: 'negative',
} as const;

export type SupportedFileType = (typeof SUPPORTED_FILE_TYPES)[number];
export type EvaluationScore = keyof typeof EVALUATION_SCORES;
export type RecommendationType = keyof typeof RECOMMENDATION_TYPES;

export interface ScoreStatistics {
	total: number;
	excellent: number;
	regular: number;
	insufficient: number;
	averageScore: number;
	recommendationType: RecommendationType;
}

export interface ValidationSchemas {
	uploadSchema: any;
	evaluationSchema: any;
	criteriaExtractionSchema: any;
}

// Frontend specific types
export interface FileWithContent {
	file: File;
	content: string;
	name: string;
}

export interface ProcessingState {
	isProcessing: boolean;
	currentFile: string | null;
	error: string | null;
	progress: number;
}

export interface BasicInfo {
	title: string;
	expedient: string;
	entity: string;
	context: string;
}

export interface ProposalFile extends FileWithContent {
	lotNumber: number;
}

export interface APIResponse<T> {
	success: boolean;
	data?: T;
	error?: string;
	details?: string;
}

export interface FileInfo {
	name: string;
	type: string;
	size: number;
	extension: string;
	isSupported: boolean;
}

export interface PDFProcessingOptions {
	maxPages?: number;
	timeout?: number;
	minTextLength?: number;
}

export interface ProcessingError {
	code: string;
	message: string;
	isUserFriendly: boolean;
	filename?: string;
	step?: string;
}

export const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.doc', '.txt'] as const;

export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_CRITERIA = 8;
export const MIN_JUSTIFICATION_LENGTH = 100;

export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

// Utility functions for company management
export function getDisplayName(
	companyName: string | null,
	proposalName: string,
): string {
	if (companyName && companyName.trim().length > 0) {
		return companyName;
	}
	return `${proposalName} (empresa no identificada)`;
}

export function getShortDisplayName(
	companyName: string | null,
	proposalName: string,
): string {
	if (companyName && companyName.trim().length > 0) {
		return companyName.length > 30
			? `${companyName.substring(0, 27)}...`
			: companyName;
	}

	const shortName =
		proposalName.length > 20
			? `${proposalName.substring(0, 17)}...`
			: proposalName;
	return `${shortName} (no identificada)`;
}

export function hasCompanyInfo(evaluation: LotEvaluation): boolean {
	return (
		evaluation.companyName !== null && evaluation.companyName.trim().length > 0
	);
}

export function getCompanyNameOrDefault(
	companyName: string | null,
	defaultText: string = 'Empresa no especificada',
): string {
	return companyName && companyName.trim().length > 0
		? companyName
		: defaultText;
}
