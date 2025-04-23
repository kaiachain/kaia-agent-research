const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Gemini client with default configs
let genAI = null;

// Initialize Gemini API
function initializeGemini(apiKey) {
  if (!apiKey) {
    console.log('Gemini API key not configured');
    return false;
  }
  
  genAI = new GoogleGenerativeAI(apiKey);
  return true;
}

// Function to get summary using Gemini
async function getSummaryFromGemini(title, body) {
  try {
    if (!genAI) {
      throw new Error('Gemini API not initialized');
    }
    
    // Initialize with specific model configuration
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.0-flash-lite",
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 1024,
      },
    });
    
    const prompt = `
Summarize this Delphi Digital report directly without any introductory phrases.
Title: ${title}

Content:
${body}

Your response MUST follow this exact format:
1. A direct, concise summary of the report's main points in 1-2 sentences (max 160 characters).

2. A brief one-liner explaining why this research/topic is relevant to the Kaia ecosystem and technology stack.

Format your response exactly as:
[Main summary of the report]

Relevance: [How this relates to Kaia]

Do not use phrases like "Here's a summary" or "This report discusses". Start directly with the core information.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('Error getting summary from Gemini:', error);
    return null;
  }
}

/**
 * Placeholder function to simulate summarizing report content.
 * @param {string} content - The content of the report (unused in stub).
 * @returns {Promise<string>} A placeholder summary.
 */
async function summarizeContent(content) {
  console.log("--- (Stub) Summarizing content... ---");
  // In a real implementation, this would call the AI/summarization logic
  await new Promise(resolve => setTimeout(resolve, 50)); // Simulate async work
  return "This is a stub summary.";
}

module.exports = {
  initializeGemini,
  getSummaryFromGemini,
  summarizeContent
}; 

