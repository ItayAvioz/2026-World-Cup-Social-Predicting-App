-- ================================================================
-- WORLDCUP 2026 — Feature: Games
-- Table: games
-- 104 games: 72 group stage + 32 knockout
-- All times in UTC (IDT = UTC+3, scores = 90-min only, no ET/penalties)
-- ================================================================


-- ----------------------------------------------------------------
-- 1. TABLE
-- ----------------------------------------------------------------

CREATE TABLE public.games (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_home     text        NOT NULL,
  team_away     text        NOT NULL,
  kick_off_time timestamptz NOT NULL,
  score_home    int,          -- NULL until played (90-min score only)
  score_away    int,          -- NULL until played (90-min score only)
  group_name    text CHECK (group_name IN ('A','B','C','D','E','F','G','H','I','J','K','L')),
  phase         text        NOT NULL CHECK (phase IN ('group','r32','r16','qf','sf','third','final'))
);

CREATE INDEX games_kickoff_idx   ON public.games (kick_off_time);
CREATE INDEX games_phase_idx     ON public.games (phase, group_name);


-- ----------------------------------------------------------------
-- 2. RLS
-- ----------------------------------------------------------------

ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

-- Everyone can read the schedule (no auth required)
CREATE POLICY "games: public read"
  ON public.games FOR SELECT
  USING (true);

-- INSERT / UPDATE / DELETE: service role only (Phase 4 football API)


-- ----------------------------------------------------------------
-- 3. SEED — GROUP STAGE (72 games)
-- ----------------------------------------------------------------

INSERT INTO public.games (team_home, team_away, kick_off_time, group_name, phase) VALUES

-- ── GROUP A: Mexico · South Africa · South Korea · UEFA PO-D ──
('Mexico',       'South Africa', '2026-06-11T19:00:00Z', 'A', 'group'),
('South Korea',  'UEFA PO-D',    '2026-06-12T02:00:00Z', 'A', 'group'),
('UEFA PO-D',    'South Africa', '2026-06-18T16:00:00Z', 'A', 'group'),
('Mexico',       'South Korea',  '2026-06-19T03:00:00Z', 'A', 'group'),
('Mexico',       'UEFA PO-D',    '2026-06-25T01:00:00Z', 'A', 'group'),  -- MD3 simultaneous
('South Africa', 'South Korea',  '2026-06-25T01:00:00Z', 'A', 'group'),  -- MD3 simultaneous

-- ── GROUP B: Canada · Qatar · Switzerland · UEFA PO-A ──
('Canada',       'UEFA PO-A',    '2026-06-12T19:00:00Z', 'B', 'group'),
('Qatar',        'Switzerland',  '2026-06-13T19:00:00Z', 'B', 'group'),
('Switzerland',  'UEFA PO-A',    '2026-06-18T19:00:00Z', 'B', 'group'),
('Canada',       'Qatar',        '2026-06-18T22:00:00Z', 'B', 'group'),
('UEFA PO-A',    'Qatar',        '2026-06-24T19:00:00Z', 'B', 'group'),  -- MD3 simultaneous
('Canada',       'Switzerland',  '2026-06-24T19:00:00Z', 'B', 'group'),  -- MD3 simultaneous

-- ── GROUP C: Brazil · Morocco · Haiti · Scotland ──
('Brazil',       'Morocco',      '2026-06-13T22:00:00Z', 'C', 'group'),
('Haiti',        'Scotland',     '2026-06-14T01:00:00Z', 'C', 'group'),
('Scotland',     'Morocco',      '2026-06-19T22:00:00Z', 'C', 'group'),
('Brazil',       'Haiti',        '2026-06-20T01:00:00Z', 'C', 'group'),
('Scotland',     'Brazil',       '2026-06-24T22:00:00Z', 'C', 'group'),  -- MD3 simultaneous
('Morocco',      'Haiti',        '2026-06-24T22:00:00Z', 'C', 'group'),  -- MD3 simultaneous

