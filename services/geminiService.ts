
import { GoogleGenAI } from "@google/genai";
import { UserPreferences, ItineraryResult, CandidatePlace } from "../types";
import { rankCandidates } from "./rankingEngine";

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

// Helper to extract Array JSON if model returns array directly
const cleanJsonArrayString = (str: string) => {
    let cleaned = str.replace(/```json\n?/g, '').replace(/```/g, '');
    const firstBracket = cleaned.indexOf('[');
    const lastBracket = cleaned.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket !== -1) {
      cleaned = cleaned.substring(firstBracket, lastBracket + 1);
    }
    return cleaned;
};

export const generateItinerary = async (prefs: UserPreferences): Promise<ItineraryResult> => {
  const apiKey = import.meta.env.VITE_API_KEY;
  if (!apiKey) throw new Error("API Key 未設定。");

  const ai = new GoogleGenAI({ apiKey });

  // ==========================================
  // STAGE 1: Candidate Search (Cost Optimization: Use Flash)
  // ==========================================
  console.log("Stage 1: Fetching raw candidates (Using Flash)...");
  
  const step1Prompt = `
    你是一個資料採集助手。請針對以下旅遊需求，搜尋並列出 20 個推薦的候選地點（景點、餐廳、購物點）。
    不要安排行程，只需要提供原始資料供後續演算法計算。

    【用戶資訊】
    - 地點/機場: ${prefs.airport}
    - 住宿: ${prefs.hotels[0].name} ${prefs.hotels[0].location}
    - 興趣: ${prefs.style.focus}
    - 預算: ${prefs.budget.currency} ${prefs.budget.amount}
    
    【*** 特別重要要求 ***】
    用戶有額外的客製化需求："${prefs.customRequests || '無'}"。
    如果這個需求包含前往其他城市（例如一日遊、即日來回），**請務必搜尋該目標城市的熱門景點**並加入候選清單中，即使它離住宿地點較遠。

    請同時尋找用戶第一間住宿 (${prefs.hotels[0].name}) 的大約經緯度，放在回傳資料的 "hotelCoords" 欄位。

    回傳格式必須是標準 JSON 物件，包含兩個部分：
    1. "hotelCoords": { "lat": number, "lng": number }
    2. "candidates": 一個陣列，每個物件包含：
       - "name": 地點名稱 (String)
       - "category": 類別 (String, 只能是 'sightseeing', 'food', 'shopping', 'culture', 'other' 其中之一)
       - "rating": Google 評分 (Number, 1.0-5.0)
       - "reviewCount": 評論數 (Number)
       - "priceLevel": 價格等級 (Number, 1=便宜, 2=適中, 3=昂貴, 4=奢華)
       - "latitude": 緯度 (Number)
       - "longitude": 經度 (Number)
       - "description": 簡短描述 (String, 30字以內)
  `;

  let candidates: CandidatePlace[] = [];
  let hotelCoords = { lat: 0, lng: 0 };

  try {
      // 策略調整：使用 gemini-2.5-flash 進行搜尋
      // Flash 擅長快速檢索且便宜，適合 Stage 1
      const resp1 = await ai.models.generateContent({
          model: "gemini-2.5-flash", 
          contents: step1Prompt,
          config: { 
              responseMimeType: "application/json",
              tools: [{ googleSearch: {} }] 
          }
      });
      
      const rawData = JSON.parse(cleanJsonString(resp1.text || "{}"));
      candidates = rawData.candidates || [];
      hotelCoords = rawData.hotelCoords || { lat: 0, lng: 0 };
      
      console.log(`Stage 1 Complete. Found ${candidates.length} candidates.`);

  } catch (e) {
      console.error("Stage 1 Failed:", e);
      throw new Error("搜尋景點失敗，請稍後再試。");
  }

  // ==========================================
  // STAGE 2: Hardcoded Ranking Engine (No Cost)
  // ==========================================
  console.log("Stage 2: Running Ranking Engine...");
  
  // Apply the mathematical formula
  const rankedCandidates = rankCandidates(candidates, prefs, hotelCoords.lat !== 0 ? hotelCoords : undefined);
  
  // Take top 15 items for the trip
  const topCandidates = rankedCandidates.slice(0, 15);
  
  // ==========================================
  // STAGE 3: Final Planning (Performance: Use Pro)
  // ==========================================
  console.log("Stage 3: Generating Final Itinerary (Using Pro)...");

  // TOKEN SAVING STRATEGY:
  // Pro 模型很聰明，它不需要我們傳入冗長的 "description" 就能知道 "東京鐵塔" 是什麼。
  // 我們在這裡將 topCandidates 進行「瘦身」，移除描述欄位，只保留決策需要的數據。
  // 這可以顯著減少 Input Token 的消耗。
  const minimizedCandidates = topCandidates.map(c => ({
      name: c.name,
      cat: c.category,
      lat: c.latitude,
      lng: c.longitude,
      score: c.score,
      rating: c.rating,
      price: c.priceLevel,
      matchReason: c.matchReason // 保留排名理由，讓 AI 知道為什麼選這個
      // description 被移除
  }));

  const schemaDescription = JSON.stringify({
    tripTitle: "旅程標題",
    totalCostEstimate: "總花費 (Number)",
    currency: "貨幣代碼",
    summary: "行程總結",
    days: [
      {
        date: "YYYY-MM-DD",
        dayNumber: "Number",
        summary: "當天主題",
        activities: [
          {
            time: "HH:MM",
            placeName: "地點名稱",
            description: "描述 (請重新生成生動的描述)",
            reasoning: "顯示 Ranking 引擎計算的結果",
            matchTags: ["Tag1", "Tag2"],
            cost: "費用 (Number)",
            currency: "貨幣",
            transportMethod: "交通方式",
            transportCost: "交通費 (Number)",
            transportTimeMinutes: "交通時間 (Number)",
            googleMapsUri: "URL",
            rating: "評分字串",
            isMeal: "Boolean",
            latitude: "Number",
            longitude: "Number"
          }
        ]
      }
    ]
  }, null, 2);

  const step3Prompt = `
    你現在是行程規劃執行者。我已經透過演算法計算出 Ranking 最高的景點。
    請使用以下提供的【已排序候選名單】，根據地理位置順序（Routing）和營業時間，將它們填入行程表。

    【用戶資訊】
    - 日期: ${prefs.dates.start} (${prefs.dates.startTime}) 到 ${prefs.dates.end} (${prefs.dates.endTime})
    - 人數: ${prefs.travelers}
    - 預算: ${prefs.budget.amount} ${prefs.budget.currency}
    - 交通偏好: ${prefs.style.transportPreference}
    - *** 客製化要求 (Strict) ***: "${prefs.customRequests || '無'}"

    【已排序且計算過分數的候選名單 (高分優先，已精簡資料)】
    ${JSON.stringify(minimizedCandidates, null, 2)}

    【規劃要求】
    1. **嚴格執行客製化要求**: 如果用戶要求去特定城市一日遊 (即使不在候選名單前幾名，或距離較遠)，請務必優先安排一天滿足該需求，並在該日的 summary 說明。
       - 例如：若要求「去熊本一日遊」，請找出名單中的熊本景點，集中排在同一天，並計算來回交通時間與成本 (如新幹線)。
    2. **路線優化**: 雖然名單是按分數排的，但安排時請考慮地理順路（不要東奔西跑）。
    3. **理由說明**: 在 output JSON 的 "reasoning" 欄位，引用該地點的 "score" 分數。如果是為了滿足客製化要求而選的點，請在 reasoning 中註明「響應用戶特別要求」。
    4. **預算分配**: 若用戶選擇「經濟優先」，請選擇便宜的交通方式。
    5. **完整性**: 必須填滿所有旅遊日期。如果候選名單不夠用，你可以自行補充少量順路的點，但在 reasoning 中註明是「AI 補充」。
    
    【輸出格式】
    純 JSON。結構如下：
    ${schemaDescription}
  `;

  try {
    // 策略維持：使用 gemini-3-pro-preview 進行複雜的路線與邏輯規劃
    // 因為我們已經縮減了 Input 資料，這裡的 Token 費用會降低，但仍保有 Pro 的邏輯能力
    const resp3 = await ai.models.generateContent({
      model: "gemini-3-pro-preview", 
      contents: step3Prompt,
      config: {
        responseMimeType: "application/json",
        // Still allow tools in step 3 to fetch accurate open hours or transport info if needed
        tools: [{ googleSearch: {} }, { googleMaps: {} }],
      },
    });

    const text = resp3.text;
    if (!text) throw new Error("No response from Gemini Stage 3");
    
    const data = JSON.parse(cleanJsonString(text)) as ItineraryResult;
    
    // Inject traveler count and fallback consistency
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
