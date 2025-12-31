
import { CandidatePlace, UserPreferences, Hotel } from "../types";

const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371; 
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const isDateInHotelStay = (dateObj: Date, checkInStr: string, checkOutStr: string): boolean => {
    if (!checkInStr || !checkOutStr) return false;
    const checkIn = new Date(checkInStr);
    const checkOut = new Date(checkOutStr);
    // Normalize time components to ensure date-only comparison
    checkIn.setHours(0,0,0,0);
    checkOut.setHours(0,0,0,0);
    dateObj.setHours(0,0,0,0);
    // Logic: Stay covers the night of check-in up to (but not including) the night of check-out.
    // e.g. IN: 1st, OUT: 3rd.
    // 1st: Stay (True)
    // 2nd: Stay (True)
    // 3rd: Checkout (False - usually means we are moving or leaving)
    return dateObj.getTime() >= checkIn.getTime() && dateObj.getTime() < checkOut.getTime();
};

// Helper: Parse time "HH:MM" to hours float
const parseTime = (timeStr: string): number => {
    if (!timeStr) return 9; 
    const [h, m] = timeStr.split(':').map(Number);
    return h + (m / 60);
};

export const rankCandidates = (
  candidates: CandidatePlace[],
  prefs: UserPreferences,
  hotels: Hotel[] 
): CandidatePlace[] => {

  return candidates.map(place => {
    let score = 0;

    // 1. Rating
    const rating = place.rating || 4.0;
    score += (rating / 5) * 100 * 0.3;

    // 2. Interest
    let matchScore = 50; 
    if (prefs.style.focus === 'balanced') matchScore = 80;
    else if (prefs.style.focus === place.category) matchScore = 100;
    else if (place.category === 'sightseeing') matchScore = 70;
    score += matchScore * 0.4;

    // 3. Distance Check (Calculate nearest hotel)
    let minDistance = Infinity;
    hotels.forEach(h => {
        if (h.latitude && h.longitude && place.latitude && place.longitude) {
            const d = calculateDistance(h.latitude, h.longitude, place.latitude, place.longitude);
            if (d < minDistance) minDistance = d;
        }
    });

    if (minDistance !== Infinity) {
        place.distanceFromHotel = parseFloat(minDistance.toFixed(2));
        // Penalize heavily if very far, but don't exclude yet
        if (minDistance > 100) score -= 200; 
        else score += Math.max(0, (1 - minDistance / 30) * 100) * 0.2;
    } else {
        score -= 50; 
    }

    place.score = parseFloat(score.toFixed(1));
    return place;
  }).sort((a, b) => (b.score || 0) - (a.score || 0));
};

