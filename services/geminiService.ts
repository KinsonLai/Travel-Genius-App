import { GoogleGenAI, Type } from "@google/genai";
import { UserPreferences, ItineraryResult } from "../types";

// Helper to clean JSON string if Markdown code blocks are present
const cleanJsonString = (str: string) => {
  // Remove markdown code blocks
  let cleaned = str.replace(/```json\n?/g, '').replace(/```/g, '');
  // Sometimes the model might output text before the JSON, find the first '{' and last '}'
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }
  return cleaned;
};

export const generateItinerary = async (prefs: UserPreferences): Promise<ItineraryResult> => {
  // Safe env check
  let apiKey = "";
  if (import.meta.env && import.meta.env.VITE_API_KEY) {
    apiKey = import.meta.env.VITE_API_KEY;
  } else if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
    apiKey = process.env.API_KEY;
  }
  
  if (!apiKey) {
    console.error("API Key is missing. Please check your .env file or Netlify Environment Variables.");
    throw new Error("API Key 未設定。請在 Netlify 設定中加入 VITE_API_KEY。");
  }

  const ai = new GoogleGenAI({ apiKey });

  const schemaDescription = JSON.stringify({
    tripTitle: "旅程標題 (String)",
    totalCostEstimate: "單人總預估花費 (Number) - 必須是轉匯後的數字",
    currency: "用戶選擇的貨幣代碼 (String)",
    exchangeRateUsed: "使用的匯率 (Number, 1當地貨幣 = ? 用戶貨幣)",
    summary: "行程總結 (String)",
    days: [
      {
        date: "YYYY-MM-DD",
        dayNumber: "Number",
        summary: "當天主題 (String)",
        activities: [
          {
            time: "HH:MM",
            placeName: "地點名稱 (String)",
            description: "活動描述 (String) - 包含選擇此景點的原因(基於優先度)",
            cost: "單人活動/餐飲費用 (Number) - 必須是每人的費用",
            currency: "用戶選擇的貨幣代碼 (String)",
            transportMethod: "交通方式 (String)",
            transportCost: "單人交通費 (Number) - 必須是每人的費用 (計程車請自行除以人數)",
            transportTimeMinutes: "交通時間分鐘 (Number)",
            googleMapsUri: "地圖連結 (String)",
            rating: "評價 (String)",
            isMeal: "Boolean",
            latitude: "緯度 (Number)",
            longitude: "經度 (Number)"
          }
        ]
      }
    ]
  }, null, 2);

  // Construct a prompt that guides the model through the logic
  const prompt = `
    你是一位專業的智能旅行規劃師。請根據以下用戶輸入，規劃一個完整的旅遊行程。

    【用戶資訊】
    - 出發日期: ${prefs.dates.start} ${prefs.dates.startTime}
    - 回程日期: ${prefs.dates.end} ${prefs.dates.endTime}
    - 旅遊人數: ${prefs.travelers} 人
    - 機場: ${prefs.airport}
    - **每人**預算 (扣除機票住宿後的當地消費預算): ${prefs.budget.amount} ${prefs.budget.currency} (請嚴格控制在此範圍內)
    - 旅遊風格: ${prefs.style.pace} (節奏), ${prefs.style.focus} (重點)
    - 交通偏好: ${prefs.style.transportPreference} (效率 vs 金錢)
    - 住宿清單:
      ${prefs.hotels.map((h, i) => `${i + 1}. ${h.name} (${h.location})`).join('\n')}

    【核心規劃邏輯 (必須嚴格執行)】
    1. **資訊獲取 (Information Retrieval)**:
       - 針對住宿地點周邊，使用 Google Search 搜尋所有潛在景點。
       - 獲取每個候選景點的詳細資訊：距離酒店距離、評價 (Rating)、熱門程度、預估成本、交通時間及成本、營業時間、休息日 (Closed Days)。
       - **務必**檢查景點在旅遊當天是否營業（避免白去一趟）。

    2. **優先度係數計算與排序 (Priority Ranking)**:
       - 為每個候選景點計算一個「優先度係數」。
       - **計算因子**:
         - **用戶偏好匹配度**: ${prefs.style.focus} (例如用戶選「美食」，則高分餐廳係數極高)。
         - **評價與熱門度**: 優先選擇 Rating > 4.0 且評論數多的景點。
         - **距離與順路**: 離酒店近或與其他高分景點順路的，係數加分。
         - **成本效益**: 符合預算限制的景點加分。
       - 根據計算出的係數，將景點進行 Ranking (排名)，優先安排高分景點。

    3. **行程安排與預算分配**:
       - 根據 Ranking 結果填入行程表。
       - **預算合理化**: 如果用戶預算較低 (${prefs.budget.amount} ${prefs.budget.currency} 對於該地區算低)，請將較貴的體驗/美食安排在午餐 (通常較便宜)，晚餐選擇平價美食。
       - **交通選擇**: 嚴格遵守「${prefs.style.transportPreference}」。
         - 若選「效率優先」：即使貴，也優先選新幹線/特急/計程車以節省時間。
         - 若選「經濟優先」：優先選巴士/普通電車。
         - 若選「平衡」：比較時間與金錢的性價比。
         - **必須考慮**: 機場往返酒店、酒店移動、景點間移動的具體交通成本與時間。

    4. **費用計算規則 (非常重要)**:
       - JSON 輸出的 \`cost\` 和 \`transportCost\` 必須是 **單人費用 (Per Person)**。
       - 如果是計程車或包車等共乘交通工具，請先計算總價，然後除以 ${prefs.travelers} 人，得出單人費用填入。
       - 找出 當地貨幣 對 ${prefs.budget.currency} 的最新匯率，將所有金額轉為 ${prefs.budget.currency}。

    5. **地圖資訊**: 
       - 每個活動 (activities) **必須** 包含 \`latitude\` (緯度) 和 \`longitude\` (經度) 數值，以便在地圖上繪製路線。

    【輸出格式】
    請務必返回 **純 JSON 格式**，嚴格遵守以下結構。不要包含任何 Markdown 標記以外的閒聊文字。

    【JSON 結構範例】
    ${schemaDescription}
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash", 
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }, { googleMaps: {} }],
      },
    });

    const text = response.text;
    if (!text) throw new Error("No response from Gemini");
    
    // Parse the JSON
    try {
      const data = JSON.parse(cleanJsonString(text)) as ItineraryResult;
      
      // Double check currency consistency in case AI hallucinates
      if (data.currency !== prefs.budget.currency) {
          console.warn(`AI returned wrong currency ${data.currency}, expected ${prefs.budget.currency}. Overriding label but numbers might be off.`);
          data.currency = prefs.budget.currency;
      }

      // CRITICAL FIX: Inject the traveler count from preferences into the result
      data.travelers = prefs.travelers;

      return data;
    } catch (e) {
      console.error("Failed to parse JSON:", text);
      throw new Error("無法解析 AI 回傳的行程資料，請重試。");
    }

  } catch (error) {
    console.error("Error generating itinerary:", error);
    throw error;
  }
};