// Advanced PDF Generator with Puppeteer
// File: src/utils/advancedPdfGenerator.ts

import puppeteer from 'puppeteer';
import { EvaluationResult } from '../types';
import logger from './logger';

interface PDFGenerationOptions {
	tenderTitle: string;
	proposalName: string;
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

const DEFAULT_COMPANY_INFO = {
	name: 'OPTIMPEOPLE S.L.',
	website: 'www.optimpeople.com',
	address: 'c/Doctor Letamendi, 29, baixos 1a',
	city: '08031 Barcelona',
	taxId: 'B67585539',
	phone: '+34 650 891 296',
};

export async function generateEvaluationPDF(
	evaluationResult: EvaluationResult,
	options: PDFGenerationOptions,
): Promise<Buffer> {
	const browser = await puppeteer.launch({
		headless: true,
		args: ['--no-sandbox', '--disable-setuid-sandbox'],
	});

	try {
		const page = await browser.newPage();

		// Set up the HTML content
		const htmlContent = generateHTMLContent(evaluationResult, options);

		await page.setContent(htmlContent, {
			waitUntil: 'networkidle0',
		});

		// Generate PDF with custom options
		const pdfData = await page.pdf({
			format: 'A4',
			margin: {
				top: '2cm',
				right: '1.5cm',
				bottom: '3cm',
				left: '1.5cm',
			},
			printBackground: true,
			displayHeaderFooter: true,
			headerTemplate: generateHeaderTemplate(options.logoUrl),
			footerTemplate: generateFooterTemplate(
				options.companyInfo || DEFAULT_COMPANY_INFO,
			),
		});

		// Convert Uint8Array to Buffer
		const pdfBuffer = Buffer.from(pdfData);

		return pdfBuffer;
	} finally {
		await browser.close();
	}
}

function generateHeaderTemplate(logoUrl?: string): string {
	if (!logoUrl) {
		return `
			<div style="width: 100%; height: 60px; display: flex; justify-content: center; align-items: center; margin: 0; padding: 0;">
				<div style="background: linear-gradient(135deg, #00b894 0%, #00a085 100%); color: white; padding: 10px 20px; border-radius: 5px; font-family: Arial, sans-serif; font-size: 14px; font-weight: bold;">
					OPTIMPEOPLE - Informe d'Avaluació
				</div>
			</div>
		`;
	}

	return `
		<div style="width: 100%; height: 60px; display: flex; justify-content: center; align-items: center; margin: 0; padding: 0;">
			<img src="${logoUrl}" style="height: 50px; max-width: 200px; object-fit: contain;" />
		</div>
	`;
}

function generateFooterTemplate(
	companyInfo: typeof DEFAULT_COMPANY_INFO,
): string {
	return `
		<div style="width: 100%; font-size: 10px; color: #666; text-align: center; border-top: 1px solid #ddd; padding-top: 10px; margin-top: 20px; line-height: 1.4;">
			<div><strong>${companyInfo.name}</strong> &nbsp;&nbsp;&nbsp; ${companyInfo.website}</div>
			<div>${companyInfo.address} &nbsp; ${companyInfo.city} &nbsp;&nbsp;&nbsp; ${companyInfo.taxId} &nbsp;&nbsp;&nbsp; ${companyInfo.phone}</div>
		</div>
	`;
}

function generateHTMLContent(
	evaluationResult: EvaluationResult,
	options: PDFGenerationOptions,
): string {
	const currentDate = new Date().toLocaleDateString('ca-ES', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	});

	const totalCriteria = evaluationResult.criteria.length;
	const excellentScores = evaluationResult.criteria.filter(
		(c) => c.score === 'COMPLEIX_EXITOSAMENT',
	).length;
	const regularScores = evaluationResult.criteria.filter(
		(c) => c.score === 'REGULAR',
	).length;
	const insufficientScores = evaluationResult.criteria.filter(
		(c) => c.score === 'INSUFICIENT',
	).length;