-- ── GROUP D: United States · Paraguay · Australia · UEFA PO-C ──
('United States','Paraguay',     '2026-06-13T01:00:00Z', 'D', 'group'),
('Australia',    'UEFA PO-C',    '2026-06-13T04:00:00Z', 'D', 'group'),
('United States','Australia',    '2026-06-19T19:00:00Z', 'D', 'group'),
('UEFA PO-C',    'Paraguay',     '2026-06-20T04:00:00Z', 'D', 'group'),
('UEFA PO-C',    'United States','2026-06-26T02:00:00Z', 'D', 'group'),  -- MD3 simultaneous
('Paraguay',     'Australia',    '2026-06-26T02:00:00Z', 'D', 'group'),  -- MD3 simultaneous

-- ── GROUP E: Germany · Curaçao · Ivory Coast · Ecuador ──
('Germany',      'Curaçao',      '2026-06-14T17:00:00Z', 'E', 'group'),
('Ivory Coast',  'Ecuador',      '2026-06-14T23:00:00Z', 'E', 'group'),
('Germany',      'Ivory Coast',  '2026-06-20T20:00:00Z', 'E', 'group'),
('Ecuador',      'Curaçao',      '2026-06-21T00:00:00Z', 'E', 'group'),
('Ecuador',      'Germany',      '2026-06-25T20:00:00Z', 'E', 'group'),  -- MD3 simultaneous
('Curaçao',      'Ivory Coast',  '2026-06-25T20:00:00Z', 'E', 'group'),  -- MD3 simultaneous

-- ── GROUP F: Netherlands · Japan · Tunisia · UEFA PO-B ──
('Netherlands',  'Japan',        '2026-06-14T20:00:00Z', 'F', 'group'),
('UEFA PO-B',    'Tunisia',      '2026-06-15T02:00:00Z', 'F', 'group'),
('Netherlands',  'UEFA PO-B',    '2026-06-20T17:00:00Z', 'F', 'group'),
('Tunisia',      'Japan',        '2026-06-21T04:00:00Z', 'F', 'group'),
('Japan',        'UEFA PO-B',    '2026-06-25T23:00:00Z', 'F', 'group'),  -- MD3 simultaneous
('Tunisia',      'Netherlands',  '2026-06-25T23:00:00Z', 'F', 'group'),  -- MD3 simultaneous

-- ── GROUP G: Belgium · Egypt · Iran · New Zealand ──
('Belgium',      'Egypt',        '2026-06-15T19:00:00Z', 'G', 'group'),
('Iran',         'New Zealand',  '2026-06-16T01:00:00Z', 'G', 'group'),
('Belgium',      'Iran',         '2026-06-21T19:00:00Z', 'G', 'group'),
('New Zealand',  'Egypt',        '2026-06-22T01:00:00Z', 'G', 'group'),
('Egypt',        'Iran',         '2026-06-27T03:00:00Z', 'G', 'group'),  -- MD3 simultaneous
('New Zealand',  'Belgium',      '2026-06-27T03:00:00Z', 'G', 'group'),  -- MD3 simultaneous

-- ── GROUP H: Spain · Cape Verde · Saudi Arabia · Uruguay ──
('Spain',        'Cape Verde',   '2026-06-15T16:00:00Z', 'H', 'group'),
('Saudi Arabia', 'Uruguay',      '2026-06-15T22:00:00Z', 'H', 'group'),
('Spain',        'Saudi Arabia', '2026-06-21T16:00:00Z', 'H', 'group'),
('Uruguay',      'Cape Verde',   '2026-06-21T22:00:00Z', 'H', 'group'),
('Uruguay',      'Spain',        '2026-06-27T00:00:00Z', 'H', 'group'),  -- MD3 simultaneous
('Cape Verde',   'Saudi Arabia', '2026-06-27T00:00:00Z', 'H', 'group'),  -- MD3 simultaneous

