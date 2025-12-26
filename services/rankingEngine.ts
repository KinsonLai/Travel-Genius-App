
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

// Check if a specific date (YYYY-MM-DD object or string logic) is inside a hotel's stay range
const isDateInHotelStay = (dateObj: Date, checkInStr: string, checkOutStr: string): boolean => {
    if (!checkInStr || !checkOutStr) return false;
    const checkIn = new Date(checkInStr);
    const checkOut = new Date(checkOutStr);
    // Reset hours to avoid timezone mess for simple range check
    checkIn.setHours(0,0,0,0);
    checkOut.setHours(0,0,0,0);
    dateObj.setHours(0,0,0,0);
    
    return dateObj >= checkIn && dateObj <= checkOut;
};

// Main Ranking Function
export const rankCandidates = (
  candidates: CandidatePlace[],
  prefs: UserPreferences,
  hotels: Hotel[] // Receive ALL hotels
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
    // LOGIC UPDATE: Calculate distance to the NEAREST hotel in the list.
    // This allows spots in City B (Hotel B) to rank high even if Hotel A is far away.
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

    let distScore = 0;
    if (minDistance !== Infinity) {
        place.distanceFromHotel = parseFloat(minDistance.toFixed(2));
        // Max comfortable daily radius ~15km, but for inter-city planning we can be lenient.
        // If it's within 10km of ANY booked hotel, give it good score.
        const maxDist = 20; 
        distScore = Math.max(0, (1 - minDistance / maxDist) * 100);
        if (minDistance < 3) reasons.push(`離${nearestHotelName}很近(${place.distanceFromHotel}km)`);
    } else {
        // Fallback if no hotel coords
        distScore = 50; 
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
 * 核心演算法：Day-Aware Route Optimization with Multi-Hotel Support
 * 
 * 1. 根據旅行天數，將行程分為 N 天。
 * 2. 確定當天是「哪間酒店」負責 (根據日期)。
 * 3. 確定當天的「起始座標」 (若是移動日，可能起點是 Hotel A，終點是 Hotel B，這裡簡化為以當晚住宿 Hotel B 為主，或 Hotel A 為主)。
 * 4. 過濾出「離當天酒店」較近的候選點 (避免 Day 1 住東京卻跑到大阪的景點)。
 * 5. TSP/Greedy 排序。
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
  
  // 為了避免單日塞太多，設定一個軟上限
  const MAX_SPOTS_PER_DAY = Math.ceil(candidates.length / totalDays) + 1;

  for (let dayNum = 1; dayNum <= totalDays; dayNum++) {
    // 1. Determine Date and Day of Week
    const currentDate = new Date(startDate);
    currentDate.setDate(startDate.getDate() + (dayNum - 1));
    const currentDayOfWeek = currentDate.getDay(); // 0 = Sun

    // 2. Determine Active Hotel for this night
    // Find a hotel where (currentDate >= checkIn) AND (currentDate < checkOut)
    // Note: Usually checkOut day morning you are still at Hotel A, but evening you are at Hotel B.
    // Simplification: We assign the hotel you SLEEP at tonight as the anchor, 
    // OR if it's the last day, the one you checked out from.
    let activeHotel = hotels.find(h => isDateInHotelStay(currentDate, h.checkIn, h.checkOut));
    
    // Fallback logic: If dates have gaps, find the closest previous hotel
    if (!activeHotel && hotels.length > 0) {
        // Find last hotel that ends before today
        activeHotel = hotels[hotels.length - 1]; // Default to last
    }
    if (!activeHotel) activeHotel = hotels[0]; // Safety net

    // 3. Filter candidates suitable for THIS hotel's region
    // We only want to schedule spots that are reasonably close to the current hotel (e.g., within 50km)
    // UNLESS it's a "transfer day" where we might visit spots along the way. 
    // To simplify: We prioritize spots close to the current active hotel.
    
    const availableToday = unvisited.filter(p => {
       // A. Time Constraint Check
       if (p.closedDays && p.closedDays.includes(currentDayOfWeek)) return false;

       // B. Geographic Constraint Check (Crucial for multi-city)
       // If the spot is > 100km away from current hotel, assume it belongs to another leg of the trip
       // Exception: If we only have 1 hotel, ignore this.
       if (hotels.length > 1 && p.latitude && p.longitude && activeHotel?.latitude && activeHotel?.longitude) {
           const dist = calculateDistance(activeHotel.latitude, activeHotel.longitude, p.latitude, p.longitude);
           if (dist > 80) return false; // 80km threshold (e.g. Tokyo to Osaka is ~400km, so this filters correctly)
       }

       return true;
    });

    if (availableToday.length === 0) continue;

    // 4. Graph Search (Nearest Neighbor)
    // Start from the Hotel
    let currentLoc = { lat: activeHotel.latitude || 0, lng: activeHotel.longitude || 0 };
    
    // Safety: if hotel has no coords, assume first candidate's location to start chain
    if (currentLoc.lat === 0 && availableToday.length > 0) {
        currentLoc = { lat: availableToday[0].latitude, lng: availableToday[0].longitude };
    }

    let spotsTodayCount = 0;
    const todaysPool = [...availableToday]; // Local mutable copy

    while (todaysPool.length > 0 && spotsTodayCount < MAX_SPOTS_PER_DAY) {
        let nearestIdx = -1;
        let minDist = Infinity;

        for (let i = 0; i < todaysPool.length; i++) {
            const candidate = todaysPool[i];
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
            
            bestPlace.suggestedDay = dayNum; 
            bestPlace.matchReason += ` | Day ${dayNum} (${activeHotel?.name}周邊)`;

            finalOrderedList.push(bestPlace);
            
            // Move current location to this spot
            currentLoc = { lat: bestPlace.latitude, lng: bestPlace.longitude };
            
            // Remove from unvisited (Global) & pool (Local)
            const globalIdx = unvisited.findIndex(p => p.name === bestPlace.name);
            if (globalIdx !== -1) unvisited.splice(globalIdx, 1);
            
            todaysPool.splice(nearestIdx, 1);
            spotsTodayCount++;
        } else {
            break;
        }
    }
  }

  // 5. Handle Leftovers
  // These are likely spots that were valid but didn't fit in the days, OR spots that were far from ALL hotels (data error?)
  if (unvisited.length > 0) {
      unvisited.forEach(p => {
          // Just assign to Day 1 or find best fit day (omitted for brevity, dumping to Day 1 or Last Day)
          p.suggestedDay = totalDays; 
          p.matchReason += " | 候補/距離過遠";
          finalOrderedList.push(p);
      });
  }

  return finalOrderedList;
};
