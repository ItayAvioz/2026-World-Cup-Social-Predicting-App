-- ================================================================
-- Migration 80: Trivia questions seed — 40 questions, Jun 11 – Jul 20, 2026
-- Time slot: available_from = DATE 19:00 UTC (22:00 Israel/UTC+3 summer)
--            available_until = DATE+1 19:00 UTC
-- ================================================================

INSERT INTO public.trivia_questions
  (question_date, available_from, available_until,
   question_text, option_a, option_b, option_c, option_d,
   correct_option, explanation)
VALUES
-- Q1 — Jun 11
('2026-06-11','2026-06-11T19:00:00+00','2026-06-12T19:00:00+00',
 'Who is the only player to have played in two World Cup Finals for two different nations?',
 'Ferenc Puskás','Luis Monti','José Altafini','Robert Prosinečki',
 'b','Luis Monti represented Argentina in the 1930 Final and Italy in the 1934 Final.'),

-- Q2 — Jun 12
('2026-06-12','2026-06-12T19:00:00+00','2026-06-13T19:00:00+00',
 'In 2006, which team was eliminated without conceding a single goal in open play?',
 'Italy','France','Switzerland','Portugal',
 'c','Switzerland kept clean sheets in all four of their matches but were eliminated in the Round of 16 on penalties.'),

-- Q3 — Jun 13
('2026-06-13','2026-06-13T19:00:00+00','2026-06-14T19:00:00+00',
 'Who was the first player in World Cup history to be officially shown a Red Card?',
 'Antonio Rattín','Carlos Caszely','Garrincha','Bobby Moore',
 'b','While players were sent off before, physical cards were introduced in 1970; the first Red Card was shown to Caszely (Chile) in 1974.'),

-- Q4 — Jun 14
('2026-06-14','2026-06-14T19:00:00+00','2026-06-15T19:00:00+00',
 'Which referee famously issued three yellow cards to the same player in a single 2006 match?',
 'Pierluigi Collina','Howard Webb','Graham Poll','Byron Moreno',
 'c','English referee Graham Poll booked Croatia''s Josip Šimunić three times before finally sending him off against Australia.'),

-- Q5 — Jun 15
('2026-06-15','2026-06-15T19:00:00+00','2026-06-16T19:00:00+00',
 'In the 1930 Final, what unique equipment dispute occurred between the finalists?',
 'Disagreement over kit colors','Disagreement over which ball to use','Disagreement over the referee''s nationality','Disagreement over the goalpost material',
 'b','Argentina provided the first-half ball and Uruguay provided the second-half ball; Uruguay eventually won 4-2.'),

-- Q6 — Jun 16
('2026-06-16','2026-06-16T19:00:00+00','2026-06-17T19:00:00+00',
 'Who is the youngest manager to ever lead a team in a World Cup?',
 'Julian Nagelsmann','Juan José Tramutola','Lionel Scaloni','Roberto Martínez',
 'b','Tramutola managed Argentina in 1930 at just 27 years old.'),

-- Q7 — Jun 17
('2026-06-17','2026-06-17T19:00:00+00','2026-06-18T19:00:00+00',
 'Which player holds the record for the fastest red card in history (56 seconds)?',
 'José Batista','Vinnie Jones','Gerardo Bedoya','David Beckham',
 'a','Representing Uruguay against Scotland in 1986, Batista was sent off less than a minute into the match.'),

-- Q8 — Jun 18
('2026-06-18','2026-06-18T19:00:00+00','2026-06-19T19:00:00+00',
 'In 1978, Ernie Brandts became the only player to do what in a single match?',
 'Score a hat-trick of penalties','Score a goal and an own goal','Be substituted twice in the first half','Provide three assists to the opponent',
 'b','Playing for the Netherlands against Italy, Brandts scored for both teams in the same game.'),

-- Q9 — Jun 19
('2026-06-19','2026-06-19T19:00:00+00','2026-06-20T19:00:00+00',
 'Which nation withdrew from the 1950 World Cup, allegedly because they weren''t allowed to play barefoot?',
 'Egypt','India','South Korea','Nigeria',
 'b','India withdrew from the tournament partially because FIFA had banned playing without boots.'),

