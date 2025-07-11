export interface FileContent {
	name: string;
	content: string;
	type: 'specification' | 'proposal';
}

export interface EvaluationCriteria {
	criterion: string;
	score: 'INSUFICIENT' | 'REGULAR' | 'COMPLEIX_EXITOSAMENT';
	justification: string;
	strengths: string[];
	improvements: string[];
	references: string[];
}

export interface EvaluationResult {
	summary: string;
	criteria: EvaluationCriteria[];
	recommendation: string;
	confidence: number;
	extractedCriteria: string[];
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

export interface EvaluationRequest {
	specifications: FileContent[];
	proposals: FileContent[];
}

export interface EvaluationPDFRequest extends EvaluationRequest {
	tenderTitle?: string;
	logoUrl?: string;
	companyInfo?: {
		name: string;
		website: string;
		address: string;
		city: string;
		taxId: string;
		phone: string;
	};
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

export interface PDFGenerationConfig {
	headerImageUrl?: string;
	companyInfo: {
		name: string;
		website: string;
		address: string;
		city: string;
		taxId: string;
		phone: string;
	};
}

export interface PDFGenerationResult {
	buffer: Buffer;
	filename: string;
	contentType: string;
	size: number;
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
	pdfGenerationSchema: any;
}
