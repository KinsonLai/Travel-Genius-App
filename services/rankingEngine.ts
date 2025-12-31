
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
    // Standard hotel logic: You are "at" the hotel from check-in night until check-out morning.
    // However, for planning *activities*, we care about where you sleep *that night*.
    // If check-in is Oct 1, check-out is Oct 3.
    // Oct 1 night: Hotel A. Oct 2 night: Hotel A. Oct 3: Leaving Hotel A.
    return dateObj >= checkIn && dateObj < checkOut;
};

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

    // 3. Distance Check (Calculate nearest hotel for general scoring)
    let minDistance = Infinity;
    hotels.forEach(h => {
        if (h.latitude && h.longitude && place.latitude && place.longitude) {
            const d = calculateDistance(h.latitude, h.longitude, place.latitude, place.longitude);
            if (d < minDistance) minDistance = d;
        }
    });

    if (minDistance !== Infinity) {
        place.distanceFromHotel = parseFloat(minDistance.toFixed(2));
        // Penalize heavily if super far (> 100km) from ANY hotel, unless it's a specific key destination
        if (minDistance > 100) score -= 300; 
        else score += Math.max(0, (1 - minDistance / 30) * 100) * 0.2;
    } else {
        score -= 50; 
    }

    place.score = parseFloat(score.toFixed(1));
    return place;
  }).sort((a, b) => (b.score || 0) - (a.score || 0));
};

// Helper: Parse time "HH:MM" to hours float
const parseTime = (timeStr: string): number => {
    if (!timeStr) return 9; // Default 9 AM
    const [h, m] = timeStr.split(':').map(Number);
    return h + (m / 60);
};