-- Q10 — Jun 20
('2026-06-20','2026-06-20T19:00:00+00','2026-06-21T19:00:00+00',
 'Who is the only manager to win the World Cup twice?',
 'Mario Zagallo','Franz Beckenbauer','Vittorio Pozzo','Didier Deschamps',
 'c','Pozzo led Italy to consecutive World Cup victories in 1934 and 1938.'),

-- Q11 — Jun 21
('2026-06-21','2026-06-21T19:00:00+00','2026-06-22T19:00:00+00',
 'Who scored the fastest goal in World Cup history, timed at just 11 seconds?',
 'Clint Dempsey','Bryan Robson','Hakan Şükür','Bernard Lacombe',
 'c','The Turkish striker scored 11 seconds into the 3rd-place match against South Korea in 2002.'),

-- Q12 — Jun 22
('2026-06-22','2026-06-22T19:00:00+00','2026-06-23T19:00:00+00',
 'Who scored the only ''Olympic Goal'' (directly from a corner) in World Cup history?',
 'Marcos Coll','Roberto Carlos','Ronaldinho','Alvaro Recoba',
 'a','Coll scored directly from a corner for Colombia against the Soviet Union in 1962.'),

-- Q13 — Jun 23
('2026-06-23','2026-06-23T19:00:00+00','2026-06-24T19:00:00+00',
 'Which nation was the first Asian country to ever participate in a World Cup?',
 'Japan','South Korea','Dutch East Indies','North Korea',
 'c','The nation now known as Indonesia participated in the 1938 World Cup.'),

-- Q14 — Jun 24
('2026-06-24','2026-06-24T19:00:00+00','2026-06-25T19:00:00+00',
 'Who holds the joint record for the most clean sheets in World Cup history (10)?',
 'Gianluigi Buffon','Iker Casillas','Peter Shilton & Fabien Barthez','Lev Yashin',
 'c','Shilton (England) and Barthez (France) both recorded 10 clean sheets in their World Cup careers.'),

-- Q15 — Jun 25
('2026-06-25','2026-06-25T19:00:00+00','2026-06-26T19:00:00+00',
 'Who holds the record for the most goals scored in a single World Cup tournament?',
 'Ronaldo (Brazil)','Just Fontaine','Sándor Kocsis','Eusébio',
 'b','Just Fontaine scored 13 goals for France at the 1958 World Cup in Sweden — a record that still stands today.'),

-- Q16 — Jun 26
('2026-06-26','2026-06-26T19:00:00+00','2026-06-27T19:00:00+00',
 'Dejan Stanković is the only player to have played in World Cups for which three ''nations''?',
 'Yugoslavia, Serbia & Montenegro, Serbia','USSR, Russia, Ukraine','Czechoslovakia, Czech Rep, Slovakia','West Germany, East Germany, Germany',
 'a','Stanković played in 1998 for Yugoslavia, 2006 for Serbia & Montenegro, and 2010 for Serbia.'),

-- Q17 — Jun 27
('2026-06-27','2026-06-27T19:00:00+00','2026-06-28T19:00:00+00',
 'Which team holds the record for the highest-scoring win in a single match (10-1)?',
 'Germany','Hungary','Yugoslavia','Portugal',
 'b','Hungary defeated El Salvador 10-1 in the 1982 World Cup.'),

-- Q18 — Jun 28
('2026-06-28','2026-06-28T19:00:00+00','2026-06-29T19:00:00+00',
 'Who was the first-ever substitute used in a World Cup match?',
 'Bobby Charlton','Gérson','Anatoliy Puzach','Mario Kempes',
 'c','Representing the USSR in 1970, Puzach became the first sub after FIFA introduced the rule.'),

-- Q19 — Jun 29
('2026-06-29','2026-06-29T19:00:00+00','2026-06-30T19:00:00+00',
 'Who is the oldest player to ever score in a World Cup Final?',
 'Lionel Messi','Nils Liedholm','Zinedine Zidane','Miroslav Klose',
 'b','The Swedish captain was 35 years and 264 days old when he scored in the 1958 Final.'),

-- Q20 — Jun 30
('2026-06-30','2026-06-30T19:00:00+00','2026-07-01T19:00:00+00',
 'Which player scored 5 goals in a single match against Cameroon in 1994?',
 'Romário','Hristo Stoichkov','Oleg Salenko','Gabriel Batistuta',
 'c','Salenko set the record for most goals in a single match during Russia''s 6-1 win.'),

