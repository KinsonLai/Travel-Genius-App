export interface Hotel {
  id: string;
  name: string;
  checkIn: string;
  checkOut: string;
  location: string; // Could be address or area name
}

export interface UserPreferences {
  dates: {
    start: string;
    end: string;
    startTime: string; // e.g. "10:00"
    endTime: string;
  };
  travelers: number; // New field for number of people
  airport: string;
  hotels: Hotel[];
  budget: {
    amount: number;
    currency: string;
  };
  style: {
    pace: 'relaxed' | 'moderate' | 'intense'; // 休閒, 適中, 特種兵
    focus: 'sightseeing' | 'shopping' | 'food' | 'culture' | 'balanced';
    transportPreference: 'cheaper' | 'faster' | 'balanced'; // 省錢(巴士), 省時(新幹線), 平衡
  };
}

export interface Activity {
  time: string;
  placeName: string;
  description: string;
  cost: number;
  currency: string;
  transportMethod?: string;
  transportCost?: number;
  transportTimeMinutes?: number;
  latitude?: number;
  longitude?: number;
  googleMapsUri?: string;
  rating?: string;
  isMeal?: boolean;
}

export interface DayPlan {
  date: string;
  dayNumber: number;
  summary: string;
  activities: Activity[];
}

export interface ItineraryResult {
  tripTitle: string;
  totalCostEstimate: number;
  currency: string;
  summary: string;
  days: DayPlan[];
  exchangeRateUsed?: number;
  travelers?: number; // Added field to persist traveler count
}