	return `
<!DOCTYPE html>
<html lang="ca">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Informe d'Avaluació - ${options.tenderTitle}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            background: white;
        }

        .container {
            max-width: 100%;
            margin: 0 auto;
            padding: 20px;
        }

        .header-space {
            height: 80px;
            margin-bottom: 30px;
        }

        .title-section {
            text-align: center;
            margin-bottom: 40px;
            padding: 25px;
            background: linear-gradient(135deg, #00b894 0%, #00a085 100%);
            color: white;
            border-radius: 10px;
            box-shadow: 0 4px 15px rgba(0, 184, 148, 0.3);
        }

        .title-section h1 {
            font-size: 32px;
            font-weight: 300;
            margin-bottom: 15px;
            letter-spacing: -0.5px;
        }

        .title-section .subtitle {
            font-size: 18px;
            opacity: 0.9;
            margin: 8px 0;
            font-weight: 300;
        }

        .info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 25px;
            margin-bottom: 40px;
        }

        .info-card {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            border-left: 5px solid #00b894;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }

        .info-card h3 {
            color: #00b894;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 12px;
            font-weight: 600;
        }

        .info-card p {
            font-size: 16px;
            font-weight: 500;
            color: #2d3748;
        }

        .summary-stats {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 20px;
            margin: 40px 0;
        }

        .stat-card {
            text-align: center;
            padding: 20px;
            background: white;
            border-radius: 10px;
            border: 1px solid #e2e8f0;
            box-shadow: 0 2px 10px rgba(0,0,0,0.08);
            transition: transform 0.2s ease;
        }

        .stat-number {
            font-size: 28px;
            font-weight: bold;
            color: #00b894;
            margin-bottom: 5px;
        }

        .stat-label {
            font-size: 12px;
            color: #718096;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            font-weight: 500;
        }

        .section {
            margin-bottom: 50px;
            page-break-inside: avoid;
        }

        .section-title {
            color: #00b894;
            border-bottom: 3px solid #00b894;
            padding-bottom: 12px;
            margin-bottom: 30px;
            font-size: 24px;
            font-weight: 600;
            letter-spacing: -0.3px;
        }

        .executive-summary {
            background: linear-gradient(145deg, #f7fafc 0%, #edf2f7 100%);
            padding: 30px;
            border-radius: 12px;
            border-left: 6px solid #00b894;
            margin-bottom: 30px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }

        .executive-summary h3 {
            color: #00b894;
            margin-bottom: 20px;
            font-size: 20px;
        }

        .executive-summary p {
            margin-bottom: 15px;
            text-align: justify;
            font-size: 15px;
            line-height: 1.7;
        }

        .confidence-indicator {
            display: flex;
            align-items: center;
            gap: 15px;
            margin: 25px 0;
            padding: 15px;
            background: white;
            border-radius: 8px;
            border: 1px solid #e2e8f0;
        }

        .confidence-bar {
            flex: 1;
            height: 12px;
            background: #e2e8f0;
            border-radius: 6px;
            overflow: hidden;
            position: relative;
        }

        .confidence-fill {
            height: 100%;
            background: linear-gradient(90deg, #dc3545 0%, #ffc107 50%, #28a745 100%);
            border-radius: 6px;
        }

        .confidence-text {
            font-weight: 600;
            font-size: 16px;
            color: #2d3748;
            min-width: 70px;
        }

        .recommendation {
            padding: 25px;
            border-radius: 10px;
            margin: 30px 0;
            border-left: 6px solid #28a745;
            background: linear-gradient(145deg, #f0fff4 0%, #dcfce7 100%);
        }

        .recommendation.warning {
            background: linear-gradient(145deg, #fffbeb 0%, #fef3c7 100%);
            border-left-color: #f59e0b;
        }

        .recommendation.danger {
            background: linear-gradient(145deg, #fef2f2 0%, #fecaca 100%);
            border-left-color: #ef4444;
        }

        .recommendation h3 {
            margin-bottom: 15px;
            font-size: 18px;
            color: #1a202c;
        }

        .recommendation p {
            font-size: 15px;
            line-height: 1.6;
            text-align: justify;
        }

        .criteria-section {
            margin-bottom: 40px;
        }

        .criterion {
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            margin-bottom: 30px;
            overflow: hidden;
            box-shadow: 0 4px 12px rgba(0,0,0,0.08);
            page-break-inside: avoid;
        }

        .criterion-header {
            padding: 20px 25px;
            background: linear-gradient(135deg, #00b894 0%, #00a085 100%);
            color: white;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .criterion-name {
            font-weight: 600;
            font-size: 17px;
            flex: 1;
            line-height: 1.4;
        }

        .criterion-score {
            padding: 8px 16px;
            border-radius: 25px;
            font-weight: bold;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-left: 20px;
        }

        .score-excellent {
            background: #10b981;
            color: white;
            box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);
        }

        .score-regular {
            background: #f59e0b;
            color: white;
            box-shadow: 0 2px 8px rgba(245, 158, 11, 0.3);
        }

        .score-insufficient {
            background: #ef4444;
            color: white;
            box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3);
        }

        .criterion-content {
            padding: 25px;
        }

        .justification {
            margin-bottom: 25px;
            text-align: justify;
            font-size: 14px;
            line-height: 1.7;
            color: #374151;
        }

        .justification strong {
            color: #1f2937;
        }

        .points-section {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 25px;
            margin-bottom: 20px;
        }

        .points-card {
            background: #f9fafb;
            padding: 20px;
            border-radius: 8px;
            border: 1px solid #e5e7eb;
        }

        .points-card.strengths {
            border-left: 4px solid #10b981;
            background: linear-gradient(145deg, #ecfdf5 0%, #d1fae5 100%);
        }

        .points-card.improvements {
            border-left: 4px solid #f59e0b;
            background: linear-gradient(145deg, #fffbeb 0%, #fef3c7 100%);
        }

        .points-card h4 {
            margin-bottom: 12px;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            font-weight: 600;
        }

        .points-card.strengths h4 {
            color: #047857;
        }

        .points-card.improvements h4 {
            color: #92400e;
        }

        .points-list {
            margin: 0;
            padding-left: 18px;
            list-style-type: disc;
        }

        .points-list li {
            margin-bottom: 8px;
            font-size: 13px;
            line-height: 1.5;
            color: #374151;
        }

        .references {
            background: #f3f4f6;
            padding: 15px 20px;
            border-radius: 6px;
            font-size: 12px;
            color: #6b7280;
            border-left: 3px solid #9ca3af;
        }

        .references strong {
            color: #374151;
        }

        .page-break {
            page-break-before: always;
        }

        .footer-space {
            height: 100px;
            margin-top: 50px;
        }

        @media print {
            .page-break {
                page-break-before: always;
            }
            
            .criterion {
                page-break-inside: avoid;
            }
            
            .section {
                page-break-inside: avoid;
            }
        }
    </style>
</head>
<body>
    <div class="header-space"></div>
    
    <div class="container">
        <div class="title-section">
            <h1>Informe d'Avaluació de Licitació</h1>
            <div class="subtitle">${options.tenderTitle}</div>
            <div class="subtitle">Data: ${currentDate}</div>
        </div>

        <div class="info-grid">
            <div class="info-card">
                <h3>Proposta Avaluada</h3>
                <p>${options.proposalName}</p>
            </div>
            <div class="info-card">
                <h3>Criteris Analitzats</h3>
                <p>${totalCriteria} criteris subjectius</p>
            </div>
        </div>

        <div class="summary-stats">
            <div class="stat-card">
                <div class="stat-number">${totalCriteria}</div>
                <div class="stat-label">Total Criteris</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${excellentScores}</div>
                <div class="stat-label">Compleix Exitosament</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${regularScores}</div>
                <div class="stat-label">Regular</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${insufficientScores}</div>
                <div class="stat-label">Insuficient</div>
            </div>
        </div>

        <div class="section">
            <h2 class="section-title">Resum Executiu</h2>
            <div class="executive-summary">
                <h3>Síntesi de l'Avaluació</h3>
                ${evaluationResult.summary
									.split('\n')
									.map((paragraph) =>
										paragraph.trim() ? `<p>${paragraph}</p>` : '',
									)
									.join('')}
                
                <div class="confidence-indicator">
                    <span><strong>Nivell de confiança de l'avaluació:</strong></span>
                    <div class="confidence-bar">
                        <div class="confidence-fill" style="width: ${evaluationResult.confidence * 100}%"></div>
                    </div>
                    <span class="confidence-text">${Math.round(evaluationResult.confidence * 100)}%</span>
                </div>
            </div>

            <div class="recommendation ${getRecommendationClass(evaluationResult)}">
                <h3>Recomanació Final</h3>
                <p>${evaluationResult.recommendation}</p>
            </div>
        </div>

        <div class="page-break"></div>

        <div class="section">
            <h2 class="section-title">Avaluació Detallada per Criteris</h2>
            <div class="criteria-section">
                ${evaluationResult.criteria
									.map(
										(criterion) => `
                    <div class="criterion">
                        <div class="criterion-header">
                            <div class="criterion-name">${criterion.criterion}</div>
                            <div class="criterion-score ${getScoreClass(criterion.score)}">
                                ${getScoreLabel(criterion.score)}
                            </div>
                        </div>
                        <div class="criterion-content">
                            <div class="justification">
                                <strong>Justificació:</strong> ${criterion.justification}
                            </div>
                            
