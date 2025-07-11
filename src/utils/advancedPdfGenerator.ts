import puppeteer from 'puppeteer';
import { EvaluationResult } from '../types';
import logger from './logger';
import { OPTIMPEOPLE_LOGO_BASE64 } from './logo';

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
				top: '2.5cm',
				right: '1.5cm',
				bottom: '2.5cm',
				left: '1.5cm',
			},
			printBackground: true,
			displayHeaderFooter: false, // Usaremos header/footer integrados en el HTML
		});

		// Convert Uint8Array to Buffer
		const pdfBuffer = Buffer.from(pdfData);

		return pdfBuffer;
	} finally {
		await browser.close();
	}
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

	const logoSrc = options.logoUrl || OPTIMPEOPLE_LOGO_BASE64;
	const companyInfo = options.companyInfo || DEFAULT_COMPANY_INFO;

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
            font-family: Arial, sans-serif;
            line-height: 1.4;
            color: #333;
            background: white;
            font-size: 12px;
        }

        .page {
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }

        .header {
            display: flex;
            justify-content: flex-end;
            align-items: center;
            padding: 20px 0;
            margin-bottom: 30px;
        }

        .logo {
            height: 50px;
            max-width: 200px;
        }

        .document-title {
            text-align: left;
            margin-bottom: 30px;
        }

        .document-title h1 {
            font-size: 16px;
            font-weight: bold;
            text-transform: uppercase;
            margin-bottom: 20px;
            letter-spacing: 0.5px;
        }

        .content {
            flex: 1;
            margin-bottom: 40px;
        }

        .intro-text {
            margin-bottom: 20px;
            text-align: justify;
            line-height: 1.5;
        }

        .intro-text p {
            margin-bottom: 15px;
        }

        .criteria-flow {
            margin: 25px 0;
            padding-left: 20px;
        }

        .criteria-flow h3 {
            font-size: 12px;
            margin-bottom: 15px;
            font-weight: bold;
        }

        .flow-steps {
            margin-left: 0;
            padding-left: 0;
            counter-reset: step-counter;
        }

        .flow-step {
            list-style: none;
            margin-bottom: 15px;
            counter-increment: step-counter;
            position: relative;
            padding-left: 25px;
        }

        .flow-step::before {
            content: counter(step-counter) ")";
            position: absolute;
            left: 0;
            font-weight: bold;
        }

        .sub-criteria {
            margin: 10px 0 10px 20px;
            list-style: none;
        }

        .sub-criteria li {
            margin-bottom: 5px;
            position: relative;
            padding-left: 15px;
        }

        .sub-criteria li::before {
            content: "-";
            position: absolute;
            left: 0;
            font-weight: bold;
        }

        .evaluation-section {
            margin-top: 40px;
            page-break-before: auto;
        }

        .evaluation-title {
            font-size: 16px;
            font-weight: bold;
            text-transform: uppercase;
            margin-bottom: 30px;
            color: #333;
            border-bottom: 2px solid #ddd;
            padding-bottom: 10px;
        }

        .tender-info {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 30px;
            border-left: 4px solid #00b894;
        }

        .tender-info h3 {
            color: #00b894;
            margin-bottom: 10px;
            font-size: 14px;
        }

        .tender-info p {
            margin-bottom: 8px;
        }

        .criteria-evaluation {
            margin-top: 30px;
        }

        .criterion-item {
            margin-bottom: 35px;
            page-break-inside: avoid;
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            overflow: hidden;
        }

        .criterion-header {
            background: linear-gradient(135deg, #00b894 0%, #00a085 100%);
            color: white;
            padding: 15px 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .criterion-name {
            font-weight: bold;
            font-size: 14px;
            flex: 1;
        }

        .criterion-score {
            background: rgba(255,255,255,0.2);
            padding: 6px 12px;
            border-radius: 15px;
            font-size: 11px;
            font-weight: bold;
            text-transform: uppercase;
        }

        .criterion-content {
            padding: 20px;
            background: white;
        }

        .justification {
            margin-bottom: 20px;
            text-align: justify;
            line-height: 1.6;
        }

        .justification strong {
            color: #2c3e50;
        }

        .points-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 15px;
        }

        .points-section {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 6px;
            border-left: 4px solid;
        }

        .points-section.strengths {
            border-left-color: #28a745;
            background: #f8fff9;
        }

        .points-section.improvements {
            border-left-color: #ffc107;
            background: #fffef7;
        }

        .points-section h4 {
            font-size: 12px;
            margin-bottom: 10px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            font-weight: bold;
        }

        .points-section.strengths h4 {
            color: #155724;
        }

        .points-section.improvements h4 {
            color: #856404;
        }

        .points-list {
            list-style: none;
            margin: 0;
            padding: 0;
        }

        .points-list li {
            margin-bottom: 6px;
            padding-left: 15px;
            position: relative;
            font-size: 11px;
            line-height: 1.4;
        }

        .points-list li::before {
            content: "•";
            position: absolute;
            left: 0;
            font-weight: bold;
        }

        .references {
            background: #f1f3f4;
            padding: 12px 15px;
            border-radius: 4px;
            font-size: 10px;
            color: #5f6368;
            border-left: 3px solid #9aa0a6;
            margin-top: 15px;
        }

        .references strong {
            color: #3c4043;
        }

        .summary-section {
            margin-top: 40px;
            background: #f7f9fc;
            padding: 25px;
            border-radius: 10px;
            border-left: 6px solid #00b894;
        }

        .summary-section h3 {
            color: #00b894;
            margin-bottom: 15px;
            font-size: 15px;
        }

        .summary-text {
            line-height: 1.6;
            text-align: justify;
            margin-bottom: 15px;
        }

        .recommendation {
            background: #e8f5e8;
            padding: 15px;
            border-radius: 6px;
            border-left: 4px solid #28a745;
            margin-top: 20px;
        }

        .recommendation.warning {
            background: #fff8e1;
            border-left-color: #ffc107;
        }

        .recommendation.danger {
            background: #ffebee;
            border-left-color: #dc3545;
        }

        .recommendation strong {
            display: block;
            margin-bottom: 8px;
            color: #2c3e50;
        }

        .footer {
            margin-top: auto;
            padding-top: 30px;
            border-top: 1px solid #ddd;
            text-align: center;
            font-size: 10px;
            color: #666;
            line-height: 1.4;
        }

        .footer .company-name {
            font-weight: bold;
        }

        .page-break {
            page-break-before: always;
        }

        @media print {
            .page-break {
                page-break-before: always;
            }
            
            .criterion-item {
                page-break-inside: avoid;
            }
        }
    </style>
</head>
<body>
    <div class="page">
        <!-- Header with logo -->
        <div class="header">
            <img src="${logoSrc}" alt="OptimPeople Logo" class="logo" />
        </div>

        <!-- Main content -->
        <div class="content">
            <!-- Document title -->
            <div class="document-title">
                <h1>Informe d'Avaluació de Proposta de Licitació</h1>
            </div>

            <!-- Introduction text -->
            <div class="intro-text">
                <p>De moment l'eina es limita a l'avaluació de criteris de valoració subjectiva.</p>
                
                <div class="criteria-flow">
                    <h3>Aquest és el flux de cerca dels apartats que contenen els criteris de valoració subjectiva:</h3>
                    
                    <ol class="flow-steps">
                        <li class="flow-step">
                            Habitualment, és en els plecs administratius on hi ha els criteris de valoració
                        </li>
                        <li class="flow-step">
                            En algunes ocasions, només hi ha un únic plec que agrupa plec tècnic + plec administratiu. En aquest cas, trobarem els criteris de valoració en aquest únic document
                        </li>
                        <li class="flow-step">
                            Cal analitzar primer si el plec administratiu disposa d'un apartat anomenat "Quadre de característiques...". És una mena d'annex on s'especifica allò important per a les empreses licitants, i sovint incorpora els criteris de valoració. Però no sempre.
                        </li>
                        <li class="flow-step">
                            Tan si és dins del "Quadre de característiques..." com si és en el cos del plec administratiu o document únic, hem d'anar a buscar conceptes com:
                            <ul class="sub-criteria">
                                <li>Criteris de valoració</li>
                                <li>Criteris d'adjudicació</li>
                                <li>Criteris de puntuació</li>
                                <li>Ponderació de l'oferta</li>
                                <li>Mètode d'avaluació</li>
                                <li>etc.</li>
                            </ul>
                        </li>
                        <li class="flow-step">
                            Un cop identificat l'apartat on hi ha aquests criteris, el sistema ha de fixar-se en:
                            <ul class="sub-criteria">
                                <li>Criteris subjectius</li>
                                <li>Criteris avaluables segons judici de valor</li>
                                <li>Criteris no automàtics</li>
                                <li>Etc.</li>
                            </ul>
                        </li>
                    </ol>
                </div>

                <p>Què cal tenir en compte: que l'oferta ha de respondre al què es demana al plec tècnic. És a dir, la valoració de la bona o mala oferta es fa en base a si aquesta respon adequadament a l'objecte del contracte i a les tasques que cal fer en el marc del contracte.</p>
            </div>

            <!-- Evaluation section -->
            <div class="evaluation-section">
                <h2 class="evaluation-title">Avaluació de la Proposta</h2>
                
                <!-- Tender information -->
                <div class="tender-info">
                    <h3>Informació de la Licitació</h3>
                    <p><strong>Títol:</strong> ${options.tenderTitle}</p>
                    <p><strong>Proposta avaluada:</strong> ${options.proposalName}</p>
                    <p><strong>Data d'avaluació:</strong> ${currentDate}</p>
                    <p><strong>Criteris analitzats:</strong> ${evaluationResult.criteria.length} criteris subjectius</p>
                </div>

                <!-- Criteria evaluation -->
                <div class="criteria-evaluation">
                    ${evaluationResult.criteria
											.map(
												(criterion) => `
                        <div class="criterion-item">
                            <div class="criterion-header">
                                <div class="criterion-name">${criterion.criterion}</div>
                                <div class="criterion-score">${getScoreLabel(criterion.score)}</div>
                            </div>
                            <div class="criterion-content">
                                <div class="justification">
                                    <strong>Avaluació:</strong> ${criterion.justification}
                                </div>
                                
                                <div class="points-grid">
                                    <div class="points-section strengths">
                                        <h4>Punts Forts</h4>
                                        <ul class="points-list">
                                            ${criterion.strengths.map((strength) => `<li>${strength}</li>`).join('')}
                                        </ul>
                                    </div>
                                    <div class="points-section improvements">
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

                <!-- Summary section -->
                <div class="summary-section">
                    <h3>Resum Executiu</h3>
                    <div class="summary-text">
                        ${evaluationResult.summary
													.split('\n')
													.map((paragraph) =>
														paragraph.trim() ? `<p>${paragraph}</p>` : '',
													)
													.join('')}
                    </div>
                    
                    <div class="recommendation ${getRecommendationClass(evaluationResult)}">
                        <strong>Recomanació Final:</strong>
                        ${evaluationResult.recommendation}
                    </div>
                </div>
            </div>
        </div>

        <!-- Footer -->
        <div class="footer">
            <div class="company-name">${companyInfo.name}</div>
            <div>${companyInfo.website}</div>
            <div>${companyInfo.address} ${companyInfo.city} &nbsp;&nbsp;&nbsp;&nbsp; ${companyInfo.taxId} &nbsp;&nbsp;&nbsp;&nbsp; ${companyInfo.phone}</div>
        </div>
    </div>
</body>
</html>
    `;
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
		logger.info('📄 Iniciando generación de PDF con formato OptimPeople...');

		const pdfBuffer = await generateEvaluationPDF(evaluationResult, options);

		// Sanitize the title for filename
		const sanitizedTitle = options.tenderTitle
			.replace(/[^a-zA-Z0-9\s-_]/g, '') // Remove special characters except spaces, hyphens, and underscores
			.replace(/\s+/g, '-') // Replace spaces with hyphens
			.toLowerCase()
			.substring(0, 50); // Limit length

		const timestamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD format
		const filename = `optimpeople-informe-avaluacio-${sanitizedTitle}-${timestamp}.pdf`;

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
