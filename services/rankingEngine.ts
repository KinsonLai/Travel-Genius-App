
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
    // Normalize rating (0-5) to 0-100, then apply weight
    // If rating is missing, assume 4.0
    const rating = place.rating || 4.0;
    const ratingScore = (rating / 5) * 100;
    score += ratingScore * 0.3;
    if (rating >= 4.5) reasons.push(`高評價(${rating})`);

    // 2. Interest Match Score (Weight: 40%)
    // Check if place category matches user focus
    let matchScore = 50; // Base score
    if (prefs.style.focus === 'balanced') {
        matchScore = 80; // Balanced likes everything reasonably
    } else if (prefs.style.focus === place.category) {
        matchScore = 100; // Perfect match
        reasons.push(`符合興趣(${prefs.style.focus})`);
    } else if (
        (prefs.style.focus === 'sightseeing' && place.category === 'culture') ||
        (prefs.style.focus === 'culture' && place.category === 'sightseeing')
    ) {
        matchScore = 80; // Related categories
    } else if (prefs.style.focus === 'food' && place.category !== 'food') {
        matchScore = 30; // Foodies might not care about museums as much
    }
    score += matchScore * 0.4;

    // 3. Distance/Logistics Score (Weight: 20%)
    // Calculate distance from hotel (if hotel coords available)
    let distScore = 50; // Default neutral
    if (hotelLocation && place.latitude && place.longitude) {
        const dist = calculateDistance(hotelLocation.lat, hotelLocation.lng, place.latitude, place.longitude);
        place.distanceFromHotel = parseFloat(dist.toFixed(2));
        
        // Linear decay: 0km = 100pts, 10km = 0pts (adjustable)
        const maxDist = 10; 
        distScore = Math.max(0, (1 - dist / maxDist) * 100);
        
        if (dist < 2) reasons.push(`離酒店近(${place.distanceFromHotel}km)`);
    }
    score += distScore * 0.2;

    // 4. Budget/Price Score (Weight: 10%)
    // Normalize price (1-4)
    // Low budget users prefer priceLevel 1-2. High budget don't care.
    let priceScore = 50;
    const avgBudgetPerDay = prefs.budget.amount / ((new Date(prefs.dates.end).getTime() - new Date(prefs.dates.start).getTime()) / (1000 * 3600 * 24));
    // Simple heuristic: if daily budget < 100 USD (approx), prefer cheap
    // Assuming currency conversion is roughly handled mentally or simply by level
    // Price Level 1 = Cheap, 4 = Expensive
    
    // Invert scale: Cheaper is better for accessibility, but expensive is better for "Quality" sometimes.
    // Let's go with "Value":
    if (avgBudgetPerDay < 3000) { // e.g. Low budget
        if (place.priceLevel <= 2) {
            priceScore = 100;
            reasons.push("符合預算");
        } else {
            priceScore = 20;
        }
    } else {
        // High budget: prefer higher quality (often higher price) or neutral
        priceScore = 80; 
    }
    score += priceScore * 0.1;

    // Finalize
    place.score = parseFloat(score.toFixed(1));
    place.matchReason = `綜合評分: ${place.score} | ${reasons.join(', ')}`;
    
    return place;
  }).sort((a, b) => (b.score || 0) - (a.score || 0)); // Sort descending
};
