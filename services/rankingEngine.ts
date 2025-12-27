
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
    checkIn.setHours(0,0,0,0);
    checkOut.setHours(0,0,0,0);
    dateObj.setHours(0,0,0,0);
    return dateObj >= checkIn && dateObj <= checkOut;
};

// Ranking: Heavy penalty for spots far from ALL hotels
export const rankCandidates = (
  candidates: CandidatePlace[],
  prefs: UserPreferences,
  hotels: Hotel[] 
): CandidatePlace[] => {

  return candidates.map(place => {
    let score = 0;
    const reasons: string[] = [];

    // 1. Rating
    const rating = place.rating || 4.0;
    score += (rating / 5) * 100 * 0.3;

    // 2. Interest
    let matchScore = 50; 
    if (prefs.style.focus === 'balanced') matchScore = 80;
    else if (prefs.style.focus === place.category) matchScore = 100;
    else if (place.category === 'sightseeing') matchScore = 70;
    score += matchScore * 0.4;

    // 3. Distance Check (The most important filter for Geo-fencing)
    let minDistance = Infinity;
    let nearestHotelName = "";

    hotels.forEach(h => {
        if (h.latitude && h.longitude && place.latitude && place.longitude) {
            const d = calculateDistance(h.latitude, h.longitude, place.latitude, place.longitude);
            if (d < minDistance) {
                minDistance = d;
                nearestHotelName = h.name;
            }
        }
    });

    if (minDistance !== Infinity) {
        place.distanceFromHotel = parseFloat(minDistance.toFixed(2));
        // Penalize heavily if > 80km from ANY hotel (unless it's a specific custom request keyword match, which we can't easily track here without passing custom keywords, but usually custom request items are fetched specifically)
        if (minDistance > 80) score -= 200; // Nuclear penalty
        else score += Math.max(0, (1 - minDistance / 20) * 100) * 0.2;
        
        if (minDistance < 5) reasons.push(`鄰近${nearestHotelName}`);
    } else {
        score -= 50; // Unknown location
    }

    // 4. Budget Check
    // If budget per person per day is low (< 3000 JPY/TWD approx unit), penalize $$$$
    // Assuming budget.amount is total for all travelers.
    // We don't know currency rate here, so we use PriceLevel (1-4) as heuristic
    if (place.priceLevel === 4) score -= 10; 

    place.score = parseFloat(score.toFixed(1));
    place.matchReason = reasons.join(', ');
    
    return place;
  }).sort((a, b) => (b.score || 0) - (a.score || 0));
};

export const optimizeRoute = (
  candidates: CandidatePlace[],
  hotels: Hotel[],
  startDateStr: string,
  totalDays: number,
  airportCoords?: { lat: number, lng: number } // New Param
): CandidatePlace[] => {
  if (candidates.length === 0) return candidates;

  const unvisited = [...candidates];
  const finalOrderedList: CandidatePlace[] = [];
  const startDate = new Date(startDateStr);
  
  const MAX_SPOTS_PER_DAY = Math.max(3, Math.ceil(candidates.length / totalDays));

  for (let dayNum = 1; dayNum <= totalDays; dayNum++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(startDate.getDate() + (dayNum - 1));
    const currentDayOfWeek = currentDate.getDay();

    // 1. Determine Anchor Point (Start of Day)
    // Day 1: Start from Airport (if avail) OR First Hotel
    // Other Days: Start from Active Hotel
    
    let activeHotel = hotels.find(h => isDateInHotelStay(currentDate, h.checkIn, h.checkOut));
    if (!activeHotel) activeHotel = hotels[hotels.length - 1];

    let startLoc = { lat: activeHotel.latitude || 0, lng: activeHotel.longitude || 0 };
    
    // Day 1 Logic override
    if (dayNum === 1 && airportCoords && airportCoords.lat !== 0) {
        startLoc = airportCoords; 
    }

    // 2. Strict Geo-Filter for this specific day
    const MAX_RADIUS_KM = 60; // Max radius from the Hotel where we sleep
    
    const availableToday = unvisited.filter(p => {
       if (p.closedDays && p.closedDays.includes(currentDayOfWeek)) return false;
       if (p.score && p.score < 0) return false; // Filter out nuclear penalty items

       // Distance Check: Must be close to the hotel of the day
       // (Exception: On Day 1, if we land at Airport A and Hotel is B, we might visit spots between A and B. 
       //  But generally, stick to hotel radius is safer for user satisfaction)
       if (activeHotel?.latitude && activeHotel?.longitude && p.latitude && p.longitude) {
           const dist = calculateDistance(activeHotel.latitude, activeHotel.longitude, p.latitude, p.longitude);
           if (dist > MAX_RADIUS_KM) return false;
           p.distanceFromHotel = parseFloat(dist.toFixed(1));
           return true;
       }
       return false;
    });

    if (availableToday.length === 0) continue;

    // 3. TSP / Greedy
    let currentLoc = startLoc;
    
    // If startLoc is invalid (0,0), pick first candidate
    if (currentLoc.lat === 0) {
        currentLoc = { lat: availableToday[0].latitude, lng: availableToday[0].longitude };
    }

    let spotsCount = 0;
    const todaysPool = [...availableToday]; 

    while (todaysPool.length > 0 && spotsCount < MAX_SPOTS_PER_DAY) {
        let bestIdx = -1;
        let minMove = Infinity;

        for (let i = 0; i < todaysPool.length; i++) {
            const cand = todaysPool[i];
            const moveDist = calculateDistance(currentLoc.lat, currentLoc.lng, cand.latitude, cand.longitude);
            
            if (moveDist < minMove) {
                minMove = moveDist;
                bestIdx = i;
            }
        }

        if (bestIdx !== -1) {
            const chosen = todaysPool[bestIdx];
            chosen.suggestedDay = dayNum;
            // Provide context for Stage 3 to understand why this was picked
            const distLabel = dayNum === 1 && airportCoords ? '機場/飯店' : activeHotel.name;
            chosen.matchReason = `Day ${dayNum} (距${distLabel}約${parseFloat(minMove.toFixed(1))}km)`;
            
            finalOrderedList.push(chosen);
            
            currentLoc = { lat: chosen.latitude, lng: chosen.longitude };
            
            const globalIdx = unvisited.findIndex(u => u.name === chosen.name);
            if (globalIdx !== -1) unvisited.splice(globalIdx, 1);
            todaysPool.splice(bestIdx, 1);
            spotsCount++;
        } else {
            break;
        }
    }
  }

  return finalOrderedList;
};
