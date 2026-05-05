// ── COUNTDOWN ────────────────────────────────────────────────
// Target: June 11 2026, 19:00 UTC = 22:00 IDT (opening kick-off)
(function() {
  const T = new Date('2026-06-11T19:00:00Z');
  function tick() {
    let d = T - Date.now();
    if (d < 0) d = 0;
    document.getElementById('cd-days').textContent  = String(Math.floor(d/86400000)).padStart(2,'0');
    document.getElementById('cd-hours').textContent = String(Math.floor(d%86400000/3600000)).padStart(2,'0');
    document.getElementById('cd-mins').textContent  = String(Math.floor(d%3600000/60000)).padStart(2,'0');
    document.getElementById('cd-secs').textContent  = String(Math.floor(d%60000/1000)).padStart(2,'0');
  }
  tick(); setInterval(tick,1000);
})();

// ── TEAM DATA ────────────────────────────────────────────────
// Draw: December 5, 2025, Kennedy Center, Washington D.C.
// IDT = UTC+3 (Israel Daylight Time, June–July)
// Mexico City = UTC-6 (no DST since 2023) → IDT = local+9
// Los Angeles/Seattle/Vancouver = PDT UTC-7 → IDT = local+10
// Toronto = EDT UTC-4 → IDT = local+7

const TEAMS = [
  // GROUP A
  { name:'Mexico', code:'mx', group:'A', conf:'CONCACAF', host:true, lat:19.4, lng:-99.1,
    fifaRank:15, best:'Quarter-Finals', times:'2×', lastAchieved:'1986 (Mexico)', lastWC:'2022 (Qatar) — Group Stage',
    schedule:[
      { phase:'group', label:'Group A', date:'Thu, Jun 11', opponent:'South Africa', oppCode:'za', venue:'Estadio Azteca', city:'Mexico City', idt:'22:00', idtLabel:'Jun 11' },
      { phase:'group', label:'Group A', date:'Thu, Jun 18', opponent:'South Korea',  oppCode:'kr', venue:'Estadio Akron',  city:'Guadalajara', idt:'06:00', idtLabel:'Jun 19 ⁺¹' },
      { phase:'group', label:'Group A', date:'Wed, Jun 24', opponent:'Czech Republic', oppCode:'cz', venue:'Estadio Azteca', city:'Mexico City', idt:'04:00', idtLabel:'Jun 25 ⁺¹' },
      { phase:'knockout', label:'Round of 32', date:'Tue, Jun 30', opponent:'TBD (if advancing)', oppCode:null, venue:'Estadio Azteca', city:'Mexico City', idt:'TBD', idtLabel:'Jun 30' },
    ]
  },
  { name:'South Africa', code:'za', group:'A', conf:'CAF',      host:false, lat:-25.7, lng:28.2,
    fifaRank:60, best:'Group Stage', times:'3 appearances', lastAchieved:'2010 (as host)', lastWC:'2010 (South Africa) — Group Stage (as host)' },
  { name:'South Korea',  code:'kr', group:'A', conf:'AFC',      host:false, lat:37.6, lng:127.0,
    fifaRank:25, best:'4th Place', times:'1×', lastAchieved:'2002 (Japan/Korea)', lastWC:'2022 (Qatar) — Round of 16' },
  { name:'Czech Republic', code:'cz', group:'A', conf:'UEFA',   host:false, lat:50.1, lng:14.4,
    fifaRank:41, best:'Runner-Up (as Czechoslovakia)', times:'2×', lastAchieved:'1962 (Chile)', lastWC:'2006 (Germany) — Group Stage' },
  // GROUP B
  { name:'Canada', code:'ca', group:'B', conf:'CONCACAF', host:true, lat:57.0, lng:-96.0,
    fifaRank:30, best:'Group Stage', times:'2 appearances', lastAchieved:'2022 (Qatar)', lastWC:'2022 (Qatar) — Group Stage',
    schedule:[
      { phase:'group', label:'Group B', date:'Fri, Jun 12', opponent:'Bosnia-Herzegovina', oppCode:'ba', venue:'BMO Field',  city:'Toronto',    idt:'22:00', idtLabel:'Jun 12' },
      { phase:'group', label:'Group B', date:'Thu, Jun 18', opponent:'Qatar',          oppCode:'qa', venue:'BC Place',   city:'Vancouver',  idt:'01:00', idtLabel:'Jun 19 ⁺¹' },
      { phase:'group', label:'Group B', date:'Wed, Jun 24', opponent:'Switzerland',    oppCode:'ch', venue:'BC Place',   city:'Vancouver',  idt:'22:00', idtLabel:'Jun 24' },
      { phase:'knockout', label:'Round of 32', date:'Thu, Jul 2', opponent:'TBD (if advancing)', oppCode:null, venue:'BC Place', city:'Vancouver', idt:'TBD', idtLabel:'Jul 2' },
    ]
  },
  { name:'Qatar',       code:'qa', group:'B', conf:'AFC',  host:false, lat:25.3, lng:51.2,
    fifaRank:55, best:'Group Stage (host)', times:'1×', lastAchieved:'2022 (Qatar)', lastWC:'2022 (Qatar) — Group Stage (as host)' },
  { name:'Switzerland', code:'ch', group:'B', conf:'UEFA', host:false, lat:46.9, lng:7.4,
    fifaRank:19, best:'Quarter-Finals', times:'3×', lastAchieved:'1954 (Switzerland)', lastWC:'2022 (Qatar) — Round of 16' },
  { name:'Bosnia-Herzegovina', code:'ba', group:'B', conf:'UEFA', host:false, lat:43.85, lng:18.35,
    fifaRank:65, best:'Group Stage', times:'1 appearance', lastAchieved:'2014 (Brazil)', lastWC:'2014 (Brazil) — Group Stage' },
  // GROUP C
  { name:'Brazil',   code:'br', group:'C', conf:'CONMEBOL', host:false, lat:-15.8, lng:-47.9,
    fifaRank:6,  best:'World Champion', times:'5×', lastAchieved:'2002 (Japan/Korea)', lastWC:'2022 (Qatar) — Quarter-Finals' },
  { name:'Morocco',  code:'ma', group:'C', conf:'CAF',      host:false, lat:33.0, lng:-5.5,
    fifaRank:8, best:'4th Place', times:'1×', lastAchieved:'2022 (Qatar)', lastWC:'2022 (Qatar) — 4th Place' },
  { name:'Haiti',    code:'ht', group:'C', conf:'CONCACAF', host:false, lat:19.0, lng:-72.3,
    fifaRank:83, best:'Group Stage', times:'1 appearance', lastAchieved:'1974 (West Germany)', lastWC:'1974 (West Germany) — Group Stage' },
  { name:'Scotland', code:'gb-sct', group:'C', conf:'UEFA', host:false, lat:55.9, lng:-3.2,
    fifaRank:43, best:'Group Stage', times:'8 appearances', lastAchieved:'1998 (France)', lastWC:'1998 (France) — Group Stage' },
  // GROUP D
  { name:'United States', code:'us', group:'D', conf:'CONCACAF', host:true, lat:39.5, lng:-98.5,
    fifaRank:16, best:'3rd Place', times:'1×', lastAchieved:'1930 (Uruguay)', lastWC:'2022 (Qatar) — Round of 16',
    schedule:[
      { phase:'group', label:'Group D', date:'Fri, Jun 12', opponent:'Paraguay',       oppCode:'py', venue:'SoFi Stadium', city:'Inglewood, CA', idt:'04:00', idtLabel:'Jun 13 ⁺¹' },
      { phase:'group', label:'Group D', date:'Fri, Jun 19', opponent:'Australia',       oppCode:'au', venue:'Lumen Field',  city:'Seattle',       idt:'22:00', idtLabel:'Jun 19' },
      { phase:'group', label:'Group D', date:'Thu, Jun 25', opponent:'Turkey',          oppCode:'tr', venue:'SoFi Stadium', city:'Inglewood, CA', idt:'05:00', idtLabel:'Jun 26 ⁺¹' },
      { phase:'knockout', label:'Round of 32', date:'Sun, Jun 28', opponent:'TBD (if advancing)', oppCode:null, venue:'SoFi Stadium', city:'Inglewood, CA', idt:'TBD', idtLabel:'Jun 28' },
    ]
  },
  { name:'Paraguay',  code:'py', group:'D', conf:'CONMEBOL', host:false, lat:-25.3, lng:-57.6,
    fifaRank:40, best:'Quarter-Finals', times:'1×', lastAchieved:'2010 (South Africa)', lastWC:'2010 (South Africa) — Quarter-Finals' },
  { name:'Australia', code:'au', group:'D', conf:'AFC',      host:false, lat:-25.3, lng:133.8,
    fifaRank:27, best:'Round of 16', times:'2×', lastAchieved:'2022 (Qatar)', lastWC:'2022 (Qatar) — Round of 16' },
  { name:'Turkey',    code:'tr', group:'D', conf:'UEFA',     host:false, lat:39.9, lng:32.85,
    fifaRank:22, best:'3rd Place', times:'1×', lastAchieved:'2002 (Japan/Korea)', lastWC:'2002 (Japan/Korea) — 3rd Place' },
  // GROUP E
  { name:'Germany',     code:'de', group:'E', conf:'UEFA',     host:false, lat:52.5, lng:13.4,
    fifaRank:10, best:'World Champion', times:'4×', lastAchieved:'2014 (Brazil)', lastWC:'2022 (Qatar) — Group Stage' },
  { name:'Curaçao',     code:'cw', group:'E', conf:'CONCACAF', host:false, lat:12.1, lng:-68.9,
    fifaRank:82, best:'First World Cup!', times:'First time', lastAchieved:'2026 (debut)', lastWC:'2026 — First World Cup ever' },
  { name:'Ivory Coast', code:'ci', group:'E', conf:'CAF',      host:false, lat:7.5, lng:-6.5,
    fifaRank:34, best:'Group Stage', times:'3 appearances', lastAchieved:'2014 (Brazil)', lastWC:'2014 (Brazil) — Group Stage' },
  { name:'Ecuador',     code:'ec', group:'E', conf:'CONMEBOL', host:false, lat:-0.2, lng:-78.5,
    fifaRank:23, best:'Round of 16', times:'1×', lastAchieved:'2006 (Germany)', lastWC:'2022 (Qatar) — Group Stage' },
  // GROUP F
  { name:'Netherlands', code:'nl', group:'F', conf:'UEFA', host:false, lat:52.2, lng:5.5,
    fifaRank:7,  best:'Runner-Up', times:'3×', lastAchieved:'2010 (South Africa)', lastWC:'2022 (Qatar) — Quarter-Finals' },
  { name:'Japan',       code:'jp', group:'F', conf:'AFC',  host:false, lat:35.7, lng:139.7,
    fifaRank:18, best:'Round of 16', times:'4×', lastAchieved:'2022 (Qatar)', lastWC:'2022 (Qatar) — Round of 16' },
  { name:'Tunisia',     code:'tn', group:'F', conf:'CAF',  host:false, lat:34.0, lng:9.0,
    fifaRank:44, best:'Group Stage', times:'6 appearances', lastAchieved:'2022 (Qatar)', lastWC:'2022 (Qatar) — Group Stage' },
  { name:'Sweden',      code:'se', group:'F', conf:'UEFA', host:false, lat:59.3, lng:18.1,
    fifaRank:38, best:'Runner-Up', times:'1×', lastAchieved:'1958 (Sweden)', lastWC:'2018 (Russia) — Quarter-Finals' },
  // GROUP G
  { name:'Belgium',     code:'be', group:'G', conf:'UEFA', host:false, lat:50.8, lng:4.4,
    fifaRank:9,  best:'3rd Place', times:'1×', lastAchieved:'2018 (Russia)', lastWC:'2022 (Qatar) — Group Stage' },
  { name:'Egypt',       code:'eg', group:'G', conf:'CAF',  host:false, lat:30.0, lng:31.2,
    fifaRank:29, best:'Group Stage', times:'3 appearances', lastAchieved:'2018 (Russia)', lastWC:'2018 (Russia) — Group Stage' },
  { name:'Iran',        code:'ir', group:'G', conf:'AFC',  host:false, lat:35.7, lng:51.4,
    fifaRank:21, best:'Group Stage', times:'6 appearances', lastAchieved:'2022 (Qatar)', lastWC:'2022 (Qatar) — Group Stage' },
  { name:'New Zealand', code:'nz', group:'G', conf:'OFC',  host:false, lat:-37.0, lng:175.5,
    fifaRank:85, best:'Group Stage (unbeaten!)', times:'1× — 2010 only', lastAchieved:'2010 (South Africa)', lastWC:'2010 (South Africa) — Group Stage (3 draws, 0 losses)' },
  // GROUP H
  { name:'Spain',        code:'es', group:'H', conf:'UEFA',     host:false, lat:40.4, lng:-3.7,
    fifaRank:2,  best:'World Champion', times:'1×', lastAchieved:'2010 (South Africa)', lastWC:'2022 (Qatar) — Round of 16' },
  { name:'Cape Verde',   code:'cv', group:'H', conf:'CAF',      host:false, lat:14.9, lng:-23.5,
    fifaRank:69, best:'First World Cup!', times:'First time', lastAchieved:'2026 (debut)', lastWC:'2026 — First World Cup ever' },
  { name:'Saudi Arabia', code:'sa', group:'H', conf:'AFC',      host:false, lat:24.7, lng:46.7,
    fifaRank:61, best:'Round of 16', times:'1×', lastAchieved:'1994 (USA)', lastWC:'2022 (Qatar) — Group Stage' },
  { name:'Uruguay',      code:'uy', group:'H', conf:'CONMEBOL', host:false, lat:-32.5, lng:-56.0,
    fifaRank:17, best:'World Champion', times:'2×', lastAchieved:'1950 (Brazil)', lastWC:'2022 (Qatar) — Group Stage' },
  // GROUP I
  { name:'France',  code:'fr', group:'I', conf:'UEFA', host:false, lat:48.9, lng:2.3,
    fifaRank:1,  best:'World Champion', times:'2×', lastAchieved:'2018 (Russia)', lastWC:'2022 (Qatar) — Runner-Up' },
  { name:'Senegal', code:'sn', group:'I', conf:'CAF',  host:false, lat:14.5, lng:-14.5,
    fifaRank:14, best:'Quarter-Finals', times:'1×', lastAchieved:'2002 (Japan/Korea)', lastWC:'2022 (Qatar) — Round of 16' },
  { name:'Norway',  code:'no', group:'I', conf:'UEFA', host:false, lat:62.0, lng:9.5,
    fifaRank:31, best:'Round of 16', times:'2×', lastAchieved:'1998 (France)', lastWC:'1998 (France) — Round of 16' },
  { name:'Iraq',    code:'iq', group:'I', conf:'AFC',  host:false, lat:33.3, lng:44.4,
    fifaRank:57, best:'Group Stage', times:'1 appearance', lastAchieved:'1986 (Mexico)', lastWC:'1986 (Mexico) — Group Stage' },
  // GROUP J
  { name:'Argentina', code:'ar', group:'J', conf:'CONMEBOL', host:false, lat:-31.5, lng:-64.0,
    fifaRank:3,  best:'World Champion', times:'3×', lastAchieved:'2022 (Qatar)', lastWC:'2022 (Qatar) — 🏆 Champion' },
  { name:'Algeria',   code:'dz', group:'J', conf:'CAF',      host:false, lat:28.0, lng:2.5,
    fifaRank:28, best:'Round of 16', times:'1×', lastAchieved:'2014 (Brazil)', lastWC:'2014 (Brazil) — Round of 16' },
  { name:'Austria',   code:'at', group:'J', conf:'UEFA',     host:false, lat:48.2, lng:16.4,
    fifaRank:24, best:'3rd Place', times:'1×', lastAchieved:'1954 (Switzerland)', lastWC:'1998 (France) — Group Stage',
    note:'8 qualifications · 7 appearances · missed 1938 (Nazi annexation/Anschluss)' },
  { name:'Jordan',    code:'jo', group:'J', conf:'AFC',      host:false, lat:31.9, lng:35.9,
    fifaRank:63, best:'First World Cup!', times:'First time', lastAchieved:'2026 (debut)', lastWC:'2026 — First World Cup ever' },
  // GROUP K
  { name:'Portugal',   code:'pt', group:'K', conf:'UEFA',     host:false, lat:39.6, lng:-8.0,
    fifaRank:5,  best:'3rd Place', times:'1×', lastAchieved:'1966 (England)', lastWC:'2022 (Qatar) — Quarter-Finals' },
  { name:'Uzbekistan', code:'uz', group:'K', conf:'AFC',      host:false, lat:41.0, lng:63.0,
    fifaRank:50, best:'First World Cup!', times:'First time', lastAchieved:'2026 (debut)', lastWC:'2026 — First World Cup ever' },
  { name:'Colombia',   code:'co', group:'K', conf:'CONMEBOL', host:false, lat:4.7, lng:-74.1,
    fifaRank:13, best:'Quarter-Finals', times:'1×', lastAchieved:'2014 (Brazil)', lastWC:'2018 (Russia) — Round of 16' },
  { name:'DR Congo',   code:'cd', group:'K', conf:'CAF',      host:false, lat:-4.3, lng:15.3,
    fifaRank:46, best:'Group Stage (as Zaire)', times:'1 appearance', lastAchieved:'1974 (West Germany)', lastWC:'1974 (West Germany) — Group Stage (as Zaire)' },
  // GROUP L
  { name:'England', code:'gb-eng', group:'L', conf:'UEFA',     host:false, lat:51.5, lng:-0.1,
    fifaRank:4,  best:'World Champion', times:'1×', lastAchieved:'1966 (England)', lastWC:'2022 (Qatar) — Quarter-Finals' },
  { name:'Croatia', code:'hr',     group:'L', conf:'UEFA',     host:false, lat:45.8, lng:16.0,
    fifaRank:11, best:'Runner-Up', times:'1×', lastAchieved:'2018 (Russia)', lastWC:'2022 (Qatar) — 3rd Place' },
  { name:'Ghana',   code:'gh',     group:'L', conf:'CAF',      host:false, lat:8.0, lng:-1.5,
    fifaRank:74, best:'Quarter-Finals', times:'1×', lastAchieved:'2010 (South Africa)', lastWC:'2022 (Qatar) — Group Stage' },
  { name:'Panama',  code:'pa',     group:'L', conf:'CONCACAF', host:false, lat:8.5, lng:-80.0,
    fifaRank:33, best:'Group Stage', times:'1 appearance', lastAchieved:'2018 (Russia)', lastWC:'2018 (Russia) — Group Stage' },
];

