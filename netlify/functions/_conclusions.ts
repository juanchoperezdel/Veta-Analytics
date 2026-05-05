// Helpers compartidos para generación de conclusiones estratégicas.
// Usado por endpoints (products.ts, seasonality.ts, etc.) y por el script
// del weekly email (scripts/weekly-report.ts).
//
// Convención: archivo con prefijo _ no se deploya como endpoint Netlify.

export type ConclusionCategory =
  | 'yoy' | 'mom' | 'momentum' | 'forecast' | 'efficiency' | 'demand'
  | 'creative' | 'audience' | 'placement' | 'query' | 'competition'
  | 'funnel_stage' | 'seasonality' | 'time_pattern' | 'streak' | 'milestone';

export type ConclusionSeverity = 'success' | 'warning' | 'info' | 'critical';
export type ConclusionConfidence = 'alta' | 'media' | 'baja';

export type Conclusion = {
  id: string;
  category: ConclusionCategory;
  severity: ConclusionSeverity;
  route?: string;
  headline: string;
  detail: string;
  recommendation: string;
  confidence: ConclusionConfidence;
  metric?: { label: string; value: string };
};

// ─── Helpers de formato ─────────────────────────────────────────────────────
export const MONTH_LABELS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export const DAY_LABELS = [
  'Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado',
];

export function fmtCurrency(v: number): string {
  return '$' + Math.round(v).toLocaleString('es-AR');
}
export function fmtPctSigned(v: number): string {
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(0) + '%';
}
export function fmtPctAbs(v: number): string {
  return Math.abs(v * 100).toFixed(0) + '%';
}
export function fmtNumber(v: number): string {
  return Math.round(v).toLocaleString('es-AR');
}

export function sameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}
export function addMonths(d: Date, months: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + months);
  return r;
}

// Ordena críticas/warnings primero, después success, después info
export function sortBySeverity(out: Conclusion[]): Conclusion[] {
  const rank: Record<ConclusionSeverity, number> = {
    critical: 0, warning: 1, success: 2, info: 3,
  };
  return [...out].sort((a, b) => rank[a.severity] - rank[b.severity]);
}

// ─── Generador de conclusiones para Rutas/Destinos ──────────────────────────

