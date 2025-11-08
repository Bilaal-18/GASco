const { GoogleGenerativeAI } = require("@google/generative-ai");

const translationCtrl = {};

// Initialize Gemini AI with fallback models
const getGeminiModel = (preferredModel = null) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  // Try preferred model first, then fallback to faster models
  const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({ model: modelName });
};

// Retry function with exponential backoff
const retryWithBackoff = async (fn, maxRetries = 3, initialDelay = 1000) => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isLastAttempt = attempt === maxRetries - 1;
      const isOverloadError = error.status === 503 || error.message?.includes("overloaded");
      
      if (isLastAttempt || !isOverloadError) {
        throw error;
      }
      
      // Exponential backoff: 1s, 2s, 4s
      const delay = initialDelay * Math.pow(2, attempt);
      console.log(`Model overloaded, retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

// Translate Manglish to English
translationCtrl.translateManglishToEnglish = async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Text is required" });
    }

    const prompt = `You are a translation assistant for a Gas Booking customer chatbot. Translate the following Manglish (Malayalam written in English letters) text to English for internal processing.

Manglish text: "${text}"

IMPORTANT RULES:
- Translate Manglish to proper English
- Keep the meaning 100% accurate - DO NOT change the meaning
- Maintain the exact context and intent
- If the text is already in English, return it exactly as is
- Return ONLY the English translation text, no explanations, no notes, no additional text
- This translation will be used for processing customer queries about bookings, payments, and deliveries

English translation:`;

    // Try with preferred model, fallback to flash if overloaded
    const translatedText = await retryWithBackoff(async () => {
      try {
        const model = getGeminiModel();
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text().trim();
      } catch (error) {
        // If overloaded, try with flash model
        if (error.status === 503 || error.message?.includes("overloaded")) {
          console.log("Primary model overloaded, trying gemini-2.5-flash...");
          const flashModel = getGeminiModel("gemini-2.5-flash");
          const result = await flashModel.generateContent(prompt);
          const response = await result.response;
          return response.text().trim();
        }
        throw error;
      }
    });

    res.json({
      original: text,
      translated: translatedText,
      direction: "manglish-to-english",
    });
  } catch (error) {
    console.error("Translation error (Manglish to English):", error);
    res.status(500).json({
      error: "Translation failed",
      message: error.message,
    });
  }
};

// Translate English to Manglish
translationCtrl.translateEnglishToManglish = async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Text is required" });
    }

    const prompt = `You are a multilingual assistant for a Gas Booking customer chatbot. Translate the following English text to Manglish (Malayalam written in English letters).

English text: "${text}"

CRITICAL RULES:
- Translate to natural, conversational Manglish (Malayalam written in English letters)
- Keep the meaning 100% accurate - DO NOT change the meaning
- Use simple spoken-style Manglish, avoid difficult Malayalam words
- Maintain a polite, friendly tone suitable for customer service
- Make it sound natural and conversational, like how people speak in Manglish
- Return ONLY the Manglish translation text, no explanations, no notes, no original English version
- The user typed in Manglish, so they expect the response ONLY in Manglish
- Do NOT include the English version in your response

Manglish translation:`;

    // Try with preferred model, fallback to flash if overloaded
    const translatedText = await retryWithBackoff(async () => {
      try {
        const model = getGeminiModel();
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text().trim();
      } catch (error) {
        // If overloaded, try with flash model
        if (error.status === 503 || error.message?.includes("overloaded")) {
          console.log("Primary model overloaded, trying gemini-2.5-flash...");
          const flashModel = getGeminiModel("gemini-2.5-flash");
          const result = await flashModel.generateContent(prompt);
          const response = await result.response;
          return response.text().trim();
        }
        throw error;
      }
    });

    res.json({
      original: text,
      translated: translatedText,
      direction: "english-to-manglish",
    });
  } catch (error) {
    console.error("Translation error (English to Manglish):", error);
    res.status(500).json({
      error: "Translation failed",
      message: error.message,
    });
  }
};

// Detect if text is Manglish
translationCtrl.detectManglish = async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Text is required" });
    }

    const prompt = `Analyze the following text and determine if it is Manglish (Malayalam written in English letters) or English.

Text: "${text}"

Manglish examples: "entha bro", "ningalude booking status", "ente cylinder ini vare deliver aayittilla", "ippo processing aan"
English examples: "what is my booking status", "my cylinder is not delivered", "is now processing"

Respond with ONLY "manglish" or "english" (lowercase, no other text, no explanations):`;

    // Try with preferred model, fallback to flash if overloaded
    const detection = await retryWithBackoff(async () => {
      try {
        const model = getGeminiModel();
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text().trim().toLowerCase();
      } catch (error) {
        // If overloaded, try with flash model
        if (error.status === 503 || error.message?.includes("overloaded")) {
          console.log("Primary model overloaded, trying gemini-2.5-flash...");
          const flashModel = getGeminiModel("gemini-2.5-flash");
          const result = await flashModel.generateContent(prompt);
          const response = await result.response;
          return response.text().trim().toLowerCase();
        }
        throw error;
      }
    });

    const isManglish = detection.includes("manglish");

    res.json({
      text,
      isManglish,
      detection,
    });
  } catch (error) {
    console.error("Detection error:", error);
    
    // Fallback: simple heuristic detection if Gemini fails
    const manglishIndicators = ["entha", "ningalude", "ente", "ippo", "ini", "aayittilla", "varum", "kannu", "ningal"];
    const words = text.toLowerCase().split(/\s+/);
    const isManglish = words.some(word => manglishIndicators.includes(word));
    
    res.json({
      text,
      isManglish,
      detection: isManglish ? "manglish (fallback)" : "english (fallback)",
      fallback: true,
    });
  }
};

module.exports = translationCtrl;