                            <div class="points-section">
                                <div class="points-card strengths">
                                    <h4>Punts Forts</h4>
                                    <ul class="points-list">
                                        ${criterion.strengths.map((strength) => `<li>${strength}</li>`).join('')}
                                    </ul>
                                </div>
                                <div class="points-card improvements">
                                    <h4>Àrees de Millora</h4>
                                    <ul class="points-list">
                                        ${criterion.improvements.map((improvement) => `<li>${improvement}</li>`).join('')}
                                    </ul>
                                </div>
                            </div>
                            
                            <div class="references">
                                <strong>Referències consultades:</strong> ${criterion.references.join(' • ')}
                            </div>
                        </div>
                    </div>
                `,
									)
									.join('')}
            </div>
        </div>

        <div class="footer-space"></div>
    </div>
</body>
</html>
    `;
}

function getScoreClass(score: string): string {
	switch (score) {
		case 'COMPLEIX_EXITOSAMENT':
			return 'score-excellent';
		case 'REGULAR':
			return 'score-regular';
		case 'INSUFICIENT':
			return 'score-insufficient';
		default:
			return 'score-regular';
	}
}

function getScoreLabel(score: string): string {
	switch (score) {
		case 'COMPLEIX_EXITOSAMENT':
			return 'Compleix Exitosament';
		case 'REGULAR':
			return 'Regular';
		case 'INSUFICIENT':
			return 'Insuficient';
		default:
			return 'Regular';
	}
}

