/**
 * Day-of-week router — picks the theme + source datasets for a given date.
 * Date is interpreted in Asia/Singapore timezone.
 */

const THEMES = {
  monday: {
    id: 'distress',
    label: 'Distress + condo trends',
    sources: ['distress-radar', 'launches', 'condo-analysis'],
    research_query: "this week's distress radar finds + condo new launch and resale movement, surface the most undervalued by district"
  },
  tuesday: {
    id: 'hdb',
    label: 'HDB market',
    sources: ['hdb-market', 'data.gov.sg/resale', 'data.gov.sg/bto'],
    research_query: "HDB BTO + resale insights this week — flat-type winners, towns with biggest price moves, BTO subscription odds"
  },
  wednesday: {
    id: 'rental',
    label: 'Rental market',
    sources: ['rental-yield', 'ura/rentals'],
    research_query: "HDB + condo rental yields this week, hottest districts, where landlord ROI beats 5% net"
  },
  thursday: {
    id: 'landed',
    label: 'Landed market',
    sources: ['landed', 'ura/landed-transactions'],
    research_query: "landed property: brand new vs resale this week — who is still selling, where, at what discount to original asking"
  },
  friday: {
    id: 'wrap',
    label: 'Weekly wrap',
    sources: ['aggregated'],
    research_query: "wrap of the week's signals across condo, HDB, rental, landed — one bonus tip the average buyer would miss"
  },
  saturday: {
    id: 'masterplan',
    label: 'URA masterplan + policy',
    sources: ['ura/masterplan', 'gov-policy-feed'],
    research_query: "URA masterplan moves + government property policy this week, what it means for buyers and sellers"
  },
  sunday: {
    id: 'geopolitics',
    label: 'Geopolitics',
    sources: ['macro-feed', 'web-search'],
    research_query: "global geopolitics this week affecting Singapore property — Fed, USD/SGD, regional risk-off, capital flight signals"
  }
};

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function themeForDate(date = new Date()) {
  // Force-override via env (useful for backfills / debug)
  if (process.env.FORCE_THEME) {
    const t = Object.values(THEMES).find(t => t.id === process.env.FORCE_THEME);
    if (t) return { ...t, date: date.toISOString().slice(0, 10), forced: true };
  }

  // Get day-of-week in SGT
  const sgtDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Singapore' }));
  const dayName = DAY_NAMES[sgtDate.getDay()];
  return {
    ...THEMES[dayName],
    day: dayName,
    date: sgtDate.toISOString().slice(0, 10)
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(themeForDate(), null, 2));
}
