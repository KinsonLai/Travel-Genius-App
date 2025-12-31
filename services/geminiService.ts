
import { GoogleGenAI } from "@google/genai";
import { UserPreferences, ItineraryResult, CandidatePlace, Hotel, DayPlan } from "../types";
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

// Robust API Key Retrieval
const getApiKey = () => {
    const meta = import.meta as any;
    let key = "";

    // 1. Try Standard Vite Env
    if (meta.env && meta.env.VITE_API_KEY) {
        key = meta.env.VITE_API_KEY;
    } 
    // 2. Try process.env (Standard Node/Webpack fallback)
    else if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
        key = process.env.API_KEY;
    }
    // 3. Try generic VITE_ key via process (sometimes necessary in specific pipelines)
    else if (typeof process !== 'undefined' && process.env && process.env.VITE_API_KEY) {
        key = process.env.VITE_API_KEY;
    }

    // Debugging for Netlify (Will show in Browser Console)
    if (!key) {
        console.error("API Key Search Failed. Checked: import.meta.env.VITE_API_KEY, process.env.API_KEY");
        console.log("Current import.meta.env:", JSON.stringify(meta.env || {}, null, 2));
    }

    return key;
};

// New: Ensure every day exists in the result
const sanitizeItineraryDates = (data: ItineraryResult, startStr: string, totalDays: number): ItineraryResult => {
    const startDate = new Date(startStr);
    const correctedDays: DayPlan[] = [];

    for (let i = 1; i <= totalDays; i++) {
        // Calculate expected date string YYYY-MM-DD
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + (i - 1));
        // Handle timezone offset simply by string manipulation or UTC to avoid shifts
        const dateStr = d.toISOString().split('T')[0];

        // Find if AI generated this day
        const existingDay = data.days.find(day => day.dayNumber === i);

        if (existingDay) {
            correctedDays.push({
                ...existingDay,
                date: dateStr // Force correct date format
            });
        } else {
            // AI missed a day! Inject placeholder.
            console.warn(`AI missing Day ${i}, injecting placeholder.`);
            correctedDays.push({
                dayNumber: i,
                date: dateStr,
                summary: "自由探索日 (AI 自動補全)",
                activities: [
                    {
                        time: "10:00",
                        placeName: "市區自由活動",
                        description: "探索當地街道、咖啡廳或根據當下心情安排。",
                        reasoning: "保留彈性時間，享受漫遊樂趣。",
                        matchTags: ["彈性", "休閒"],
                        duration: "4 小時",
                        cost: 0,
                        currency: data.currency,
                        latitude: 0,
                        longitude: 0,
                        isMeal: false
                    }
                ]
            });
        }
    }
    
    // Sort by day number
    correctedDays.sort((a, b) => a.dayNumber - b.dayNumber);
    data.days = correctedDays;
    return data;
};

export const generateItinerary = async (prefs: UserPreferences): Promise<ItineraryResult> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API Key 未讀取到。請確認 Netlify 環境變數設為 'VITE_API_KEY'。");

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
        任務：針對住宿點「${hotel.name}」(${hotel.location}) 搜尋 25 個適合的旅遊地點(景點/餐廳)。
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
  const topCandidates = rankedCandidates.slice(0, 60); // Use top 60 to prevent running out
  
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
    1. **完整日期**: 行程必須完整包含從 Day 1 到 Day ${totalDays} 的每一天。
       請檢查以下日期列表，一天都不能少：
       ${dateListStr}
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
    4. 確保 Day 1 到 Day ${totalDays} 都有資料。

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
    
    let data = JSON.parse(cleanJsonString(text)) as ItineraryResult;
    
    // Critical Fix: Sanitize dates to ensure no day is missing
    data = sanitizeItineraryDates(data, prefs.dates.start, totalDays);

    data.travelers = prefs.travelers;
    if (data.currency !== prefs.budget.currency) data.currency = prefs.budget.currency;

    return data;

  } catch (error) {
    console.error("Stage 3 Failed:", error);
    throw error;
  }
};