// ── TEAM EXTRA DATA (population, WC apps, facts) ─────────────
const TEAM_EXTRA = {
  'mx':     { pop:'130M',  wcApps:17, footballFact:'First nation to host/co-host 3 World Cups.',     nonFootballFact:'Home to the world\'s largest pyramid (Cholula).' },
  'za':     { pop:'60M',   wcApps:3,  footballFact:'Hosted the first African World Cup in 2010.',    nonFootballFact:'The only country with three capital cities.' },
  'kr':     { pop:'51M',   wcApps:11, footballFact:'Most World Cup appearances of any Asian side.',  nonFootballFact:'South Koreans eat more instant noodles per person than any other nation on Earth.' },
  'ca':     { pop:'40M',   wcApps:2,  footballFact:'This is their first time hosting the World Cup.',nonFootballFact:'Has more lakes than the rest of the world combined.' },
  'qa':     { pop:'3M',    wcApps:1,  footballFact:'Qualified "on merit" for the first time.',       nonFootballFact:'Residents pay zero income tax — it\'s written into the constitution.' },
  'ch':     { pop:'9M',    wcApps:12, footballFact:'Reached the Round of 16 in 4 of last 5 WCs.',   nonFootballFact:'Has no official capital (Bern is de facto).' },
  'br':     { pop:'215M',  wcApps:22, footballFact:'Only team to appear in every World Cup.',        nonFootballFact:'Largest Japanese population outside of Japan.' },
  'ma':     { pop:'38M',   wcApps:6,  footballFact:'First African semi-finalist in WC history (2022).', nonFootballFact:'Home to the world\'s oldest university.' },
  'ht':     { pop:'11.7M', wcApps:1,  footballFact:'Returning since their 1974 debut.',              nonFootballFact:'First black-led republic in the world.' },
  'gb-sct': { pop:'5.5M',  wcApps:8,  footballFact:'First World Cup appearance since 1998.',         nonFootballFact:'The national animal of Scotland is the Unicorn.' },
  'us':     { pop:'340M',  wcApps:11, footballFact:'Hosting for the 2nd time — previously the sole host in 1994.', nonFootballFact:'Has the world\'s largest highway system.' },
  'py':     { pop:'7M',    wcApps:8,  footballFact:'Qualified on the final matchday of CONMEBOL.',   nonFootballFact:'Shares the world\'s largest hydroelectric plant.' },
  'au':     { pop:'26M',   wcApps:6,  footballFact:'Moved from OFC to the Asian confederation in 2006.', nonFootballFact:'Home to more than 10,000 unique beaches.' },
  'de':     { pop:'84M',   wcApps:20, footballFact:'Have reached the semi-finals 13 times.',         nonFootballFact:'First country to adopt Daylight Saving Time.' },
  'cw':     { pop:'150K',  wcApps:0,  footballFact:'Debut — the smallest nation to qualify.',        nonFootballFact:'Most residents speak at least 4 languages.' },
  'ci':     { pop:'28M',   wcApps:3,  footballFact:'Won the 2024 Africa Cup of Nations tournament.', nonFootballFact:'The world\'s largest producer of cocoa beans.' },
  'ec':     { pop:'18M',   wcApps:4,  footballFact:'Record for most altitude-aided home wins in qualifying.', nonFootballFact:'First country to give nature legal rights.' },
  'nl':     { pop:'18M',   wcApps:12, footballFact:'Runners-up 3 times — never won the trophy.',    nonFootballFact:'One-third of the country is below sea level.' },
  'jp':     { pop:'124M',  wcApps:7,  footballFact:'Fans world-famous for cleaning the stadium.',    nonFootballFact:'Features over 5 million vending machines.' },
  'tn':     { pop:'12M',   wcApps:6,  footballFact:'First African team to win a World Cup match.',   nonFootballFact:'Location of the ancient city-state of Carthage.' },
  'be':     { pop:'12M',   wcApps:14, footballFact:'Known as the "Red Devils."',                    nonFootballFact:'Has the highest density of castles in the world.' },
  'eg':     { pop:'112M',  wcApps:3,  footballFact:'First African team to play a World Cup (1934).', nonFootballFact:'Home to the last of the Ancient Wonders (Giza).' },
  'ir':     { pop:'89M',   wcApps:6,  footballFact:'Have never passed the group stage.',             nonFootballFact:'Home to the world\'s oldest continuous civilization.' },
  'nz':     { pop:'5.2M',  wcApps:2,  footballFact:'Unbeaten at 2010 WC (W0 D3 L0) — only team. In 1982 they lost all 3 games.',     nonFootballFact:'First country to grant women the right to vote (1893).' },
  'es':     { pop:'48M',   wcApps:16, footballFact:'Hold the record for most passes in a WC match.', nonFootballFact:'Produces nearly half of the world\'s olive oil.' },
  'cv':     { pop:'590K',  wcApps:0,  footballFact:'Debut — smallest African island nation to qualify.', nonFootballFact:'Charles Darwin studied the local flora here.' },
  'sa':     { pop:'36M',   wcApps:6,  footballFact:'Shocked Argentina 2-1 in one of the greatest upsets in 2022 World Cup history.',  nonFootballFact:'A country with no permanent natural rivers.' },
  'uy':     { pop:'3.5M',  wcApps:14, footballFact:'Won the very first World Cup in 1930.',          nonFootballFact:'First nation to fully legalize marijuana sales.' },
  'fr':     { pop:'68M',   wcApps:16, footballFact:'Reached the final in 3 of the last 7 WCs.',     nonFootballFact:'The most visited country in the world.' },
  'sn':     { pop:'18M',   wcApps:3,  footballFact:'Known as the "Lions of Teranga."',               nonFootballFact:'Features a bright pink lake (Lake Retba).' },
  'no':     { pop:'5.6M',  wcApps:3,  footballFact:'Erling Haaland\'s first-ever World Cup.',        nonFootballFact:'Home to the world\'s longest road tunnel (24.5km).' },
  'ar':     { pop:'46M',   wcApps:18, footballFact:'Entering as defending 2022 World Champions.',    nonFootballFact:'Invented the world\'s first animated feature film.' },
  'dz':     { pop:'45M',   wcApps:4,  footballFact:'Part of the infamous "Disgrace of Gijon" (1982).', nonFootballFact:'The largest country in Africa by land area.' },
  'at':     { pop:'9M',    wcApps:7,  footballFact:'8 qualifications, 7 appearances — qualified 1938 but Nazi annexation (Anschluss) prevented participation.',  nonFootballFact:'Home to the world\'s oldest zoo (Tiergarten Schönbrunn).' },
  'jo':     { pop:'11M',   wcApps:0,  footballFact:'Debut — qualified through the AFC playoff.',     nonFootballFact:'Contains the Dead Sea (the lowest point on Earth).' },
  'pt':     { pop:'10M',   wcApps:8,  footballFact:'Likely Cristiano Ronaldo\'s final World Cup.',   nonFootballFact:'The world\'s largest producer of natural cork.' },
  'uz':     { pop:'36M',   wcApps:0,  footballFact:'Debut — one of the longest waits in Asian football.', nonFootballFact:'One of only two doubly landlocked countries in the world.' },
  'co':     { pop:'52M',   wcApps:6,  footballFact:'Famous for Higuita\'s iconic "Scorpion Kick."',  nonFootballFact:'Second most biodiverse country on the planet.' },
  'gb-eng': { pop:'69M',   wcApps:16, footballFact:'Won their only title on home soil in 1966.',    nonFootballFact:'The English language has over 170,000 words in use — more than any other language in the world.' },
  'hr':     { pop:'3.8M',  wcApps:6,  footballFact:"Reached the top 3 in '98, '18, and '22.",       nonFootballFact:'Invented the necktie (originally called cravat).' },
  'gh':     { pop:'34M',   wcApps:4,  footballFact:'Cruelly denied a semi-final by Suarez in 2010.', nonFootballFact:'First sub-Saharan nation to gain independence.' },
  'pa':     { pop:'4.5M',  wcApps:1,  footballFact:'Debuted in 2018; returning for 2026.',           nonFootballFact:'Only place on Earth to see the sun rise over the Pacific Ocean.' },
  'cz':     { pop:'10.9M', wcApps:1,  footballFact:'Czechoslovakia were World Cup runners-up twice — losing the 1934 final to Italy and the 1962 final to Brazil. Czech Republic itself has appeared only once before (2006).', nonFootballFact:'Has the highest beer consumption per capita in the world — over 180 litres per person per year.' },
  'ba':     { pop:'3.2M',  wcApps:1,  footballFact:'Debuted at the 2014 World Cup with Džeko and Pjanić — scored 4 goals but crashed out in the group stage.', nonFootballFact:'Sarajevo hosted the 1984 Winter Olympics; its abandoned bobsled track is now one of the world\'s most famous "modern ruins" and a street-art landmark.' },
  'tr':     { pop:'88M',   wcApps:2,  footballFact:'Hakan Şükür scored the fastest goal in World Cup history — 10.8 seconds into the 3rd-place play-off vs South Korea at 2002, en route to a historic bronze.', nonFootballFact:'Produces around 70% of the world\'s hazelnuts — essentially powering the global Nutella supply.' },
  'se':     { pop:'10.5M', wcApps:12, footballFact:'Reached the top three on three occasions: runners-up in 1958 (lost 5-2 to Brazil and 17-year-old Pelé), and 3rd-place finishes in 1950 and 1994.', nonFootballFact:'Invented Bluetooth — and Alfred Nobel, creator of the Nobel Prizes, was Swedish.' },
  'iq':     { pop:'48M',   wcApps:1,  footballFact:'Won the 2007 AFC Asian Cup in one of sport\'s most emotional moments — uniting a war-torn nation. Ahmed Radhi\'s 1986 WC goal remains the only World Cup goal in Iraqi history.', nonFootballFact:'Home to Mesopotamia, the "Cradle of Civilisation" and the birthplace of writing — cuneiform script dates back to ~3400 BC.' },
  'cd':     { pop:'116M',  wcApps:1,  footballFact:'Competed as Zaire in 1974 — a player famously booted the ball away mid-free-kick vs Brazil. Conceded 14 goals in 3 games including a 9-0 loss to Yugoslavia. Returning after 52 years.', nonFootballFact:'The Congo River is the deepest river on Earth (over 220m), and the country holds the world\'s second-largest rainforest after the Amazon.' },
};

