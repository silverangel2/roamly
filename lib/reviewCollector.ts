export type CollectedReview = {
  source: string;
  sourceUrl?: string;
  rating?: number | null;
  title?: string;
  body: string;
  date?: string | null;
  verified?: boolean | null;
};