function getRecommendationClass(evaluationResult: EvaluationResult): string {
	const excellent = evaluationResult.criteria.filter(
		(c) => c.score === 'COMPLEIX_EXITOSAMENT',
	).length;
	const insufficient = evaluationResult.criteria.filter(
		(c) => c.score === 'INSUFICIENT',
	).length;
	const total = evaluationResult.criteria.length;

	if (insufficient > 0) return 'danger';
	if (excellent / total >= 0.7) return '';
	return 'warning';
}

// Route handler helper function
export async function generatePDFResponse(
	evaluationResult: EvaluationResult,
	options: PDFGenerationOptions,
): Promise<{
	buffer: Buffer;
	filename: string;
	contentType: string;
	size: number;
}> {
	try {
		logger.info('📄 Iniciando generación de PDF...');

		const pdfBuffer = await generateEvaluationPDF(evaluationResult, options);

		// Sanitize the title for filename
		const sanitizedTitle = options.tenderTitle
			.replace(/[^a-zA-Z0-9\s-_]/g, '') // Remove special characters except spaces, hyphens, and underscores
			.replace(/\s+/g, '-') // Replace spaces with hyphens
			.toLowerCase()
			.substring(0, 50); // Limit length

		const timestamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD format
		const filename = `informe-avaluacio-${sanitizedTitle}-${timestamp}.pdf`;

		logger.info(
			`✅ PDF generado exitosamente: ${filename} (${pdfBuffer.length} bytes)`,
		);

		return {
			buffer: pdfBuffer,
			filename,
			contentType: 'application/pdf',
			size: pdfBuffer.length,
		};
	} catch (error) {
		logger.error('❌ Error generando PDF:', error);
		throw new Error(
			`Error generando PDF: ${error instanceof Error ? error.message : 'Error desconocido'}`,
		);
	}
}
