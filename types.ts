
export interface Hotel {
  id: string;
  name: string;
  checkIn: string;
  checkOut: string;
  location: string; // Could be address or area name
  // Optional coordinates for distance calc
  latitude?: number;
  longitude?: number;
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
  customRequests?: string; // New: Free text for specific requirements (e.g. day trips)
}

// Intermediate type for the Ranking Engine
export interface CandidatePlace {
  name: string;
  category: 'sightseeing' | 'shopping' | 'food' | 'culture' | 'other';
  rating: number; // 1-5
  reviewCount: number;
  priceLevel: number; // 1-4 ($, $$, $$$, $$$$)
  latitude: number;
  longitude: number;
  description: string;
  
  // New: Time Constraint Dictionary Data
  // 0=Sun, 1=Mon, ..., 6=Sat
  closedDays?: number[]; 
  openingText?: string; // e.g. "10:00 - 22:00"

  // Calculated fields
  score?: number;
  distanceFromHotel?: number; // km
  matchReason?: string;
  
  // Algorithm output
  suggestedDay?: number; // Which day of the trip (1-based) the algo assigned this to
}

export interface Activity {
  time: string;
  placeName: string;
  description: string;
  reasoning: string; // New: AI explains why this spot was ranked high
  matchTags: string[]; // New: e.g. ["高評價", "距離近", "符合預算"]
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
