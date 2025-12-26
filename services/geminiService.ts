import { GoogleGenAI } from "@google/genai";
import { UserPreferences, ItineraryResult, CandidatePlace } from "../types";
import { rankCandidates } from "./rankingEngine";

// Helper to clean JSON string
const cleanJsonString = (str: string) => {
  // Remove markdown code blocks if present
  let cleaned = str.replace(/```json\n?/g, '').replace(/```/g, '');
  
  // Find the first '{' and last '}'
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
    
    請務必回傳標準 JSON 格式，不要包含任何其他文字或解釋。格式如下：
    {
      "hotelCoords": { "lat": number, "lng": number },
      "candidates": [
        {
          "name": "地點名稱",
          "category": "類別 (sightseeing/food/shopping/culture/other)",
          "rating": 數字 (1-5),
          "reviewCount": 數字,
          "priceLevel": 數字 (1-4),
          "latitude": 數字,
          "longitude": 數字,
          "description": "簡短描述"
        }
      ]
    }
  `;

  let candidates: CandidatePlace[] = [];
  let hotelCoords = { lat: 0, lng: 0 };

  try {
      // FIX: Removed responseMimeType: "application/json" and responseSchema
      // because using tools with strict JSON mode is currently unsupported/unstable on some models.
      const resp1 = await ai.models.generateContent({
          model: "gemini-flash-latest", 
          contents: step1Prompt,
          config: { 
              tools: [{ googleSearch: {} }] 
          }
      });
      
      const rawText = resp1.text || "{}";
      const rawData = JSON.parse(cleanJsonString(rawText));
      candidates = rawData.candidates || [];
      hotelCoords = rawData.hotelCoords || { lat: 0, lng: 0 };
      
      console.log(`Stage 1 Complete. Found ${candidates.length} candidates.`);

  } catch (e) {
      console.error("Stage 1 Failed:", e);
      // More descriptive error for debugging
      const msg = e instanceof Error ? e.message : JSON.stringify(e);
      throw new Error(`搜尋景點失敗 (${msg})`);
  }

  // ==========================================
  // STAGE 2: Ranking (Deterministic, No Cost)
  // ==========================================
  
  const rankedCandidates = rankCandidates(candidates, prefs, hotelCoords.lat !== 0 ? hotelCoords : undefined);
  const topCandidates = rankedCandidates.slice(0, 16); 
  
  // ==========================================
  // STAGE 3: Final Planning (Use 3 Pro)
  // ==========================================
  console.log("Stage 3: Planning Itinerary (Using Gemini 3 Pro)...");

  // Token Slimming
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

  const step3Prompt = `
    你是一個專業的旅遊規劃師。請根據以下資訊規劃行程。
    
    【參數】
    日期: ${prefs.dates.start} ~ ${prefs.dates.end}
    時間: ${prefs.dates.startTime} ~ ${prefs.dates.endTime}
    人數: ${prefs.travelers}
    預算: ${prefs.budget.amount} ${prefs.budget.currency}
    交通: ${prefs.style.transportPreference}
    客製化: "${prefs.customRequests || '無'}" (最高優先級，如有一日遊需求請優先安排並計算交通)

    【候選名單 (已排序)】
    ${JSON.stringify(minimizedCandidates)}

    【輸出要求】
    請直接回傳標準 JSON 格式，不要包含 Markdown 標記 (\`\`\`json) 或其他文字。
    JSON 結構必須符合以下 Schema：
    {
      "tripTitle": "旅程標題",
      "totalCostEstimate": 數字,
      "currency": "${prefs.budget.currency}",
      "summary": "行程總結",
      "days": [
        {
          "date": "YYYY-MM-DD",
          "dayNumber": 數字,
          "summary": "當天主題",
          "activities": [
            {
              "time": "HH:MM",
              "placeName": "名稱",
              "description": "描述",
              "reasoning": "推薦理由",
              "matchTags": ["標籤1", "標籤2"],
              "cost": 數字 (單人費用),
              "transportMethod": "交通方式 (如: 地鐵, 計程車, 步行)",
              "transportCost": 數字 (單人交通費),
              "transportTimeMinutes": 數字 (交通時間),
              "googleMapsUri": "URL",
              "rating": "評分",
              "isMeal": 布林值,
              "latitude": 數字,
              "longitude": 數字
            }
          ]
        }
      ]
    }
  `;

  try {
    // FIX: Removed responseMimeType: "application/json" and responseSchema here as well
    // to avoid potential conflicts with tools.
    const resp3 = await ai.models.generateContent({
      model: "gemini-3-pro-preview", 
      contents: step3Prompt,
      config: {
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
