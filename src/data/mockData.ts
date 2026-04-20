import { Client, BusinessKPIs, ProductRoute, GoogleAdsCampaign, MetaAdsCampaign, YouTubeVideo, PlatformKPIs } from './types';

export const clients: Client[] = [
  { id: '1', slug: 'andesmar', name: 'Andesmar Turismo', logoInitial: 'A' },
  { id: '2', slug: 'saas-b2b', name: 'CloudSync B2B', logoInitial: 'C' }
];

export const mockData = {
  'andesmar': {
    businessKpis: {
      users: { value: 108035, delta: -0.1433 },
      sessions: { value: 176636, delta: -0.101 },
      avgSessionDuration: { value: '04:11', delta: -0.075 },
      conversionRate: { value: 0.0619, delta: 0.068 },
      carts: { value: 6683, delta: -0.085 },
      tickets: { value: 10235, delta: -0.140 },
      revenue: { value: 656653893, delta: -0.178 },
      aov: { value: 98257, delta: -0.102 },
    } as BusinessKPIs,
    routes: [
      { id: 'r1', route: 'Mendoza → Santiago', revenue: 261766860, revenueDelta: -11.9, articles: 139, articlesDelta: -11.0, purchases: 516, purchasesDelta: -6.0, addToCart: 1800 },
      { id: 'r2', route: 'Santiago → Mendoza', revenue: 23699550, revenueDelta: -1.9, articles: 330, articlesDelta: -3.2, purchases: 215, purchasesDelta: 0.5, addToCart: 1012 },
      { id: 'r3', route: 'Mendoza → CORDOBA', revenue: 11281829, revenueDelta: -10.6, articles: 162, articlesDelta: -10.0, purchases: 123, purchasesDelta: 0.0, addToCart: 424 },
      { id: 'r4', route: 'CORDOBA → Mendoza', revenue: 10877914, revenueDelta: -17.4, articles: 157, articlesDelta: -16.5, purchases: 121, purchasesDelta: -3.2, addToCart: 358 },
      { id: 'r5', route: 'Bariloche → Osorno', revenue: 7628250, revenueDelta: -16.4, articles: 153, articlesDelta: -12.1, purchases: 102, purchasesDelta: -8.9, addToCart: 538 },
      { id: 'r6', route: 'Retiro Buenos Aires → Mendoza', revenue: 15181537, revenueDelta: 7.6, articles: 148, articlesDelta: 8.0, purchases: 110, purchasesDelta: 10.0, addToCart: 563 },
    ] as ProductRoute[],
    googleAds: {
      kpis: {
        spend: { value: 3772685, delta: 0.047 },
        carts: { value: 1118, delta: -0.375 },
        tickets: { value: 1642, delta: -0.401 },
        revenue: { value: 92421728, delta: -0.492 },
        cpa: { value: 3404.95, delta: 0.678 },
        roas: { value: 24.32, delta: -0.516 },
        aov: { value: 82667, delta: -0.187 }
      } as PlatformKPIs,
      campaigns: [
        { id: 'g1', name: 'PerformanceMax_ARG_ExcMZA', spend: 1146613, impressions: 97660, clicks: 13860, ctr: 0.1419, cpc: 82.73, users: 8658, retention: 0.6247, carts: 368, revenue: 32330830, roas: 28.2 },
        { id: 'g2', name: 'Generación de Demanda - Turismo', spend: 53824, impressions: 147273, clicks: 6327, ctr: 0.043, cpc: 8.51, users: 3068, retention: 0.4849, carts: 0, revenue: 0, roas: 0 },
        { id: 'g3', name: 'Search_Brand_ARG_ExcMZA', spend: 292705, impressions: 14354, clicks: 4993, ctr: 0.3478, cpc: 58.62, users: 2861, retention: 0.573, carts: 149, revenue: 14805244, roas: 50.58 },
        { id: 'g4', name: 'Search_Brand_Comercial_MZA', spend: 396396, impressions: 11359, clicks: 4924, ctr: 0.4335, cpc: 80.5, users: 2780, retention: 0.5646, carts: 264, revenue: 17448611, roas: 44.02 },
        { id: 'g5', name: 'PMax_Competencia_Aerea', spend: 336031, impressions: 54579, clicks: 3006, ctr: 0.0551, cpc: 111.79, users: 1834, retention: 0.6101, carts: 44, revenue: 4066890, roas: 12.1 }
      ] as GoogleAdsCampaign[]
    },
    metaAds: {
      kpis: {
        spend: { value: 1515736, delta: -0.062 },
        purchases: { value: 757, delta: -0.154 },
        revenue: { value: 52433669, delta: -0.307 },
        cpa: { value: 2002.29, delta: 0.109 },
        roas: { value: 34.59, delta: -0.262 },
        aov: { value: 69265, delta: -0.181 }
      } as PlatformKPIs,
      campaigns: [
        { id: 'm1', type: 'Conversión', segment: 'Advantage_Post', spend: 222920.86, reach: 47041, purchases: 149, revenue: 12375015, cpa: 1496.11, roas: 55.51, ctr: 0.0105, cpc: 131.44 },
        { id: 'm2', type: 'Conversión', segment: 'Advantage_MZA_SJ', spend: 189478.63, reach: 29180, purchases: 138, revenue: 7962840, cpa: 1373.03, roas: 42.03, ctr: 0.0074, cpc: 160.58 },
        { id: 'm3', type: 'Conversión', segment: 'Advantage_MZA_CL', spend: 94379.81, reach: 19580, purchases: 81, revenue: 3828120, cpa: 1165.18, roas: 40.56, ctr: 0.006, cpc: 174.13 },
        { id: 'm4', type: 'Conversión', segment: 'Advantage_Estudiantes', spend: 74757.31, reach: 14697, purchases: 65, revenue: 3955490, cpa: 1150.11, roas: 52.91, ctr: 0.0048, cpc: 271.84 },
      ] as MetaAdsCampaign[]
    },
    youtube: [
      { id: 'y1', title: 'Si hay algo que nadie duda, es de viajar con Andesmar 🚌 💙', campaign: 'Generación de demanda_Youtube', impressions: 7021, clicks: 32, ctr: 0.0046, conversions: 8.73, conversionRate: 0.0026, spend: 13804.48 },
      { id: 'y2', title: 'Unimos Catamarca con Caleta Olivia en nuestra nueva línea', campaign: 'Generación de demanda_Youtube', impressions: 2365, clicks: 4, ctr: 0.0017, conversions: 0.34, conversionRate: 0.0003, spend: 5507.94 },
      { id: 'y3', title: 'Vos sabés a quién llevar a ese viaje', campaign: 'Generación de demanda_Youtube', impressions: 1910, clicks: 10, ctr: 0.0052, conversions: 0.23, conversionRate: 0.0003, spend: 4899.12 },
    ] as YouTubeVideo[]
  }
};