-- Q21 — Jul 1
('2026-07-01','2026-07-01T19:00:00+00','2026-07-02T19:00:00+00',
 'Who is the all-time leading goalscorer in World Cup history with 16 goals?',
 'Ronaldo (R9)','Pelé','Miroslav Klose','Just Fontaine',
 'c','Klose (Germany) scored his 16th goal in the 2014 semi-final against Brazil.'),

-- Q22 — Jul 2
('2026-07-02','2026-07-02T19:00:00+00','2026-07-03T19:00:00+00',
 'Who scored the winning goal for Uruguay in the 1950 ''Maracanazo'' against Brazil?',
 'Juan Alberto Schiaffino','Alcides Ghiggia','Obdulio Varela','Jules Rimet',
 'b','Ghiggia scored the decisive second goal in a match watched by nearly 200,000 fans.'),

-- Q23 — Jul 3
('2026-07-03','2026-07-03T19:00:00+00','2026-07-04T19:00:00+00',
 'What was the name of the dog who found the stolen Jules Rimet trophy in 1966?',
 'Rover','Pickles','Buster','Lucky',
 'b','The trophy was stolen before the 1966 tournament; Pickles found it wrapped in newspaper in a hedge.'),

-- Q24 — Jul 4
('2026-07-04','2026-07-04T19:00:00+00','2026-07-05T19:00:00+00',
 'Which player has won the most ''Man of the Match'' awards in history (11)?',
 'Lionel Messi','Cristiano Ronaldo','Arjen Robben','Kylian Mbappé',
 'a','Messi holds the record, with 7 of those awards coming during his winning 2022 campaign.'),

-- Q25 — Jul 5
('2026-07-05','2026-07-05T19:00:00+00','2026-07-06T19:00:00+00',
 'The first-ever penalty shootout in World Cup history (1982) occurred between which teams?',
 'West Germany and France','Argentina and Italy','Brazil and Italy','France and Brazil',
 'a','West Germany won the shootout 5-4 after a legendary 3-3 draw in the semi-final.'),

-- Q26 — Jul 6
('2026-07-06','2026-07-06T19:00:00+00','2026-07-07T19:00:00+00',
 'Which host stadium features an open-air canopy designed specifically to keep 90% of fans dry while leaving the pitch exposed to the elements?',
 'Houston Stadium','Estadio Monterrey','Miami Stadium','Toronto Stadium',
 'c','The stadium in Miami underwent a massive renovation to include a massive canopy for fan comfort.'),

-- Q27 — Jul 7
('2026-07-07','2026-07-07T19:00:00+00','2026-07-08T19:00:00+00',
 'BC Place in Vancouver features a unique roof where the center ''node'' can cast a specific shadow that interferes with what requirement?',
 'Goal-line technology accuracy','Player vision during sunset','VAR lighting consistency standards','Live television color balancing',
 'c','The shadow from the roof''s central supports required specific lighting adjustments for consistent VAR analysis.'),

-- Q28 — Jul 8
('2026-07-08','2026-07-08T19:00:00+00','2026-07-09T19:00:00+00',
 'Under the new 2026 disciplinary laws, what specific on-field action can now lead to an immediate dismissal (Red Card)?',
 'Removing a jersey during a goal celebration','Persistent dissent from the technical bench','Covering the mouth when speaking to an opponent during a confrontation','Kicking the ball away after a whistle in the knockout rounds',
 'c','This rule was introduced to prevent players from concealing abusive or discriminatory remarks from lip-readers and officials.'),

-- Q29 — Jul 9
('2026-07-09','2026-07-09T19:00:00+00','2026-07-10T19:00:00+00',
 'The 2026 ''Trionda'' match ball features an IMU sensor that sends data at what frequency for offside detection?',
 '100 Hz','250 Hz','500 Hz','1,000 Hz',
 'c','The internal sensor provides 500 data points per second to provide extremely precise timing for offside decisions.'),

-- Q30 — Jul 10
('2026-07-10','2026-07-10T19:00:00+00','2026-07-11T19:00:00+00',
 'To accommodate the longer format, single yellow cards are officially cleared after which specific round(s)?',
 'Only after the Group Stage','Only after the Quarter-Finals','Both after the Group Stage AND the Quarter-Finals','They do not clear at any stage in the tournament',
 'c','FIFA adjusted the rules for 2026 to ensure players are less likely to miss the Final due to an accumulation of yellows across a longer tournament.'),

