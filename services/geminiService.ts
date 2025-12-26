import { GoogleGenAI, Type, Schema } from "@google/genai";
import { UserPreferences, ItineraryResult, CandidatePlace } from "../types";
import { rankCandidates } from "./rankingEngine";

// Helper to clean JSON string (still useful as a safety net)
const cleanJsonString = (str: string) => {
  let cleaned = str.replace(/```json\n?/g, '').replace(/```/g, '');
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }
  return cleaned;
};

export const generateItinerary = async (prefs: UserPreferences): Promise<ItineraryResult> => {
  const apiKey = import.meta.env.VITE_API_KEY;
  if (!apiKey) throw new Error("API Key 未設定。");

  const ai = new GoogleGenAI({ apiKey });

  // ==========================================
  // STAGE 1: Candidate Search (Use Flash)
  // ==========================================
  console.log("Stage 1: Fetching raw candidates (Using Flash)...");
  
  const step1Prompt = `
    任務：針對以下需求搜尋 20 個推薦地點。
    資訊：${prefs.airport}, 住宿 ${prefs.hotels[0].name}, 風格 ${prefs.style.focus}。
    客製化要求：${prefs.customRequests || '無'} (若包含遠處城市一日遊，務必搜尋該地景點)。
    
    請回傳 JSON 資料，包含住宿座標與候選景點清單。
  `;

  // Define Schema to save tokens on format instructions and ensure validity
  const stage1Schema: Schema = {
    type: Type.OBJECT,
    properties: {
      hotelCoords: {
        type: Type.OBJECT,
        properties: {
          lat: { type: Type.NUMBER },
          lng: { type: Type.NUMBER },
        }
      },
      candidates: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            category: { type: Type.STRING }, // sightseeing, food, shopping, culture, other
            rating: { type: Type.NUMBER },
            reviewCount: { type: Type.NUMBER },
            priceLevel: { type: Type.NUMBER },
            latitude: { type: Type.NUMBER },
            longitude: { type: Type.NUMBER },
            description: { type: Type.STRING }
          }
        }
      }
    }
  };

  let candidates: CandidatePlace[] = [];
  let hotelCoords = { lat: 0, lng: 0 };

  try {
      // Use gemini-flash-latest for high-speed, low-cost search
      const resp1 = await ai.models.generateContent({
          model: "gemini-flash-latest", 
          contents: step1Prompt,
          config: { 
              responseMimeType: "application/json",
              responseSchema: stage1Schema,
              tools: [{ googleSearch: {} }] 
          }
      });
      
      const rawData = JSON.parse(cleanJsonString(resp1.text || "{}"));
      candidates = rawData.candidates || [];
      hotelCoords = rawData.hotelCoords || { lat: 0, lng: 0 };
      
      console.log(`Stage 1 Complete. Found ${candidates.length} candidates.`);

  } catch (e) {
      console.error("Stage 1 Failed:", e);
      throw new Error(`搜尋景點失敗 (${e instanceof Error ? e.message : 'Unknown Error'})`);
  }

  // ==========================================
  // STAGE 2: Ranking (Deterministic, No Cost)
  // ==========================================
  
  const rankedCandidates = rankCandidates(candidates, prefs, hotelCoords.lat !== 0 ? hotelCoords : undefined);
  const topCandidates = rankedCandidates.slice(0, 16); // Take slightly more for buffer
  
  // ==========================================
  // STAGE 3: Final Planning (Use 3 Pro)
  // ==========================================
  console.log("Stage 3: Planning Itinerary (Using Gemini 3 Pro)...");

  // Token Slimming: Round coordinates and use shorter keys or just essential data
  const minimizedCandidates = topCandidates.map(c => ({
      name: c.name,
      cat: c.category,
      lat: Number(c.latitude.toFixed(4)),
      lng: Number(c.longitude.toFixed(4)),
      score: c.score,
      rating: c.rating,
      price: c.priceLevel,
      reason: c.matchReason
  }));

  const stage3Schema: Schema = {
    type: Type.OBJECT,
    properties: {
      tripTitle: { type: Type.STRING },
      totalCostEstimate: { type: Type.NUMBER },
      currency: { type: Type.STRING },
      summary: { type: Type.STRING },
      days: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            date: { type: Type.STRING },
            dayNumber: { type: Type.NUMBER },
            summary: { type: Type.STRING },
            activities: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  time: { type: Type.STRING },
                  placeName: { type: Type.STRING },
                  description: { type: Type.STRING },
                  reasoning: { type: Type.STRING },
                  matchTags: { type: Type.ARRAY, items: { type: Type.STRING } },
                  cost: { type: Type.NUMBER },
                  transportMethod: { type: Type.STRING },
                  transportCost: { type: Type.NUMBER },
                  transportTimeMinutes: { type: Type.NUMBER },
                  googleMapsUri: { type: Type.STRING },
                  rating: { type: Type.STRING },
                  isMeal: { type: Type.BOOLEAN },
                  latitude: { type: Type.NUMBER },
                  longitude: { type: Type.NUMBER }
                }
              }
            }
          }
        }
      }
    }
  };

  const step3Prompt = `
    規劃行程表。
    
    【參數】
    日期: ${prefs.dates.start} ~ ${prefs.dates.end}
    時間: ${prefs.dates.startTime} ~ ${prefs.dates.endTime}
    人數: ${prefs.travelers}
    預算: ${prefs.budget.amount} ${prefs.budget.currency}
    交通: ${prefs.style.transportPreference}
    客製化: "${prefs.customRequests || '無'}" (最高優先級，如有一日遊需求請優先安排並計算交通)

    【候選名單 (已排序)】
    ${JSON.stringify(minimizedCandidates)}

    【要求】
    1. 順路優先，考慮景點營業時間。
    2. 必須分配預算 (transportCost, cost)。
    3. 嚴格遵守客製化需求。
    4. 回傳完整行程 JSON。
  `;

  try {
    // Strategy: Use 'gemini-3-pro-preview' for maximum reasoning capability.
    // 3-Pro is smart enough without 'thinkingConfig', so we remove it to avoid extra token costs.
    const resp3 = await ai.models.generateContent({
      model: "gemini-3-pro-preview", 
      contents: step3Prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: stage3Schema,
        tools: [{ googleSearch: {} }, { googleMaps: {} }],
      },
    });

    const text = resp3.text;
    if (!text) throw new Error("No response from Gemini Stage 3");
    
    const data = JSON.parse(cleanJsonString(text)) as ItineraryResult;
    
    // Inject consistency data
    data.travelers = prefs.travelers;
    if (data.currency !== prefs.budget.currency) {
        data.currency = prefs.budget.currency;
    }

    return data;

  } catch (error) {
    console.error("Stage 3 Failed:", error);
    throw error;
  }
};