// All 48 teams confirmed — no TBD slots remain
const TBD = {};

const flagUrl = (code, w=40) => `https://flagcdn.com/w${w}/${code}.png`;

// ── RENDER GROUPS ────────────────────────────────────────────
(function() {
  const letters = ['A','B','C','D','E','F','G','H','I','J','K','L'];
  const container = document.getElementById('groups-grid');

  letters.forEach(letter => {
    const groupTeams = TEAMS.filter(t => t.group === letter);
    const tbd = TBD[letter];
    const card = document.createElement('div');
    card.className = 'group-card';

    let html = `<div class="group-header">GROUP ${letter}<button class="grp-map-btn" data-filter="${letter}" title="Show on map">📍</button></div><div class="group-teams">`;
    groupTeams.forEach(team => {
      const idx = TEAMS.indexOf(team);
      html += `
        <div class="group-team" data-team-idx="${idx}">
          <img src="${flagUrl(team.code)}" alt="${team.name}"
               onerror="this.style.display='none';this.nextSibling.style.display='flex'">
          <div class="team-placeholder" style="display:none">?</div>
          <div class="team-info">
            <div class="team-name-sm">${team.name}</div>
            <div class="team-conf-sm">${team.conf}</div>
          </div>
          ${team.host ? '<span class="badge-host">HOST</span>' : ''}
        </div>`;
    });
    if (tbd) {
      html += `
        <div class="group-team" title="${tbd.hint}" style="cursor:default">
          <div class="team-placeholder">?</div>
          <div class="team-info">
            <div class="team-name-sm">TBD</div>
            <div class="team-conf-sm">${tbd.note}</div>
          </div>
          <span class="badge-tbd">TBD</span>
        </div>`;
    }
    html += `</div>`;
    card.innerHTML = html;
    container.appendChild(card);
  });

  // Event delegation — click team row, map button, or group header (accordion on mobile)
  container.addEventListener('click', e => {
    const row = e.target.closest('[data-team-idx]');
    if (row) { if (window.innerWidth > 768) { openModal(TEAMS[+row.dataset.teamIdx], 'stats'); } else { location.href = 'team.html?code=' + TEAMS[+row.dataset.teamIdx].code + '&mode=stats'; } return; }
    const mapBtn = e.target.closest('.grp-map-btn');
    if (mapBtn) {
      e.stopPropagation();
      filterGlobe(mapBtn.dataset.filter);
      document.getElementById('globe-section').scrollIntoView({ behavior:'smooth' });
      return;
    }
    const header = e.target.closest('.group-header');
    if (header) {
      const card = header.closest('.group-card');
      if (card) card.classList.toggle('open');
    }
  });
})();

