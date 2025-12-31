
import { GoogleGenAI } from "@google/genai";
import { UserPreferences, ItineraryResult, CandidatePlace, Hotel } from "../types";
import { rankCandidates, optimizeRoute } from "./rankingEngine";

// Helper to clean JSON string
const cleanJsonString = (str: string) => {
  let cleaned = str.replace(/```json\n?/g, '').replace(/```/g, '');
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }
  return cleaned;
};

// Helper: Deduplicate candidates
const deduplicateCandidates = (candidates: CandidatePlace[]): CandidatePlace[] => {
    const seen = new Set();
    return candidates.filter(c => {
        // Fix: Add safety check for undefined name or object
        if (!c || !c.name) return false;
        const key = c.name.toLowerCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

export const generateItinerary = async (prefs: UserPreferences): Promise<ItineraryResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const start = new Date(prefs.dates.start);
  const end = new Date(prefs.dates.end);
  const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 3600 * 24)) + 1;

  // ==========================================
  // STAGE 0: Pre-computation (Airport & Custom Keywords)
  // ==========================================
  console.log("Stage 0: Pre-fetching Airport & Analyzing Custom Requests...");
  
  let airportCoords = { lat: 0, lng: 0 };
  const airportPrompt = `
    Return JSON only: {"lat": number, "lng": number} for the airport: "${prefs.airport}".
  `;
  try {
     const airportResp = await ai.models.generateContent({
         model: "gemini-3-flash-preview",
         contents: airportPrompt,
         config: { tools: [{ googleSearch: {} }] }
     });
     const airportJson = JSON.parse(cleanJsonString(airportResp.text || "{}"));
     if(airportJson.lat) airportCoords = airportJson;
  } catch(e) {
      console.warn("Failed to geocode airport, defaulting to 0,0");
  }

  let customKeywords: string[] = [];
  if (prefs.customRequests && prefs.customRequests.length > 5) {
      const extractPrompt = `
        User Request: "${prefs.customRequests}"
        Extract specific place names or city names mentioned that are NOT generic (like 'sushi' or 'park').
        Return JSON: {"places": ["Place A", "Place B"]}
      `;
      try {
          const kwResp = await ai.models.generateContent({ model: "gemini-3-flash-preview", contents: extractPrompt });
          const kwJson = JSON.parse(cleanJsonString(kwResp.text || "{}"));
          customKeywords = kwJson.places || [];
      } catch(e) {}
  }

  // ==========================================
  // STAGE 1: Parallel Candidate Search
  // ==========================================
  console.log("Stage 1: Fetching candidates (Hotels + Custom Requests)...");

  // Construct Search Tasks
  const hotelTasks = prefs.hotels.map(async (hotel) => {
      const prompt = `
        任務：針對住宿點「${hotel.name}」(${hotel.location}) 搜尋 15 個適合的旅遊地點(景點/餐廳)。
        
        【關鍵要求】
        1. **地理位置優先**: 必須優先尋找距離該住宿點 10公里內 的地點。
        2. **時間估算**: 請提供該地點的建議遊玩時間 (durationHours)，例如 1.5 或 2.0。
        3. 包含網站連結。
        
        JSON Format: { "hotelCoords": {"lat": number, "lng": number}, "candidates": [...] }
        (Candidate fields: name, category, rating, priceLevel, latitude, longitude, closedDays, openingText, website, durationHours)
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

  const customTask = async () => {
      if (customKeywords.length === 0) return [];
      const prompt = `
         Search details for specific places: ${customKeywords.join(', ')}.
         JSON Format: { "candidates": [...] }
         Must include valid latitude/longitude, website URL, and durationHours.
      `;
      try {
        const resp = await ai.models.generateContent({
            model: "gemini-3-flash-preview", 
            contents: prompt,
            config: { tools: [{ googleSearch: {} }] }
        });
        const json = JSON.parse(cleanJsonString(resp.text || "{}"));
        return (json.candidates || []) as CandidatePlace[];
      } catch (e) { return []; }
  };

  const results = await Promise.all([...hotelTasks, customTask()]);
  const allCandidates = deduplicateCandidates(results.flat());

  if (allCandidates.length === 0) throw new Error("無法找到任何景點，請檢查輸入或稍後再試。");

  // ==========================================
  // STAGE 2: Ranking & Geo-Fenced Optimization
  // ==========================================
  const rankedCandidates = rankCandidates(allCandidates, prefs, prefs.hotels);
  const maxCandidates = Math.min(totalDays * 6, 40); 
  const topCandidates = rankedCandidates.slice(0, maxCandidates); 
  
  console.log(`Optimization: Processing ${topCandidates.length} spots. Flight: ${prefs.dates.startTime} - ${prefs.dates.endTime}`);

  const optimizedCandidates = optimizeRoute(
      topCandidates, 
      prefs.hotels, 
      prefs.dates.start,
      totalDays,
      airportCoords.lat !== 0 ? airportCoords : undefined,
      { start: prefs.dates.startTime, end: prefs.dates.endTime } // Pass flight times
  );
  
  // ==========================================
  // STAGE 3: Final Planning
  // ==========================================
  console.log("Stage 3: Final Planning...");

  // Organize by Day for the Prompt to ensure no day is missed
  const dayBuckets: Record<number, any[]> = {};
  for(let i=1; i<=totalDays; i++) dayBuckets[i] = [];
  
  optimizedCandidates.forEach(c => {
      if(c.suggestedDay && dayBuckets[c.suggestedDay]) {
          dayBuckets[c.suggestedDay].push({
              name: c.name,
              hours: c.openingText,
              lat: Number(c.latitude.toFixed(4)),
              lng: Number(c.longitude.toFixed(4)),
              website: c.website
          });
      }
  });

  // Construct a textual plan "skeleton"
  let planSkeleton = "";
  for(let i=1; i<=totalDays; i++) {
      const items = dayBuckets[i];
      planSkeleton += `Day ${i}: `;
      if (items.length > 0) {
          planSkeleton += JSON.stringify(items) + "\n";
      } else {
          planSkeleton += "(無演算法推薦景點 - 請AI根據當天住宿點附近的熱門區域，自動填補2-3個輕鬆行程)\n";
      }
  }

  const hotelSchedule = prefs.hotels.map((h, i) => 
      `Check-in ${h.checkIn}: ${h.name} (@ ${h.latitude},${h.longitude})`
  ).join('\n');

  const step3Prompt = `
    角色：專業導遊。
    任務：產生 JSON 行程。

    【硬性約束】
    1. 總天數: ${totalDays} 天 (從 ${prefs.dates.start} 到 ${prefs.dates.end})。
    2. **班機時間**:
       - Day 1: ${prefs.dates.startTime} 抵達機場 (${prefs.airport})。之前不可安排活動。
       - Day ${totalDays}: ${prefs.dates.endTime} 飛機起飛。必須在起飛前 3 小時抵達機場。
    3. **每日行程骨架 (必須嚴格遵守此結構)**:
    ${planSkeleton}
    
    【你的工作】
    1. 針對每一天，請使用骨架中的景點。
    2. 若骨架中某天標註為「無演算法推薦」，你必須根據當晚住宿位置 (${hotelSchedule})，**自動生成**合適的輕鬆行程（如逛街、公園、晚餐），絕不能留白。
    3. Day 1 必須包含「抵達與前往市區/飯店」的交通。
    4. 最後一天必須包含「前往機場」的交通。
    5. 每個活動請填寫 "duration" (例如 "2 小時")。
    6. "website" 若骨架有則用，無則嘗試搜尋填入。

    【輸出 Schema】
    {
      "tripTitle": "標題",
      "totalCostEstimate": 數字,
      "currency": "${prefs.budget.currency}",
      "summary": "總結",
      "days": [
        {
          "date": "YYYY-MM-DD",
          "dayNumber": 1,
          "summary": "主題",
          "activities": [
             // Activity Schema ...
          ]
        }
        ... // 必須包含 Day 1 到 Day ${totalDays}
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
    
    data.travelers = prefs.travelers;
    if (data.currency !== prefs.budget.currency) data.currency = prefs.budget.currency;

    data.days.forEach(d => {
        d.activities.forEach(a => {
            if (a.transportCost === undefined) a.transportCost = 0;
            if (a.cost === undefined) a.cost = 0;
            if (!a.duration) a.duration = "1.5 小時"; 
        });
    });

    return data;

  } catch (error) {
    console.error("Stage 3 Failed:", error);
    throw error;
  }
};
