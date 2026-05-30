// Venue lookup: key = `${team_home}|${team_away}` (group stage only — knockout TBD)
//
// 2026-05-31: replaced 6 March-2026 qualifier placeholders with real teams:
//   UEFA PO-A → Bosnia-Herzegovina  |  UEFA PO-B → Sweden
//   UEFA PO-C → Turkey              |  UEFA PO-D → Czech Republic
//   IC PO-1   → DR Congo            |  IC PO-2   → Iraq
// Source of truth: js/main.js HOST_SCHEDULES (already had real teams).
// DB games table also has real teams; this file is what makes the venue
// line render on Dashboard/Game. Pre-fix, ~10 games rendered with no venue.
const RAW = [
  // Mexico host games
  ['Mexico','South Africa','Estadio Azteca','Mexico City','87,500','Group A · MD1'],
  ['South Korea','Czech Republic','Estadio Akron','Guadalajara','49,850','Group A · MD1'],
  ['Sweden','Tunisia','Estadio BBVA','Monterrey','53,500','Group F · MD1'],
  ['Uzbekistan','Colombia','Estadio Azteca','Mexico City','87,500','Group K · MD1'],
  ['Mexico','South Korea','Estadio Akron','Guadalajara','49,850','Group A · MD2'],
  ['Tunisia','Japan','Estadio BBVA','Monterrey','53,500','Group F · MD2'],
  ['Colombia','DR Congo','Estadio Akron','Guadalajara','49,850','Group K · MD2'],
  ['Mexico','Czech Republic','Estadio Azteca','Mexico City','87,500','Group A · MD3'],
  ['South Africa','South Korea','Estadio BBVA','Monterrey','53,500','Group A · MD3'],
  ['Uruguay','Spain','Estadio Akron','Guadalajara','49,850','Group H · MD3'],
  // Canada host games
  ['Canada','Bosnia-Herzegovina','BMO Field','Toronto','45,000','Group B · MD1'],
  ['Australia','Turkey','BC Place','Vancouver','54,500','Group D · MD1'],
  ['Ghana','Panama','BMO Field','Toronto','45,000','Group L · MD1'],
  ['Canada','Qatar','BC Place','Vancouver','54,500','Group B · MD2'],
  ['Germany','Ivory Coast','BMO Field','Toronto','45,000','Group E · MD2'],
  ['New Zealand','Egypt','BC Place','Vancouver','54,500','Group G · MD2'],
  ['Croatia','Panama','BMO Field','Toronto','45,000','Group L · MD2'],
  ['Canada','Switzerland','BC Place','Vancouver','54,500','Group B · MD3'],
  ['Senegal','Iraq','BMO Field','Toronto','45,000','Group I · MD3'],
  ['New Zealand','Belgium','BC Place','Vancouver','54,500','Group G · MD3'],
  // USA host games
  ['United States','Paraguay','SoFi Stadium','Inglewood, CA','70,240','Group D · MD1'],
  ['Qatar','Switzerland','Levi\'s Stadium','Santa Clara, CA','68,500','Group B · MD1'],
  ['Brazil','Morocco','MetLife Stadium','E. Rutherford, NJ','82,500','Group C · MD1'],
  ['Haiti','Scotland','Gillette Stadium','Foxborough, MA','65,878','Group C · MD1'],
  ['Germany','Curaçao','NRG Stadium','Houston, TX','72,220','Group E · MD1'],
  ['Netherlands','Japan','AT&T Stadium','Arlington, TX','80,000','Group F · MD1'],
  ['Ivory Coast','Ecuador','Lincoln Financial Field','Philadelphia, PA','69,796','Group E · MD1'],
  ['Spain','Cape Verde','Mercedes-Benz Stadium','Atlanta, GA','71,000','Group H · MD1'],
  ['Belgium','Egypt','Lumen Field','Seattle, WA','68,740','Group G · MD1'],
  ['Saudi Arabia','Uruguay','Hard Rock Stadium','Miami Gardens, FL','64,767','Group H · MD1'],
  ['Iran','New Zealand','SoFi Stadium','Inglewood, CA','70,240','Group G · MD1'],
  ['France','Senegal','MetLife Stadium','E. Rutherford, NJ','82,500','Group I · MD1'],
  ['Iraq','Norway','Gillette Stadium','Foxborough, MA','65,878','Group I · MD1'],
  ['Argentina','Algeria','Arrowhead Stadium','Kansas City, MO','76,416','Group J · MD1'],
  ['Austria','Jordan','Levi\'s Stadium','Santa Clara, CA','68,500','Group J · MD1'],
  ['Portugal','DR Congo','NRG Stadium','Houston, TX','72,220','Group K · MD1'],
  ['England','Croatia','AT&T Stadium','Arlington, TX','80,000','Group L · MD1'],
  ['Czech Republic','South Africa','Mercedes-Benz Stadium','Atlanta, GA','71,000','Group A · MD2'],
  ['Switzerland','Bosnia-Herzegovina','SoFi Stadium','Inglewood, CA','70,240','Group B · MD2'],
  ['United States','Australia','Lumen Field','Seattle, WA','68,740','Group D · MD2'],
  ['Scotland','Morocco','Gillette Stadium','Foxborough, MA','65,878','Group C · MD2'],
  ['Brazil','Haiti','Lincoln Financial Field','Philadelphia, PA','69,796','Group C · MD2'],
  ['Turkey','Paraguay','Levi\'s Stadium','Santa Clara, CA','68,500','Group D · MD2'],
  ['Netherlands','Sweden','NRG Stadium','Houston, TX','72,220','Group F · MD2'],
  ['Ecuador','Curaçao','Arrowhead Stadium','Kansas City, MO','76,416','Group E · MD2'],
  ['Spain','Saudi Arabia','Mercedes-Benz Stadium','Atlanta, GA','71,000','Group H · MD2'],
  ['Belgium','Iran','SoFi Stadium','Inglewood, CA','70,240','Group G · MD2'],
  ['Uruguay','Cape Verde','Hard Rock Stadium','Miami Gardens, FL','64,767','Group H · MD2'],
  ['Argentina','Austria','AT&T Stadium','Arlington, TX','80,000','Group J · MD2'],
  ['France','Iraq','Lincoln Financial Field','Philadelphia, PA','69,796','Group I · MD2'],
  ['Norway','Senegal','MetLife Stadium','E. Rutherford, NJ','82,500','Group I · MD2'],
  ['Jordan','Algeria','Levi\'s Stadium','Santa Clara, CA','68,500','Group J · MD2'],
  ['Portugal','Uzbekistan','NRG Stadium','Houston, TX','72,220','Group K · MD2'],
  ['England','Ghana','Gillette Stadium','Foxborough, MA','65,878','Group L · MD2'],
  ['Bosnia-Herzegovina','Qatar','Lumen Field','Seattle, WA','68,740','Group B · MD3'],
  ['Scotland','Brazil','Hard Rock Stadium','Miami Gardens, FL','64,767','Group C · MD3'],
  ['Morocco','Haiti','Mercedes-Benz Stadium','Atlanta, GA','71,000','Group C · MD3'],
  ['Ecuador','Germany','MetLife Stadium','E. Rutherford, NJ','82,500','Group E · MD3'],
  ['Curaçao','Ivory Coast','Lincoln Financial Field','Philadelphia, PA','69,796','Group E · MD3'],
  ['Japan','Sweden','AT&T Stadium','Arlington, TX','80,000','Group F · MD3'],
  ['Tunisia','Netherlands','Arrowhead Stadium','Kansas City, MO','76,416','Group F · MD3'],
  ['Turkey','United States','SoFi Stadium','Inglewood, CA','70,240','Group D · MD3'],
  ['Paraguay','Australia','Levi\'s Stadium','Santa Clara, CA','68,500','Group D · MD3'],
  ['Norway','France','Gillette Stadium','Foxborough, MA','65,878','Group I · MD3'],
  ['Cape Verde','Saudi Arabia','NRG Stadium','Houston, TX','72,220','Group H · MD3'],
  ['Egypt','Iran','Lumen Field','Seattle, WA','68,740','Group G · MD3'],
  ['Panama','England','MetLife Stadium','E. Rutherford, NJ','82,500','Group L · MD3'],
  ['Croatia','Ghana','Lincoln Financial Field','Philadelphia, PA','69,796','Group L · MD3'],
  ['Colombia','Portugal','Hard Rock Stadium','Miami Gardens, FL','64,767','Group K · MD3'],
  ['DR Congo','Uzbekistan','Mercedes-Benz Stadium','Atlanta, GA','71,000','Group K · MD3'],
  ['Algeria','Austria','Arrowhead Stadium','Kansas City, MO','76,416','Group J · MD3'],
  ['Jordan','Argentina','AT&T Stadium','Arlington, TX','80,000','Group J · MD3'],
]

export const VENUE_MAP = new Map(
  RAW.map(([home, away, venue, city, capacity, round]) => [
    `${home}|${away}`,
    { venue, city, capacity, round }
  ])
)

export function getVenue(teamHome, teamAway) {
  return VENUE_MAP.get(`${teamHome}|${teamAway}`) ?? null
}