// ── WORLD MAP (earth-dark texture + SVG gold borders) ────────
(function() {
  var container = document.getElementById('globe-container');

  // Background: NASA equirectangular earth-dark texture
  var mapImg = document.createElement('img');
  mapImg.className = 'map-bg';
  mapImg.alt = '';
  mapImg.src = 'https://unpkg.com/three-globe/example/img/earth-dark.jpg';
  mapImg.onerror = function() {
    this.src = 'https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-dark.jpg';
  };
  container.appendChild(mapImg);

  // Equirectangular projection — same formula as the texture
  function proj(lat, lng) {
    return {
      x: ((lng + 180) / 360) * 100,
      y: ((90  - lat)  / 180) * 100
    };
  }

  // ── Gold host-country borders (SVG overlay, same viewBox as texture) ──
  (function() {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:6';
    svg.setAttribute('viewBox', '0 0 360 180');
    svg.setAttribute('preserveAspectRatio', 'none');
    container.appendChild(svg);

    function draw(d) {
      var el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      el.setAttribute('d', d);
      el.setAttribute('fill', 'rgba(245,197,24,0.10)');
      el.setAttribute('stroke', '#f5c518');
      el.setAttribute('stroke-width', '1.2');
      el.setAttribute('stroke-linejoin', 'round');
      el.setAttribute('stroke-linecap', 'round');
      svg.appendChild(el);
    }

    function poly2path(pts) {
      return pts.map(function(p, i) {
        return (i === 0 ? 'M' : 'L') + (p[0]+180).toFixed(1) + ',' + (90-p[1]).toFixed(1);
      }).join('') + 'Z';
    }

    function fallback() {
      draw(poly2path([[-124,49],[-110,49],[-95,49],[-89.5,48],[-87,47],[-84,46.5],[-82,45.5],[-83,42],[-80,42.5],[-76,44],[-67,47],[-64,44],[-60,46],[-53,47],[-53,52],[-58,60],[-62,63],[-68,63],[-75,63],[-80,63],[-87,65],[-90,63],[-100,63],[-110,63],[-120,63],[-130,63],[-135,60],[-130,54],[-126,50],[-124,49]]));
      draw(poly2path([[-124,48.5],[-124,43],[-124,39],[-122,37.5],[-120,34.5],[-117,32.5],[-114,32.5],[-111,31.5],[-108,31.5],[-106,32],[-104,29.5],[-100,28],[-97,26],[-94,29.5],[-90,29],[-88,30],[-85,30],[-84,29.5],[-82.5,29.5],[-82,28],[-81.5,26.5],[-81.5,25],[-80.5,25],[-80,25.5],[-80,28],[-80,30.5],[-76,35],[-74,38.5],[-72,41],[-70,42],[-67,44.5],[-67,47],[-76,44],[-80,42.5],[-83,42],[-83,44],[-82,45.5],[-84,46.5],[-87,47],[-88,48],[-89.5,48],[-95,49],[-100,49],[-110,49],[-122,49],[-124,48.5]]));
      draw(poly2path([[-117,32.5],[-116.5,31],[-115.5,30],[-114.5,28],[-113,26.5],[-110.5,24],[-109.8,22.9],[-110.3,24],[-111,26],[-112.5,27.5],[-113.5,29],[-114.8,32],[-117,32.5]]));
      draw(poly2path([[-114.8,32],[-111,31.5],[-108,31.5],[-106,32],[-104,29.5],[-100,28],[-97,26],[-97,22],[-94.5,18.5],[-91.5,18.5],[-90.4,21],[-86.9,21.5],[-87.5,18.5],[-87.8,16.5],[-88.5,15.5],[-92,15.5],[-94,16],[-99.5,16.5],[-103,19],[-105,21],[-107,23],[-108.5,25.5],[-110.5,27.5],[-112,29],[-114,31],[-114.8,32]]));
    }

    function ringPath(ring) {
      return ring.map(function(pt, i) {
        return (i === 0 ? 'M' : 'L') + (pt[0]+180).toFixed(2) + ',' + (90-pt[1]).toFixed(2);
      }).join('') + 'Z';
    }
    function isContiUSA(poly) {
      var outer = poly[0], n = outer.length, cx = 0, cy = 0;
      for (var i = 0; i < n; i++) { cx += outer[i][0]; cy += outer[i][1]; }
      cx /= n; cy /= n;
      return cy >= 24 && cy <= 50 && cx >= -128 && cx <= -65;
    }
    function buildPath(geom, id) {
      var d = '';
      if (geom.type === 'Polygon') {
        geom.coordinates.forEach(function(ring) { d += ringPath(ring); });
      } else if (geom.type === 'MultiPolygon') {
        geom.coordinates.forEach(function(poly) {
          if (id !== '840' || isContiUSA(poly))
            poly.forEach(function(ring) { d += ringPath(ring); });
        });
      }
      return d;
    }

    if (typeof topojson === 'undefined') { fallback(); return; }
    var HOST_IDS = { '840': true, '124': true, '484': true };

    // Safe path builder — skips rings that cross the antimeridian (Russia, USA-Alaska etc.)
    function buildPathSafe(geom) {
      var d = '';
      var polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
      polys.forEach(function(poly) {
        poly.forEach(function(ring) {
          for (var i = 1; i < ring.length; i++) {
            if (Math.abs(ring[i][0] - ring[i-1][0]) > 180) return;
          }
          d += ringPath(ring);
        });
      });
      return d;
    }

    // Continent path builder — splits antimeridian-crossing rings into open segments
    // instead of skipping them, so Russia/Pacific-territory seams don't leave gaps
    function buildContPath(geom) {
      var d = '';
      var polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
      polys.forEach(function(poly) {
        poly.forEach(function(ring) {
          var hasCross = false;
          for (var i = 1; i < ring.length; i++) {
            if (Math.abs(ring[i][0] - ring[i-1][0]) > 180) { hasCross = true; break; }
          }
          if (!hasCross) { d += ringPath(ring); return; }
          // Split ring at each antimeridian crossing → open path segments
          var seg = [];
          for (var i = 0; i < ring.length; i++) {
            if (i > 0 && Math.abs(ring[i][0] - ring[i-1][0]) > 180) {
              if (seg.length >= 2) {
                d += seg.map(function(p, j) {
                  return (j===0?'M':'L') + (p[0]+180).toFixed(2)+','+(90-p[1]).toFixed(2);
                }).join('');
              }
              seg = [ring[i]];
            } else {
              seg.push(ring[i]);
            }
          }
          if (seg.length >= 2) {
            d += seg.map(function(p, j) {
              return (j===0?'M':'L') + (p[0]+180).toFixed(2)+','+(90-p[1]).toFixed(2);
            }).join('');
          }
        });
      });
      return d;
    }

    // Ocean labels — 2-row, italic blue, subtle
    function addOceanLabels() {
      var oceans = [
        { l1:'PACIFIC',  l2:'OCEAN', x:38,  y:76  },
        { l1:'ATLANTIC', l2:'OCEAN', x:143, y:63  },
        { l1:'INDIAN',   l2:'OCEAN', x:258, y:103 },
        { l1:'SOUTHERN', l2:'OCEAN', x:180, y:146 },
        { l1:'ARCTIC',   l2:'OCEAN', x:180, y:10  }
      ];
      oceans.forEach(function(o) {
        var t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('fill', 'rgba(140,185,235,0.40)');
        t.setAttribute('font-size', '3.8');
        t.setAttribute('font-family', 'sans-serif');
        t.setAttribute('letter-spacing', '0.7');
        t.setAttribute('font-style', 'italic');
        var s1 = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        s1.setAttribute('x', o.x); s1.setAttribute('y', o.y);
        s1.textContent = o.l1;
        var s2 = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        s2.setAttribute('x', o.x); s2.setAttribute('dy', '4.5');
        s2.textContent = o.l2;
        t.appendChild(s1); t.appendChild(s2);
        svg.appendChild(t);
      });
    }

    fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
      .then(function(r) { return r.json(); })
      .then(function(topo) {
        var features = topojson.feature(topo, topo.objects.countries).features;
        // Country borders — very subtle lines, no fill
        features.forEach(function(f) {
          var d = buildPathSafe(f.geometry);
          if (!d) return;
          var el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          el.setAttribute('d', d);
          el.setAttribute('fill', 'none');
          el.setAttribute('stroke', 'rgba(160,170,150,0.22)');
          el.setAttribute('stroke-width', '0.3');
          svg.appendChild(el);
        });
        // ── Continent outlines — bold perimeters ─────────────────────────
        var CONT_IDS = {
          AFRICA:        {12:1,24:1,204:1,72:1,854:1,108:1,120:1,132:1,140:1,148:1,174:1,180:1,178:1,384:1,262:1,818:1,232:1,231:1,266:1,270:1,288:1,324:1,624:1,404:1,426:1,430:1,434:1,450:1,454:1,466:1,478:1,480:1,504:1,508:1,516:1,562:1,566:1,646:1,678:1,686:1,694:1,706:1,710:1,728:1,729:1,748:1,834:1,768:1,788:1,800:1,894:1,716:1},
          SOUTH_AMERICA: {76:1,32:1,152:1,604:1,170:1,862:1,68:1,218:1,600:1,858:1,328:1,740:1,254:1},
          EUROPE:        {8:1,20:1,40:1,112:1,56:1,70:1,100:1,191:1,203:1,208:1,233:1,246:1,250:1,276:1,300:1,348:1,352:1,372:1,380:1,428:1,438:1,440:1,442:1,807:1,470:1,498:1,492:1,499:1,528:1,578:1,616:1,620:1,642:1,688:1,703:1,705:1,724:1,752:1,756:1,804:1,826:1},
          ASIA:          {4:1,50:1,64:1,96:1,116:1,156:1,356:1,360:1,364:1,368:1,376:1,392:1,400:1,398:1,414:1,417:1,418:1,422:1,458:1,462:1,496:1,104:1,524:1,408:1,512:1,586:1,275:1,608:1,634:1,682:1,702:1,410:1,144:1,760:1,158:1,762:1,764:1,626:1,792:1,795:1,784:1,860:1,704:1,887:1,51:1,31:1,268:1,643:1},
          NORTH_AMERICA: {840:1,124:1,484:1,304:1,320:1,84:1,340:1,222:1,558:1,188:1,591:1,192:1,332:1,214:1,388:1,780:1,44:1,28:1,662:1,670:1,659:1,212:1,308:1},
          OCEANIA:       {36:1,554:1,598:1,242:1,548:1,90:1,584:1,585:1,520:1,776:1,798:1}
        };
        ['AFRICA','SOUTH_AMERICA','EUROPE','ASIA','NORTH_AMERICA','OCEANIA'].forEach(function(cont) {
          var ids = CONT_IDS[cont];
          var geoms = topo.objects.countries.geometries.filter(function(g) { return ids[+g.id]; });
          if (!geoms.length) return;
          var merged = topojson.merge(topo, geoms);
          // Europe & Asia have antimeridian-crossing rings (Russia, France's Pacific territories)
          // — use buildContPath which splits those rings into open segments instead of skipping them
          var d = (cont === 'EUROPE' || cont === 'ASIA') ? buildContPath(merged) : buildPathSafe(merged);
          if (!d) return;
          var el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          el.setAttribute('d', d);
          el.setAttribute('fill', 'none');
          el.setAttribute('stroke', 'rgba(200,205,195,0.5)');
          el.setAttribute('stroke-width', '0.8');
          el.setAttribute('stroke-linejoin', 'round');
          el.setAttribute('stroke-linecap', 'round');
          svg.appendChild(el);
        });
        // Host nations on top — gold tint + gold border
        features.forEach(function(f) {
          var id = '' + f.id;
          if (!HOST_IDS[id]) return;
          var d = buildPath(f.geometry, id);
          if (d) draw(d);
        });
        addOceanLabels();
      })
      .catch(function() { fallback(); addOceanLabels(); });
  })();

  // ── FLAG MARKERS ──
  TEAMS.forEach(function(d) {
    var p   = proj(d.lat, d.lng);
    var big = d.host;
    var fw  = big ? 38 : 26;
    var fh  = big ? 28 : 19;

    var wrap = document.createElement('div');
    wrap.title = d.name + ' · Group ' + d.group;
    wrap.dataset.teamGroup = d.group;
    wrap.style.cssText = [
      'position:absolute',
      'left:' + p.x + '%',
      'top:'  + p.y + '%',
      'transform:translate(-50%,-50%)',
      'cursor:pointer',
      'z-index:' + (big ? 15 : 10),
      'transition:transform .18s',
      'pointer-events:auto',
      'padding:6px',
      '-webkit-tap-highlight-color:transparent'
    ].join(';');

    var img = document.createElement('img');
    img.src = 'https://flagcdn.com/w' + (big ? 80 : 40) + '/' + d.code + '.png';
    img.alt = d.name;
    img.style.cssText = [
      'width:'  + fw + 'px',
      'height:' + fh + 'px',
      'border-radius:3px',
      'object-fit:cover',
      'display:block',
      'pointer-events:none',
      big ? 'border:3px solid #f5c518;box-shadow:0 0 10px rgba(245,197,24,.65),0 2px 10px rgba(0,0,0,.9)'
          : 'border:1px solid rgba(255,255,255,.4);box-shadow:0 2px 10px rgba(0,0,0,.9)'
    ].join(';');

    img.onerror = function() {
      this.style.display = 'none';
      var fb = document.createElement('div');
      fb.textContent = d.code.slice(0, 2).toUpperCase();
      fb.style.cssText = [
        'width:'  + fw + 'px',
        'height:' + fh + 'px',
        'border-radius:3px',
        'display:flex','align-items:center','justify-content:center',
        'font-size:9px','font-weight:700',
        'box-shadow:0 2px 8px rgba(0,0,0,.9)',
        big ? 'background:#f5c518;color:#000;border:2.5px solid #f5c518'
            : 'background:#444;color:#fff;border:1px solid rgba(255,255,255,.3)'
      ].join(';');
      wrap.appendChild(fb);
    };

    wrap.appendChild(img);
    wrap.addEventListener('click', function() { if (window.innerWidth > 768) { openModal(d, 'nation'); } else { location.href = 'team.html?code=' + d.code + '&mode=nation'; } });
    wrap.addEventListener('mouseenter', function() { this.style.transform='translate(-50%,-50%) scale(1.55)'; this.style.zIndex='40'; });
    wrap.addEventListener('mouseleave', function() { this.style.transform='translate(-50%,-50%) scale(1)';   this.style.zIndex= big ? '15' : '10'; });
    wrap.addEventListener('touchstart', function() { this.style.transform='translate(-50%,-50%) scale(1.4)'; }, { passive:true });
    wrap.addEventListener('touchend',   function() { this.style.transform='translate(-50%,-50%) scale(1)'; },  { passive:true });

    container.appendChild(wrap);
  });

})();