-- Q31 — Jul 11
('2026-07-11','2026-07-11T19:00:00+00','2026-07-12T19:00:00+00',
 'If Cristiano Ronaldo plays in the 2026 tournament, he will be the first player in history to be named in the squad for how many World Cups?',
 '4','5','6','7',
 'c','Ronaldo has been named in every squad since 2006; 2026 would be his historic 6th World Cup cycle.'),

-- Q32 — Jul 12
('2026-07-12','2026-07-12T19:00:00+00','2026-07-13T19:00:00+00',
 'Iraq has qualified for 2026. This marks their first appearance in the tournament since which year?',
 '1994','1986','2006','1978',
 'b','Iraq ended a 40-year drought to qualify for the expanded 48-team tournament.'),

-- Q33 — Jul 13
('2026-07-13','2026-07-13T19:00:00+00','2026-07-14T19:00:00+00',
 'Which manager is leading his 4th different national team at a World Cup in the 2026 cycle?',
 'Carlos Queiroz','Hervé Renard','Guus Hiddink','Roberto Martínez',
 'b','Renard has managed Zambia, Morocco, Saudi Arabia, and now a new side for the 2026 edition.'),

-- Q34 — Jul 14
('2026-07-14','2026-07-14T19:00:00+00','2026-07-15T19:00:00+00',
 '2026 is the first tournament to feature an ''Extra'' 6th substitute specifically for what condition?',
 'Goalkeeper injury','Suspected Concussion','Cramps in Extra Time','Tactical change after 90''',
 'b','Following medical guidelines, teams are allowed an additional sub if a player is suspected of having a concussion.'),

-- Q35 — Jul 15
('2026-07-15','2026-07-15T19:00:00+00','2026-07-16T19:00:00+00',
 'Which nation entering the 2026 tournament holds the record for the most consecutive clean sheets in a single qualifying cycle (840 minutes)?',
 'Brazil','Morocco','France','Japan',
 'b','Morocco set a defensive record during their qualifying run, maintaining a clean sheet for 14 hours of play.'),

-- Q36 — Jul 16
('2026-07-16','2026-07-16T19:00:00+00','2026-07-17T19:00:00+00',
 'Estadio Azteca will set a world record in 2026 as the only stadium to host the Opening Match of how many different World Cups?',
 '2','3','4','5',
 'b','Mexico City''s legendary stadium previously hosted the opening match in 1970 and 1986.'),

-- Q37 — Jul 17
('2026-07-17','2026-07-17T19:00:00+00','2026-07-18T19:00:00+00',
 'How many dedicated cameras are installed in each 2026 stadium specifically to power the ''Semi-Automated Offside'' limb-tracking technology?',
 '6','8','10','12',
 'd','The tracking system uses 12 specialized cameras to follow players'' bodies and the ball.'),

-- Q38 — Jul 18
('2026-07-18','2026-07-18T19:00:00+00','2026-07-19T19:00:00+00',
 'In the group stage tie-breaking ''Fair Play'' system, how many points are deducted from a team''s total for a single direct Red Card?',
 '-1','-3','-4','-5',
 'c','A direct red card carries a 4-point penalty in the Fair Play tie-breaker system.'),

-- Q39 — Jul 19
('2026-07-19','2026-07-19T19:00:00+00','2026-07-20T19:00:00+00',
 'Guillermo Ochoa is in the 2026 squad for his record-breaking 6th World Cup. How many of his previous five tournaments did he actually play minutes in?',
 '5','4','3','2',
 'c','Ochoa was an unused substitute in 2006 and 2010; he played in 2014, 2018, and 2022.'),

-- Q40 — Jul 20
('2026-07-20','2026-07-20T19:00:00+00','2026-07-21T19:00:00+00',
 'What is the maximum travel distance between the two furthest host cities in the 2026 tournament?',
 '3,200 miles','4,500 miles','5,100 miles','2,800 miles',
 'd','The great-circle distance between Vancouver (Canada) and Miami (USA) is approximately 2,800 miles, making it the longest journey between any two 2026 host cities.');