export function buildRouteConclusions(
  routes: any[],
  monthlyRows: any[],
  demandMonthlyRows: any[],
  partialCurrentRows: any[],
  partialYoyRows: any[],
): Conclusion[] {
  type MonthRow = { month: Date; spend: number; revenue: number; purchases: number; roas: number };
  const history = new Map<string, MonthRow[]>();
  for (const r of monthlyRows) {
    const route = r.route as string;
    const month = new Date(r.month);
    const spend = Number(r.spend);
    const revenue = Number(r.revenue);
    const purchases = Number(r.purchases);
    if (!history.has(route)) history.set(route, []);
    history.get(route)!.push({
      month, spend, revenue, purchases,
      roas: spend > 0 ? revenue / spend : 0,
    });
  }
  const partialCurrent = new Map<string, { spend: number; revenue: number; purchases: number }>();
  const partialYoy = new Map<string, { spend: number; revenue: number; purchases: number }>();
  for (const r of partialCurrentRows) {
    partialCurrent.set(r.route, { spend: Number(r.spend), revenue: Number(r.revenue), purchases: Number(r.purchases) });
  }
  for (const r of partialYoyRows) {
    partialYoy.set(r.route, { spend: Number(r.spend), revenue: Number(r.revenue), purchases: Number(r.purchases) });
  }
  const demandHistory = new Map<string, { month: Date; clicks: number }[]>();
  for (const r of demandMonthlyRows) {
    const route = r.route as string;
    if (!demandHistory.has(route)) demandHistory.set(route, []);
    demandHistory.get(route)!.push({ month: new Date(r.month), clicks: Number(r.clicks) });
  }

  const relevantRoutes = routes.filter(r => r.spend > 5000);
  const out: Conclusion[] = [];
  const today = new Date();
  const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const dayOfMonth = today.getDate();
  const monthLabel = MONTH_LABELS[currentMonthStart.getMonth()];
  const prevYear = currentMonthStart.getFullYear() - 1;

  for (const route of relevantRoutes) {
    const hist = history.get(route.route) ?? [];

    // 1. YoY apples-to-apples
    const cur = partialCurrent.get(route.route);
    const yoy = partialYoy.get(route.route);
    if (cur && yoy && yoy.revenue > 1000 && cur.spend > 0) {
      const revPct = (cur.revenue - yoy.revenue) / yoy.revenue;
      const spendPct = yoy.spend > 0 ? (cur.spend - yoy.spend) / yoy.spend : 0;
      if (Math.abs(revPct) >= 0.15) {
        const isGrowing = revPct > 0;
        const efficient = isGrowing && spendPct < revPct;
        out.push({
          id: `yoy-${route.route}`,
          category: 'yoy',
          severity: isGrowing ? 'success' : 'warning',
          route: route.route,
          headline: isGrowing
            ? `${route.route}: ${fmtPctSigned(revPct)} de revenue vs ${monthLabel} ${prevYear}`
            : `${route.route}: cae ${fmtPctAbs(revPct)} vs ${monthLabel} ${prevYear}`,
          detail: `En los primeros ${dayOfMonth} días de ${monthLabel} generó ${fmtCurrency(cur.revenue)}, contra ${fmtCurrency(yoy.revenue)} en el mismo período de ${prevYear}. La inversión fue ${fmtPctSigned(spendPct)}.`,
          recommendation: isGrowing
            ? (efficient
              ? `Vendés más con menos plata: vale la pena replicar lo que estás haciendo y considerar ampliar el budget.`
              : `Considerá mantener el presupuesto en ${route.route} mientras siga el crecimiento.`)
            : `Vale la pena revisar qué cambió respecto al año pasado: estacionalidad, competencia o creatives.`,
          confidence: 'alta',
          metric: { label: 'Revenue MTD', value: fmtCurrency(cur.revenue) },
        });
      }
    }

    // 2. Momentum
    if (hist.length >= 4) {
      const last4 = hist.slice(-4);
      let consecutiveUp = 0;
      let consecutiveDown = 0;
      for (let i = 1; i < last4.length; i++) {
        if (last4[i].revenue > last4[i - 1].revenue * 1.02) consecutiveUp++;
        else if (last4[i].revenue < last4[i - 1].revenue * 0.98) consecutiveDown++;
      }
      if (consecutiveUp >= 3) {
        const first = last4[0];
        const last = last4[last4.length - 1];
        const totalGrowth = (last.revenue - first.revenue) / first.revenue;
        out.push({
          id: `momentum-up-${route.route}`,
          category: 'momentum',
          severity: 'success',
          route: route.route,
          headline: `${route.route} crece 3 meses seguidos`,
          detail: `Revenue pasó de ${fmtCurrency(first.revenue)} a ${fmtCurrency(last.revenue)} (${fmtPctSigned(totalGrowth)}). ROAS evolucionó de ${first.roas.toFixed(1)}x a ${last.roas.toFixed(1)}x.`,
          recommendation: `Vale la pena considerar escalar budget en ${route.route} mientras el momentum se sostiene.`,
          confidence: 'alta',
        });
      } else if (consecutiveDown >= 3) {
        const first = last4[0];
        const last = last4[last4.length - 1];
        const totalDrop = (last.revenue - first.revenue) / first.revenue;
        out.push({
          id: `momentum-down-${route.route}`,
          category: 'momentum',
          severity: 'critical',
          route: route.route,
          headline: `${route.route} cae 3 meses seguidos`,
          detail: `Revenue pasó de ${fmtCurrency(first.revenue)} a ${fmtCurrency(last.revenue)} (${fmtPctSigned(totalDrop)}). ROAS bajó de ${first.roas.toFixed(1)}x a ${last.roas.toFixed(1)}x.`,
          recommendation: `Vale la pena revisar creatives, audiencia o pricing antes de seguir invirtiendo en ${route.route}.`,
          confidence: 'alta',
        });
      }
    }

    // 3. Forecast
    const lastClosedMonth = hist[hist.length - 1];
    if (lastClosedMonth && lastClosedMonth.revenue > 1000) {
      const nextMonthStart = addMonths(currentMonthStart, 1);
      const nextMonthLabel = MONTH_LABELS[nextMonthStart.getMonth()];
      const lastClosedLabel = MONTH_LABELS[lastClosedMonth.month.getMonth()];
      const nextYoy = hist.find(h => sameMonth(h.month, addMonths(nextMonthStart, -12)));
      const lastYoy = hist.find(h => sameMonth(h.month, addMonths(lastClosedMonth.month, -12)));
      if (nextYoy && lastYoy && lastYoy.revenue > 1000) {
        const yoyRatio = (nextYoy.revenue - lastYoy.revenue) / lastYoy.revenue;
        if (Math.abs(yoyRatio) >= 0.10) {
          const projection = lastClosedMonth.revenue * (1 + yoyRatio);
          const better = yoyRatio > 0;
          const nextMonthCap = nextMonthLabel.charAt(0).toUpperCase() + nextMonthLabel.slice(1);
          out.push({
            id: `forecast-${route.route}`,
            category: 'forecast',
            severity: 'info',
            route: route.route,
            headline: `${nextMonthCap} suele ser ${better ? 'mejor' : 'peor'} para ${route.route}`,
            detail: `El año pasado ${nextMonthLabel} generó ${fmtPctAbs(yoyRatio)} ${better ? 'más' : 'menos'} que ${lastClosedLabel}. Si el patrón se repite, esperate cerca de ${fmtCurrency(projection)} de revenue.`,
            recommendation: better
              ? `Vale la pena tener creatives listos y considerar anticipar parte del budget para no perder el upside.`
              : `Considerá mantener inversión moderada en ${route.route} y reasignar a rutas con mejor ratio en ${nextMonthLabel}.`,
            confidence: 'media',
          });
        }
      }
    }
  }

  // 4. Eficiencia comparativa
  const topByRevenue = [...relevantRoutes].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  if (topByRevenue.length >= 3) {
    const sortedByRoas = [...topByRevenue].sort((a, b) => b.roas - a.roas);
    const best = sortedByRoas[0];
    const worst = sortedByRoas[sortedByRoas.length - 1];
    const avgRoas = sortedByRoas.reduce((s, r) => s + r.roas, 0) / sortedByRoas.length;
    if (best.roas > 0 && worst.roas > 0 && worst.roas < avgRoas * 0.6) {
      const gap = (best.roas - worst.roas) / worst.roas;
      out.push({
        id: `efficiency-${best.route}-vs-${worst.route}`,
        category: 'efficiency',
        severity: 'info',
        route: best.route,
        headline: `${worst.route} rinde menos que el promedio del top`,
        detail: `Entre las rutas top, ${best.route} devuelve $${best.roas.toFixed(2)} por cada $1, mientras ${worst.route} solo devuelve $${worst.roas.toFixed(2)}. Diferencia de ${fmtPctAbs(gap)}.`,
        recommendation: `Vale la pena evaluar si conviene reasignar parte del budget de ${worst.route} hacia ${best.route}, o revisar qué está limitando la performance de ${worst.route}.`,
        confidence: 'alta',
      });
    }
  }

  // 5. Demanda creciendo sin spend acompañando
  const currentMonthDate = currentMonthStart;
  const prevMonthDate = addMonths(currentMonthStart, -1);
  for (const route of relevantRoutes) {
    const dh = demandHistory.get(route.route) ?? [];
    const cur = dh.find(d => sameMonth(d.month, currentMonthDate));
    const prev = dh.find(d => sameMonth(d.month, prevMonthDate));
    if (cur && prev && prev.clicks > 50) {
      const clicksDelta = (cur.clicks - prev.clicks) / prev.clicks;
      if (clicksDelta >= 0.30 && route.spendDelta <= 0.05) {
        out.push({
          id: `demand-${route.route}`,
          category: 'demand',
          severity: 'info',
          route: route.route,
          headline: `Crece la demanda de ${route.route} pero la inversión no acompaña`,
          detail: `La gente busca ${route.route} ${fmtPctSigned(clicksDelta)} más este mes (${cur.clicks} clicks vs ${prev.clicks} el anterior), pero la inversión se mantuvo casi igual.`,
          recommendation: `Vale la pena considerar subir budget en ${route.route} para capturar la demanda creciente antes que la competencia.`,
          confidence: 'media',
        });
      }
    }
  }

  return sortBySeverity(out).slice(0, 8);
}