-- ── GROUP I: France · Senegal · Norway · IC PO-2 ──
('France',       'Senegal',      '2026-06-16T19:00:00Z', 'I', 'group'),
('IC PO-2',      'Norway',       '2026-06-16T22:00:00Z', 'I', 'group'),
('France',       'IC PO-2',      '2026-06-22T21:00:00Z', 'I', 'group'),
('Norway',       'Senegal',      '2026-06-23T00:00:00Z', 'I', 'group'),
('Norway',       'France',       '2026-06-26T19:00:00Z', 'I', 'group'),  -- MD3 simultaneous
('Senegal',      'IC PO-2',      '2026-06-26T19:00:00Z', 'I', 'group'),  -- MD3 simultaneous

-- ── GROUP J: Argentina · Algeria · Austria · Jordan ──
('Argentina',    'Algeria',      '2026-06-17T01:00:00Z', 'J', 'group'),
('Austria',      'Jordan',       '2026-06-17T04:00:00Z', 'J', 'group'),
('Argentina',    'Austria',      '2026-06-22T17:00:00Z', 'J', 'group'),
('Jordan',       'Algeria',      '2026-06-23T03:00:00Z', 'J', 'group'),
('Algeria',      'Austria',      '2026-06-28T02:00:00Z', 'J', 'group'),  -- MD3 simultaneous
('Jordan',       'Argentina',    '2026-06-28T02:00:00Z', 'J', 'group'),  -- MD3 simultaneous

-- ── GROUP K: Portugal · Uzbekistan · Colombia · IC PO-1 ──
('Portugal',     'IC PO-1',      '2026-06-17T17:00:00Z', 'K', 'group'),
('Uzbekistan',   'Colombia',     '2026-06-18T03:00:00Z', 'K', 'group'),
('Portugal',     'Uzbekistan',   '2026-06-23T17:00:00Z', 'K', 'group'),
('Colombia',     'IC PO-1',      '2026-06-24T02:00:00Z', 'K', 'group'),
('Colombia',     'Portugal',     '2026-06-27T23:30:00Z', 'K', 'group'),  -- MD3 simultaneous
('IC PO-1',      'Uzbekistan',   '2026-06-27T23:30:00Z', 'K', 'group'),  -- MD3 simultaneous

-- ── GROUP L: England · Croatia · Ghana · Panama ──
('England',      'Croatia',      '2026-06-17T20:00:00Z', 'L', 'group'),
('Ghana',        'Panama',       '2026-06-17T23:00:00Z', 'L', 'group'),
('England',      'Ghana',        '2026-06-23T20:00:00Z', 'L', 'group'),
('Croatia',      'Panama',       '2026-06-23T23:00:00Z', 'L', 'group'),
('Panama',       'England',      '2026-06-27T21:00:00Z', 'L', 'group'),  -- MD3 simultaneous
('Croatia',      'Ghana',        '2026-06-27T21:00:00Z', 'L', 'group');  -- MD3 simultaneous


-- ----------------------------------------------------------------
-- 4. SEED — KNOCKOUT STAGE (32 games, all TBD)
-- team_home/team_away = 'TBD' until group stage resolves
-- ----------------------------------------------------------------

INSERT INTO public.games (team_home, team_away, kick_off_time, group_name, phase) VALUES

