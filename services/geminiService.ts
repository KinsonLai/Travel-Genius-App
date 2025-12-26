
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

export const generateItinerary = async (prefs: UserPreferences): Promise<ItineraryResult> => {
  const apiKey = import.meta.env.VITE_API_KEY;
  if (!apiKey) throw new Error("API Key 未設定。");

  const ai = new GoogleGenAI({ apiKey });

  // Calculate duration
  const start = new Date(prefs.dates.start);
  const end = new Date(prefs.dates.end);
  const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 3600 * 24)) + 1;

  // Format hotel list for prompt
  const hotelsListStr = prefs.hotels.map((h, i) => 
    `酒店${i+1}: ${h.name} (位置: ${h.location}, 日期: ${h.checkIn}~${h.checkOut})`
  ).join('\n');

  // ==========================================
  // STAGE 1: Candidate Search (Use Flash)
  // ==========================================
  console.log("Stage 1: Fetching raw candidates (Using Flash)...");
  
  const step1Prompt = `
    任務：針對以下需求搜尋 25 個推薦地點。
    機場：${prefs.airport}
    住宿安排 (請根據這些地點周邊搜尋)：
    ${hotelsListStr}
    
    旅遊風格：${prefs.style.focus}
    客製化要求：${prefs.customRequests || '無'}。
    
    【重要指令】
    1. 因為用戶有多個住宿地點，請確保搜尋的景點能**均勻分布**在這些住宿地點周邊，不要只集中在第一間酒店。
    2. 務必搜尋每一間酒店的經緯度。
    3. 務必搜尋景點的「公休日」與「營業時間」。

    請務必回傳標準 JSON 格式，不要包含任何其他文字或解釋。格式如下：
    {
      "hotelsData": [
        { "id": "對應prefs中的hotel id", "name": "酒店名稱", "lat": number, "lng": number }
      ],
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
          "closedDays": [數字], // 0=週日, 1=週一, ... 6=週六。若無休則為 []
          "openingText": "例如: 10:00-22:00"
        }
      ]
    }
  `;

  let candidates: CandidatePlace[] = [];
  // Use a map to store hotel coords temporary
  let hotelsCoordsMap: Record<string, {lat: number, lng: number}> = {};

  try {
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
      
      // Map coords back to prefs.hotels
      const returnedHotels = rawData.hotelsData || [];
      // We iterate through our original prefs.hotels and try to find coords from AI response
      // Note: The AI might not return ID perfectly, so we might match by index or assume order
      prefs.hotels.forEach((h, index) => {
          // Try to find by name match or index
          const found = returnedHotels.find((rh: any) => rh.name.includes(h.name)) || returnedHotels[index];
          if (found && found.lat) {
              h.latitude = found.lat;
              h.longitude = found.lng;
          }
      });
      
      console.log(`Stage 1 Complete. Found ${candidates.length} candidates.`);

  } catch (e) {
      console.error("Stage 1 Failed:", e);
      const msg = e instanceof Error ? e.message : JSON.stringify(e);
      throw new Error(`搜尋景點失敗 (${msg})`);
  }

  // ==========================================
  // STAGE 2: Ranking & Time-Aware Optimization
  // ==========================================
  
  // 1. Scoring (篩選高品質景點)
  // Now we pass the FULL array of hotels so ranking can check distance to NEAREST hotel
  const rankedCandidates = rankCandidates(candidates, prefs, prefs.hotels);
  
  // 取前 18 個最高分景點 (稍微增加數量以應對多天)
  const topCandidates = rankedCandidates.slice(0, 18); 
  
  // 2. Graph + Dictionary Algorithm (路徑 + 時間優化)
  // 使用 Day-Aware Nearest Neighbor 算法重新排序並分組
  console.log("Applying Time-Aware Graph optimization...");
  const optimizedCandidates = optimizeRoute(
      topCandidates, 
      prefs.hotels, // Pass all hotels with their dates
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
      day: c.suggestedDay, // Tell AI which day the algorithm assigned
      closed: c.closedDays, // Tell AI the closed days
      hours: c.openingText,
      lat: Number(c.latitude.toFixed(4)),
      lng: Number(c.longitude.toFixed(4)),
      score: c.score,
      rating: c.rating,
      price: c.priceLevel,
      reason: c.matchReason
  }));
  
  // Create a summary of which hotel is used on which day for the prompt
  const hotelSchedule = prefs.hotels.map(h => `${h.checkIn}至${h.checkOut}: 住 ${h.name}`).join(', ');

  const step3Prompt = `
    你是一個專業的旅遊規劃師。請根據以下資訊規劃行程。
    
    【參數】
    日期: ${prefs.dates.start} ~ ${prefs.dates.end} (${totalDays}天)
    時間: ${prefs.dates.startTime} ~ ${prefs.dates.endTime}
    住宿安排: ${hotelSchedule} (請確保行程的出發與結束點符合當天的住宿)
    人數: ${prefs.travelers}
    預算: ${prefs.budget.amount} ${prefs.budget.currency}
    交通: ${prefs.style.transportPreference}
    客製化: "${prefs.customRequests || '無'}" (最高優先級)

    【候選名單 (已完成演算法優化)】
    以下名單已經經過「地理路徑(Graph)」與「營業時間(Dictionary)」的演算法驗證。
    系統已根據住宿位置，將景點分配到適合的日期 (Day)。
    **請嚴格遵守 "day" 欄位的建議**。
    ${JSON.stringify(minimizedCandidates)}

    【核心指令】
    1. **嚴格遵守 "day" 分配**：演算法已經考慮了酒店位置。例如，若某景點靠近第二間酒店，演算法會將其分配在入住第二間酒店的日期，請勿隨意更動。
    2. **酒店移動日**：在更換酒店當天 (Check-out A -> Check-in B)，請安排合理的交通移動時間，並建議是否先去酒店放行李或使用車站置物櫃。
    3. 同一天的景點順序，請依照列表中的出現順序安排。
    4. 回傳完整行程 JSON。

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