// ─── Generador de conclusiones para Estacionalidad ──────────────────────────

type Cell = { dow: number; hour: number; spend: number; revenue: number; roas: number; purchases: number };
type DowAgg = { dow: number; label: string; spend: number; revenue: number; purchases: number; roas: number; sampleSize: number };
type DomAgg = { day: number; spend: number; revenue: number; purchases: number; roas: number; sampleSize: number };
type PhaseAgg = { phase: string; spend: number; revenue: number; purchases: number; roas: number; sampleSize: number };

export function buildSeasonalityConclusions(input: {
  cells: Cell[];
  dows: DowAgg[];
  daysOfMonth: DomAgg[];
  phases: PhaseAgg[];
  source: 'all' | 'meta' | 'google';
}): Conclusion[] {
  const out: Conclusion[] = [];
  const sourceLabel = input.source === 'all' ? 'Meta + Google' : input.source === 'meta' ? 'Meta Ads' : 'Google Ads';

  // ─── 1. Día de semana líder ─────────────────────────────────────────
  const validDows = input.dows.filter(d => d.sampleSize >= 2 && d.spend > 0);
  if (validDows.length >= 3) {
    const sortedDows = [...validDows].sort((a, b) => b.roas - a.roas);
    const best = sortedDows[0];
    const avgRoas = validDows.reduce((s, d) => s + d.roas, 0) / validDows.length;
    if (best.roas > avgRoas * 1.15) {
      const liftPct = (best.roas - avgRoas) / avgRoas;
      out.push({
        id: `season-dow-best`,
        category: 'time_pattern',
        severity: 'success',
        headline: `Los ${best.label.toLowerCase()}s son tu mejor día`,
        detail: `Por cada $1 invertido los ${best.label.toLowerCase()}s recuperás $${best.roas.toFixed(2)}, ${fmtPctSigned(liftPct)} mejor que el promedio del resto de los días.`,
        recommendation: `Vale la pena considerar subir el budget los ${best.label.toLowerCase()}s o programar campañas con bid scheduling para concentrar inversión ese día.`,
        confidence: best.sampleSize >= 4 ? 'alta' : 'media',
      });
    }
    // Día más débil
    const worst = sortedDows[sortedDows.length - 1];
    if (worst.roas < avgRoas * 0.7 && validDows.length >= 4) {
      const dropPct = (worst.roas - avgRoas) / avgRoas;
      out.push({
        id: `season-dow-worst`,
        category: 'time_pattern',
        severity: 'warning',
        headline: `Los ${worst.label.toLowerCase()}s rinden por debajo del promedio`,
        detail: `Los ${worst.label.toLowerCase()}s tienen ROAS ${worst.roas.toFixed(2)}x, ${fmtPctSigned(dropPct)} vs el promedio. Generaron ${fmtCurrency(worst.revenue)} en el rango.`,
        recommendation: `Vale la pena considerar reducir budget los ${worst.label.toLowerCase()}s o probar creatives específicos que combatan la baja performance.`,
        confidence: worst.sampleSize >= 4 ? 'alta' : 'media',
      });
    }
  }

  // ─── 2. Fase del mes ganadora ──────────────────────────────────────
  const validPhases = input.phases.filter(p => p.sampleSize > 0 && p.spend > 0);
  if (validPhases.length === 3) {
    const sortedPhases = [...validPhases].sort((a, b) => b.revenue - a.revenue);
    const winner = sortedPhases[0];
    const loser = sortedPhases[sortedPhases.length - 1];
    const liftVsAvg = (winner.revenue - loser.revenue) / loser.revenue;
    if (liftVsAvg >= 0.20) {
      out.push({
        id: `season-phase`,
        category: 'seasonality',
        severity: 'info',
        headline: `${winner.phase} concentra el revenue del mes`,
        detail: `Esa fase generó ${fmtCurrency(winner.revenue)} (vs ${fmtCurrency(loser.revenue)} en ${loser.phase}). Diferencia de ${fmtPctAbs(liftVsAvg)}.`,
        recommendation: `Vale la pena anticipar más budget para ${winner.phase} y considerar reducir presión publicitaria en ${loser.phase}.`,
        confidence: 'alta',
      });
    }
  }

  // ─── 3. Día del mes pico ───────────────────────────────────────────
  const validDoms = input.daysOfMonth.filter(d => d.sampleSize >= 2 && d.revenue > 0);
  if (validDoms.length >= 10) {
    const sortedDoms = [...validDoms].sort((a, b) => b.revenue - a.revenue);
    const peak = sortedDoms[0];
    const avgDomRevenue = validDoms.reduce((s, d) => s + d.revenue, 0) / validDoms.length;
    if (peak.revenue > avgDomRevenue * 1.5) {
      const liftPct = (peak.revenue - avgDomRevenue) / avgDomRevenue;
      out.push({
        id: `season-dom-peak`,
        category: 'seasonality',
        severity: 'info',
        headline: `El día ${peak.day} es tu pico mensual`,
        detail: `Genera ${fmtCurrency(peak.revenue)} en promedio, ${fmtPctSigned(liftPct)} sobre el día promedio del mes. Coincide con cobros, quincena o feriado puntual.`,
        recommendation: `Vale la pena llegar al día ${peak.day} con creatives frescos y budget extra para capturar el pico.`,
        confidence: peak.sampleSize >= 3 ? 'alta' : 'media',
      });
    }
  }

  // ─── 4. Mejor combinación día × hora ───────────────────────────────
  const sortedCells = [...input.cells].filter(c => c.spend >= 1000).sort((a, b) => b.roas - a.roas);
  if (sortedCells.length > 0) {
    const top = sortedCells[0];
    const dayLabel = DAY_LABELS[top.dow];
    const hourLabel = `${top.hour.toString().padStart(2, '0')}:00`;
    if (top.roas >= 5) {  // umbral razonable, no reportar si ya es bajo
      out.push({
        id: `season-best-slot`,
        category: 'time_pattern',
        severity: 'success',
        headline: `${dayLabel} ${hourLabel}: tu franja con mejor rendimiento`,
        detail: `En esa franja generaste ${fmtCurrency(top.revenue)} con ${fmtCurrency(top.spend)} de inversión. Por cada $1 recuperaste $${top.roas.toFixed(2)}.`,
        recommendation: `Vale la pena armar bid schedules en ${sourceLabel} para concentrar más inversión en ${dayLabel.toLowerCase()}s alrededor de las ${hourLabel}.`,
        confidence: 'media',
      });
    }
  }

  // ─── 5. Hora del día más fuerte ────────────────────────────────────
  // Calculamos por hora desde cells
  const hourMap = new Map<number, { spend: number; revenue: number }>();
  for (const c of input.cells) {
    if (!hourMap.has(c.hour)) hourMap.set(c.hour, { spend: 0, revenue: 0 });
    const h = hourMap.get(c.hour)!;
    h.spend += c.spend; h.revenue += c.revenue;
  }
  const hours = [...hourMap.entries()].map(([hour, v]) => ({ hour, spend: v.spend, revenue: v.revenue, roas: v.spend > 0 ? v.revenue / v.spend : 0 }));
  if (hours.length >= 12) {
    const sortedHours = [...hours].filter(h => h.spend > 100).sort((a, b) => b.roas - a.roas);
    if (sortedHours.length > 0) {
      const peakHour = sortedHours[0];
      const avgHourRoas = hours.filter(h => h.spend > 100).reduce((s, h) => s + h.roas, 0) / hours.filter(h => h.spend > 100).length;
      if (peakHour.roas > avgHourRoas * 1.3) {
        const lift = (peakHour.roas - avgHourRoas) / avgHourRoas;
        out.push({
          id: `season-peak-hour`,
          category: 'time_pattern',
          severity: 'success',
          headline: `Las ${peakHour.hour}:00 es la hora con mejor ROAS`,
          detail: `En promedio recuperás $${peakHour.roas.toFixed(2)} por cada $1 a las ${peakHour.hour}:00, ${fmtPctSigned(lift)} sobre el promedio del día.`,
          recommendation: `Vale la pena probar mayor inversión en esa franja horaria con bid adjustments en ${sourceLabel}.`,
          confidence: 'media',
        });
      }
    }
  }

  return sortBySeverity(out).slice(0, 6);
}

