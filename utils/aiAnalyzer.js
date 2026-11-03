const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const { calculateTheoreticalValue, getExchangeRate } = require('./currencyConverter');

const ANALYSIS_MODEL = 'claude-opus-4-8';

let anthropic = null;

function getAnthropic() {
  if (!anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('Anthropic API key not configured. Please set ANTHROPIC_API_KEY environment variable.');
    }
    anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return anthropic;
}

/**
 * Analyzes an uploaded document to determine investment/expense type
 * @param {string} filePath - Path to the uploaded file
 * @param {string} fileType - MIME type of the file
 * @returns {Promise<Object>} Analysis results with suggested title, amount, type, etc.
 */
async function analyzeDocument(filePath, fileType) {
  try {
    let analysisResult;

    if (fileType === 'application/pdf') {
      // For PDFs, we'll need to convert to image or extract text
      // For now, we'll use a text-based approach
      analysisResult = await analyzePDF(filePath);
    } else if (fileType.startsWith('image/')) {
      // For images (JPG, PNG), use Vision API
      analysisResult = await analyzeImage(filePath);
    } else {
      throw new Error('Unsupported file type');
    }

    // Enhance analysis result with investment calculations
    if (analysisResult && analysisResult.suggestedAmount && analysisResult.currency) {
      const investmentCalc = calculateTheoreticalValue(
        analysisResult.suggestedAmount,
        analysisResult.currency,
        2.8 // Default risk multiplier as per user's example
      );
      
      analysisResult.investmentCalculation = investmentCalc;
      analysisResult.suggestedRiskMultiplier = 2.8;
      analysisResult.suggestedExchangeRate = investmentCalc.exchangeRate;
    }

    return analysisResult;
  } catch (error) {
    console.error('Document analysis error:', error);
    throw new Error('Failed to analyze document');
  }
}

/**
 * Analyzes an image using Claude's vision capability
 */
async function analyzeImage(imagePath) {
  try {
    // Read the image file and convert to base64
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');

    // Derive the media type from the file extension (don't assume JPEG)
    const ext = path.extname(imagePath).toLowerCase();
    const mediaType = ext === '.png' ? 'image/png'
      : ext === '.gif' ? 'image/gif'
      : ext === '.webp' ? 'image/webp'
      : 'image/jpeg';

    const response = await getAnthropic().messages.create({
      model: ANALYSIS_MODEL,
      max_tokens: 1000,
      temperature: 0.1,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analyze this document and determine what type of investment or expense it represents.

Please provide a JSON response with the following structure:
{
  "type": "expense" | "investment" | "invoice" | "receipt" | "contract" | "other",
  "category": "travel", "office_supplies", "software", "equipment", "consulting", "marketing", etc.
  "suggestedTitle": "Brief descriptive title",
  "suggestedAmount": number or null if not clear,
  "currency": "USD" | "CAD" | "EUR" | "GBP" etc. (detected currency),
  "confidence": 0.0-1.0,
  "description": "What you see in the document",
  "extractedText": "Key text extracted from the document",
  "tags": ["tag1", "tag2", "tag3"]
}

Focus on identifying:
- Is this a business expense, investment, invoice, receipt, or contract?
- What is the monetary amount and currency (look for $, C$, CAD, USD, etc.)?
- What category does this fall under?
- What would be a good title for this deliverable?
- If amounts are in non-USD currency, note the currency but keep the amount as-is

Be especially careful to detect Canadian dollars (C$, CAD) vs US dollars (USD, $).`
            },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: base64Image
              }
            }
          ]
        }
      ]
    });

    const analysisText = response.content[0].text;

    // Try to parse JSON from the response
    try {
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', parseError);
    }

    // Fallback: create a structured response from the text
    return {
      type: 'other',
      category: 'unknown',
      suggestedTitle: 'Document Analysis',
      suggestedAmount: null,
      currency: 'USD',
      confidence: 0.5,
      description: analysisText,
      extractedText: analysisText,
      tags: ['ai-analyzed']
    };

  } catch (error) {
    console.error('Image analysis error:', error);
    throw error;
  }
}

/**
 * Analyzes a PDF by extracting text and processing with AI
 */
async function analyzePDF(pdfPath) {
  try {
    // Extract text from PDF
    const pdfBuffer = fs.readFileSync(pdfPath);
    const pdfData = await pdfParse(pdfBuffer);
    const extractedText = pdfData.text;

    if (!extractedText || extractedText.trim().length === 0) {
      // If no text could be extracted, return a fallback
      return {
        type: 'document',
        category: 'manual-review',
        suggestedTitle: 'PDF Document - Text Extraction Failed',
        suggestedAmount: null,
        confidence: 0.1,
        description: 'Could not extract text from PDF - manual review required',
        extractedText: 'No text could be extracted from this PDF',
        tags: ['pdf', 'manual-review', 'extraction-failed']
      };
    }

    // Analyze the extracted text with AI
    const response = await getAnthropic().messages.create({
      model: ANALYSIS_MODEL,
      max_tokens: 1000,
      temperature: 0.1,
      messages: [
        {
          role: "user",
          content: `Analyze this extracted PDF text and determine what type of investment or expense it represents.

PDF Text Content:
"""
${extractedText}
"""

Please provide a JSON response with the following structure:
{
  "type": "expense" | "investment" | "invoice" | "receipt" | "contract" | "other",
  "category": "travel", "office_supplies", "software", "equipment", "consulting", "marketing", etc.
  "suggestedTitle": "Brief descriptive title",
  "suggestedAmount": number or null if not clear,
  "currency": "USD" | "CAD" | "EUR" | "GBP" etc. (detected currency),
  "confidence": 0.0-1.0,
  "description": "What this document represents",
  "extractedText": "Key relevant text from the document",
  "tags": ["tag1", "tag2", "tag3"]
}

Focus on identifying:
- Is this a business expense, investment, invoice, receipt, or contract?
- What is the monetary amount and currency (look for $, C$, CAD, USD, etc.)?
- What category does this fall under?
- What would be a good title for this deliverable?
- If amounts are in non-USD currency, note the currency but keep the amount as-is

Be especially careful to detect Canadian dollars (C$, CAD) vs US dollars (USD, $).`
        }
      ]
    });

    const analysisText = response.content[0].text;

    // Try to parse JSON from the response
    try {
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        
        // Ensure we include the full extracted text for reference
        result.extractedText = extractedText.length > 500 
          ? extractedText.substring(0, 500) + '...' 
          : extractedText;
          
        return result;
      }
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', parseError);
    }

    // Fallback: create a structured response from the text
    return {
      type: 'document',
      category: 'unknown',
      suggestedTitle: 'PDF Document Analysis',
      suggestedAmount: null,
      currency: 'USD',
      confidence: 0.5,
      description: analysisText,
      extractedText: extractedText.length > 500 
        ? extractedText.substring(0, 500) + '...' 
        : extractedText,
      tags: ['pdf', 'ai-analyzed']
    };

  } catch (error) {
    console.error('PDF analysis error:', error);
    throw error;
  }
}

module.exports = {
  analyzeDocument
};