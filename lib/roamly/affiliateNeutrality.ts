export const ROAMLY_AFFILIATE_NEUTRAL_DISCLOSURE =
  "Roamly may earn a commission from some booking links. Recommendations are ranked according to your trip needs, not commission.";

export const TRANSPORT_SCORE_WEIGHTS = {
  customer_fit: 0.25,
  total_cost: 0.2,
  time_efficiency: 0.2,
  convenience: 0.15,
  schedule_compatibility: 0.1,
  reliability: 0.1,
  affiliate_value: 0
} as const;

export const ACCOMMODATION_SCORE_WEIGHTS = {
  traveler_fit: 0.25,
  location: 0.2,
  total_price: 0.15,
  review_quality: 0.15,
  convenience: 0.1,
  cancellation_flexibility: 0.1,
  amenities: 0.05,
  affiliate_value: 0
} as const;

export type AffiliateNeutralOption = {
  id: string;
  customerScore: number;
  affiliateAvailable?: boolean;
  affiliateValue?: number;
};

const NEAR_TIE_POINTS = 1.5;

export function rankAffiliateNeutralOptions<T extends AffiliateNeutralOption>(options: T[]) {
  return [...options].sort((a, b) => {
    const scoreDelta = b.customerScore - a.customerScore;
    if (Math.abs(scoreDelta) > NEAR_TIE_POINTS) return scoreDelta;
    if (a.affiliateAvailable !== b.affiliateAvailable) return a.affiliateAvailable ? -1 : 1;
    return scoreDelta;
  });
}

export function affiliateNeutralityDiagnostics(options: AffiliateNeutralOption[]) {
  const ranked = rankAffiliateNeutralOptions(options);
  return {
    winner: ranked[0] || null,
    affiliateValueWeight: 0,
    nearTiePoints: NEAR_TIE_POINTS,
    disclosure: ROAMLY_AFFILIATE_NEUTRAL_DISCLOSURE
  };
}