// ─── Generador de conclusiones para Evolutivo ──────────────────────────────

type EvoMonth = {
  month: string;  // 'YYYY-MM'
  total: { spend: number; revenue: number; purchases: number; roas: number };
};

export function buildEvolutivoConclusions(months: EvoMonth[]): Conclusion[] {
  const out: Conclusion[] = [];
  if (!months || months.length < 3) return out;

  // Excluimos el mes en curso (es parcial)
  const today = new Date();
  const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const closedMonths = months.filter(m => m.month < currentMonthKey);
  if (closedMonths.length < 3) return out;

  // 1. Racha de meses creciendo / cayendo
  const last5 = closedMonths.slice(-5);
  let consecutiveUp = 0;
  let consecutiveDown = 0;
  for (let i = 1; i < last5.length; i++) {
    if (last5[i].total.revenue > last5[i - 1].total.revenue * 1.02) {
      consecutiveUp++;
      consecutiveDown = 0;
    } else if (last5[i].total.revenue < last5[i - 1].total.revenue * 0.98) {
      consecutiveDown++;
      consecutiveUp = 0;
    } else {
      consecutiveUp = 0;
      consecutiveDown = 0;
    }
  }
  if (consecutiveUp >= 3) {
    const first = last5[last5.length - 1 - consecutiveUp];
    const last = last5[last5.length - 1];
    const totalGrowth = (last.total.revenue - first.total.revenue) / first.total.revenue;
    out.push({
      id: 'evo-streak-up',
      category: 'streak',
      severity: 'success',
      headline: `Llevás ${consecutiveUp + 1} meses creciendo en revenue`,
      detail: `Pasaste de ${fmtCurrency(first.total.revenue)} a ${fmtCurrency(last.total.revenue)} (${fmtPctSigned(totalGrowth)}). ROAS evolucionó de ${first.total.roas.toFixed(1)}x a ${last.total.roas.toFixed(1)}x.`,
      recommendation: `Vale la pena documentar qué cambios de inversión, creatives o estrategia coincidieron con esta racha — ayudará a sostenerla.`,
      confidence: 'alta',
    });
  } else if (consecutiveDown >= 3) {
    const first = last5[last5.length - 1 - consecutiveDown];
    const last = last5[last5.length - 1];
    const totalDrop = (last.total.revenue - first.total.revenue) / first.total.revenue;
    out.push({
      id: 'evo-streak-down',
      category: 'streak',
      severity: 'critical',
      headline: `Llevás ${consecutiveDown + 1} meses cayendo en revenue`,
      detail: `Pasaste de ${fmtCurrency(first.total.revenue)} a ${fmtCurrency(last.total.revenue)} (${fmtPctSigned(totalDrop)}).`,
      recommendation: `Vale la pena revisar la estrategia general: cambios estructurales en mercado, competencia, oferta o estacionalidad.`,
      confidence: 'alta',
    });
  }

  // 2. Mejor mes histórico
  const sortedByRevenue = [...closedMonths].sort((a, b) => b.total.revenue - a.total.revenue);
  const peakMonth = sortedByRevenue[0];
  const peakDate = new Date(peakMonth.month + '-01');
  const peakLabel = `${MONTH_LABELS[peakDate.getMonth()]} ${peakDate.getFullYear()}`;
  const lastMonth = closedMonths[closedMonths.length - 1];
  // Solo reportar si el peak NO es el mes más reciente
  if (peakMonth.month !== lastMonth.month && peakMonth.total.revenue > lastMonth.total.revenue * 1.20) {
    const gap = (peakMonth.total.revenue - lastMonth.total.revenue) / peakMonth.total.revenue;
    out.push({
      id: 'evo-peak',
      category: 'milestone',
      severity: 'info',
      headline: `Tu mejor mes fue ${peakLabel} con ${fmtCurrency(peakMonth.total.revenue)}`,
      detail: `Estás ${fmtPctAbs(gap)} por debajo de ese pico. ROAS del mes pico: ${peakMonth.total.roas.toFixed(1)}x con ${fmtCurrency(peakMonth.total.spend)} de inversión.`,
      recommendation: `Vale la pena revisar qué hicimos diferente en ${peakLabel} y considerar si esos drivers pueden replicarse.`,
      confidence: 'alta',
    });
  }

  // 3. Comparativa YoY del último mes cerrado
  const lastClosedKey = lastMonth.month;
  const [lastYearStr, lastMonthStr] = lastClosedKey.split('-');
  const yoyKey = `${parseInt(lastYearStr) - 1}-${lastMonthStr}`;
  const yoyMonth = months.find(m => m.month === yoyKey);
  if (yoyMonth && yoyMonth.total.revenue > 1000) {
    const revPct = (lastMonth.total.revenue - yoyMonth.total.revenue) / yoyMonth.total.revenue;
    if (Math.abs(revPct) >= 0.15) {
      const isGrowing = revPct > 0;
      const lastDate = new Date(lastClosedKey + '-01');
      const lastMonthLabel = MONTH_LABELS[lastDate.getMonth()];
      const prevYearLabel = parseInt(lastYearStr) - 1;
      out.push({
        id: 'evo-yoy',
        category: 'yoy',
        severity: isGrowing ? 'success' : 'warning',
        headline: isGrowing
          ? `${lastMonthLabel.charAt(0).toUpperCase() + lastMonthLabel.slice(1)} ${lastYearStr}: ${fmtPctSigned(revPct)} vs ${prevYearLabel}`
          : `${lastMonthLabel.charAt(0).toUpperCase() + lastMonthLabel.slice(1)} ${lastYearStr}: cae ${fmtPctAbs(revPct)} vs ${prevYearLabel}`,
        detail: `${fmtCurrency(lastMonth.total.revenue)} este año, contra ${fmtCurrency(yoyMonth.total.revenue)} el año pasado.`,
        recommendation: isGrowing
          ? `Vale la pena identificar qué moviste vs el año pasado para sostener el crecimiento.`
          : `Vale la pena revisar si hay un factor de mercado, oferta o competencia que cambió respecto al año pasado.`,
        confidence: 'alta',
      });
    }
  }

  return sortBySeverity(out).slice(0, 4);
}

