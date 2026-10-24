/* NextHand prototype: demo data. All people, places, phone numbers and figures are invented.
   Every case is built from what the caller gave on the phone: five keypad presses (`ans`), where the call came from,
   a name and landmark, and a recorded voice message. Title, band and wording on screen are worked out from those. */
window.NHDATA = (function () {
  var MIN = 60, H = 3600;
  return {
    start: 9 * H + 12 * MIN,                                   // Day 1, 09:12
    tiers: ['Local', 'District', 'State', 'National'],
    offerMins: { immediate: 5, urgent: 15, delayed: 480 },      // how long an offer waits before it climbs (placeholders)
    helpLimitMins: { immediate: 60, urgent: 240 },              // time limits for the North Star (assumed)
    staleAfterMins: 120,                                         // a unit status older than this counts as unavailable
    callbackMins: 120,                                           // automated call-back interval
    requestMaxKm: 60,                                            // a partner can only request cases this close
    recordNeeded: { urgent: 3, immediate: 6 },                   // confirmed tasks needed to request each severity (assumed)

    accounts: {
      officer: {
        id: 'officer', first: 'Meera', person: 'Meera Rao', role: 'Duty officer', badge: 'Duty officer',
        org: 'District Disaster Response Force, Raichur', short: 'DDRF Raichur',
        tier: 'District', probation: null, baseDone: 0,
        unitOrgs: ['DDRF Raichur', 'PWD volunteers', 'Fire service', 'Power utility', 'District hospital', 'Sahyog Relief', 'Raichur Rural Aid']
      },
      ngo2: {
        id: 'ngo2', first: 'Farah', person: 'Farah Khan', role: 'Operations lead', badge: 'Verified NGO',
        org: 'Raichur Rural Aid', short: 'Raichur Rural Aid',
        tier: 'Local', probation: null, baseDone: 4,
        unitOrgs: ['Raichur Rural Aid']
      },
      ngo: {
        id: 'ngo', first: 'Imran', person: 'Imran Sheikh', role: 'Field coordinator', badge: 'New NGO',
        org: 'Sahyog Relief Trust', short: 'Sahyog Relief',
        tier: 'Local', probation: { need: 3, vouch: 'District Collector, Raichur' }, baseDone: 0,
        unitOrgs: ['Sahyog Relief']
      }
    },

    // The recorded keypad script. Presses come in this order, most important first, so a dropped line still leaves a case.
    // 0 is always “not sure”.
    script: [
      { key: 'type', q: 'What is the problem?', opts: { 1: 'Fire', 2: 'Medical', 3: 'Flood', 4: 'Gas leak', 5: 'Collapse', 6: 'No supplies', 7: 'Power or water failure', 8: 'Something else' } },
      { key: 'life', q: 'Is anyone’s life at risk?', opts: { 1: 'Unconscious or bleeding', 2: 'Hurt but awake', 3: 'Nobody hurt' } },
      { key: 'worse', q: 'When will it get worse?', opts: { 1: 'Within the hour', 2: 'Today', 3: 'Later' } },
      { key: 'people', q: 'How many people are affected?', opts: { 1: '1 to 5', 2: '6 to 50', 3: '51 to 500', 4: 'More than 500' } },
      { key: 'caller', q: 'Who is calling?', opts: { 1: 'Trapped at the place', 2: 'Safe at the place', 3: 'Reporting for someone else' } }
    ],

    // Cases already in the system when the demo starts. `plan` is what the automated call-backs will hear.
    // ans = [problem, life at risk, gets worse, people, caller]. loc: net = placed by the phone network, pin = PIN code and landmark.
    cases: [
      {
        id: 'NH-0407', place: 'Old market building, Raichur', exact: 'Lane behind the clock tower, ground-floor shop', contact: '+91 00000 11007',
        ans: [5, 1, 1, 2, 3], loc: 'pin', pin: '584101', name: 'Anita', landmark: 'Opposite the clock tower',
        people: 25, sev: 5, chance: 0.9, hours: 3, harmH: 0.5,
        lang: 'Kannada', callers: 1, unconfirmed: true, km: 6, ageMins: 2, offerLeftMins: 3.5, callbackAfter: 60,
        plan: ['same'], needs: ['Medical team', 'Engineers'],
        voice: 'A wall has fallen on the shops. I can hear people calling from under it. I am across the road, I am not hurt.',
        script: ['Do not move anyone who is trapped under heavy material.', 'Keep people back from the leaning wall.', 'Keep this phone free; the responder will ring you.']
      },
      {
        id: 'NH-0408', place: 'District Hospital, Raichur', exact: 'Generator yard, north gate', contact: '+91 00000 11001',
        ans: [7, 3, 2, 4, 2], loc: 'net', name: 'Dr. Prakash', landmark: 'Generator yard, north gate',
        people: 1200, sev: 5, chance: 0.8, hours: 6, harmH: 5.5,
        lang: 'Hindi', callers: 3, unconfirmed: false, km: 12, ageMins: 1, offerLeftMins: 4.4, callbackAfter: 120,
        plan: ['same'], needs: ['Generators', 'Electricians'],
        voice: 'Our only backup generator has fuel for about five and a half hours and the grid keeps dropping. Forty ICU beds depend on it.',
        script: ['Move life-support equipment to the priority circuit.', 'Switch off air conditioning, lifts and spare lighting.', 'Do not refuel while the generator is running.']
      },
      {
        id: 'NH-0409', place: 'Irrigation dam, Raichur', exact: 'Spillway control hut, right bank', contact: '+91 00000 11002',
        ans: [3, 3, 2, 4, 3], loc: 'net', name: 'Lakshmi', landmark: 'Spillway control hut',
        people: 8000, sev: 4, chance: 0.45, hours: 10, harmH: 12,
        lang: 'Kannada', callers: 2, unconfirmed: false, km: 18, ageMins: 3, offerLeftMins: 12, callbackAfter: 120,
        plan: ['none', 'none'], needs: ['Engineers'],
        voice: 'The spillway gates have had no operator for two days and heavy rain is due. Thousands live downstream.',
        script: ['Phone the downstream village head and warn them.', 'Keep people away from the spillway and canal banks.', 'Do not try to operate the gates alone.']
      },
      {
        id: 'NH-0406', place: 'Settlement near Sindhanur, Raichur', exact: 'Relief shed behind the old bus stand', contact: '+91 00000 11003',
        ans: [6, 3, 3, 3, 2], loc: 'net', name: 'Venkat', landmark: 'Old bus stand',
        people: 400, sev: 3, chance: 0.5, hours: 8, harmH: 48,
        lang: 'Telugu', callers: 1, unconfirmed: true, km: 34, ageMins: 20, offerLeftMins: 460, callbackAfter: 360,
        plan: ['worse'], needs: ['Food trucks', 'Volunteers'],
        voice: 'Our usual supplier has stopped coming. We have food for about two days for the whole settlement.',
        script: ['Count people by group: children, elderly, sick.', 'Share remaining food equally and keep clean water for the sick.', 'Agree one safe meeting point for the delivery.']
      },
      {
        id: 'NH-0402', place: 'Relief camp, Manvi, Raichur', exact: 'Camp B, school ground, east gate', contact: '+91 00000 11004',
        ans: [6, 3, 3, 3, 2], loc: 'net', name: 'Zainab', landmark: 'School ground, east gate',
        people: 120, sev: 2, chance: 0.4, hours: 4, harmH: 36,
        lang: 'Kannada', callers: 2, unconfirmed: false, km: 22, ageMins: 50, offerLeftMins: 400, callbackAfter: 360,
        plan: ['same'], needs: ['Water tanks', 'Volunteers'],
        voice: 'There is no drinking water and not enough blankets for a second cold night. Many children here.',
        script: ['Group children and elderly in the driest area.', 'Boil water or use chlorine tablets if you have them.', 'Share blankets between groups.']
      }
    ],

    // A call with “not sure” answers, already waiting at the review desk.
    unclear: {
      id: 'NH-0410', place: 'Central bus stand area, Raichur', exact: 'Not confirmed', contact: '+91 00000 11005',
      ans: [1, 0, 0, 2, 2], loc: 'net', name: 'Not left', landmark: 'Not left',
      people: 20, sev: 4, chance: 0.5, hours: 2, harmH: 12,
      lang: 'Kannada', callers: 1, unconfirmed: true, km: 3, ageMins: 4, callbackAfter: 60,
      plan: ['same'], needs: ['Fire tender'],
      voice: 'Fire… there are children… (the line drops).',
      script: ['Move away from smoke and stay low.', 'Keep children together in one place.']
    },

    // New calls that arrive when you press “Simulate a new call”, in order.
    pool: [
      {
        place: 'Water pumping station, Raichur', exact: 'Control room, pump house 2', contact: '+91 00000 22041',
        ans: [7, 3, 2, 4, 2], loc: 'net', name: 'Ravi', landmark: 'Pump house 2',
        people: 40000, sev: 4, chance: 0.6, hours: 3, harmH: 7,
        lang: 'Kannada', callers: 1, unconfirmed: true, km: 28, ageMins: 0, callbackAfter: 120,
        preset: 'ravi', plan: ['same'], needs: ['Engineers', 'Electricians'],
        voice: 'I am the only operator on shift; five of eight staff are missing. The pressure alarm has been on for twenty minutes. The pumps will stop in about seven hours.',
        script: ['Do not restart a pump that has tripped.', 'Write down the pressure reading every 15 minutes.', 'Keep this phone free for the engineer.']
      },
      {
        place: 'Primary health centre, Lingasugur, Raichur', exact: 'Store room, main road', contact: '+91 00000 22005',
        ans: [2, 2, 2, 2, 2], loc: 'net', name: 'Dr. Sunita', landmark: 'Store room, main road',
        people: 30, sev: 4, chance: 0.5, hours: 3, harmH: 14,
        lang: 'Kannada', callers: 1, unconfirmed: true, km: 54, ageMins: 0, callbackAfter: 120,
        plan: ['same'], needs: ['Medical team'],
        voice: 'We have no insulin for about thirty diabetic patients. The district store has stock but no cold vehicle.',
        script: ['List patients by dose time, earliest first.', 'Keep any remaining insulin in a cool place.', 'Tell patients to avoid heavy exercise until supply arrives.']
      },
      {
        place: 'School shelter, Devadurga, Raichur', exact: 'Hall B, behind the playground', contact: '+91 00000 22007',
        ans: [6, 3, 3, 3, 2], loc: 'net', name: 'Mehboob', landmark: 'Hall B, playground',
        people: 300, sev: 2, chance: 0.4, hours: 4, harmH: 30,
        lang: 'Kannada', callers: 2, unconfirmed: false, km: 41, ageMins: 0, callbackAfter: 360,
        plan: ['same'], needs: ['Water tanks', 'Volunteers'],
        voice: 'Two taps for three hundred people and one has stopped. Drinking water will run out by tomorrow.',
        script: ['Ration water for children, the elderly and the sick first.', 'Boil water before drinking if you can.', 'Keep one person at the working tap to keep the queue calm.']
      },
      {
        place: 'Food depot, Sindhanur, Raichur', exact: 'Depot gate, Station Road', contact: '+91 00000 22006',
        ans: [6, 3, 3, 4, 3], loc: 'pin', pin: '584128', name: 'Gopal', landmark: 'Depot gate, Station Road',
        people: 2500, sev: 2, chance: 0.4, hours: 6, harmH: 40,
        lang: 'Telugu', callers: 3, unconfirmed: false, km: 33, ageMins: 0, callbackAfter: 360,
        plan: ['same'], needs: ['Volunteers', 'Food trucks'],
        voice: 'The depot keeper has gone and the gates are locked. The shops in town are nearly empty.',
        script: ['Do not force the gates; wait for a district officer.', 'List the shops still open and their stock.', 'Set up a queue point away from the depot gate.']
      }
    ],

    units: [
      { id: 'u1', name: 'Generator crew 1', org: 'DDRF Raichur', caps: ['Generators', 'Electricians'], status: 'free', agoMins: 25, reply: 'free' },
      { id: 'u2', name: 'Engineer on call, water works', org: 'PWD volunteers', caps: ['Engineers'], status: 'free', agoMins: 15, reply: 'free' },
      { id: 'u3', name: 'Rescue boat team 2', org: 'DDRF Raichur', caps: ['Boats'], status: 'free', agoMins: 40, reply: 'free' },
      { id: 'u4', name: 'Fire tender 3', org: 'Fire service', caps: ['Fire tender'], status: 'busy', agoMins: 70, reply: 'free' },
      { id: 'u5', name: 'Electrician crew', org: 'Power utility', caps: ['Electricians', 'Engineers'], status: 'free', agoMins: 150, reply: 'free' },
      { id: 'u6', name: 'Medical team A', org: 'District hospital', caps: ['Medical team'], status: 'busy', agoMins: 50, reply: 'busy' },
      { id: 'u7', name: 'Food truck 1', org: 'Sahyog Relief', caps: ['Food trucks', 'Volunteers'], status: 'free', agoMins: 30, reply: 'free' },
      { id: 'u8', name: 'Water tanker', org: 'Sahyog Relief', caps: ['Water tanks', 'Volunteers'], status: 'free', agoMins: 45, reply: 'off' },
      { id: 'u9', name: 'Engineer volunteers', org: 'Raichur Rural Aid', caps: ['Engineers', 'Volunteers'], status: 'free', agoMins: 20, reply: 'free' },
      { id: 'u10', name: 'Mobile clinic', org: 'Raichur Rural Aid', caps: ['Medical team'], status: 'free', agoMins: 35, reply: 'free' },
      { id: 'u11', name: 'Water tanker 2', org: 'Raichur Rural Aid', caps: ['Water tanks', 'Volunteers'], status: 'free', agoMins: 55, reply: 'free' }
    ],

    // Starting point for the duty officer's metrics (invented).
    history: { nsHelped: 15, nsTotal: 18, audited: 20, under: 1, trips: 24, wasted: 6 }
  };
})();
