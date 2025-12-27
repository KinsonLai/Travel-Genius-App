
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

  const start = new Date(prefs.dates.start);
  const end = new Date(prefs.dates.end);
  const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 3600 * 24)) + 1;

  // ==========================================
  // STAGE 0: Pre-computation (Airport & Custom Keywords)
  // ==========================================
  console.log("Stage 0: Pre-fetching Airport & Analyzing Custom Requests...");
  
  // 1. Get Airport Coordinates logic (Simple search query)
  let airportCoords = { lat: 0, lng: 0 };
  const airportPrompt = `
    Return JSON only: {"lat": number, "lng": number} for the airport: "${prefs.airport}".
  `;
  try {
     const airportResp = await ai.models.generateContent({
         model: "gemini-flash-latest",
         contents: airportPrompt,
         config: { tools: [{ googleSearch: {} }] }
     });
     const airportJson = JSON.parse(cleanJsonString(airportResp.text || "{}"));
     if(airportJson.lat) airportCoords = airportJson;
  } catch(e) {
      console.warn("Failed to geocode airport, defaulting to 0,0");
  }

  // 2. Extract Specific Locations from Custom Request to force-search them
  let customKeywords: string[] = [];
  if (prefs.customRequests && prefs.customRequests.length > 5) {
      const extractPrompt = `
        User Request: "${prefs.customRequests}"
        Extract specific place names or city names mentioned that are NOT generic (like 'sushi' or 'park').
        Return JSON: {"places": ["Place A", "Place B"]}
      `;
      try {
          const kwResp = await ai.models.generateContent({ model: "gemini-flash-latest", contents: extractPrompt });
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
        任務：針對住宿點「${hotel.name}」(${hotel.location}) 搜尋 12 個適合的景點/餐廳。
        ${customKeywords.length > 0 ? `優先搜尋符合這些關鍵字的地點: ${customKeywords.join(', ')} (若在附近)` : ''}
        
        【嚴格限制】
        1. 距離住宿點 1.5小時內。
        2. 回傳經緯度、公休日。
        3. **務必盡量提供該地點的官方網站或介紹頁面 URL (website)**。
        
        JSON Format: { "hotelCoords": {"lat": number, "lng": number}, "candidates": [...] }
        (Candidate fields: name, category, rating, priceLevel, latitude, longitude, closedDays, openingText, website)
      `;
      try {
          const resp = await ai.models.generateContent({
              model: "gemini-flash-latest", 
              contents: prompt,
              config: { tools: [{ googleSearch: {} }] }
          });
          const json = JSON.parse(cleanJsonString(resp.text || "{}"));
          // Update hotel coords
          if (json.hotelCoords?.lat) { hotel.latitude = json.hotelCoords.lat; hotel.longitude = json.hotelCoords.lng; }
          return (json.candidates || []) as CandidatePlace[];
      } catch (e) { return []; }
  });

  const customTask = async () => {
      if (customKeywords.length === 0) return [];
      const prompt = `
         Search details for specific places: ${customKeywords.join(', ')}.
         JSON Format: { "candidates": [...] }
         Must include valid latitude/longitude and website URL.
      `;
      try {
        const resp = await ai.models.generateContent({
            model: "gemini-flash-latest", 
            contents: prompt,
            config: { tools: [{ googleSearch: {} }] }
        });
        const json = JSON.parse(cleanJsonString(resp.text || "{}"));
        return (json.candidates || []) as CandidatePlace[];
      } catch (e) { return []; }
  };

  const results = await Promise.all([...hotelTasks, customTask()]);
  const allCandidates = deduplicateCandidates(results.flat());

  if (allCandidates.length === 0) throw new Error("無法找到任何景點，請檢查輸入。");

  // ==========================================
  // STAGE 2: Ranking & Geo-Fenced Optimization
  // ==========================================
  const rankedCandidates = rankCandidates(allCandidates, prefs, prefs.hotels);
  const maxCandidates = Math.min(totalDays * 5, 35); 
  const topCandidates = rankedCandidates.slice(0, maxCandidates); 
  
  console.log(`Optimization: Processing ${topCandidates.length} spots. Airport: ${airportCoords.lat},${airportCoords.lng}`);

  const optimizedCandidates = optimizeRoute(
      topCandidates, 
      prefs.hotels, 
      prefs.dates.start,
      totalDays,
      airportCoords.lat !== 0 ? airportCoords : undefined
  );
  
  // ==========================================
  // STAGE 3: Final Planning
  // ==========================================
  console.log("Stage 3: Final Planning...");

  // Minimal token payload
  const minimizedCandidates = optimizedCandidates.map(c => ({
      name: c.name,
      day: c.suggestedDay, // THE ALGORITHM HAS SPOKEN. DO NOT CHANGE.
      hours: c.openingText,
      lat: Number(c.latitude.toFixed(4)),
      lng: Number(c.longitude.toFixed(4)),
      dist: c.distanceFromHotel,
      context: c.matchReason,
      website: c.website // Pass the website from Stage 1 to Stage 3
  }));
  
  const hotelSchedule = prefs.hotels.map((h, i) => 
      `Day ? (Check-in ${h.checkIn}): 住 ${h.name}`
  ).join('\n');

  const budgetPerDay = Math.floor(prefs.budget.amount / totalDays);

  const step3Prompt = `
    角色：嚴格的旅行會計師與導遊。
    任務：將提供的候選列表轉換為詳細行程 JSON。

    【重要：輸入資料】
    1. 機場: ${prefs.airport} (座標: ${airportCoords.lat}, ${airportCoords.lng})
    2. 住宿表: 
    ${hotelSchedule}
    3. **候選景點列表 (已鎖定日期與地理位置)**:
    ${JSON.stringify(minimizedCandidates)}

    【核心規則 - 違反即失敗】
    1. **地理圍欄 (Geo-Fencing)**: 候選列表中的 "day" 欄位是經過嚴格地理計算的結果。**你必須 100% 遵守該 day 分配**。
    2. **禁止幻覺**: **只能使用** 上述候選列表中的景點。
    3. **機場邏輯**: 
       - Day 1 第一個活動必須是「抵達 ${prefs.airport} 並前往市區/飯店」。
       - 最後一天最後一個活動必須是「前往 ${prefs.airport}」。
    4. **預算控制**: 
       - 總預算: ${prefs.budget.amount} ${prefs.budget.currency}。
       - 請為每個活動估算真實的 cost (門票/餐飲) 與 transportCost (交通)。

    【詳細欄位要求】
    1. **duration (預估停留時間)**: 請根據活動性質估算遊覽時間（例如："1.5 小時", "2 小時", "45 分鐘"）。
    2. **website (官方網站)**: 若候選列表中有 website 則使用之；若無，請嘗試透過 Google Search 尋找該景點的**官方網站**或**主要介紹頁面**。

    【輸出 Schema】
    {
      "tripTitle": "標題",
      "totalCostEstimate": 數字 (必須 <= ${prefs.budget.amount}),
      "currency": "${prefs.budget.currency}",
      "summary": "總結",
      "days": [
        {
          "date": "YYYY-MM-DD",
          "dayNumber": 1,
          "summary": "主題",
          "activities": [
            {
              "time": "10:00",
              "placeName": "名稱",
              "description": "描述",
              "duration": "例如: 1.5 小時", 
              "website": "官方網站URL",
              "reasoning": "為何選此",
              "cost": 數字 (若免費填 0),
              "transportMethod": "交通方式",
              "transportCost": 數字 (必填，若無填 0),
              "transportTimeMinutes": 數字,
              "googleMapsUri": "URL",
              "latitude": 數字,
              "longitude": 數字,
              "isMeal": boolean
            }
          ]
        }
      ]
    }
    只回傳 JSON。
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
    
    // Safety Fallback: Ensure travelers count exists
    data.travelers = prefs.travelers;
    if (data.currency !== prefs.budget.currency) data.currency = prefs.budget.currency;

    // Safety Fallback
    data.days.forEach(d => {
        d.activities.forEach(a => {
            if (a.transportCost === undefined || a.transportCost === null) a.transportCost = 0;
            if (a.cost === undefined || a.cost === null) a.cost = 0;
            // Ensure duration string exists if missing
            if (!a.duration) a.duration = "1 小時"; 
        });
    });

    return data;

  } catch (error) {
    console.error("Stage 3 Failed:", error);
    throw error;
  }
};