// ─── Generador de conclusiones para Embudo (Funnel) ────────────────────────

type FunnelStage = { label: string; value: number; delta: number; conversionFromPrevStage: number; conversionDelta: number };

export function buildFunnelConclusions(input: {
  stages: FunnelStage[];
  totalConversion: number;
  totalConversionDelta: number;
  revenue: { value: number; delta: number };
}): Conclusion[] {
  const out: Conclusion[] = [];
  const { stages, totalConversion, totalConversionDelta, revenue } = input;
  if (!stages || stages.length === 0) return out;

  // 1. Conversión total
  if (Math.abs(totalConversionDelta) >= 0.10) {
    const isImproving = totalConversionDelta > 0;
    out.push({
      id: 'funnel-total-conversion',
      category: 'funnel_stage',
      severity: isImproving ? 'success' : 'warning',
      headline: isImproving
        ? `Tu conversión total mejoró ${fmtPctAbs(totalConversionDelta)}`
        : `Tu conversión total cae ${fmtPctAbs(totalConversionDelta)}`,
      detail: `${(totalConversion * 100).toFixed(2)}% de los usuarios termina comprando. Hace un mes era ${((totalConversion / (1 + totalConversionDelta)) * 100).toFixed(2)}%.`,
      recommendation: isImproving
        ? `Vale la pena identificar qué cambió y consolidar la mejora — puede ser nuevo creative, mejor landing o ajuste de pricing.`
        : `Vale la pena revisar los pasos del embudo para encontrar dónde se está perdiendo el tráfico.`,
      confidence: 'alta',
      metric: { label: 'Conversión total', value: (totalConversion * 100).toFixed(2) + '%' },
    });
  }

  // 2. Cuello de botella: el paso con peor delta de conversión
  // Solo miramos pasos intermedios (no el primero que es 100%)
  const intermediate = stages.slice(1);
  if (intermediate.length > 0) {
    const worstStage = [...intermediate].sort((a, b) => a.conversionDelta - b.conversionDelta)[0];
    if (worstStage.conversionDelta < -0.10) {
      out.push({
        id: `funnel-bottleneck-${worstStage.label}`,
        category: 'funnel_stage',
        severity: 'critical',
        headline: `Cuello de botella: paso "${worstStage.label}" perdió ${fmtPctAbs(worstStage.conversionDelta)}`,
        detail: `La conversión a ${worstStage.label.toLowerCase()} pasó de ${((worstStage.conversionFromPrevStage / (1 + worstStage.conversionDelta)) * 100).toFixed(1)}% a ${(worstStage.conversionFromPrevStage * 100).toFixed(1)}%. Es donde más se está perdiendo gente.`,
        recommendation: `Vale la pena enfocar la próxima iteración en mejorar este paso: revisar UX, copy, friction (campos extras, validaciones), o claridad del valor.`,
        confidence: 'alta',
      });
    }
    // También mejor paso
    const bestStage = [...intermediate].sort((a, b) => b.conversionDelta - a.conversionDelta)[0];
    if (bestStage.conversionDelta > 0.15) {
      out.push({
        id: `funnel-best-${bestStage.label}`,
        category: 'funnel_stage',
        severity: 'success',
        headline: `Mejoró el paso "${bestStage.label}" ${fmtPctSigned(bestStage.conversionDelta)}`,
        detail: `Pasó de ${((bestStage.conversionFromPrevStage / (1 + bestStage.conversionDelta)) * 100).toFixed(1)}% a ${(bestStage.conversionFromPrevStage * 100).toFixed(1)}% de conversión a este paso.`,
        recommendation: `Vale la pena identificar qué cambió y considerar replicar la lógica en otros pasos del embudo.`,
        confidence: 'alta',
      });
    }
  }

  // 3. Revenue total
  if (Math.abs(revenue.delta) >= 0.15) {
    const up = revenue.delta > 0;
    out.push({
      id: 'funnel-revenue',
      category: 'mom',
      severity: up ? 'success' : 'warning',
      headline: up
        ? `Revenue subió ${fmtPctSigned(revenue.delta)} vs mes pasado`
        : `Revenue cae ${fmtPctAbs(revenue.delta)} vs mes pasado`,
      detail: `${fmtCurrency(revenue.value)} este período.`,
      recommendation: up
        ? `Vale la pena documentar qué movimientos de marketing/producto coincidieron con esta mejora.`
        : `Vale la pena cruzar con la pestaña Pulso o Rutas para identificar qué canal/ruta lidera la caída.`,
      confidence: 'alta',
    });
  }

  return sortBySeverity(out).slice(0, 6);
}