// ── GLOBE FILTER ─────────────────────────────────────────────
var _activeGroupFilter = null;
function filterGlobe(letter) {
  _activeGroupFilter = (_activeGroupFilter === letter) ? null : letter;
  var wrappers = document.querySelectorAll('#globe-container > div[data-team-group]');
  wrappers.forEach(function(el) {
    var match = !_activeGroupFilter || el.dataset.teamGroup === _activeGroupFilter;
    el.style.opacity        = match ? '1' : '0.1';
    el.style.pointerEvents  = match ? 'auto' : 'none';
    el.style.transition     = 'opacity .3s';
  });
  var bar    = document.getElementById('globe-filter-bar');
  var letter_el = document.getElementById('globe-filter-letter');
  if (bar) bar.style.display = _activeGroupFilter ? 'flex' : 'none';
  if (letter_el) letter_el.textContent = _activeGroupFilter || '';
}

// ── MODAL ────────────────────────────────────────────────────
function openModal(team, mode) {
  const el = id => document.getElementById(id);
  el('m-flag-img').src   = flagUrl(team.code, 160);
  el('m-flag-img').alt   = team.name;
  el('m-flag-img').style.display = 'block';
  el('m-name').textContent  = team.name;
  el('m-conf').textContent  = team.conf;
  el('m-group').textContent = 'Group ' + team.group;
  el('m-host').style.display = team.host ? 'flex' : 'none';

  const showNation = (mode === 'nation');
  el('m-stats-section').style.display  = showNation ? 'none'  : 'block';
  el('m-nation-section').style.display = showNation ? 'block' : 'none';

  if (!showNation) {
    el('m-best').textContent          = team.best;
    el('m-rank').textContent          = '#' + team.fifaRank;
    el('m-times').textContent         = team.times;
    el('m-last-achieved').textContent = team.lastAchieved;
    el('m-lastwc').textContent        = team.lastWC;
  } else {
    const extra = TEAM_EXTRA[team.code] || {};
    el('m-pop').textContent              = extra.pop             || '—';
    el('m-wc-apps').textContent          = extra.wcApps          || '—';
    el('m-football-fact').textContent    = extra.footballFact    || '—';
    el('m-nonfootball-fact').textContent = extra.nonFootballFact || '—';
  }

  el('modal').classList.add('open');
  el('modal').querySelector('.modal').scrollTop = 0;
}

function openTeamByName(name) {
  const team = TEAMS.find(t => t.name === name);
  if (team) openModal(team);
}

function closeModal() { document.getElementById('modal').classList.remove('open'); }
document.getElementById('modal').addEventListener('click', e => { if (e.target === document.getElementById('modal')) closeModal(); });
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') { closeModal(); closeHostModal(); } });

// ── AUTH (handled by js/auth.js) ─────────────────────────────

