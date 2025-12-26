
import { GoogleGenAI } from "@google/genai";
import { UserPreferences, ItineraryResult, CandidatePlace, Hotel } from "../types";
import { rankCandidates, optimizeRoute } from "./rankingEngine";

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

// Helper: Deduplicate candidates by name
const deduplicateCandidates = (candidates: CandidatePlace[]): CandidatePlace[] => {
    const seen = new Set();
    return candidates.filter(c => {
        const key = c.name.toLowerCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

export const generateItinerary = async (prefs: UserPreferences): Promise<ItineraryResult> => {
  const apiKey = import.meta.env.VITE_API_KEY;
  if (!apiKey) throw new Error("API Key 未設定。");

  const ai = new GoogleGenAI({ apiKey });

  // Calculate duration
  const start = new Date(prefs.dates.start);
  const end = new Date(prefs.dates.end);
  const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 3600 * 24)) + 1;

  // ==========================================
  // STAGE 1: Parallel Candidate Search (Per Hotel)
  // ==========================================
  console.log("Stage 1: Fetching raw candidates (Parallel Search per Hotel)...");
  
  // Create a unique search task for each hotel to guarantee coverage
  // (Optimization: If hotels are extremely close/same city, we could group them, but parallel is safer for correctness)
  const searchPromises = prefs.hotels.map(async (hotel, index) => {
      const prompt = `
        任務：針對以下「單一特定住宿點」搜尋 15 個推薦地點。
        機場：${prefs.airport}
        中心住宿點：${hotel.name} (位置: ${hotel.location})
        旅遊風格：${prefs.style.focus}
        客製化要求：${prefs.customRequests || '無'}。
        
        【嚴格限制】
        1. **只搜尋距離此住宿點 1.5 小時交通圈內的景點**。不要推薦其他城市的景點。
        2. 務必搜尋此住宿點 (${hotel.name}) 的精確經緯度。
        3. 包含景點的「公休日(0-6)」與「營業時間」。

        回傳 JSON 格式：
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
              "description": "簡短描述",
              "closedDays": [數字], 
              "openingText": "例如: 10:00-22:00"
            }
          ]
        }
      `;

      try {
          const resp = await ai.models.generateContent({
              model: "gemini-flash-latest", 
              contents: prompt,
              config: { tools: [{ googleSearch: {} }] }
          });
          const json = JSON.parse(cleanJsonString(resp.text || "{}"));
          
          // Update hotel coords if found
          if (json.hotelCoords && json.hotelCoords.lat) {
              hotel.latitude = json.hotelCoords.lat;
              hotel.longitude = json.hotelCoords.lng;
          }

          return (json.candidates || []) as CandidatePlace[];
      } catch (e) {
          console.error(`Search failed for hotel ${hotel.name}`, e);
          return [];
      }
  });

  // Wait for all searches to complete
  const results = await Promise.all(searchPromises);
  
  // Flatten and Deduplicate
  let allCandidates = deduplicateCandidates(results.flat());
  
  console.log(`Stage 1 Complete. Found total ${allCandidates.length} unique candidates across ${prefs.hotels.length} zones.`);

  if (allCandidates.length === 0) {
      throw new Error("無法找到任何景點，請檢查輸入的城市或地點名稱是否正確。");
  }

  // ==========================================
  // STAGE 2: Ranking & Time-Aware Optimization
  // ==========================================
  
  // 1. Scoring 
  const rankedCandidates = rankCandidates(allCandidates, prefs, prefs.hotels);
  
  // 取前 N 個 (根據天數動態調整，每天約 5-6 個候選，總數不超過 40)
  const maxCandidates = Math.min(totalDays * 6, 40);
  const topCandidates = rankedCandidates.slice(0, maxCandidates); 
  
  // 2. Graph + Dictionary Algorithm (Geo-Fencing Logic applied here)
  console.log("Applying Time-Aware Graph optimization...");
  const optimizedCandidates = optimizeRoute(
      topCandidates, 
      prefs.hotels, 
      prefs.dates.start,
      totalDays
  );
  
  // ==========================================
  // STAGE 3: Final Planning (Use 3 Pro)
  // ==========================================
  console.log("Stage 3: Planning Itinerary (Using Gemini 3 Pro)...");

  // Token Slimming
  const minimizedCandidates = optimizedCandidates.map(c => ({
      name: c.name,
      day: c.suggestedDay, // Strictly assigned by algo
      closed: c.closedDays,
      hours: c.openingText,
      lat: Number(c.latitude.toFixed(4)),
      lng: Number(c.longitude.toFixed(4)),
      tag: c.matchReason, // Contains info about which hotel it belongs to
      dist: c.distanceFromHotel
  }));
  
  const hotelSchedule = prefs.hotels.map(h => 
      `日期區間 [${h.checkIn} ~ ${h.checkOut}] 住: ${h.name} (${h.latitude?.toFixed(3)}, ${h.longitude?.toFixed(3)})`
  ).join('\n');

  const step3Prompt = `
    你是一個專業的旅遊規劃師。請生成一份詳細的行程表。

    【核心限制 - 必須嚴格遵守】
    1. **多住宿邏輯**: 用戶在不同日期住在不同酒店。
       - 請參閱下方的 [住宿安排]。
       - **絕對禁止**在住 A 酒店的日子，安排 B 酒店附近的景點 (除非是移動日)。
       - 候選名單中的 "day" 欄位是由演算法根據地理位置分配的，**請務必 100% 遵守該 day 分配**。不要私自移動景點到別天。
    
    【住宿安排】
    ${hotelSchedule}

    【參數】
    總天數: ${totalDays} 天 (${prefs.dates.start} ~ ${prefs.dates.end})
    人數: ${prefs.travelers}
    預算: ${prefs.budget.amount} ${prefs.budget.currency}
    風格: ${prefs.style.focus}

    【候選名單 (已鎖定日期)】
    ${JSON.stringify(minimizedCandidates)}

    【輸出要求】
    請回傳符合以下 Schema 的標準 JSON (無 Markdown):
    {
      "tripTitle": "標題",
      "totalCostEstimate": 數字,
      "currency": "${prefs.budget.currency}",
      "summary": "總結",
      "days": [
        {
          "date": "YYYY-MM-DD",
          "dayNumber": 數字,
          "summary": "當日主題 (例如: 東京探索)",
          "activities": [
            {
              "time": "HH:MM",
              "placeName": "名稱",
              "description": "描述",
              "reasoning": "為何選此處",
              "matchTags": ["標籤"],
              "cost": 數字,
              "transportMethod": "交通方式",
              "transportCost": 數字,
              "transportTimeMinutes": 數字,
              "googleMapsUri": "URL",
              "rating": "4.5",
              "isMeal": boolean,
              "latitude": number,
              "longitude": number
            }
          ]
        }
      ]
    }
  `;

  try {
    const resp3 = await ai.models.generateContent({
      model: "gemini-3-pro-preview", 
      contents: step3Prompt,
      config: {
        tools: [{ googleSearch: {} }],
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