// ─── Generador de conclusiones para Meta Ads ────────────────────────────────

export function buildMetaAdsConclusions(input: {
  campaigns: any[];     // del endpoint /meta-ads
  creatives: any[];     // del endpoint /creatives
  demographics: any;    // del endpoint /demographics — incluye mismatches
  kpis: any;
}): Conclusion[] {
  const out: Conclusion[] = [];
  const { campaigns, creatives, demographics, kpis } = input;

  // 1. Mejor campaña por revenue (objetivo de venta)
  const salesCampaigns = (campaigns ?? []).filter((c: any) =>
    ['OUTCOME_SALES', 'CONVERSIONS', 'PRODUCT_CATALOG_SALES'].includes(c.type)
  );
  if (salesCampaigns.length > 0) {
    const sorted = [...salesCampaigns].sort((a, b) => b.revenue - a.revenue);
    const top = sorted[0];
    const totalRev = salesCampaigns.reduce((s, c) => s + Number(c.revenue || 0), 0);
    if (totalRev > 0 && top.revenue / totalRev >= 0.25) {
      const sharePct = top.revenue / totalRev;
      out.push({
        id: `meta-top-campaign`,
        category: 'efficiency',
        severity: 'success',
        headline: `"${top.segment}" es tu campaña Meta más rentable`,
        detail: `Aporta ${fmtPctAbs(sharePct)} del revenue de Meta (${fmtCurrency(top.revenue)}). ROAS ${top.roas.toFixed(1)}x con ${fmtCurrency(top.spend)}.`,
        recommendation: `Vale la pena considerar escalar budget en "${top.segment}" o duplicar la estructura para audiencias similares.`,
        confidence: 'alta',
      });
    }
  }

  // 2. Campañas Meta con health 'pause'
  const toPause = (campaigns ?? []).filter((c: any) => c.health?.status === 'pause');
  if (toPause.length > 0) {
    const c = toPause[0];
    out.push({
      id: `meta-pause-${c.id}`,
      category: 'efficiency',
      severity: 'critical',
      headline: `${toPause.length} campaña${toPause.length > 1 ? 's' : ''} Meta sin convertir`,
      detail: `"${c.segment}" gastó ${fmtCurrency(c.last7d?.spend ?? c.spend)} en últimos 7 días sin conversiones.${toPause.length > 1 ? ` Hay ${toPause.length - 1} más en la misma situación.` : ''}`,
      recommendation: `Vale la pena pausar urgente o cambiar drasticamente: nuevo creative, audiencia o landing.`,
      confidence: 'alta',
    });
  }

  // 3. Top creative por ROAS (con spend significativo)
  if (creatives && creatives.length > 0) {
    const filteredCreatives = creatives.filter((c: any) => c.spend >= 5000);
    if (filteredCreatives.length > 0) {
      const sorted = [...filteredCreatives].sort((a, b) => b.roas - a.roas);
      const top = sorted[0];
      const avgRoas = filteredCreatives.reduce((s, c) => s + Number(c.roas || 0), 0) / filteredCreatives.length;
      if (top.roas > avgRoas * 1.5 && top.roas >= 3) {
        const liftPct = (top.roas - avgRoas) / avgRoas;
        out.push({
          id: `meta-top-creative`,
          category: 'creative',
          severity: 'success',
          headline: `Tu creative "${top.adName ?? top.adId}" rinde ${fmtPctAbs(liftPct)} más que el promedio`,
          detail: `Generó ${fmtCurrency(top.revenue)} con ${fmtCurrency(top.spend)}. ROAS ${top.roas.toFixed(1)}x vs promedio de ${avgRoas.toFixed(1)}x. ${top.purchases} compras.`,
          recommendation: `Vale la pena considerar duplicar este creative en otras campañas o producir variaciones (mismo concepto, distintos copys/imágenes).`,
          confidence: 'alta',
        });
      }
    }
  }

  // 4. Demographic mismatches → oportunidades de redistribución
  if (demographics?.mismatches && Array.isArray(demographics.mismatches)) {
    for (const m of demographics.mismatches) {
      if (m.underspent && m.underspent.length > 0) {
        const top = m.underspent[0];
        const dimLabel = m.dimension.toLowerCase();
        out.push({
          id: `meta-mismatch-${m.dimension}-${top.value}`,
          category: 'audience',
          severity: 'info',
          headline: `${m.dimension}: estás sub-invirtiendo en ${top.value}`,
          detail: `${top.value} representa ${fmtPctAbs(top.purchShare)} de las compras pero solo ${fmtPctAbs(top.spendShare)} del spend. ROAS ${top.roas.toFixed(1)}x.`,
          recommendation: `Vale la pena considerar subir bid adjustments para ${dimLabel} = ${top.value} o crear campañas dedicadas a ese segmento.`,
          confidence: 'alta',
        });
        break;  // un mismatch por iteración para no spammear
      }
    }
    // También sobre-gastando
    for (const m of demographics.mismatches) {
      if (m.overspent && m.overspent.length > 0) {
        const top = m.overspent[0];
        const dimLabel = m.dimension.toLowerCase();
        out.push({
          id: `meta-overspend-${m.dimension}-${top.value}`,
          category: 'audience',
          severity: 'warning',
          headline: `${m.dimension}: estás sobre-invirtiendo en ${top.value}`,
          detail: `${top.value} consume ${fmtPctAbs(top.spendShare)} del spend pero solo aporta ${fmtPctAbs(top.purchShare)} de las compras. ROAS ${top.roas.toFixed(1)}x.`,
          recommendation: `Vale la pena considerar reducir bid adjustments o excluir ${dimLabel} = ${top.value} si su ROAS es claramente inferior al promedio.`,
          confidence: 'alta',
        });
        break;
      }
    }
  }

  // 5. Tendencia general
  if (kpis?.revenue?.delta !== undefined && kpis.revenue.delta < -0.20 && kpis?.spend?.delta > -0.10) {
    out.push({
      id: `meta-revenue-drop`,
      category: 'mom',
      severity: 'warning',
      headline: `Revenue de Meta cae ${fmtPctAbs(kpis.revenue.delta)} vs período anterior`,
      detail: `${fmtCurrency(Number(kpis.revenue.value))} este período. La inversión casi no cambió (${fmtPctSigned(kpis.spend.delta)}). El problema está en la conversión.`,
      recommendation: `Vale la pena revisar fatiga de creatives (frecuencia alta), saturación de audiencias o cambios en placement performance.`,
      confidence: 'alta',
    });
  }

  return sortBySeverity(out).slice(0, 6);
}