// ── HOST SCHEDULE DATA + MODAL (wired via addEventListener) ──
const HOST_SCHEDULES = {
  'Mexico': {
    flag:'🇲🇽', code:'mx', cities:3, totalGames:13,
    cityList:'📍 Mexico City · Guadalajara · Monterrey',
    games:[
      { phase:'group', round:'Group A · MD1', date:'Thu, Jun 11', idt:'22:00', idtDate:'Jun 11',     home:'Mexico',       hCode:'mx', away:'South Africa', aCode:'za', venue:'Estadio Azteca', city:'Mexico City',  capacity:'87,500' },
      { phase:'group', round:'Group A · MD1', date:'Thu, Jun 11', idt:'05:00', idtDate:'Jun 12 ⁺¹', home:'South Korea',  hCode:'kr', away:'Czech Republic', aCode:'cz', venue:'Estadio Akron',  city:'Guadalajara',  capacity:'49,850' },
      { phase:'group', round:'Group F · MD1', date:'Sun, Jun 14', idt:'05:00', idtDate:'Jun 15 ⁺¹', home:'Sweden', hCode:'se', away:'Tunisia',      aCode:'tn', venue:'Estadio BBVA',   city:'Monterrey',    capacity:'53,500' },
      { phase:'group', round:'Group K · MD1', date:'Wed, Jun 17', idt:'06:00', idtDate:'Jun 18 ⁺¹', home:'Uzbekistan',   hCode:'uz', away:'Colombia',     aCode:'co', venue:'Estadio Azteca', city:'Mexico City',  capacity:'87,500' },
      { phase:'group', round:'Group A · MD2', date:'Thu, Jun 18', idt:'06:00', idtDate:'Jun 19 ⁺¹', home:'Mexico',       hCode:'mx', away:'South Korea',  aCode:'kr', venue:'Estadio Akron',  city:'Guadalajara',  capacity:'49,850' },
      { phase:'group', round:'Group F · MD2', date:'Sat, Jun 20', idt:'07:00', idtDate:'Jun 21 ⁺¹', home:'Tunisia',      hCode:'tn', away:'Japan',        aCode:'jp', venue:'Estadio BBVA',   city:'Monterrey',    capacity:'53,500' },
      { phase:'group', round:'Group K · MD2', date:'Tue, Jun 23', idt:'05:00', idtDate:'Jun 24 ⁺¹', home:'Colombia',     hCode:'co', away:'DR Congo', aCode:'cd', venue:'Estadio Akron',  city:'Guadalajara',  capacity:'49,850' },
      { phase:'group', round:'Group A · MD3', date:'Wed, Jun 24', idt:'04:00', idtDate:'Jun 25 ⁺¹', home:'Mexico',       hCode:'mx', away:'Czech Republic', aCode:'cz', venue:'Estadio Azteca', city:'Mexico City',  capacity:'87,500' },
      { phase:'group', round:'Group A · MD3', date:'Wed, Jun 24', idt:'04:00', idtDate:'Jun 25 ⁺¹', home:'South Africa', hCode:'za', away:'South Korea',  aCode:'kr', venue:'Estadio BBVA',   city:'Monterrey',    capacity:'53,500' },
      { phase:'group', round:'Group H · MD3', date:'Fri, Jun 26', idt:'03:00', idtDate:'Jun 27 ⁺¹', home:'Uruguay',      hCode:'uy', away:'Spain',        aCode:'es', venue:'Estadio Akron',  city:'Guadalajara',  capacity:'49,850' },
      { phase:'knockout', round:'Round of 32', date:'Mon, Jun 29', idt:'05:00', idtDate:'Jun 30 ⁺¹', home:'TBD', hCode:null, away:'TBD', aCode:null, venue:'Estadio BBVA',   city:'Monterrey',    capacity:'53,500' },
      { phase:'knockout', round:'Round of 32', date:'Tue, Jun 30', idt:'04:00', idtDate:'Jul 1 ⁺¹',  home:'TBD', hCode:null, away:'TBD', aCode:null, venue:'Estadio Azteca', city:'Mexico City',  capacity:'87,500' },
      { phase:'knockout', round:'Round of 16', date:'Sun, Jul 5',  idt:'03:00', idtDate:'Jul 6 ⁺¹',  home:'TBD', hCode:null, away:'TBD', aCode:null, venue:'Estadio Azteca', city:'Mexico City',  capacity:'87,500' },
    ]
  },
  'Canada': {
    flag:'🇨🇦', code:'ca', cities:2, totalGames:13,
    cityList:'📍 Toronto · Vancouver',
    games:[
      { phase:'group', round:'Group B · MD1', date:'Fri, Jun 12', idt:'22:00', idtDate:'Jun 12',     home:'Canada',      hCode:'ca',     away:'Bosnia-Herzegovina', aCode:'ba',     venue:'BMO Field', city:'Toronto',    capacity:'45,000' },
      { phase:'group', round:'Group D · MD1', date:'Fri, Jun 12', idt:'07:00', idtDate:'Jun 13 ⁺¹', home:'Australia',   hCode:'au',     away:'Turkey', aCode:'tr',     venue:'BC Place',  city:'Vancouver',  capacity:'54,500' },
      { phase:'group', round:'Group L · MD1', date:'Wed, Jun 17', idt:'02:00', idtDate:'Jun 18 ⁺¹', home:'Ghana',       hCode:'gh',     away:'Panama',      aCode:'pa',     venue:'BMO Field', city:'Toronto',    capacity:'45,000' },
      { phase:'group', round:'Group B · MD2', date:'Wed, Jun 18', idt:'01:00', idtDate:'Jun 19 ⁺¹', home:'Canada',      hCode:'ca',     away:'Qatar',       aCode:'qa',     venue:'BC Place',  city:'Vancouver',  capacity:'54,500' },
      { phase:'group', round:'Group E · MD2', date:'Sat, Jun 20', idt:'23:00', idtDate:'Jun 20',     home:'Germany',     hCode:'de',     away:'Ivory Coast', aCode:'ci',     venue:'BMO Field', city:'Toronto',    capacity:'45,000' },
      { phase:'group', round:'Group G · MD2', date:'Sun, Jun 21', idt:'04:00', idtDate:'Jun 22 ⁺¹', home:'New Zealand', hCode:'nz',     away:'Egypt',       aCode:'eg',     venue:'BC Place',  city:'Vancouver',  capacity:'54,500' },
      { phase:'group', round:'Group L · MD2', date:'Tue, Jun 23', idt:'02:00', idtDate:'Jun 24 ⁺¹', home:'Croatia',     hCode:'hr',     away:'Panama',      aCode:'pa',     venue:'BMO Field', city:'Toronto',    capacity:'45,000' },
      { phase:'group', round:'Group B · MD3', date:'Wed, Jun 24', idt:'22:00', idtDate:'Jun 24',     home:'Canada',      hCode:'ca',     away:'Switzerland', aCode:'ch',     venue:'BC Place',  city:'Vancouver',  capacity:'54,500' },
      { phase:'group', round:'Group I · MD3', date:'Fri, Jun 26', idt:'22:00', idtDate:'Jun 26',     home:'Senegal',     hCode:'sn',     away:'Iraq', aCode:'iq',     venue:'BMO Field', city:'Toronto',    capacity:'45,000' },
      { phase:'group', round:'Group G · MD3', date:'Fri, Jun 26', idt:'06:00', idtDate:'Jun 27 ⁺¹', home:'New Zealand', hCode:'nz',     away:'Belgium',     aCode:'be',     venue:'BC Place',  city:'Vancouver',  capacity:'54,500' },
      { phase:'knockout', round:'Round of 32', date:'Thu, Jul 2', idt:'02:00', idtDate:'Jul 3 ⁺¹', home:'TBD', hCode:null, away:'TBD', aCode:null, venue:'BMO Field', city:'Toronto',   capacity:'45,000' },
      { phase:'knockout', round:'Round of 32', date:'Thu, Jul 2', idt:'06:00', idtDate:'Jul 3 ⁺¹', home:'TBD', hCode:null, away:'TBD', aCode:null, venue:'BC Place',  city:'Vancouver', capacity:'54,500' },
      { phase:'knockout', round:'Round of 16', date:'Tue, Jul 7', idt:'23:00', idtDate:'Jul 7',    home:'TBD', hCode:null, away:'TBD', aCode:null, venue:'BC Place',  city:'Vancouver', capacity:'54,500' },
    ]
  },
  'United States': {
    flag:'🇺🇸', code:'us', cities:11, totalGames:78,
    cityList:'📍 New York/NJ · Los Angeles · Dallas · Seattle · San Francisco · Miami · Kansas City · Boston · Philadelphia · Atlanta · Houston',
    games:[
      { phase:'group', round:'Group D · MD1', date:'Fri, Jun 12', idt:'04:00', idtDate:'Jun 13 ⁺¹', home:'United States', hCode:'us',     away:'Paraguay',      aCode:'py',     venue:'SoFi Stadium',            city:'Inglewood, CA',     capacity:'70,240' },
      { phase:'group', round:'Group B · MD1', date:'Sat, Jun 13', idt:'22:00', idtDate:'Jun 13',     home:'Qatar',         hCode:'qa',     away:'Switzerland',   aCode:'ch',     venue:"Levi's Stadium",          city:'Santa Clara, CA',   capacity:'68,500' },
      { phase:'group', round:'Group C · MD1', date:'Sat, Jun 13', idt:'01:00', idtDate:'Jun 14 ⁺¹', home:'Brazil',        hCode:'br',     away:'Morocco',       aCode:'ma',     venue:'MetLife Stadium',         city:'E. Rutherford, NJ', capacity:'82,500' },
      { phase:'group', round:'Group C · MD1', date:'Sat, Jun 13', idt:'04:00', idtDate:'Jun 14 ⁺¹', home:'Haiti',         hCode:'ht',     away:'Scotland',      aCode:'gb-sct', venue:'Gillette Stadium',        city:'Foxborough, MA',    capacity:'65,878' },
      { phase:'group', round:'Group E · MD1', date:'Sun, Jun 14', idt:'20:00', idtDate:'Jun 14',     home:'Germany',       hCode:'de',     away:'Curaçao',       aCode:'cw',     venue:'NRG Stadium',             city:'Houston, TX',       capacity:'72,220' },
      { phase:'group', round:'Group F · MD1', date:'Sun, Jun 14', idt:'23:00', idtDate:'Jun 14',     home:'Netherlands',   hCode:'nl',     away:'Japan',         aCode:'jp',     venue:'AT&T Stadium',            city:'Arlington, TX',     capacity:'80,000' },
      { phase:'group', round:'Group E · MD1', date:'Sun, Jun 14', idt:'02:00', idtDate:'Jun 15 ⁺¹', home:'Ivory Coast',   hCode:'ci',     away:'Ecuador',       aCode:'ec',     venue:'Lincoln Financial Field',  city:'Philadelphia, PA',  capacity:'69,796' },
      { phase:'group', round:'Group H · MD1', date:'Mon, Jun 15', idt:'19:00', idtDate:'Jun 15',     home:'Spain',         hCode:'es',     away:'Cape Verde',    aCode:'cv',     venue:'Mercedes-Benz Stadium',   city:'Atlanta, GA',       capacity:'71,000' },
      { phase:'group', round:'Group G · MD1', date:'Mon, Jun 15', idt:'22:00', idtDate:'Jun 15',     home:'Belgium',       hCode:'be',     away:'Egypt',         aCode:'eg',     venue:'Lumen Field',             city:'Seattle, WA',       capacity:'68,740' },
      { phase:'group', round:'Group H · MD1', date:'Mon, Jun 15', idt:'01:00', idtDate:'Jun 16 ⁺¹', home:'Saudi Arabia',  hCode:'sa',     away:'Uruguay',       aCode:'uy',     venue:'Hard Rock Stadium',       city:'Miami Gardens, FL', capacity:'64,767' },
      { phase:'group', round:'Group G · MD1', date:'Mon, Jun 15', idt:'04:00', idtDate:'Jun 16 ⁺¹', home:'Iran',          hCode:'ir',     away:'New Zealand',   aCode:'nz',     venue:'SoFi Stadium',            city:'Inglewood, CA',     capacity:'70,240' },
      { phase:'group', round:'Group I · MD1', date:'Tue, Jun 16', idt:'22:00', idtDate:'Jun 16',     home:'France',        hCode:'fr',     away:'Senegal',       aCode:'sn',     venue:'MetLife Stadium',         city:'E. Rutherford, NJ', capacity:'82,500' },
      { phase:'group', round:'Group I · MD1', date:'Tue, Jun 16', idt:'01:00', idtDate:'Jun 17 ⁺¹', home:'Iraq', hCode:'iq',     away:'Norway',        aCode:'no',     venue:'Gillette Stadium',        city:'Foxborough, MA',    capacity:'65,878' },
      { phase:'group', round:'Group J · MD1', date:'Tue, Jun 16', idt:'04:00', idtDate:'Jun 17 ⁺¹', home:'Argentina',     hCode:'ar',     away:'Algeria',       aCode:'dz',     venue:'Arrowhead Stadium',       city:'Kansas City, MO',   capacity:'76,416' },
      { phase:'group', round:'Group J · MD1', date:'Tue, Jun 16', idt:'07:00', idtDate:'Jun 17 ⁺¹', home:'Austria',       hCode:'at',     away:'Jordan',        aCode:'jo',     venue:"Levi's Stadium",          city:'Santa Clara, CA',   capacity:'68,500' },
      { phase:'group', round:'Group K · MD1', date:'Tue, Jun 17', idt:'20:00', idtDate:'Jun 17',     home:'Portugal',      hCode:'pt',     away:'DR Congo', aCode:'cd',     venue:'NRG Stadium',             city:'Houston, TX',       capacity:'72,220' },
      { phase:'group', round:'Group L · MD1', date:'Tue, Jun 17', idt:'23:00', idtDate:'Jun 17',     home:'England',       hCode:'gb-eng', away:'Croatia',       aCode:'hr',     venue:'AT&T Stadium',            city:'Arlington, TX',     capacity:'80,000' },
      { phase:'group', round:'Group A · MD2', date:'Thu, Jun 18', idt:'19:00', idtDate:'Jun 18',     home:'Czech Republic', hCode:'cz',     away:'South Africa',  aCode:'za',     venue:'Mercedes-Benz Stadium',   city:'Atlanta, GA',       capacity:'71,000' },
      { phase:'group', round:'Group B · MD2', date:'Thu, Jun 18', idt:'22:00', idtDate:'Jun 18',     home:'Switzerland',   hCode:'ch',     away:'Bosnia-Herzegovina', aCode:'ba',     venue:'SoFi Stadium',            city:'Inglewood, CA',     capacity:'70,240' },
      { phase:'group', round:'Group D · MD2', date:'Thu, Jun 19', idt:'22:00', idtDate:'Jun 19',     home:'United States', hCode:'us',     away:'Australia',     aCode:'au',     venue:'Lumen Field',             city:'Seattle, WA',       capacity:'68,740' },
      { phase:'group', round:'Group C · MD2', date:'Thu, Jun 19', idt:'01:00', idtDate:'Jun 20 ⁺¹', home:'Scotland',      hCode:'gb-sct', away:'Morocco',       aCode:'ma',     venue:'Gillette Stadium',        city:'Foxborough, MA',    capacity:'65,878' },
      { phase:'group', round:'Group C · MD2', date:'Thu, Jun 19', idt:'04:00', idtDate:'Jun 20 ⁺¹', home:'Brazil',        hCode:'br',     away:'Haiti',         aCode:'ht',     venue:'Lincoln Financial Field',  city:'Philadelphia, PA',  capacity:'69,796' },
      { phase:'group', round:'Group D · MD2', date:'Thu, Jun 19', idt:'07:00', idtDate:'Jun 20 ⁺¹', home:'Turkey', hCode:'tr',     away:'Paraguay',      aCode:'py',     venue:"Levi's Stadium",          city:'Santa Clara, CA',   capacity:'68,500' },
      { phase:'group', round:'Group F · MD2', date:'Sat, Jun 20', idt:'20:00', idtDate:'Jun 20',     home:'Netherlands',   hCode:'nl',     away:'Sweden', aCode:'se',     venue:'NRG Stadium',             city:'Houston, TX',       capacity:'72,220' },
      { phase:'group', round:'Group E · MD2', date:'Sat, Jun 20', idt:'03:00', idtDate:'Jun 21 ⁺¹', home:'Ecuador',       hCode:'ec',     away:'Curaçao',       aCode:'cw',     venue:'Arrowhead Stadium',       city:'Kansas City, MO',   capacity:'76,416' },
      { phase:'group', round:'Group H · MD2', date:'Sun, Jun 21', idt:'19:00', idtDate:'Jun 21',     home:'Spain',         hCode:'es',     away:'Saudi Arabia',  aCode:'sa',     venue:'Mercedes-Benz Stadium',   city:'Atlanta, GA',       capacity:'71,000' },
      { phase:'group', round:'Group G · MD2', date:'Sun, Jun 21', idt:'22:00', idtDate:'Jun 21',     home:'Belgium',       hCode:'be',     away:'Iran',          aCode:'ir',     venue:'SoFi Stadium',            city:'Inglewood, CA',     capacity:'70,240' },
      { phase:'group', round:'Group H · MD2', date:'Sun, Jun 21', idt:'01:00', idtDate:'Jun 22 ⁺¹', home:'Uruguay',       hCode:'uy',     away:'Cape Verde',    aCode:'cv',     venue:'Hard Rock Stadium',       city:'Miami Gardens, FL', capacity:'64,767' },
      { phase:'group', round:'Group J · MD2', date:'Sun, Jun 22', idt:'20:00', idtDate:'Jun 22',     home:'Argentina',     hCode:'ar',     away:'Austria',       aCode:'at',     venue:'AT&T Stadium',            city:'Arlington, TX',     capacity:'80,000' },
      { phase:'group', round:'Group I · MD2', date:'Sun, Jun 22', idt:'00:00', idtDate:'Jun 23 ⁺¹', home:'France',        hCode:'fr',     away:'Iraq', aCode:'iq',     venue:'Lincoln Financial Field',  city:'Philadelphia, PA',  capacity:'69,796' },
      { phase:'group', round:'Group I · MD2', date:'Sun, Jun 22', idt:'03:00', idtDate:'Jun 23 ⁺¹', home:'Norway',        hCode:'no',     away:'Senegal',       aCode:'sn',     venue:'MetLife Stadium',         city:'E. Rutherford, NJ', capacity:'82,500' },
      { phase:'group', round:'Group J · MD2', date:'Sun, Jun 22', idt:'06:00', idtDate:'Jun 23 ⁺¹', home:'Jordan',        hCode:'jo',     away:'Algeria',       aCode:'dz',     venue:"Levi's Stadium",          city:'Santa Clara, CA',   capacity:'68,500' },
      { phase:'group', round:'Group K · MD2', date:'Mon, Jun 23', idt:'20:00', idtDate:'Jun 23',     home:'Portugal',      hCode:'pt',     away:'Uzbekistan',    aCode:'uz',     venue:'NRG Stadium',             city:'Houston, TX',       capacity:'72,220' },
      { phase:'group', round:'Group L · MD2', date:'Mon, Jun 23', idt:'23:00', idtDate:'Jun 23',     home:'England',       hCode:'gb-eng', away:'Ghana',         aCode:'gh',     venue:'Gillette Stadium',        city:'Foxborough, MA',    capacity:'65,878' },
      { phase:'group', round:'Group B · MD3', date:'Wed, Jun 24', idt:'22:00', idtDate:'Jun 24',     home:'Bosnia-Herzegovina', hCode:'ba',     away:'Qatar',         aCode:'qa',     venue:'Lumen Field',             city:'Seattle, WA',       capacity:'68,740' },
      { phase:'group', round:'Group C · MD3', date:'Wed, Jun 24', idt:'01:00', idtDate:'Jun 25 ⁺¹', home:'Scotland',      hCode:'gb-sct', away:'Brazil',        aCode:'br',     venue:'Hard Rock Stadium',       city:'Miami Gardens, FL', capacity:'64,767' },
      { phase:'group', round:'Group C · MD3', date:'Wed, Jun 24', idt:'01:00', idtDate:'Jun 25 ⁺¹', home:'Morocco',       hCode:'ma',     away:'Haiti',         aCode:'ht',     venue:'Mercedes-Benz Stadium',   city:'Atlanta, GA',       capacity:'71,000' },
      { phase:'group', round:'Group E · MD3', date:'Thu, Jun 25', idt:'23:00', idtDate:'Jun 25',     home:'Ecuador',       hCode:'ec',     away:'Germany',       aCode:'de',     venue:'MetLife Stadium',         city:'E. Rutherford, NJ', capacity:'82,500' },
      { phase:'group', round:'Group E · MD3', date:'Thu, Jun 25', idt:'23:00', idtDate:'Jun 25',     home:'Curaçao',       hCode:'cw',     away:'Ivory Coast',   aCode:'ci',     venue:'Lincoln Financial Field',  city:'Philadelphia, PA',  capacity:'69,796' },
      { phase:'group', round:'Group F · MD3', date:'Thu, Jun 25', idt:'02:00', idtDate:'Jun 26 ⁺¹', home:'Japan',         hCode:'jp',     away:'Sweden', aCode:'se',     venue:'AT&T Stadium',            city:'Arlington, TX',     capacity:'80,000' },
      { phase:'group', round:'Group F · MD3', date:'Thu, Jun 25', idt:'02:00', idtDate:'Jun 26 ⁺¹', home:'Tunisia',       hCode:'tn',     away:'Netherlands',   aCode:'nl',     venue:'Arrowhead Stadium',       city:'Kansas City, MO',   capacity:'76,416' },
      { phase:'group', round:'Group D · MD3', date:'Thu, Jun 25', idt:'05:00', idtDate:'Jun 26 ⁺¹', home:'Turkey', hCode:'tr',     away:'United States', aCode:'us',     venue:'SoFi Stadium',            city:'Inglewood, CA',     capacity:'70,240' },
      { phase:'group', round:'Group D · MD3', date:'Thu, Jun 25', idt:'05:00', idtDate:'Jun 26 ⁺¹', home:'Paraguay',      hCode:'py',     away:'Australia',     aCode:'au',     venue:"Levi's Stadium",          city:'Santa Clara, CA',   capacity:'68,500' },
      { phase:'group', round:'Group I · MD3', date:'Fri, Jun 26', idt:'22:00', idtDate:'Jun 26',     home:'Norway',        hCode:'no',     away:'France',        aCode:'fr',     venue:'Gillette Stadium',        city:'Foxborough, MA',    capacity:'65,878' },
      { phase:'group', round:'Group H · MD3', date:'Fri, Jun 26', idt:'03:00', idtDate:'Jun 27 ⁺¹', home:'Cape Verde',    hCode:'cv',     away:'Saudi Arabia',  aCode:'sa',     venue:'NRG Stadium',             city:'Houston, TX',       capacity:'72,220' },
      { phase:'group', round:'Group G · MD3', date:'Fri, Jun 26', idt:'06:00', idtDate:'Jun 27 ⁺¹', home:'Egypt',         hCode:'eg',     away:'Iran',          aCode:'ir',     venue:'Lumen Field',             city:'Seattle, WA',       capacity:'68,740' },
      { phase:'group', round:'Group L · MD3', date:'Sat, Jun 27', idt:'00:00', idtDate:'Jun 28 ⁺¹', home:'Panama',        hCode:'pa',     away:'England',       aCode:'gb-eng', venue:'MetLife Stadium',         city:'E. Rutherford, NJ', capacity:'82,500' },
      { phase:'group', round:'Group L · MD3', date:'Sat, Jun 27', idt:'00:00', idtDate:'Jun 28 ⁺¹', home:'Croatia',       hCode:'hr',     away:'Ghana',         aCode:'gh',     venue:'Lincoln Financial Field',  city:'Philadelphia, PA',  capacity:'69,796' },
      { phase:'group', round:'Group K · MD3', date:'Sat, Jun 27', idt:'02:30', idtDate:'Jun 28 ⁺¹', home:'Colombia',      hCode:'co',     away:'Portugal',      aCode:'pt',     venue:'Hard Rock Stadium',       city:'Miami Gardens, FL', capacity:'64,767' },
      { phase:'group', round:'Group K · MD3', date:'Sat, Jun 27', idt:'02:30', idtDate:'Jun 28 ⁺¹', home:'DR Congo', hCode:'cd',     away:'Uzbekistan',    aCode:'uz',     venue:'Mercedes-Benz Stadium',   city:'Atlanta, GA',       capacity:'71,000' },
      { phase:'group', round:'Group J · MD3', date:'Sat, Jun 27', idt:'05:00', idtDate:'Jun 28 ⁺¹', home:'Algeria',       hCode:'dz',     away:'Austria',       aCode:'at',     venue:'Arrowhead Stadium',       city:'Kansas City, MO',   capacity:'76,416' },
      { phase:'group', round:'Group J · MD3', date:'Sat, Jun 27', idt:'05:00', idtDate:'Jun 28 ⁺¹', home:'Jordan',        hCode:'jo',     away:'Argentina',     aCode:'ar',     venue:'AT&T Stadium',            city:'Arlington, TX',     capacity:'80,000' },
      // ── ROUND OF 32 (12 games) ──
      { phase:'knockout', round:'Round of 32', date:'Sun, Jun 28', idt:'22:00', idtDate:'Jun 28',     home:'TBD', hCode:null, away:'TBD', aCode:null, venue:'SoFi Stadium',            city:'Inglewood, CA',     capacity:'70,240' },
      { phase:'knockout', round:'Round of 32', date:'Mon, Jun 29', idt:'20:00', idtDate:'Jun 29',     home:'TBD', hCode:null, away:'TBD', aCode:null, venue:'NRG Stadium',             city:'Houston, TX',       capacity:'72,220' },
      { phase:'knockout', round:'Round of 32', date:'Mon, Jun 29', idt:'23:30', idtDate:'Jun 29',     home:'TBD', hCode:null, away:'TBD', aCode:null, venue:'Gillette Stadium',        city:'Foxborough, MA',    capacity:'65,878' },
      { phase:'knockout', round:'Round of 32', date:'Tue, Jun 30', idt:'20:00', idtDate:'Jun 30',     home:'TBD', hCode:null, away:'TBD', aCode:null, venue:'AT&T Stadium',            city:'Arlington, TX',     capacity:'80,000' },
      { phase:'knockout', round:'Round of 32', date:'Tue, Jun 30', idt:'00:00', idtDate:'Jul 1 ⁺¹',  home:'TBD', hCode:null, away:'TBD', aCode:null, venue:'MetLife Stadium',         city:'E. Rutherford, NJ', capacity:'82,500' },
      { phase:'knockout', round:'Round of 32', date:'Wed, Jul 1',  idt:'19:00', idtDate:'Jul 1',      home:'TBD', hCode:null, away:'TBD', aCode:null, venue:'Mercedes-Benz Stadium',   city:'Atlanta, GA',       capacity:'71,000' },
      { phase:'knockout', round:'Round of 32', date:'Wed, Jul 1',  idt:'23:00', idtDate:'Jul 1',      home:'TBD', hCode:null, away:'TBD', aCode:null, venue:'Lumen Field',             city:'Seattle, WA',       capacity:'68,740' },
      { phase:'knockout', round:'Round of 32', date:'Wed, Jul 1',  idt:'03:00', idtDate:'Jul 2 ⁺¹',  home:'TBD', hCode:null, away:'TBD', aCode:null, venue:"Levi's Stadium",          city:'Santa Clara, CA',   capacity:'68,500' },
      { phase:'knockout', round:'Round of 32', date:'Thu, Jul 2',  idt:'22:00', idtDate:'Jul 2',      home:'TBD', hCode:null, away:'TBD', aCode:null, venue:'SoFi Stadium',            city:'Inglewood, CA',     capacity:'70,240' },
      { phase:'knockout', round:'Round of 32', date:'Fri, Jul 3',  idt:'21:00', idtDate:'Jul 3',      home:'TBD', hCode:null, away:'TBD', aCode:null, venue:'AT&T Stadium',            city:'Arlington, TX',     capacity:'80,000' },
      { phase:'knockout', round:'Round of 32', date:'Fri, Jul 3',  idt:'01:00', idtDate:'Jul 4 ⁺¹',  home:'TBD', hCode:null, away:'TBD', aCode:null, venue:'Hard Rock Stadium',       city:'Miami Gardens, FL', capacity:'64,767' },
      { phase:'knockout', round:'Round of 32', date:'Fri, Jul 3',  idt:'04:30', idtDate:'Jul 4 ⁺¹',  home:'TBD', hCode:null, away:'TBD', aCode:null, venue:'Arrowhead Stadium',       city:'Kansas City, MO',   capacity:'76,416' },
      // ── ROUND OF 16 (6 games) ──
      { phase:'knockout', round:'Round of 16', date:'Sat, Jul 4',  idt:'20:00', idtDate:'Jul 4',      home:'TBD', hCode:null, away:'TBD', aCode:null, venue:'NRG Stadium',             city:'Houston, TX',       capacity:'72,220' },
      { phase:'knockout', round:'Round of 16', date:'Sat, Jul 4',  idt:'00:00', idtDate:'Jul 5 ⁺¹',  home:'TBD', hCode:null, away:'TBD', aCode:null, venue:'Lincoln Financial Field',  city:'Philadelphia, PA',  capacity:'69,796' },
      { phase:'knockout', round:'Round of 16', date:'Sun, Jul 5',  idt:'23:00', idtDate:'Jul 5',      home:'TBD', hCode:null, away:'TBD', aCode:null, venue:'MetLife Stadium',         city:'E. Rutherford, NJ', capacity:'82,500' },
      { phase:'knockout', round:'Round of 16', date:'Mon, Jul 6',  idt:'22:00', idtDate:'Jul 6',      home:'TBD', hCode:null, away:'TBD', aCode:null, venue:'AT&T Stadium',            city:'Arlington, TX',     capacity:'80,000' },
      { phase:'knockout', round:'Round of 16', date:'Mon, Jul 6',  idt:'03:00', idtDate:'Jul 7 ⁺¹',  home:'TBD', hCode:null, away:'TBD', aCode:null, venue:'Lumen Field',             city:'Seattle, WA',       capacity:'68,740' },
      { phase:'knockout', round:'Round of 16', date:'Tue, Jul 7',  idt:'19:00', idtDate:'Jul 7',      home:'TBD', hCode:null, away:'TBD', aCode:null, venue:'Mercedes-Benz Stadium',   city:'Atlanta, GA',       capacity:'71,000' },
      // ── QUARTER-FINALS (4 games) ──
      { phase:'knockout', round:'Quarter-Final', date:'Thu, Jul 9',  idt:'23:00', idtDate:'Jul 9',      home:'TBD', hCode:null, away:'TBD', aCode:null, venue:'Gillette Stadium',        city:'Foxborough, MA',    capacity:'65,878' },
      { phase:'knockout', round:'Quarter-Final', date:'Fri, Jul 10', idt:'22:00', idtDate:'Jul 10',     home:'TBD', hCode:null, away:'TBD', aCode:null, venue:'SoFi Stadium',            city:'Inglewood, CA',     capacity:'70,240' },
      { phase:'knockout', round:'Quarter-Final', date:'Sat, Jul 11', idt:'00:00', idtDate:'Jul 12 ⁺¹', home:'TBD', hCode:null, away:'TBD', aCode:null, venue:'Hard Rock Stadium',       city:'Miami Gardens, FL', capacity:'64,767' },
      { phase:'knockout', round:'Quarter-Final', date:'Sat, Jul 11', idt:'04:00', idtDate:'Jul 12 ⁺¹', home:'TBD', hCode:null, away:'TBD', aCode:null, venue:'Arrowhead Stadium',       city:'Kansas City, MO',   capacity:'76,416' },
      // ── SEMI-FINALS (2 games) ──
      { phase:'knockout', round:'Semi-Final',    date:'Tue, Jul 14', idt:'22:00', idtDate:'Jul 14',     home:'TBD', hCode:null, away:'TBD', aCode:null, venue:'AT&T Stadium',            city:'Arlington, TX',     capacity:'80,000' },
      { phase:'knockout', round:'Semi-Final',    date:'Wed, Jul 15', idt:'22:00', idtDate:'Jul 15',     home:'TBD', hCode:null, away:'TBD', aCode:null, venue:'Mercedes-Benz Stadium',   city:'Atlanta, GA',       capacity:'71,000' },
      // ── 3RD PLACE + FINAL ──
      { phase:'knockout', round:'🥉 3rd Place',  date:'Sat, Jul 18', idt:'00:00', idtDate:'Jul 19 ⁺¹', home:'TBD', hCode:null, away:'TBD', aCode:null, venue:'Hard Rock Stadium',       city:'Miami Gardens, FL', capacity:'64,767' },
      { phase:'knockout', round:'🏆 Final',      date:'Sun, Jul 19', idt:'22:00', idtDate:'Jul 19',     home:'TBD', hCode:null, away:'TBD', aCode:null, venue:'MetLife Stadium',         city:'E. Rutherford, NJ', capacity:'82,500' },
    ]
  }
};