export const optimizeRoute = (
  candidates: CandidatePlace[],
  hotels: Hotel[],
  startDateStr: string,
  totalDays: number,
  airportCoords?: { lat: number, lng: number },
  flightTimes?: { start: string, end: string }
): CandidatePlace[] => {
  if (candidates.length === 0) return [];

  const finalOrderedList: CandidatePlace[] = [];
  const unvisited = [...candidates];
  const startDate = new Date(startDateStr);

  // Time Logic
  const arrivalTime = flightTimes ? parseTime(flightTimes.start) : 10;
  const departureTime = flightTimes ? parseTime(flightTimes.end) : 18;

  // Pace Logic (Hours per spot)
  const paceMap = { relaxed: 2.5, moderate: 1.8, intense: 1.2 };
  // Default duration if API didn't provide one
  const defaultDuration = 1.5; 

  for (let dayNum = 1; dayNum <= totalDays; dayNum++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(startDate.getDate() + (dayNum - 1));
    const currentDayOfWeek = currentDate.getDay();

    // 1. Identify Active Hotel for this NIGHT
    // If it's the last day, we technically don't sleep there, but we start from the previous night's hotel.
    let activeHotel = hotels.find(h => isDateInHotelStay(currentDate, h.checkIn, h.checkOut));
    
    // Fallback: If no hotel found (e.g., last day or date gap), use the closest logical hotel
    if (!activeHotel) {
        // If it's the very last day, use the hotel where we checked out this morning
        if (dayNum === totalDays) {
            activeHotel = hotels.find(h => new Date(h.checkOut).getTime() === currentDate.getTime());
        }
        if (!activeHotel) activeHotel = hotels[hotels.length - 1]; // Absolute fallback
    }

    // 2. Define Time Budget
    let currentTime = 9.0; // Default start time 9 AM
    let maxTime = 20.0; // Default end time 8 PM

    if (dayNum === 1) {
        // Day 1: Start later due to flight
        currentTime = Math.max(arrivalTime + 2, 9); // +2 hours for immigration/transport
    }
    if (dayNum === totalDays) {
        // Last Day: End earlier for flight
        maxTime = Math.min(departureTime - 3, 20); // -3 hours for transport/check-in
    }

    // If no time left (e.g. late arrival), skip strictly but maybe add a "Dinner" spot if possible
    if (currentTime >= maxTime) {
        // Force at least one "Late Night" spot if it's Day 1 arrival
        if (dayNum === 1) maxTime = 23; 
        else continue; 
    }

    // 3. Determine Start Location for Greedy Search
    let currentLoc = { lat: activeHotel.latitude || 0, lng: activeHotel.longitude || 0 };
    let startLocationName = activeHotel.name;

    // Day 1 overrides: Start from Airport
    if (dayNum === 1 && airportCoords && airportCoords.lat !== 0) {
        currentLoc = airportCoords;
        startLocationName = "機場";
    }

    // 4. Filter Available Spots for THIS Day
    // Criteria: 
    // - Not visited
    // - Open on this day
    // - Within acceptable range of the HOTEL (not the airport, unless Day 1)
    // - Day 1 exception: Can be near Airport OR Hotel
    const MAX_RADIUS = 40; // km

    let todaysPool = unvisited.filter(p => {
       if (p.closedDays && p.closedDays.includes(currentDayOfWeek)) return false;
       
       // Distance Check
       let dist = 999;
       if (activeHotel.latitude && activeHotel.longitude && p.latitude && p.longitude) {
           dist = calculateDistance(activeHotel.latitude, activeHotel.longitude, p.latitude, p.longitude);
       }
       
       // Strict geo-fencing: Activity must be near the hotel we are staying at
       if (dist > MAX_RADIUS) {
           // Exception: Day 1, maybe it's near the airport?
           if (dayNum === 1 && airportCoords) {
               const distToAirport = calculateDistance(airportCoords.lat, airportCoords.lng, p.latitude, p.longitude);
               if (distToAirport < 30) {
                   p.distanceFromHotel = parseFloat(dist.toFixed(1)); // Hack: store dist
                   return true;
               }
           }
           return false;
       }
       
       p.distanceFromHotel = parseFloat(dist.toFixed(1));
       return true;
    });

    // Sort pool by score initially to prefer better spots
    todaysPool.sort((a, b) => (b.score || 0) - (a.score || 0));

    // 5. Greedy Selection Loop
    // We want to fill [currentTime] to [maxTime]
    let dayHasActivity = false;

    while (currentTime < maxTime && todaysPool.length > 0) {
        let bestIdx = -1;
        let minScoreMetric = Infinity; // We want to minimize (Distance / Score) roughly

        // Simple Greedy: Find closest available spot to currentLoc
        let minMoveDist = Infinity;

        for (let i = 0; i < todaysPool.length; i++) {
            const cand = todaysPool[i];
            const moveDist = calculateDistance(currentLoc.lat, currentLoc.lng, cand.latitude, cand.longitude);
            
            // Optimization: Prefer closer spots, but weight by rating slightly
            // If Spot A is 2km away (Score 50) and Spot B is 2.5km away (Score 90), pick B.
            // Weighted Dist = Real Dist - (Score / 20)
            const weightedDist = moveDist - ((cand.score || 0) / 40);

            if (weightedDist < minScoreMetric) {
                minScoreMetric = weightedDist;
                minMoveDist = moveDist;
                bestIdx = i;
            }
        }

        if (bestIdx !== -1) {
            const chosen = todaysPool[bestIdx];
            
            // Estimate costs
            const travelTimeHours = (minMoveDist / 30) + 0.2; // 30km/h avg speed + buffer
            const visitDuration = chosen.durationHours || defaultDuration;

            // Check if fits in day
            if (currentTime + travelTimeHours + visitDuration > maxTime + 0.5) { // 0.5h flex
                // Doesn't fit, remove from pool for today, try next closest?
                // Actually, for simple greedy, we just stop or skip. 
                // Let's remove and try finding a smaller one? No, just break to avoid infinite loops.
                todaysPool.splice(bestIdx, 1); 
                continue; 
            }

            // Commit
            chosen.suggestedDay = dayNum;
            chosen.matchReason = `Day ${dayNum} (從${startLocationName}出發)`;
            finalOrderedList.push(chosen);

            // Update state
            currentTime += travelTimeHours + visitDuration;
            currentLoc = { lat: chosen.latitude, lng: chosen.longitude };
            startLocationName = chosen.name;
            dayHasActivity = true;

            // Remove from global unvisited
            const globalIdx = unvisited.findIndex(u => u.name === chosen.name);
            if (globalIdx !== -1) unvisited.splice(globalIdx, 1);
            todaysPool.splice(bestIdx, 1);

        } else {
            break; // No reachable candidates
        }
    }

    // FAILSAFE: If a day has NO activity (e.g. strict time, or bad filtering), 
    // Force add the single CLOSEST spot from unvisited, ignoring time limits, 
    // just to ensure the day isn't empty.
    if (!dayHasActivity && unvisited.length > 0) {
        let backupIdx = -1;
        let backupDist = Infinity;
        
        for(let i=0; i<unvisited.length; i++) {
             const u = unvisited[i];
             // Check distance to hotel
             if (activeHotel.latitude && activeHotel.longitude) {
                 const d = calculateDistance(activeHotel.latitude, activeHotel.longitude, u.latitude, u.longitude);
                 if (d < backupDist) {
                     backupDist = d;
                     backupIdx = i;
                 }
             }
        }

        if (backupIdx !== -1) {
             const rescue = unvisited[backupIdx];
             rescue.suggestedDay = dayNum;
             rescue.matchReason = `Day ${dayNum} (自動補充行程)`;
             finalOrderedList.push(rescue);
             unvisited.splice(backupIdx, 1);
        }
    }
  }

  return finalOrderedList;
};
