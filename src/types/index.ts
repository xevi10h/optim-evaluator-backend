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

export type SupportedFileType = (typeof SUPPORTED_FILE_TYPES)[number];
export type EvaluationScore = keyof typeof EVALUATION_SCORES;