// ─── Generador de conclusiones para Google Ads ──────────────────────────────

export function buildGoogleAdsConclusions(input: {
  campaigns: any[];      // del endpoint /google-ads
  searchTermsData: any;  // del endpoint /search-terms
  competitorsData: any;  // del endpoint /competitors
  kpis: any;             // KPIs agregados del período
}): Conclusion[] {
  const out: Conclusion[] = [];
  const { campaigns, searchTermsData, competitorsData, kpis } = input;

  // 1. Mejor campaña por revenue
  if (campaigns && campaigns.length > 0) {
    const sorted = [...campaigns].sort((a, b) => b.revenue - a.revenue);
    const top = sorted[0];
    const totalRevenue = campaigns.reduce((s, c) => s + Number(c.revenue || 0), 0);
    if (totalRevenue > 0 && top.revenue / totalRevenue >= 0.25) {
      const sharePct = top.revenue / totalRevenue;
      out.push({
        id: `gads-top-campaign`,
        category: 'efficiency',
        severity: 'success',
        headline: `"${top.name}" es tu campaña estrella`,
        detail: `Aporta ${fmtPctAbs(sharePct)} del revenue total de Google Ads (${fmtCurrency(top.revenue)}). ROAS ${top.roas.toFixed(1)}x con ${fmtCurrency(top.spend)} de inversión.`,
        recommendation: `Vale la pena revisar si hay margen para escalar budget en "${top.name}" sin sacrificar el ROAS, y considerar replicar el approach en otras campañas.`,
        confidence: 'alta',
      });
    }
  }

  // 2. Campañas con health 'pause' (urgente)
  const toPause = (campaigns ?? []).filter((c: any) => c.health?.status === 'pause');
  if (toPause.length > 0) {
    const c = toPause[0];  // la más cara
    out.push({
      id: `gads-pause-${c.id}`,
      category: 'efficiency',
      severity: 'critical',
      headline: `${toPause.length} campaña${toPause.length > 1 ? 's' : ''} sin convertir con gasto significativo`,
      detail: `"${c.name}" gastó ${fmtCurrency(c.last7d?.spend ?? c.spend)} en últimos 7 días sin conversiones. ${toPause.length > 1 ? `Hay ${toPause.length - 1} campaña${toPause.length > 2 ? 's' : ''} más en la misma situación.` : ''}`,
      recommendation: `Vale la pena revisar urgente: pausar, cambiar landing o ajustar targeting antes de seguir gastando.`,
      confidence: 'alta',
    });
  }

  // 3. Top query que aporta gran parte del revenue
  if (searchTermsData?.topConverters && searchTermsData.topConverters.length > 0) {
    const totalRev = searchTermsData.topConverters.reduce((s: number, t: any) => s + Number(t.convValue || 0), 0);
    const top = searchTermsData.topConverters[0];
    if (totalRev > 0 && Number(top.convValue) / totalRev >= 0.20) {
      const sharePct = Number(top.convValue) / totalRev;
      out.push({
        id: `gads-top-query`,
        category: 'query',
        severity: 'info',
        headline: `"${top.term}" es tu query más rentable`,
        detail: `Genera ${fmtPctAbs(sharePct)} del revenue del top de queries (${fmtCurrency(Number(top.convValue))}). ROAS ${Number(top.roas).toFixed(1)}x con ${top.clicks} clicks.`,
        recommendation: `Vale la pena considerar crear un ad group dedicado a esta query con copy y landing optimizados específicamente para ella.`,
        confidence: 'alta',
      });
    }
  }

  // 4. Wasted spend con monto significativo → ahorro accionable
  if (searchTermsData?.actionable && Number(searchTermsData.actionable.monthlySavings) > 5000) {
    const savings = Number(searchTermsData.actionable.monthlySavings);
    const count = searchTermsData.actionable.negativeKeywordsCount;
    out.push({
      id: `gads-negative-keywords`,
      category: 'query',
      severity: 'warning',
      headline: `Podés ahorrar ${fmtCurrency(savings)}/mes con negative keywords`,
      detail: `Hay ${count} queries que gastan sin convertir. Si las agregás como negative keywords (exact match), no se sigue gastando ahí.`,
      recommendation: `Vale la pena copiar la lista desde el bloque de Search Terms y pegarla en Google Ads → Keywords → Negative keywords (a nivel cuenta o campaña).`,
      confidence: 'alta',
      metric: { label: 'Ahorro/mes', value: fmtCurrency(savings) },
    });
  }

  // 5. Competencia: si gastás mucho en queries de competencia con bajo ROAS
  if (competitorsData?.configured && competitorsData.totals) {
    const totalCost = Number(competitorsData.totals.cost);
    const totalRoas = Number(competitorsData.totals.roas);
    if (totalCost > 10000 && totalRoas < 5) {
      out.push({
        id: `gads-competition`,
        category: 'competition',
        severity: 'warning',
        headline: `Estás gastando ${fmtCurrency(totalCost)} en queries de competencia`,
        detail: `Esos clicks tienen ROAS ${totalRoas.toFixed(2)}x — más bajo que el promedio. Proyección mensual: ${fmtCurrency(Number(competitorsData.monthlyProjection?.cost ?? 0))}.`,
        recommendation: `Vale la pena revisar si la estrategia de "robo de marca" justifica el gasto, o considerar agregar nombres de competencia como negative keywords.`,
        confidence: 'alta',
      });
    }
  }

  // 6. Tendencia general: si KPIs cayeron mucho
  if (kpis?.revenue?.delta !== undefined && kpis.revenue.delta < -0.20 && kpis?.spend?.delta > -0.10) {
    out.push({
      id: `gads-revenue-drop`,
      category: 'mom',
      severity: 'warning',
      headline: `Revenue de Google Ads cae ${fmtPctAbs(kpis.revenue.delta)} vs período anterior`,
      detail: `${fmtCurrency(Number(kpis.revenue.value))} este período vs un mes atrás. La inversión casi no cambió (${fmtPctSigned(kpis.spend.delta)}), entonces el problema está en la conversión.`,
      recommendation: `Vale la pena revisar landing pages, copy de ads, o si hubo cambios en el algoritmo / pricing de la competencia.`,
      confidence: 'alta',
    });
  }

  return sortBySeverity(out).slice(0, 6);
}