export const optimizeRoute = (
  candidates: CandidatePlace[],
  hotels: Hotel[],
  startDateStr: string,
  totalDays: number,
  airportCoords?: { lat: number, lng: number },
  flightTimes?: { start: string, end: string }
): CandidatePlace[] => {
  const finalOrderedList: CandidatePlace[] = [];
  const unvisited = [...candidates];
  const startDate = new Date(startDateStr);
  startDate.setHours(0,0,0,0);

  // Flight Constraints
  const arrivalTime = flightTimes ? parseTime(flightTimes.start) : 10;
  const departureTime = flightTimes ? parseTime(flightTimes.end) : 18;

  // Pace Logic (Hours per spot)
  const paceMap = { relaxed: 2.5, moderate: 1.8, intense: 1.2 };
  const defaultDuration = 1.5; 

  for (let dayNum = 1; dayNum <= totalDays; dayNum++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(startDate.getDate() + (dayNum - 1));
    const currentDayOfWeek = currentDate.getDay();

    // 1. Determine "Base" Location (Where we sleep TONIGHT)
    // If it's the last day, we assume we just checked out from the previous night's hotel.
    let activeHotel = hotels.find(h => isDateInHotelStay(currentDate, h.checkIn, h.checkOut));
    
    // Fallback for last day or gaps: Use the hotel we checked out of this morning
    if (!activeHotel) {
        // Find hotel where checkOut == today
        activeHotel = hotels.find(h => {
            const out = new Date(h.checkOut);
            out.setHours(0,0,0,0);
            return out.getTime() === currentDate.getTime();
        });
        // Ultimate fallback
        if (!activeHotel) activeHotel = hotels[hotels.length - 1];
    }

    // 2. Define Time Budget for Activities
    let currentTime = 9.0; // Standard Start
    let maxTime = 20.0; // Standard End (Dinner time)

    // Day 1: Constraint by Arrival
    if (dayNum === 1) {
        // Flight landing + 2h immigration/transport
        currentTime = Math.max(arrivalTime + 2.0, 9.0);
    }
    // Last Day: Constraint by Departure
    if (dayNum === totalDays) {
        // Flight takeoff - 3h (checkin + transport)
        maxTime = Math.min(departureTime - 3.0, 20.0);
    }

    // Check if we have ANY time window
    const availableHours = maxTime - currentTime;
    
    // Special marker for "Travel Day Only"
    if (availableHours < 1.0) {
         // No time for spots. Just travel.
         // We add a dummy placeholder to ensure the day exists in the structure
         finalOrderedList.push({
             name: dayNum === 1 ? "抵達並前往飯店休息" : "前往機場準備搭機",
             category: 'other',
             rating: 0,
             reviewCount: 0,
             priceLevel: 0,
             latitude: airportCoords?.lat || 0,
             longitude: airportCoords?.lng || 0,
             description: "Travel Time",
             suggestedDay: dayNum,
             matchReason: "時間緊迫，純移動行程",
             openingText: "",
             durationHours: 0
         });
         continue;
    }

    // 3. Current Location Tracker (Simulate movement)
    let currentLoc = { lat: activeHotel.latitude || 0, lng: activeHotel.longitude || 0 };
    
    // If Day 1, start from Airport
    if (dayNum === 1 && airportCoords && airportCoords.lat !== 0) {
        currentLoc = airportCoords;
    }

    // 4. Select Candidates
    // Radius Logic:
    // If Day 1 (Airport -> Hotel), we can pick spots near Airport OR Hotel.
    // If Normal Day, pick spots near Hotel (radius 20km).
    // If Transition Day (Check out A -> Check in B), we might want spots near A or B.
    
    const MAX_RADIUS = 30; // km

    const todaysCandidates = unvisited.filter(p => {
        if (p.closedDays && p.closedDays.includes(currentDayOfWeek)) return false;
        
        let dist = 999;
        if (activeHotel.latitude && activeHotel.longitude && p.latitude && p.longitude) {
            dist = calculateDistance(activeHotel.latitude, activeHotel.longitude, p.latitude, p.longitude);
        }

        // Special check for Day 1: Also allow spots near Airport
        if (dayNum === 1 && airportCoords) {
             const distAirport = calculateDistance(airportCoords.lat, airportCoords.lng, p.latitude, p.longitude);
             if (distAirport < 20) dist = distAirport; // Allow if close to airport
        }

        p.distanceFromHotel = parseFloat(dist.toFixed(1));
        
        // Relax radius if we are running low on candidates
        const effectiveRadius = unvisited.length < 10 ? 100 : MAX_RADIUS;
        
        return dist <= effectiveRadius;
    });

    // 5. Greedy Selection
    let spotsAdded = 0;
    while (currentTime < maxTime && todaysCandidates.length > 0) {
         // Find closest to currentLoc
         let bestIdx = -1;
         let minDist = Infinity;

         for (let i=0; i < todaysCandidates.length; i++) {
             const cand = todaysCandidates[i];
             const d = calculateDistance(currentLoc.lat, currentLoc.lng, cand.latitude, cand.longitude);
             
             // Weighted score: Distance is bad, High Rating is good.
             // Heuristic: d - (score/20)
             const weight = d - ((cand.score || 0) / 20);

             if (weight < minDist) {
                 minDist = weight;
                 bestIdx = i;
             }
         }

         if (bestIdx !== -1) {
             const chosen = todaysCandidates[bestIdx];
             const travelTime = (minDist / 30) + 0.3; // hr
             const duration = chosen.durationHours || defaultDuration;

             if (currentTime + travelTime + duration > maxTime + 0.5) {
                 // Too long, skip this one, try finding a smaller one?
                 // For simplicity, just remove it from today's pool and continue
                 todaysCandidates.splice(bestIdx, 1);
                 continue;
             }

             // Commit
             chosen.suggestedDay = dayNum;
             chosen.matchReason = `Day ${dayNum} (從${spotsAdded === 0 ? (dayNum===1 ? '機場/飯店' : '飯店') : '上一景點'}出發)`;
             finalOrderedList.push(chosen);
             
             // Update logic
             currentTime += travelTime + duration;
             currentLoc = { lat: chosen.latitude, lng: chosen.longitude };
             spotsAdded++;
             
             // Remove from global unvisited
             const gIdx = unvisited.findIndex(u => u.name === chosen.name);
             if (gIdx !== -1) unvisited.splice(gIdx, 1);
             todaysCandidates.splice(bestIdx, 1);
         } else {
             break;
         }
    }

    // 6. NO EMPTY DAYS POLICY
    // If the algorithm failed to find ANY spots (e.g. strict time or bad location match),
    // We MUST force a placeholder so the prompt knows to generate something generic.
    if (spotsAdded === 0) {
        // Try to steal *any* remaining candidate regardless of distance
        if (unvisited.length > 0) {
             const backup = unvisited[0];
             backup.suggestedDay = dayNum;
             backup.matchReason = `Day ${dayNum} (補位行程)`;
             finalOrderedList.push(backup);
             unvisited.shift();
        } else {
            // No candidates left at all. Create a virtual one.
            finalOrderedList.push({
                name: "當日自由探索 (AI自動推薦)",
                category: 'other',
                rating: 0,
                reviewCount: 0,
                priceLevel: 0,
                latitude: activeHotel.latitude || 0,
                longitude: activeHotel.longitude || 0,
                description: "Relaxed exploration",
                suggestedDay: dayNum,
                matchReason: "無特定演算法推薦",
                openingText: "",
                durationHours: 2
            });
        }
    }
  }

  return finalOrderedList;
};
