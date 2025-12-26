
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

// Main Ranking Function
export const rankCandidates = (
  candidates: CandidatePlace[],
  prefs: UserPreferences,
  hotelLocation?: { lat: number, lng: number } // Coordinates of the main hotel
): CandidatePlace[] => {

  return candidates.map(place => {
    let score = 0;
    const reasons: string[] = [];

    // 1. Rating Score (Weight: 30%)
    const rating = place.rating || 4.0;
    const ratingScore = (rating / 5) * 100;
    score += ratingScore * 0.3;
    if (rating >= 4.5) reasons.push(`高評價(${rating})`);

    // 2. Interest Match Score (Weight: 40%)
    let matchScore = 50; 
    if (prefs.style.focus === 'balanced') {
        matchScore = 80; 
    } else if (prefs.style.focus === place.category) {
        matchScore = 100; 
        reasons.push(`符合興趣(${prefs.style.focus})`);
    } else if (
        (prefs.style.focus === 'sightseeing' && place.category === 'culture') ||
        (prefs.style.focus === 'culture' && place.category === 'sightseeing')
    ) {
        matchScore = 80; 
    } else if (prefs.style.focus === 'food' && place.category !== 'food') {
        matchScore = 30; 
    }
    score += matchScore * 0.4;

    // 3. Distance/Logistics Score (Weight: 20%)
    let distScore = 50; 
    if (hotelLocation && place.latitude && place.longitude) {
        const dist = calculateDistance(hotelLocation.lat, hotelLocation.lng, place.latitude, place.longitude);
        place.distanceFromHotel = parseFloat(dist.toFixed(2));
        
        const maxDist = 10; 
        distScore = Math.max(0, (1 - dist / maxDist) * 100);
        
        if (dist < 2) reasons.push(`離酒店近(${place.distanceFromHotel}km)`);
    }
    score += distScore * 0.2;

    // 4. Budget/Price Score (Weight: 10%)
    let priceScore = 50;
    const days = (new Date(prefs.dates.end).getTime() - new Date(prefs.dates.start).getTime()) / (1000 * 3600 * 24);
    const avgBudgetPerDay = prefs.budget.amount / (days || 1);
    
    if (avgBudgetPerDay < 3000) { // Low budget
        if (place.priceLevel <= 2) {
            priceScore = 100;
            reasons.push("符合預算");
        } else {
            priceScore = 20;
        }
    } else {
        priceScore = 80; 
    }
    score += priceScore * 0.1;

    // Finalize
    place.score = parseFloat(score.toFixed(1));
    place.matchReason = `綜合評分: ${place.score} | ${reasons.join(', ')}`;
    
    return place;
  }).sort((a, b) => (b.score || 0) - (a.score || 0)); // Sort descending
};

/**
 * 核心演算法：Day-Aware Route Optimization
 * 結合 Graph (最近鄰路徑) 與 Dictionary (營業時間查詢)
 * 
 * 1. 根據旅行天數，將行程分為 N 天。
 * 2. 針對第 i 天，查詢今天是星期幾。
 * 3. 從候選池中，過濾掉今天沒開的店 (Dictionary Lookup)。
 * 4. 在剩下的可用景點中，執行貪婪路徑搜尋 (Nearest Neighbor)，串接最順路的行程。
 */
export const optimizeRoute = (
  candidates: CandidatePlace[],
  hotelLocation: { lat: number, lng: number },
  startDateStr: string,
  totalDays: number
): CandidatePlace[] => {
  if (!hotelLocation || candidates.length === 0) return candidates;

  const unvisited = [...candidates];
  const finalOrderedList: CandidatePlace[] = [];
  const startDate = new Date(startDateStr);
  
  // 為了避免單日塞太多，設定一個軟上限 (可根據節奏調整)
  const MAX_SPOTS_PER_DAY = Math.ceil(candidates.length / totalDays) + 1;

  for (let dayNum = 1; dayNum <= totalDays; dayNum++) {
    // 1. Determine current Day of Week (0-6)
    const currentDate = new Date(startDate);
    currentDate.setDate(startDate.getDate() + (dayNum - 1));
    const currentDayOfWeek = currentDate.getDay(); // 0 = Sun, 1 = Mon...

    // 2. Identify available candidates for this specific day
    // Using the 'closedDays' dictionary
    const availableToday = unvisited.filter(p => {
       if (!p.closedDays || p.closedDays.length === 0) return true;
       return !p.closedDays.includes(currentDayOfWeek);
    });

    if (availableToday.length === 0) continue;

    // 3. Graph Search: Build a route for today using Nearest Neighbor
    let currentLoc = hotelLocation;
    let spotsTodayCount = 0;
    
    // Create a local mutable copy for today's pathfinding
    const todaysPool = [...availableToday];

    while (todaysPool.length > 0 && spotsTodayCount < MAX_SPOTS_PER_DAY) {
        let nearestIdx = -1;
        let minDist = Infinity;

        // Find nearest neighbor in today's pool
        for (let i = 0; i < todaysPool.length; i++) {
            const candidate = todaysPool[i];
            if (!candidate.latitude || !candidate.longitude) continue;

            const dist = calculateDistance(
                currentLoc.lat,
                currentLoc.lng,
                candidate.latitude,
                candidate.longitude
            );

            if (dist < minDist) {
                minDist = dist;
                nearestIdx = i;
            }
        }

        if (nearestIdx !== -1) {
            const bestPlace = todaysPool[nearestIdx];
            
            // Mark assigned info
            bestPlace.suggestedDay = dayNum; 
            if (bestPlace.closedDays && bestPlace.closedDays.length > 0) {
               bestPlace.matchReason += ` | 自動安排於Day ${dayNum} (避開公休)`;
            }

            finalOrderedList.push(bestPlace);
            
            // Update Location to this place (Greedy Chain)
            currentLoc = { lat: bestPlace.latitude, lng: bestPlace.longitude };
            
            // Remove from global unvisited and local pool
            const globalIdx = unvisited.findIndex(p => p.name === bestPlace.name);
            if (globalIdx !== -1) unvisited.splice(globalIdx, 1);
            
            todaysPool.splice(nearestIdx, 1);
            spotsTodayCount++;
        } else {
            break;
        }
    }
  }

  // 4. Handle leftovers (impossible constraints or overflow)
  // Just append them at the end so they aren't lost, let AI decide or warn
  if (unvisited.length > 0) {
      unvisited.forEach(p => {
          p.suggestedDay = totalDays; // Push to last day
          p.matchReason += " | 候補行程";
          finalOrderedList.push(p);
      });
  }

  return finalOrderedList;
};