// ── HOST SCHEDULE MODAL ──────────────────────────────────────
function openHostSchedule(name) {
  var d = HOST_SCHEDULES[name];
  if (!d) return;

  document.getElementById('hs-flag-img').src = 'https://flagcdn.com/w160/' + d.code + '.png';
  document.getElementById('hs-flag-img').style.display = 'block';
  document.getElementById('hs-country-name').textContent = name;
  document.getElementById('hs-stats-row').innerHTML = '🏠 Host Nation &nbsp;·&nbsp; ' + d.cities + ' cities &nbsp;·&nbsp; ' + d.totalGames + ' matches';
  document.getElementById('hs-cities-row').textContent = d.cityList;

  var tbody = '';
  var lastPhase = '';
  for (var i = 0; i < d.games.length; i++) {
    var g = d.games[i];
    if (g.phase !== lastPhase) {
      var icon = g.phase === 'group' ? '⚽' : '🏆';
      var label = g.phase === 'group' ? 'Group Stage' : 'Knockout Rounds';
      tbody += '<tr class="hs-phase-hdr"><td colspan="6">' + icon + '&nbsp; ' + label + '</td></tr>';
      lastPhase = g.phase;
    }

    var hf = g.hCode
      ? '<img class="td-flag" src="https://flagcdn.com/w40/' + g.hCode + '.png" alt="">'
      : '<div class="td-flag-ph"></div>';
    var af = g.aCode
      ? '<img class="td-flag" src="https://flagcdn.com/w40/' + g.aCode + '.png" alt="">'
      : '<div class="td-flag-ph"></div>';

    var timeCell = (g.idt === 'TBD' || g.idt === 'Various')
      ? '<span class="td-tbd">' + g.idt + '</span>'
      : '<span class="td-time">' + g.idt + '</span>' + (g.idtDate ? '<br><span style="font-size:.6rem;color:var(--muted)">' + g.idtDate + '</span>' : '');

    tbody += '<tr>'
      + '<td><span class="hs-tag ' + g.phase + '">' + g.round + '</span></td>'
      + '<td><div class="td-teams">' + hf + '<span>' + g.home + '</span><span class="td-vs">vs</span>' + af + '<span>' + g.away + '</span></div></td>'
      + '<td>' + g.venue + '<br><span style="font-size:.62rem;color:var(--muted)">' + g.city + '</span></td>'
      + '<td style="color:var(--muted);white-space:nowrap">' + (g.capacity || '—') + '</td>'
      + '<td style="white-space:nowrap;font-size:.78rem;color:var(--muted)">' + g.date + '</td>'
      + '<td>' + timeCell + '</td>'
      + '</tr>';
  }

  document.getElementById('hs-games-container').innerHTML =
    '<div class="hs-table-wrap">'
    + '<table class="hs-table"><thead><tr>'
    + '<th>Stage</th><th>Teams</th><th>Stadium</th><th>Cap.</th><th>Date</th><th>Time (ISR)</th>'
    + '</tr></thead><tbody>' + tbody + '</tbody></table></div>';

  var ov = document.getElementById('host-modal');
  ov.classList.add('open');
  ov.querySelector('.modal').scrollTop = 0;
}

function closeHostModal() {
  document.getElementById('host-modal').classList.remove('open');
}

document.getElementById('host-modal').addEventListener('click', function(e) {
  if (e.target === document.getElementById('host-modal')) closeHostModal();
});

document.querySelectorAll('.host-card').forEach(function(card) {
  card.addEventListener('click', function() {
    if (window.innerWidth > 768) { openHostSchedule(card.dataset.host); } else { location.href = 'host.html?name=' + encodeURIComponent(card.dataset.host); }
  });
});

// ── TOAST ────────────────────────────────────────────────────
function showToast(msg, type='success') {
  const t = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  document.getElementById('toast-icon').textContent = type==='success'?'✓':'✕';
  t.className='toast '+type; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),3500);
}