-- ── ROUND OF 32 (16 games) ──
('TBD', 'TBD', '2026-06-28T19:00:00Z', NULL, 'r32'),  -- SoFi, Inglewood CA
('TBD', 'TBD', '2026-06-29T17:00:00Z', NULL, 'r32'),  -- NRG, Houston TX
('TBD', 'TBD', '2026-06-29T20:30:00Z', NULL, 'r32'),  -- Gillette, Foxborough MA
('TBD', 'TBD', '2026-06-30T02:00:00Z', NULL, 'r32'),  -- BBVA, Monterrey MX
('TBD', 'TBD', '2026-06-30T17:00:00Z', NULL, 'r32'),  -- AT&T, Arlington TX
('TBD', 'TBD', '2026-06-30T21:00:00Z', NULL, 'r32'),  -- MetLife, E. Rutherford NJ
('TBD', 'TBD', '2026-07-01T01:00:00Z', NULL, 'r32'),  -- Azteca, Mexico City MX
('TBD', 'TBD', '2026-07-01T16:00:00Z', NULL, 'r32'),  -- Mercedes-Benz, Atlanta GA
('TBD', 'TBD', '2026-07-01T20:00:00Z', NULL, 'r32'),  -- Lumen Field, Seattle WA
('TBD', 'TBD', '2026-07-02T00:00:00Z', NULL, 'r32'),  -- Levi's, Santa Clara CA
('TBD', 'TBD', '2026-07-02T19:00:00Z', NULL, 'r32'),  -- SoFi, Inglewood CA
('TBD', 'TBD', '2026-07-02T23:00:00Z', NULL, 'r32'),  -- BMO Field, Toronto CA
('TBD', 'TBD', '2026-07-03T03:00:00Z', NULL, 'r32'),  -- BC Place, Vancouver CA
('TBD', 'TBD', '2026-07-03T18:00:00Z', NULL, 'r32'),  -- AT&T, Arlington TX
('TBD', 'TBD', '2026-07-03T22:00:00Z', NULL, 'r32'),  -- Hard Rock, Miami Gardens FL
('TBD', 'TBD', '2026-07-04T01:30:00Z', NULL, 'r32'),  -- Arrowhead, Kansas City MO

-- ── ROUND OF 16 (8 games) ──
('TBD', 'TBD', '2026-07-04T17:00:00Z', NULL, 'r16'),  -- NRG, Houston TX
('TBD', 'TBD', '2026-07-04T21:00:00Z', NULL, 'r16'),  -- Lincoln Financial, Philadelphia PA
('TBD', 'TBD', '2026-07-05T20:00:00Z', NULL, 'r16'),  -- MetLife, E. Rutherford NJ
('TBD', 'TBD', '2026-07-06T00:00:00Z', NULL, 'r16'),  -- Azteca, Mexico City MX
('TBD', 'TBD', '2026-07-06T19:00:00Z', NULL, 'r16'),  -- AT&T, Arlington TX
('TBD', 'TBD', '2026-07-07T00:00:00Z', NULL, 'r16'),  -- Lumen Field, Seattle WA
('TBD', 'TBD', '2026-07-07T16:00:00Z', NULL, 'r16'),  -- Mercedes-Benz, Atlanta GA
('TBD', 'TBD', '2026-07-07T20:00:00Z', NULL, 'r16'),  -- BC Place, Vancouver CA

-- ── QUARTER-FINALS (4 games) ──
('TBD', 'TBD', '2026-07-09T20:00:00Z', NULL, 'qf'),   -- Gillette, Foxborough MA
('TBD', 'TBD', '2026-07-10T19:00:00Z', NULL, 'qf'),   -- SoFi, Inglewood CA
('TBD', 'TBD', '2026-07-11T21:00:00Z', NULL, 'qf'),   -- Hard Rock, Miami Gardens FL
('TBD', 'TBD', '2026-07-12T01:00:00Z', NULL, 'qf'),   -- Arrowhead, Kansas City MO

-- ── SEMI-FINALS (2 games) ──
('TBD', 'TBD', '2026-07-14T19:00:00Z', NULL, 'sf'),   -- AT&T, Arlington TX
('TBD', 'TBD', '2026-07-15T19:00:00Z', NULL, 'sf'),   -- Mercedes-Benz, Atlanta GA

-- ── 3RD PLACE + FINAL ──
('TBD', 'TBD', '2026-07-18T21:00:00Z', NULL, 'third'),  -- Hard Rock, Miami Gardens FL
('TBD', 'TBD', '2026-07-19T19:00:00Z', NULL, 'final');  -- MetLife, E. Rutherford NJ
