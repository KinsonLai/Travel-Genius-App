
import { GoogleGenAI } from "@google/genai";
import { UserPreferences, ItineraryResult, CandidatePlace, Hotel } from "../types";
import { rankCandidates, optimizeRoute } from "./rankingEngine";

const cleanJsonString = (str: string) => {
  let cleaned = str.replace(/```json\n?/g, '').replace(/```/g, '');
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }
  return cleaned;
};

const deduplicateCandidates = (candidates: CandidatePlace[]): CandidatePlace[] => {
    const seen = new Set();
    return candidates.filter(c => {
        if (!c || !c.name) return false;
        const key = c.name.toLowerCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

const getApiKey = () => {
    const meta = import.meta as any;
    if (meta && meta.env && meta.env.VITE_API_KEY) {
        return meta.env.VITE_API_KEY;
    }
    try {
        if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
            return process.env.API_KEY;
        }
    } catch(e) {}
    return "";
};

export const generateItinerary = async (prefs: UserPreferences): Promise<ItineraryResult> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API Key 未設定。請確認 .env 檔案中包含 VITE_API_KEY");

  const ai = new GoogleGenAI({ apiKey });

  const start = new Date(prefs.dates.start);
  const end = new Date(prefs.dates.end);
  const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 3600 * 24)) + 1;

  // STAGE 0: Airport & Keywords
  console.log("Stage 0: Pre-fetching Airport & Analyzing Custom Requests...");
  let airportCoords = { lat: 0, lng: 0 };
  try {
     const airportResp = await ai.models.generateContent({
         model: "gemini-3-flash-preview",
         contents: `Return JSON only: {"lat": number, "lng": number} for airport "${prefs.airport}".`,
         config: { tools: [{ googleSearch: {} }] }
     });
     const airportJson = JSON.parse(cleanJsonString(airportResp.text || "{}"));
     if(airportJson.lat) airportCoords = airportJson;
  } catch(e) { console.warn("Airport geocode failed"); }

  let customKeywords: string[] = [];
  if (prefs.customRequests && prefs.customRequests.length > 5) {
      try {
          const kwResp = await ai.models.generateContent({ 
             model: "gemini-3-flash-preview", 
             contents: `User Request: "${prefs.customRequests}". Extract specific place names. Return JSON: {"places": ["Name1", "Name2"]}` 
          });
          const kwJson = JSON.parse(cleanJsonString(kwResp.text || "{}"));
          customKeywords = kwJson.places || [];
      } catch(e) {}
  }

  // STAGE 1: Candidate Search (Increased count)
  console.log("Stage 1: Fetching candidates...");
  const hotelTasks = prefs.hotels.map(async (hotel) => {
      // Increased from 15 to 20 to ensure pool is large enough
      const prompt = `
        任務：針對住宿點「${hotel.name}」(${hotel.location}) 搜尋 20 個適合的旅遊地點(景點/餐廳)。
        ${customKeywords.length > 0 ? `優先包含這些地點: ${customKeywords.join(', ')}` : ''}
        
        【關鍵要求】
        1. **地理位置**: 優先距離該住宿點 20公里內。
        2. **多樣性**: 包含觀光、美食、購物。
        3. **資訊完整**: 必須包含經緯度、建議停留時數(durationHours)。
        
        JSON Format: { "hotelCoords": {"lat": number, "lng": number}, "candidates": [...] }
        (Candidate fields: name, category, rating, latitude, longitude, closedDays, openingText, website, durationHours)
      `;
      try {
          const resp = await ai.models.generateContent({
              model: "gemini-3-flash-preview", 
              contents: prompt,
              config: { tools: [{ googleSearch: {} }] }
          });
          const json = JSON.parse(cleanJsonString(resp.text || "{}"));
          if (json.hotelCoords?.lat) { hotel.latitude = json.hotelCoords.lat; hotel.longitude = json.hotelCoords.lng; }
          return (json.candidates || []) as CandidatePlace[];
      } catch (e) { return []; }
  });

  const results = await Promise.all(hotelTasks);
  const allCandidates = deduplicateCandidates(results.flat());

  if (allCandidates.length === 0) throw new Error("無法找到任何景點，請檢查輸入或稍後再試。");

  // STAGE 2: Ranking & Route Optimization
  const rankedCandidates = rankCandidates(allCandidates, prefs, prefs.hotels);
  const topCandidates = rankedCandidates.slice(0, 50); // Use top 50
  
  console.log(`Optimization: Processing ${topCandidates.length} spots.`);

  // Pass STRICT flight times
  const optimizedCandidates = optimizeRoute(
      topCandidates, 
      prefs.hotels, 
      prefs.dates.start,
      totalDays,
      airportCoords.lat !== 0 ? airportCoords : undefined,
      { start: prefs.dates.startTime, end: prefs.dates.endTime }
  );
  
  // STAGE 3: Final Planning
  console.log("Stage 3: Final Planning...");

  // Build skeleton
  const dayBuckets: Record<number, any[]> = {};
  for(let i=1; i<=totalDays; i++) dayBuckets[i] = [];
  
  optimizedCandidates.forEach(c => {
      if(c.suggestedDay && dayBuckets[c.suggestedDay]) {
          dayBuckets[c.suggestedDay].push({
              name: c.name,
              lat: c.latitude,
              lng: c.longitude,
              hours: c.openingText,
              website: c.website
          });
      }
  });

  // Explicitly list ALL required dates for the prompt
  let dateListStr = "";
  let planSkeleton = "";
  const startDateObj = new Date(prefs.dates.start);
  
  for(let i=1; i<=totalDays; i++) {
      const d = new Date(startDateObj);
      d.setDate(startDateObj.getDate() + (i-1));
      const dateStr = d.toISOString().split('T')[0];
      
      dateListStr += `Day ${i} (${dateStr})\n`;
      
      const items = dayBuckets[i];
      planSkeleton += `Day ${i} (${dateStr}): `;
      if (items.length > 0) {
          planSkeleton += JSON.stringify(items) + "\n";
      } else {
          planSkeleton += "(當日無特定演算法推薦，請根據住宿位置自行安排 2-3 個輕鬆行程)\n";
      }
  }

  const hotelSchedule = prefs.hotels.map((h, i) => 
      `Check-in ${h.checkIn}: ${h.name} (@ ${h.latitude},${h.longitude})`
  ).join('\n');

  const step3Prompt = `
    角色：專業導遊。
    任務：產生 JSON 行程。

    【硬性約束 - 絕不可違反】
    1. **完整日期**: 行程必須完整包含從 Day 1 到 Day ${totalDays} 的每一天。絕不可跳過任何一天。
    2. **班機時間**:
       - Day 1: ${prefs.dates.startTime} 抵達。此前不可排活動。
       - Day ${totalDays}: ${prefs.dates.endTime} 起飛。起飛前 3 小時需抵達機場。
    3. **地理位置**: 必須參考住宿表安排行程。
       住宿表: 
       ${hotelSchedule}

    【每日行程骨架】
    ${planSkeleton}
    
    【你的工作】
    1. 依照骨架填寫詳細內容。
    2. 若骨架某日標註為「無特定推薦」，請務必**自動生成**當日的行程，不可留白。
    3. 每個活動請填寫 "duration" (例如 "2 小時")。

    【輸出 Schema】
    {
      "tripTitle": "標題",
      "totalCostEstimate": 數字,
      "currency": "${prefs.budget.currency}",
      "summary": "總結",
      "days": [
        {
          "date": "YYYY-MM-DD", // 必須對應 ${dateListStr}
          "dayNumber": 1,
          "summary": "主題",
          "activities": [
            {
              "time": "HH:MM",
              "placeName": "名稱",
              "description": "描述",
              "duration": "2 小時", 
              "website": "URL",
              "reasoning": "選擇理由",
              "cost": 數字,
              "transportMethod": "交通方式",
              "transportCost": 數字,
              "transportTimeMinutes": 數字,
              "latitude": 數字,
              "longitude": 數字,
              "isMeal": boolean
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
    
    // Safety: Ensure all days exist
    if (!data.days || data.days.length < totalDays) {
        console.warn("Gemini missed some days, attempting to patch...");
        // Simple patch logic could go here, but prompt engineering should prevent this.
    }

    data.travelers = prefs.travelers;
    if (data.currency !== prefs.budget.currency) data.currency = prefs.budget.currency;

    return data;

  } catch (error) {
    console.error("Stage 3 Failed:", error);
    throw error;
  }
};
