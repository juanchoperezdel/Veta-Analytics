export type Platform = 'meta' | 'google_ads' | 'ga4';
export type Severity = 'critical' | 'high' | 'medium' | 'info';
export type AlertStatus = 'active' | 'resolved' | 'ignored';

export interface Client {
  id: string;
  slug: string;
  name: string;
  logoInitial: string;
}

export interface BusinessKPIs {
  users: { value: number; delta: number };
  sessions: { value: number; delta: number };
  avgSessionDuration: { value: string; delta: number };
  conversionRate: { value: number; delta: number };
  carts: { value: number; delta: number };
  tickets: { value: number; delta: number };
  revenue: { value: number; delta: number };
  aov: { value: number; delta: number };
}

export interface ChannelRevenue {
  google: number;
  meta: number;
  other: number;
}

export interface ProductRoute {
  id: string;
  route: string;
  revenue: number;
  revenueDelta: number;
  articles: number;
  articlesDelta: number;
  purchases: number;
  purchasesDelta: number;
  addToCart: number;
}

export interface GoogleAdsCampaign {
  id: string;
  name: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  users: number;
  retention: number;
  carts: number;
  revenue: number;
  roas: number;
}

export interface MetaAdsCampaign {
  id: string;
  type: string;
  segment: string;
  spend: number;
  reach: number;
  purchases: number;
  revenue: number;
  cpa: number;
  roas: number;
  ctr: number;
  cpc: number;
}

export interface YouTubeVideo {
  id: string;
  title: string;
  campaign: string;
  impressions: number;
  clicks: number;
  ctr: number;
  conversions: number;
  conversionRate: number;
  spend: number;
}

export interface PlatformKPIs {
  spend: { value: number; delta: number };
  carts?: { value: number; delta: number };
  tickets?: { value: number; delta: number };
  purchases?: { value: number; delta: number };
  revenue: { value: number; delta: number };
  cpa?: { value: number; delta: number };
  roas: { value: number; delta: number };
  aov?: { value: number; delta: number };
}
