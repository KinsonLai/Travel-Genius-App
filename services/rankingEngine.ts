
import { CandidatePlace, UserPreferences, Hotel } from "../types";

// Haversine formula to calculate distance (in km) between two coordinates
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Check if a specific date is inside a hotel's stay range (Inclusive)
const isDateInHotelStay = (dateObj: Date, checkInStr: string, checkOutStr: string): boolean => {
    if (!checkInStr || !checkOutStr) return false;
    const checkIn = new Date(checkInStr);
    const checkOut = new Date(checkOutStr);
    checkIn.setHours(0,0,0,0);
    checkOut.setHours(0,0,0,0);
    dateObj.setHours(0,0,0,0);
    return dateObj >= checkIn && dateObj <= checkOut;
};

// Main Ranking Function
export const rankCandidates = (
  candidates: CandidatePlace[],
  prefs: UserPreferences,
  hotels: Hotel[] 
): CandidatePlace[] => {

  return candidates.map(place => {
    let score = 0;
    const reasons: string[] = [];

    // 1. Rating (30%)
    const rating = place.rating || 4.0;
    score += (rating / 5) * 100 * 0.3;

    // 2. Interest (40%)
    let matchScore = 50; 
    if (prefs.style.focus === 'balanced') matchScore = 80;
    else if (prefs.style.focus === place.category) matchScore = 100;
    else if (place.category === 'sightseeing') matchScore = 70; // General appeal
    score += matchScore * 0.4;

    // 3. Distance (20%) - Check distance to ANY hotel to validate it's relevant at all
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
        // Strict Penalty for being very far from ALL hotels (e.g. > 100km)
        if (minDistance > 100) score -= 50; 
        else score += Math.max(0, (1 - minDistance / 30) * 100) * 0.2;
        
        if (minDistance < 5) reasons.push(`鄰近${nearestHotelName}`);
    } else {
        score += 10; // Unknown location penalty
    }

    // 4. Budget (10%)
    // Simple logic: if budget is low, penalize expensive places
    if (prefs.budget.amount < 10000 && place.priceLevel > 3) score -= 20;
    else score += 10;

    place.score = parseFloat(score.toFixed(1));
    place.matchReason = reasons.join(', ');
    
    return place;
  }).sort((a, b) => (b.score || 0) - (a.score || 0));
};

/**
 * 嚴格地理圍欄演算法 (Strict Geo-Fencing Optimization)
 * 確保 Day N 的景點只會安排在 Day N 住宿點的合理半徑內。
 */
export const optimizeRoute = (
  candidates: CandidatePlace[],
  hotels: Hotel[],
  startDateStr: string,
  totalDays: number
): CandidatePlace[] => {
  if (candidates.length === 0) return candidates;

  const unvisited = [...candidates];
  const finalOrderedList: CandidatePlace[] = [];
  const startDate = new Date(startDateStr);
  
  // Dynamic capacity: if many days, spread them out. If few days, pack them.
  const MAX_SPOTS_PER_DAY = Math.max(3, Math.ceil(candidates.length / totalDays));

  for (let dayNum = 1; dayNum <= totalDays; dayNum++) {
    // 1. Setup Day Context
    const currentDate = new Date(startDate);
    currentDate.setDate(startDate.getDate() + (dayNum - 1));
    const currentDayOfWeek = currentDate.getDay();

    // 2. Identify Active Hotel (Where we sleep tonight, or wake up today)
    // Priority: Hotel covering this date range.
    let activeHotel = hotels.find(h => isDateInHotelStay(currentDate, h.checkIn, h.checkOut));
    
    // Check if it's a "Transfer Day" (Check-out date of Hotel A == Check-in date of Hotel B)
    // If today is strictly equal to a hotel's Check-Out date, we might be moving.
    // Ideally, we look at where we sleep tonight. 
    // Logic: isDateInHotelStay uses inclusive range. If ranges overlap (A ends 10th, B starts 10th), 
    // find() returns the first one (A). This is acceptable: Day 10 activities near Hotel A (morning) or B (evening).
    // For simplicity in this algo: we prioritize the hotel where we are likely "based" for the day.
    
    if (!activeHotel) activeHotel = hotels[hotels.length - 1]; // Fallback
    
    // 3. Filter Candidates by "Geo-Fence"
    // Valid spots must be within X km of the active hotel.
    // If it's a multi-city trip, this is CRITICAL to filter out Tokyo spots when in Osaka.
    const MAX_RADIUS_KM = 60; // Reasonable daily travel radius

    const availableToday = unvisited.filter(p => {
       // A. Time Check
       if (p.closedDays && p.closedDays.includes(currentDayOfWeek)) return false;

       // B. Geo Check
       if (activeHotel?.latitude && activeHotel?.longitude && p.latitude && p.longitude) {
           const dist = calculateDistance(activeHotel.latitude, activeHotel.longitude, p.latitude, p.longitude);
           
           // If strict filter fails, check if this is a "Transfer Day"
           // (Advanced: check if spot is between Hotel A and Hotel B).
           // For now, strict filter is safer to solve the user's complaint.
           if (dist > MAX_RADIUS_KM) return false;
           
           p.distanceFromHotel = parseFloat(dist.toFixed(1));
           return true;
       }
       // If coords missing, include it but with low priority (risky)
       return true; 
    });

    if (availableToday.length === 0) continue;

    // 4. TSP / Greedy Path finding
    let currentLoc = { lat: activeHotel.latitude || 0, lng: activeHotel.longitude || 0 };
    // If hotel has no coords, pick first available spot as anchor
    if (currentLoc.lat === 0) {
        currentLoc = { lat: availableToday[0].latitude, lng: availableToday[0].longitude };
    }

    let spotsCount = 0;
    const todaysPool = [...availableToday]; // Local copy to eat up

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
            chosen.matchReason = `Day ${dayNum} (${activeHotel.name} 距離 ${chosen.distanceFromHotel}km)`;
            
            finalOrderedList.push(chosen);
            
            // Move pointer
            currentLoc = { lat: chosen.latitude, lng: chosen.longitude };
            
            // Remove from global unvisited
            const globalIdx = unvisited.findIndex(u => u.name === chosen.name);
            if (globalIdx !== -1) unvisited.splice(globalIdx, 1);
            
            // Remove from local pool
            todaysPool.splice(bestIdx, 1);
            spotsCount++;
        } else {
            break;
        }
    }
  }

  // 5. Leftovers?
  // If we have leftovers, they are either:
  // a) Closed on the days we were near them
  // b) Too far from ANY hotel we stayed at (if we have gaps in filtering)
  // We DISCARD them rather than forcing them into wrong days, to strictly satisfy the user's requirement.
  
  return finalOrderedList;
};
