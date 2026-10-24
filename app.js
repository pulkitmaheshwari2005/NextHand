/* NextHand prototype: the control-room product, seen by three people.
   Duty officer (decides who goes), a verified NGO (can ask for higher-severity cases) and a new NGO on probation.
   Calls and call-backs are automated and happen outside the product; NextHand only shows their results.
   Front-end only: state lives in this browser. */
(function () {
  'use strict';
  var D = window.NHDATA;
  var KEY = 'nexthand_v5';
  var MIN = 60, H = 3600;
  var BANDS = ['immediate', 'urgent', 'delayed'];
  var BAND = { immediate: 'Immediate', urgent: 'Urgent', delayed: 'Delayed' };
  var STEPS = ['Accepted', 'On the way', 'On site', 'Task done'];
  var STAGES = ['Ranked', 'Offered', 'Accepted', 'On the way', 'On site', 'Task done', 'Awaiting call', 'Closed'];
  var ui = { modal: null, flash: null, toasts: [], voice: {} };

  /* ---------- helpers ---------- */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function num(n) { return Math.round(n).toLocaleString('en-IN'); }
  function hm(t) { var s = ((t % 86400) + 86400) % 86400; return pad(Math.floor(s / H)) + ':' + pad(Math.floor(s % H / MIN)); }
  function clock(t) { return 'Day ' + (Math.floor(t / 86400) + 1) + ', ' + hm(t) + ':' + pad(Math.floor(t % 60)); }
  function dur(sec) {
    if (sec <= 0) return '0:00';
    var h = Math.floor(sec / H), m = Math.floor(sec % H / MIN), s = Math.floor(sec % 60);
    return h ? h + ' h ' + pad(m) + ' min' : m + ':' + pad(s);
  }
  function ago(sec) {
    if (sec < MIN) return 'just now';
    var h = Math.floor(sec / H), m = Math.floor(sec % H / MIN);
    return (h ? h + ' h ' : '') + m + ' min ago';
  }
  function hours(h) { var r = Math.round(h * 2) / 2, w = Math.floor(r); return (r % 1 ? (w ? w : '') + '½' : w) + (r === 1 ? ' hour' : ' hours'); }
  function people(n) { return num(n) + (n === 1 ? ' person' : ' people'); }
  function $(s) { return document.querySelector(s); }

  /* ---------- what the caller pressed ---------- */
  var SC = D.script;
  var LIFE_S = { 0: 'life at risk unclear', 1: 'life at risk', 2: 'hurt but awake', 3: 'nobody hurt' };
  var WORSE_S = { 0: 'timing unclear', 1: 'worse within the hour', 2: 'worse today', 3: 'can wait' };
  function ansLabel(c, i) { var k = c.ans[i]; return k === 0 ? 'Not sure' : SC[i].opts[k]; }
  function typeName(c) { return ansLabel(c, 0); }
  function riskLine(c) { return LIFE_S[c.ans[1]] + ' · ' + WORSE_S[c.ans[2]] + ' · ' + (c.ans[3] ? SC[3].opts[c.ans[3]].toLowerCase() + ' people' : 'number unknown'); }
  function ruleBand(a) {
    if (!a[0] || !a[1] || !a[2] || (a[0] === 6 && a[2] === 1)) return 'review';
    if (a[1] === 1) return 'immediate';
    if (a[2] === 1 && [1, 3, 4, 5].indexOf(a[0]) >= 0) return 'immediate';
    if (a[1] === 2 || a[2] <= 2) return 'urgent';
    return 'delayed';
  }
  function ansSummary(c) { return SC.map(function (s, i) { return ansLabel(c, i).toLowerCase(); }).join(', '); }
  function foundBy(c) {
    return c.loc === 'pin' ? 'PIN ' + c.pin + ' and the landmark “' + c.landmark + '”, because the caller reported for someone else.'
      : 'The phone network. Accurate to a few hundred metres in towns and kilometres in villages; the responder confirms the exact place on the call.';
  }

  /* ---------- state ---------- */
  function bandOf(h) { return h < 6 ? 'immediate' : h <= 24 ? 'urgent' : 'delayed'; }
  function addEv(c, t, text) { c.events.push({ t: t, text: text }); }
  function ev(c, text) { addEv(c, S.t, text); }

  function mkCase(tpl, s) {
    var c = clone(tpl);
    c.id = c.id || ('NH-0' + (++s.seq));
    c.created = s.t - (tpl.ageMins || 0) * MIN;
    c.title = typeName(c) + ' at ' + c.place;
    var rb = ruleBand(c.ans);
    c.ruleBand = rb === 'review' ? 'urgent' : rb;
    c.band = c.ruleBand;
    c.tier = c.band === 'delayed' ? 'Local' : 'District';
    c.status = 'offered';
    c.offerExp = s.t + (tpl.offerLeftMins != null ? tpl.offerLeftMins : D.offerMins[c.band]) * MIN;
    c.callbackAt = s.t + (tpl.callbackAfter || D.callbackMins) * MIN;
    c.cbMissed = 0; c.cbIdx = 0; c.step = 0; c.unit = null; c.owner = null; c.expert = false; c.helpedAt = null; c.awaitSince = null; c.left = [];
    c.checked = null; c.goAnyway = false; c.repeats = 0; c.closedWhy = '';
    c.events = [];
    addEv(c, c.created, 'Call received in ' + c.lang + '. The caller pressed: ' + ansSummary(c) + '.');
    addEv(c, c.created + 10, c.loc === 'pin' ? 'Location from the caller: PIN ' + c.pin + ' and the landmark “' + c.landmark + '”.' : 'Location taken from the phone network.');
    if (c.name !== 'Not left') addEv(c, c.created + 20, 'Voice message recorded. ' + c.name + ' left a name and a landmark.');
    if (c.callers > 1) addEv(c, c.created + 30, c.callers + ' calls about the same place merged into one case.');
    addEv(c, c.created + 60, 'Ranked ' + BAND[c.band] + ' by the keypad rule.');
    addEv(c, c.created + 60, 'Offered to the ' + c.tier + ' tier.');
    return c;
  }
  function fresh() {
    var s = {
      v: 5, t: D.start, strikes: {}, running: true, role: 'officer', net: true, tab: 'queue', sel: null,
      seq: 410, cases: [], units: [], hist: clone(D.history), done: { ngo: 0, ngo2: 0 },
      requests: [], reqSeq: 0, pool: 0, walk: { open: true, done: {} }
    };
    D.cases.forEach(function (c) { s.cases.push(mkCase(c, s)); });
    var u = mkCase(D.unclear, s);
    u.status = 'review'; u.offerExp = null; u.events.pop(); u.events.pop();
    addEv(u, u.created + 60, 'Two keypad answers were “not sure”, so the rule cannot place it. It defaulted to Urgent and went to the review desk.');
    s.cases.push(u);
    D.units.forEach(function (x) { var y = clone(x); y.at = s.t - x.agoMins * MIN; delete y.agoMins; y.replyAt = null; s.units.push(y); });
    return s;
  }
  function load() {
    try { var v = JSON.parse(localStorage.getItem(KEY)); if (v && v.v === 5) return v; } catch (e) { /* private mode */ }
    return fresh();
  }
  var S = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } }

  function acct(role) { return D.accounts[role || S.role]; }
  function byId(id) { for (var i = 0; i < S.cases.length; i++) if (S.cases[i].id === id) return S.cases[i]; return null; }
  function unit(id) { for (var i = 0; i < S.units.length; i++) if (S.units[i].id === id) return S.units[i]; return null; }
  function tasksDone(role) { return acct(role).baseDone + (S.done[role] || 0); }
  function isProbation(a) { return !!a.probation && tasksDone(a.id) < a.probation.need; }
  function toast(text, kind) {
    var t = { text: text, kind: kind || '' };
    ui.toasts.push(t);
    setTimeout(function () { ui.toasts = ui.toasts.filter(function (x) { return x !== t; }); drawToasts(); }, 4600);
    drawToasts();
  }

  /* ---------- ordering (the screens show rank, never the maths) ---------- */
  function waitedH(c) { return Math.max(0, (S.t - c.created) / H); }
  function prio(c) { return c.people * c.sev * c.chance / c.hours * (1 + 0.05 * waitedH(c)) * (c.unconfirmed && c.band === 'immediate' ? 0.6 : 1); }
  function rankSort(a, b) { return BANDS.indexOf(a.band) - BANDS.indexOf(b.band) || prio(b) - prio(a); }

  function offeredToMe(c) { var a = acct(); return c.status === 'offered' && c.tier === a.tier && (!isProbation(a) || c.band === 'delayed'); }
  function myTask(c) { return c.owner === S.role && (c.status === 'active' || c.status === 'awaiting'); }
  function partnerTask(c) { return S.role === 'officer' && c.owner && c.owner !== 'officer' && (c.status === 'active' || c.status === 'awaiting'); }
  function visible(c) { return offeredToMe(c) || myTask(c) || partnerTask(c); }
  function canSeeExact(c) { return !isProbation(acct()) || myTask(c) || c.status === 'closed'; }

  function whyText(c) {
    var a = c.ans, why;
    if (a[1] === 1) why = 'someone is unconscious or bleeding';
    else if (c.ruleBand === 'immediate') why = 'it gets worse within the hour and the problem is ' + typeName(c).toLowerCase();
    else if (c.ruleBand === 'urgent') why = a[1] === 2 ? 'someone is hurt but awake' : 'it gets worse ' + (a[2] === 1 ? 'within the hour' : 'today');
    else why = 'nobody is hurt and it can wait';
    var who = c.callers > 1 ? c.callers + ' callers agree.' : c.unconfirmed ? 'Only one caller so far, so it is flagged unconfirmed' + (c.band === 'immediate' ? ' and ranks a little lower until it is confirmed.' : '.') : 'One caller.';
    var up = waitedH(c) >= 0.5 ? ' It has waited ' + Math.round(waitedH(c) * 60) + ' minutes, which lifts it up the list.' : '';
    var moved = c.band !== c.ruleBand ? ' The keypad rule said ' + BAND[c.ruleBand] + '; a later call changed it.' : '';
    return BAND[c.ruleBand] + ' by the keypad rule: ' + why + '. ' + (c.ans[3] ? SC[3].opts[c.ans[3]] + ' people are affected. ' : '') + who + moved + up;
  }
  function stageIndex(c) {
    if (c.status === 'review') return 0;
    if (c.status === 'offered' || c.status === 'national') return 1;
    if (c.status === 'active') return 1 + c.step;
    if (c.status === 'awaiting') return 6;
    return 8;
  }
  function nowText(c) {
    var o = c.owner ? acct(c.owner).short : '';
    if (c.status === 'review') return 'With the review desk. A supervisor is checking the keypad answers.';
    if (c.status === 'offered') return 'Offered to the ' + c.tier + ' tier. <b data-cd="' + c.offerExp + '">' + dur(c.offerExp - S.t) + '</b> left to respond.';
    if (c.status === 'national') return 'With the national desk, who assign it by hand.';
    if (c.status === 'active') return o + ': ' + STEPS[c.step - 1].toLowerCase() + '.';
    if (c.status === 'awaiting') return 'Awaiting confirmation: an automated call went to the caller at ' + hm(c.awaitSince) + '.';
    return c.closedWhy ? 'Closed: ' + c.closedWhy + '.' : 'Closed. The caller confirmed it is fixed.';
  }
  function tracker(c) {
    var cur = stageIndex(c);
    return '<div class="stages" role="list" aria-label="Where this case is">' + STAGES.map(function (s, i) {
      var cls = i < cur ? 'done' : i === cur ? 'now' : '';
      var sub = i === 1 && (c.status === 'offered' || c.status === 'national') ? '<small>' + esc(c.tier) + '</small>' : i === 2 && c.owner ? '<small>' + esc(acct(c.owner).short) + '</small>' : '';
      return '<div class="stage ' + cls + '" role="listitem"><i></i><span>' + esc(s) + '</span>' + sub + '</div>';
    }).join('') + '</div><p class="nowline">' + nowText(c) + '</p>';
  }

  /* ---------- units ---------- */
  function unitState(u) {
    if (u.replyAt) return 'waiting';
    if (S.t - u.at > D.staleAfterMins * MIN) return 'stale';
    return u.status;
  }
  function myUnits(role) { var orgs = acct(role).unitOrgs; return S.units.filter(function (u) { return orgs.indexOf(u.org) >= 0; }); }
  function matchUnit(c, role) {
    var best = null, bestScore = 0;
    myUnits(role).forEach(function (u) {
      if (unitState(u) !== 'free') return;
      var score = c.needs.reduce(function (s, k, i) { return s + (u.caps.indexOf(k) >= 0 ? (i === 0 ? 2 : 1) : 0); }, 0);
      if (score > bestScore) { best = u; bestScore = score; }
    });
    return best;
  }
  function sendCheck() {
    var us = myUnits();
    us.forEach(function (u, i) { u.replyAt = S.t + 3 + i * 2; });
    toast('Status check sent by SMS to ' + us.length + ' units. They reply 1 free, 2 busy, 3 off duty.');
  }

  /* ---------- timed events ---------- */
  function nextEvent() {
    var best = null;
    function consider(at, k, x) { if (at != null && (!best || at < best.at)) best = { at: at, k: k, x: x }; }
    S.cases.forEach(function (c) {
      if (c.status === 'offered') consider(c.offerExp, 'expire', c);
      if (c.callbackAt && c.status !== 'closed' && c.status !== 'awaiting' && c.status !== 'review') consider(c.callbackAt, 'cbdue', c);
    });
    S.units.forEach(function (u) { consider(u.replyAt, 'reply', u); });
    return best;
  }
  function advance(to) {
    var changed = false, guard = 0;
    for (;;) {
      var e = nextEvent();
      if (!e || e.at > to || guard++ > 400) break;
      S.t = Math.max(S.t, e.at);
      if (e.k === 'expire') climb(e.x, null, true);
      else if (e.k === 'cbdue') autoCallback(e.x);
      else { e.x.replyAt = null; e.x.status = e.x.reply || 'free'; e.x.at = S.t; }
      changed = true;
    }
    S.t = Math.max(S.t, to);
    return changed;
  }

  function climb(c, reason, auto) {
    var i = D.tiers.indexOf(c.tier), from = c.tier;
    c.left = (c.left || []).concat([from]);
    if (i >= D.tiers.length - 1) {
      c.status = 'national'; c.offerExp = null;
      ev(c, (auto ? 'No response at the National tier' : 'Declined at the National tier') + '. The national desk now assigns it by hand.');
      return;
    }
    var to = D.tiers[i + 1];
    closeRequests(c, 'The case moved up to the ' + to + ' tier.');
    c.tier = to; c.offerExp = S.t + D.offerMins[c.band] * MIN;
    ev(c, (auto ? 'No response before the offer ran out' : 'Declined by ' + acct().short + '. Reason: ' + reason) + '. Moved from ' + from + ' to ' + to + ' tier' + (S.net ? '' : ', sent by SMS') + '.');
    if (to === 'National') ev(c, 'National desk notified.');
    if (auto) toast(c.title + ': nobody responded in time, so it moved to the ' + to + ' tier.', 'warn');
  }
  function worsen(c, why) {
    var i = BANDS.indexOf(c.band);
    if (i === 0) { ev(c, why + '. Already Immediate.'); return false; }
    var old = c.band; c.band = BANDS[i - 1];
    c.harmH = c.band === 'immediate' ? Math.min(c.harmH, 4) : Math.min(c.harmH, 12);
    ev(c, why + '. Raised from ' + BAND[old] + ' to ' + BAND[c.band] + '.');
    if (c.status === 'offered') {
      if (c.tier === 'Local') { c.left = (c.left || []).concat(['Local']); c.tier = 'District'; ev(c, 'Now above the Local tier, so it moved to the District tier.'); }
      c.offerExp = Math.min(c.offerExp || Infinity, S.t + D.offerMins[c.band] * MIN);
    }
    ui.flash = c.id;
    return true;
  }
  function autoCallback(c) {
    var out = (c.plan && c.plan[c.cbIdx]) || 'same'; c.cbIdx++;
    if (out === 'same') {
      c.cbMissed = 0; c.callbackAt = S.t + D.callbackMins * MIN;
      var last = c.events[c.events.length - 1];
      if (last && last.text.indexOf('Automated call-back: the caller pressed 1') === 0) { last.text = 'Automated call-back: the caller pressed 1, nothing has changed (checked again at ' + hm(S.t) + ').'; last.t = S.t; }
      else ev(c, 'Automated call-back: the caller pressed 1, nothing has changed.');
    } else if (out === 'worse') {
      c.cbMissed = 0;
      ev(c, 'Automated call-back: the caller pressed 2, it is getting worse.');
      var up = worsen(c, 'Re-ranked after the call-back'); c.callbackAt = S.t + D.callbackMins * MIN;
      toast('Call-back: ' + c.title + ' is getting worse' + (up ? ', raised to ' + BAND[c.band] + '.' : '.'), 'warn');
    } else {
      c.cbMissed++;
      ev(c, 'Automated call-back not answered (' + c.cbMissed + ' missed).');
      if (c.cbMissed >= 2) {
        c.cbMissed = 0;
        if (c.band !== 'delayed' && !c.goAnyway) {
          c.goAnyway = true; ui.flash = c.id;
          ev(c, 'Caller unreachable twice. The unit goes anyway and asks locally for ' + c.name + ' near “' + c.landmark + '”.');
          toast('Caller not reachable for ' + c.title + '. The unit goes anyway and asks locally.', 'warn');
        }
      }
      c.callbackAt = S.t + 30 * MIN;
    }
  }

  /* ---------- responder actions ---------- */
  function accept(id) {
    var c = byId(id); if (!c || !offeredToMe(c)) return;
    var u = matchUnit(c);
    declineOthers(c, 'The case was taken by ' + acct().short + '.');
    c.status = 'active'; c.owner = S.role; c.step = 1; c.offerExp = null;
    if (u) { u.status = 'busy'; u.at = S.t; c.unit = u.id; }
    ev(c, 'Accepted by ' + acct().short + (u ? '. ' + u.name + ' assigned' : '. No matching unit is free, so the team sources one') + (S.net ? '.' : ', by SMS.'));
    toast('Accepted. The exact place and caller’s number are now visible.', 'good');
    S.sel = id;
  }
  function stepUp(id) {
    var c = byId(id); if (!c || c.status !== 'active') return;
    c.step = Math.min(3, c.step + 1);
    if (c.step === 3 && !c.helpedAt) c.helpedAt = S.t;
    ev(c, STEPS[c.step - 1] + '.');
  }
  function closeCase(c, countNs) {
    c.status = 'closed';
    var u = unit(c.unit); if (u) { u.status = 'free'; u.at = S.t; }
    if (countNs && c.band !== 'delayed') {
      S.hist.nsTotal++;
      if (c.helpedAt && c.helpedAt - c.created <= D.helpLimitMins[c.band] * MIN) S.hist.nsHelped++;
    }
  }
  function finish(id, wasted) {
    var c = byId(id); if (!c) return;
    S.hist.trips++;
    if (wasted) {
      S.hist.wasted++;
      ev(c, 'Nothing to do on arrival. Counted as a wasted trip.');
      closeCase(c, false);
      toast('Logged as a wasted trip.', 'warn');
      return;
    }
    c.status = 'awaiting'; c.step = 4; c.awaitSince = S.t;
    ev(c, 'Task done. An automated call has gone to the caller to confirm the fix.');
    toast('Done. The case is now awaiting confirmation from the caller.', 'good');
  }
  function reply(id, res) {
    var c = byId(id); if (!c || c.status !== 'awaiting') return;
    if (res === 'yes') {
      ev(c, 'The caller pressed 1: help arrived and it is fixed. Case closed.');
      closeCase(c, true);
      if (S.done[c.owner] !== undefined) {
        S.done[c.owner]++;
        var a = acct(c.owner);
        if (a.probation && tasksDone(c.owner) === a.probation.need) toast(a.short + ' finished probation and is now a verified responder.', 'good');
      }
      S.walk.done.confirmed = true;
      toast('Confirmed by the caller. Case closed.', 'good');
    } else if (res === 'no') {
      c.status = 'active'; c.step = 3; c.awaitSince = null;
      ev(c, 'The caller pressed 2: it is not fixed. Case reopened for ' + acct(c.owner).short + '.');
      toast('Not fixed. The case is open again for the team.', 'warn');
    } else {
      ev(c, 'The confirmation call was not answered. The system will call again.');
      toast('No answer. The case stays open until the caller confirms.');
    }
  }
  function callExpert(id) {
    var c = byId(id); if (!c || c.expert) return;
    c.expert = true; if (!c.helpedAt) c.helpedAt = S.t + 2 * MIN;
    ev(c, 'Expert joined the caller’s line through the phone bridge.');
    toast('An expert is joining the caller’s line.', 'good');
  }
  function reviewSet(id, band, note) {
    var c = byId(id); if (!c) return;
    S.hist.audited++;
    if (band === 'immediate') S.hist.under++;
    c.band = band; c.status = 'offered';
    c.tier = band === 'delayed' ? 'Local' : 'District';
    c.offerExp = S.t + D.offerMins[band] * MIN;
    ev(c, 'Review desk set the band to ' + BAND[band] + (band === 'urgent' ? ' (kept the default)' : ' (default was Urgent)') + (note ? ': ' + note : '') + '. Offered to the ' + c.tier + ' tier.');
    toast(band === 'immediate' ? 'Raised to Immediate. The audit counts this as a miss.' : 'Band set to ' + BAND[band] + '.', band === 'immediate' ? 'warn' : 'good');
  }
  function verify(id, o, place) {
    var c = byId(id); if (!c || c.status !== 'active' || c.checked) return;
    if (place && place !== c.exact) { ev(c, 'Exact place corrected on the call: ' + place + '.'); c.exact = place; }
    var who = 'Responder phoned ' + c.name + ' (' + c.contact + '): ';
    if (o === 'confirmed') { c.checked = 'Confirmed'; c.unconfirmed = false; ev(c, who + 'confirmed what was reported.'); toast('Recorded: confirmed.', 'good'); }
    else if (o === 'up') { c.checked = 'Worse than reported'; c.unconfirmed = false; ev(c, who + 'it is worse than reported.'); worsen(c, 'Band raised after the responder call'); toast('Recorded: worse than reported. The band went up.', 'warn'); }
    else if (o === 'down') {
      c.checked = 'Less serious'; c.unconfirmed = false; var i = BANDS.indexOf(c.band);
      if (i < 2) { var old = c.band; c.band = BANDS[i + 1]; ev(c, who + 'less serious than reported. Lowered from ' + BAND[old] + ' to ' + BAND[c.band] + '.'); }
      else ev(c, who + 'less serious than reported. Already Delayed.');
      toast('Recorded: less serious than reported.', 'good');
    } else {
      c.checked = 'Not genuine'; c.closedWhy = 'the responder found the report was not genuine';
      S.strikes[c.contact] = (S.strikes[c.contact] || 0) + 1;
      ev(c, who + 'not genuine. A strike is recorded against ' + c.contact + '.');
      S.hist.trips++; S.hist.wasted++; closeCase(c, false);
      toast('Marked not genuine. The case is closed and the number has a strike.', 'warn');
    }
  }
  function repeatCall() {
    var open = S.cases.filter(function (c) { return (c.status === 'offered' || c.status === 'active') && c.repeats < 2; }).sort(rankSort);
    var pick = open.filter(function (c) { return c.band !== 'immediate'; })[0] || open[0];
    if (!pick) { toast('No open case to repeat a call on.'); return; }
    var c = pick;
    if (c.repeats === 0) {
      c.repeats = 1; c.callers++; c.unconfirmed = false;
      ev(c, 'A second caller phoned about the same place and pressed the same answers. Merged into this case; it is no longer unconfirmed.');
      toast('Repeat call merged into ' + c.title + '. Same answers, so the band stays ' + BAND[c.band] + '.', 'good');
    } else {
      c.repeats = 2;
      var a = c.ans.slice();
      if (a[2] > 1) a[2]--; else if (a[1] > 1) a[1]--;
      var nb = ruleBand(a);
      c.ans = a;
      ev(c, 'The same number called again and the answers had worsened (' + riskLine(c) + ').');
      if (nb !== 'review' && BANDS.indexOf(nb) < BANDS.indexOf(c.band)) {
        var old = c.band; c.band = nb; c.ruleBand = nb;
        ev(c, 'Raised from ' + BAND[old] + ' to ' + BAND[nb] + '.');
        if (c.status === 'offered') { if (c.tier === 'Local') { c.left = (c.left || []).concat(['Local']); c.tier = 'District'; ev(c, 'Now above the Local tier, so it moved to the District tier.'); } c.offerExp = Math.min(c.offerExp || Infinity, S.t + D.offerMins[nb] * MIN); }
        ui.flash = c.id; toast('Repeat call with worse answers: ' + c.title + ' is now ' + BAND[nb] + '.', 'warn');
      } else toast('Repeat call recorded on ' + c.title + '. The band did not change.', 'good');
    }
  }
  function addNewCase() {
    if (S.pool >= D.pool.length) { toast('No more demo calls. Use “Reset demo” to start over.'); return; }
    var tpl = D.pool[S.pool++], c = mkCase(tpl, S);
    S.cases.push(c); ui.flash = c.id;
    if (tpl.preset === 'ravi') S.walk.done.arrived = true;
    toast('New call: ' + c.title + '. Ranked ' + BAND[c.band] + ', offered to the ' + c.tier + ' tier.', 'good');
  }

  /* ---------- requests for higher-severity cases ---------- */
  function requestable(c) { return (c.band === 'urgent' || c.band === 'immediate') && c.status === 'offered' && c.tier === 'District'; }
  function pendingReqs() { return S.requests.filter(function (r) { return r.status === 'pending'; }); }
  function reqFor(c, role) { var f = null; S.requests.forEach(function (r) { if (r.caseId === c.id && r.role === role && r.status === 'pending') f = r; }); return f; }
  function evalRequest(r) {
    var c = byId(r.caseId), a = acct(r.role), done = tasksDone(r.role), need = D.recordNeeded[c.band], u = matchUnit(c, r.role);
    var checks = [
      { ok: !isProbation(a), text: !isProbation(a) ? 'Verified responder' : 'Still on probation' },
      { ok: done >= need, text: done + ' confirmed tasks; ' + need + ' needed for ' + BAND[c.band] + ' cases' },
      { ok: !!u, text: u ? 'Free unit with the right kit: ' + u.name : 'No free unit with ' + c.needs.join(' or ') },
      { ok: c.km <= D.requestMaxKm, text: 'Case is ' + c.km + ' km away (limit ' + D.requestMaxKm + ' km)' },
      { ok: c.status === 'offered', text: c.status === 'offered' ? 'Case is still unassigned' : 'Case has already moved on' }
    ];
    var bad = checks.filter(function (x) { return !x.ok; });
    return { checks: checks, ok: !bad.length, first: bad.length ? bad[0].text : '' };
  }
  function sendRequest(caseId, text) {
    var c = byId(caseId); if (!c || !requestable(c) || reqFor(c, S.role)) return;
    var r = { id: 'RQ-' + (++S.reqSeq), caseId: caseId, role: S.role, text: text.trim(), at: S.t, status: 'pending', note: '' };
    S.requests.push(r);
    ev(c, acct().short + ' asked to take this ' + BAND[c.band] + ' case: “' + r.text + '”');
    if (S.role === 'ngo2') S.walk.done.requested = true;
    toast('Request sent. The duty officer will review it.', 'good');
  }
  function declineOthers(c, why, exceptId) {
    S.requests.forEach(function (r) {
      if (r.caseId === c.id && r.status === 'pending' && r.id !== exceptId) { r.status = 'declined'; r.note = why; r.decidedAt = S.t; ev(c, 'Request from ' + acct(r.role).short + ' closed: ' + why); }
    });
  }
  function closeRequests(c, why) {
    S.requests.forEach(function (r) {
      if (r.caseId === c.id && r.status === 'pending') { r.status = 'expired'; r.note = why; r.decidedAt = S.t; ev(c, 'Request from ' + acct(r.role).short + ' closed: ' + why); }
    });
  }
  function decideRequest(id, approve, note) {
    var r = null; S.requests.forEach(function (x) { if (x.id === id) r = x; });
    if (!r || r.status !== 'pending') return;
    var c = byId(r.caseId), who = acct(r.role).short;
    if (!approve) {
      r.status = 'declined'; r.note = note; r.decidedAt = S.t;
      ev(c, 'Request from ' + who + ' declined by ' + acct('officer').short + ': ' + note);
      toast('Declined. ' + who + ' will see your reason.', 'warn'); return;
    }
    if (c.status !== 'offered') { r.status = 'expired'; r.note = 'The case had already moved on.'; r.decidedAt = S.t; toast('That case has already moved on.', 'warn'); return; }
    var u = matchUnit(c, r.role);
    r.status = 'approved'; r.note = note; r.decidedAt = S.t;
    declineOthers(c, 'The case was given to ' + who + '.', r.id);
    c.status = 'active'; c.owner = r.role; c.step = 1; c.offerExp = null;
    if (u) { u.status = 'busy'; u.at = S.t; c.unit = u.id; }
    ev(c, 'Request from ' + who + ' approved by ' + acct('officer').short + (note ? ': ' + note : '') + (u ? '. ' + u.name + ' assigned.' : '.'));
    S.walk.done.approved = true;
    toast('Approved. ' + who + ' now holds this case.', 'good');
  }
  function withdrawRequest(id) {
    S.requests.forEach(function (r) {
      if (r.id === id && r.status === 'pending') { r.status = 'withdrawn'; r.decidedAt = S.t; ev(byId(r.caseId), acct(r.role).short + ' withdrew its request.'); }
    });
    toast('Request withdrawn.');
  }

  /* ---------- metrics ---------- */
  function pct(a, b) { return b ? Math.round(a / b * 1000) / 10 : 0; }

  /* ---------- rendering ---------- */
  function render() { drawRail(); drawMain(); drawModal(); drawToasts(); ui.flash = null; save(); }

  function drawRail() {
    var pend = pendingReqs().length;
    $('#rail').innerHTML =
      '<div class="brand"><span class="mark" aria-hidden="true">N</span><div><b>NextHand</b><span>Raichur control room</span></div></div>' +
      '<nav class="roles" aria-label="Who is using NextHand"><p class="rl">Using NextHand as</p>' + ['officer', 'ngo2', 'ngo'].map(function (r) {
        var a = D.accounts[r], badge = r === 'officer' && S.role !== 'officer' && pend ? '<i class="bd" title="Requests waiting">' + pend + '</i>' : '';
        return '<button class="role' + (S.role === r ? ' on' : '') + '" data-a="role" data-v="' + r + '" aria-pressed="' + (S.role === r) + '"><b>' + esc(a.badge) + '</b><span>' + esc(a.person) + ', ' + esc(a.short) + '</span>' + badge + '</button>';
      }).join('') + '</nav>' +
      '<div class="clockbox"><span>Control-room clock</span><b data-clock>' + clock(S.t) + '</b></div>' +
      '<details class="demo"' + (window.innerWidth > 900 ? ' open' : '') + '><summary>Demo controls</summary><p>Not part of the product. They let you see the clock-driven parts quickly.</p><div class="dgrid">' +
      '<button class="wide" data-a="newcase">Simulate a new call' + (D.pool.length - S.pool ? ' (' + (D.pool.length - S.pool) + ' left)' : '') + '</button>' +
      '<button class="wide" data-a="repeat">Simulate a repeat call</button>' +
      '<button data-a="pause">' + (S.running ? 'Pause clock' : 'Start clock') + '</button>' +
      '<button data-a="ff" data-s="600">+10 min</button><button data-a="ff" data-s="3600">+1 hour</button><button data-a="ff" data-s="10800">+3 hours</button>' +
      '<button class="' + (S.net ? '' : 'warn') + '" data-a="net" aria-pressed="' + (!S.net) + '">' + (S.net ? 'Network is up' : 'Network is down') + '</button>' +
      '<button class="wide" data-a="reset">Reset demo</button></div></details>';
  }

  function tabsBar(items) {
    return '<div class="tabs" role="tablist">' + items.map(function (t) {
      return '<button role="tab" class="tab' + (S.tab === t[0] ? ' on' : '') + '" aria-selected="' + (S.tab === t[0]) + '" data-a="tab" data-tab="' + t[0] + '">' + esc(t[1]) + (t[2] != null ? ' <i>' + esc(t[2]) + '</i>' : '') + '</button>';
    }).join('') + '</div>';
  }

  var WALK = [
    ['arrived', 'Simulate a new call: a pumping-station case arrives, already ranked', null, 'newcase'],
    ['requested', 'As the verified NGO, request that Urgent case', 'ngo2'],
    ['approved', 'As the duty officer, review the request and approve it', 'officer'],
    ['confirmed', 'As the NGO, finish the task, then play the caller’s reply', 'ngo2'],
    ['declined', 'As the duty officer, decline the dam case with a reason you type', 'officer'],
    ['ngo', 'Open the new NGO view to see what probation hides', 'ngo']
  ];
  function walkBar() {
    var done = S.walk.done, n = WALK.filter(function (w) { return done[w[0]]; }).length;
    if (!S.walk.open) return '<div class="walk shut"><button class="lnk" data-a="walk">Show the two-minute tour (' + n + ' of ' + WALK.length + ' done)</button></div>';
    return '<section class="walk"><div class="walk-h"><b>Two-minute tour</b><span>' + n + ' of ' + WALK.length + ' done</span><button class="lnk" data-a="walk">Hide</button></div><ol>' +
      WALK.map(function (w) {
        var btn = done[w[0]] ? '' : w[3] ? '<button class="go" data-a="' + w[3] + '">Simulate a call</button>' : '<button class="go" data-a="role" data-v="' + w[2] + '">Switch to ' + { officer: 'duty officer', ngo2: 'verified NGO', ngo: 'new NGO' }[w[2]] + '</button>';
        return '<li class="' + (done[w[0]] ? 'ok' : '') + '"><span>' + esc(w[1]) + '</span>' + btn + '</li>';
      }).join('') + '</ol></section>';
  }

  function drawMain() {
    var a = acct();
    var offers = S.cases.filter(offeredToMe).sort(rankSort), tasks = S.cases.filter(myTask).sort(rankSort);
    var partner = S.cases.filter(partnerTask).sort(rankSort), review = S.cases.filter(function (c) { return c.status === 'review'; });
    var freeN = myUnits().filter(function (u) { return unitState(u) === 'free'; }).length, pend = pendingReqs();
    var tabsList;
    if (S.role === 'officer') tabsList = [['queue', 'Help needed', offers.length], ['requests', 'Requests', pend.length], ['review', 'Review desk', review.length], ['units', 'Units', freeN + ' free']];
    else tabsList = [['queue', 'Help needed', offers.length], ['higher', 'Higher severity', isProbation(a) ? 'locked' : S.cases.filter(requestable).length], ['units', 'Units', freeN + ' free']];
    if (!tabsList.some(function (t) { return t[0] === S.tab; })) S.tab = 'queue';

    var first = offers[0];
    var greet = '<header class="greet"><h1>' + (isProbation(a) ? 'Welcome, ' : 'Good morning, ') + esc(a.first) + '.</h1><p>' + greetText(a, offers, tasks, pend) + '</p></header>';
    var banner = '';
    if (!S.net) banner += '<div class="banner down"><b>Network is down.</b> Offers go out by SMS (reply 1 to accept, 2 to decline) and district rooms relay by radio.</div>';
    if (isProbation(a)) {
      var d = tasksDone(a.id);
      banner += '<div class="banner prob"><b>Probation: ' + d + ' of ' + a.probation.need + ' confirmed tasks.</b> You see Delayed cases only, and the exact place and caller’s number unlock after you accept. Vouched for by the ' + esc(a.probation.vouch) + '. Finish ' + (a.probation.need - d) + ' more to become a verified responder, who can ask for higher-severity cases.</div>';
    }
    var body;
    if (S.tab === 'queue') {
      var cur = S.sel ? byId(S.sel) : null;
      var selId = cur && (visible(cur) || (cur.status === 'closed' && cur.owner === S.role)) ? S.sel : (first ? first.id : tasks[0] ? tasks[0].id : partner[0] ? partner[0].id : null);
      var list = (first ? hero(first) : '') + (offers.length > 1 ? section('Also waiting', offers.slice(1), 'offer', '', 2) : '') +
        (!first ? '<p class="empty big">' + (isProbation(a) ? 'No Delayed cases right now. Higher-severity cases go to verified responders.' : 'Nothing is waiting for a decision. New cases appear here the moment a call is ranked.') + '</p>' : '') +
        section('Your tasks', tasks, 'task') + section('With partner responders', partner, 'partner');
      body = '<div class="split"><div class="list">' + list + '</div><div class="detail">' + (selId ? caseDetail(byId(selId)) : '<p class="empty pad">Pick a case to see where it stands.</p>') + '</div></div>';
    } else if (S.tab === 'requests') {
      body = requestsView();
    } else if (S.tab === 'higher') {
      body = higherView(a);
    } else if (S.tab === 'review') {
      var rsel = byId(S.sel) && byId(S.sel).status === 'review' ? byId(S.sel) : review[0];
      body = '<div class="split"><div class="list">' + section('Unclear calls, ranked Urgent for now', review, 'review', 'Nothing to review. Calls with a “not sure” keypad answer land here.') + '</div><div class="detail">' +
        (rsel ? reviewDetail(rsel) : '<p class="empty pad">When a caller is unsure about a keypad answer, the call lands here for a supervisor.</p>') + '</div></div>';
    } else {
      body = unitsView(myUnits());
    }
    $('#main').innerHTML = walkBar() + greet + (S.role === 'officer' ? officerTiles() : ngoTiles(a, tasks, pend)) + banner + tabsBar(tabsList) + body;
  }
  function greetText(a, offers, tasks, pend) {
    if (S.role === 'officer') {
      var t = offers.length ? (offers.length === 1 ? '1 case needs' : offers.length + ' cases need') + ' a decision. The most urgent has <b data-cd="' + offers[0].offerExp + '">' + dur(offers[0].offerExp - S.t) + '</b> left.' : 'Nothing is waiting for a decision.';
      var mine = pend.length ? ' ' + (pend.length === 1 ? '1 request from a partner waits' : pend.length + ' requests from partners wait') + ' for your review.' : '';
      return t + mine;
    }
    if (isProbation(a)) return 'You are on probation, so you only see Delayed cases for now.';
    var n = S.cases.filter(requestable).length;
    return (offers.length ? offers.length + ' Local-tier case' + (offers.length === 1 ? ' is' : 's are') + ' open to you. ' : 'No Local-tier cases are open to you. ') + (n ? n + ' higher-severity case' + (n === 1 ? '' : 's') + ' can be requested.' : 'No higher-severity cases are open for requests.');
  }
  function officerTiles() {
    var h = S.hist, ns = pct(h.nsHelped, h.nsTotal), ut = pct(h.under, h.audited), wt = pct(h.wasted, h.trips);
    return '<div class="tiles">' +
      '<div class="tile t-blue"><span class="v">' + ns + '%</span><span class="l">Life-threatening cases helped in time</span><span class="n">' + h.nsHelped + ' of ' + h.nsTotal + ' this week · goal 85%</span><span class="bar"><i style="width:' + Math.min(100, ns) + '%"></i></span></div>' +
      '<div class="tile ' + (ut <= 5 ? 't-ok' : 't-bad') + '"><span class="v">' + ut + '%</span><span class="l">Cases ranked too low, found in audits</span><span class="n">' + h.under + ' of ' + h.audited + ' audited · limit 5%</span><span class="bar"><i style="width:' + Math.min(100, ut * 5) + '%"></i></span></div>' +
      '<div class="tile ' + (wt <= 30 ? 't-ok' : 't-bad') + '"><span class="v">' + wt + '%</span><span class="l">Trips with nothing to do</span><span class="n">' + h.wasted + ' of ' + h.trips + ' trips · limit 30%</span><span class="bar"><i style="width:' + Math.min(100, wt * 2) + '%"></i></span></div></div>';
  }
  function ngoTiles(a, tasks, pend) {
    var d = tasksDone(a.id), mine = S.requests.filter(function (r) { return r.role === S.role; });
    var inReview = mine.filter(function (r) { return r.status === 'pending'; }).length, approved = mine.filter(function (r) { return r.status === 'approved'; }).length;
    return '<div class="tiles"><div class="tile t-blue"><span class="v">' + d + '</span><span class="l">Confirmed tasks</span><span class="n">' + (isProbation(a) ? a.probation.need + ' needed to finish probation' : 'Verified responder') + '</span></div>' +
      '<div class="tile t-ok"><span class="v">' + inReview + '</span><span class="l">Requests in review</span><span class="n">' + approved + ' approved so far</span></div>' +
      '<div class="tile t-ok"><span class="v">' + tasks.length + '</span><span class="l">Your open tasks</span><span class="n">' + (tasks.length ? 'See them under Help needed' : 'None right now') + '</span></div></div>';
  }
  function row(c, mode, rank) {
    var sel = S.sel === c.id ? ' sel' : '', fl = ui.flash === c.id ? ' arrive' : '', right = '';
    if (mode === 'offer') right = '<span class="cd">Respond in <b data-cd="' + c.offerExp + '">' + dur(c.offerExp - S.t) + '</b></span>';
    else if (mode === 'task') right = '<span class="st">' + (c.status === 'awaiting' ? 'Awaiting confirmation' : STEPS[c.step - 1]) + '</span>';
    else if (mode === 'partner') right = '<span class="st">' + esc(acct(c.owner).short) + ': ' + (c.status === 'awaiting' ? 'awaiting confirmation' : STEPS[c.step - 1].toLowerCase()) + '</span>';
    else if (mode === 'review') right = '<span class="st">Needs a supervisor</span>';
    return '<li class="row r-' + c.band + sel + fl + '"><button class="rowbtn' + (rank ? '' : ' nr') + '" data-a="open" data-id="' + c.id + '">' +
      (rank ? '<span class="rk">#' + rank + '</span>' : '') + '<span class="band b-' + c.band + '">' + BAND[c.band] + '</span>' +
      '<span class="ttl">' + esc(c.title) + '</span>' +
      '<span class="meta">' + esc(riskLine(c)) + ' · ' + c.km + ' km · ' + esc(c.lang) + (c.callers > 1 ? ' · ' + c.callers + ' callers agree' : '') + '</span>' + right + '</button></li>';
  }
  function section(title, list, mode, empty, startRank) {
    if (!list.length && !empty) return '';
    return '<h3 class="sec">' + esc(title) + ' <i>' + list.length + '</i></h3>' +
      (list.length ? '<ol class="rows">' + list.map(function (c, i) { return row(c, mode, startRank ? startRank + i : 0); }).join('') + '</ol>' : '<p class="empty">' + esc(empty) + '</p>');
  }
  function hero(c) {
    var m = matchUnit(c);
    return '<section class="hero h-' + c.band + '" aria-label="Next case to decide"><div class="hero-top"><span class="band hb">' + BAND[c.band] + '</span><span class="lbl">Decide now</span></div>' +
      '<h2>' + esc(c.title) + '</h2><p class="risk">' + esc(riskLine(c)) + '</p>' +
      '<div class="hero-row"><div class="timer"><small>Time left to respond</small><b data-cd="' + c.offerExp + '">' + dur(c.offerExp - S.t) + '</b></div>' +
      '<div class="hero-btns"><button class="hb-go" data-a="accept" data-id="' + c.id + '">Accept</button><button class="hb-no" data-a="decline" data-id="' + c.id + '">Decline</button></div></div>' +
      '<p class="hero-note">' + (m ? 'Best match: ' + esc(m.name) + ', ' + esc(m.org) + '.' : 'No free unit with the right kit. You can accept and source one.') + '</p></section>';
  }
  function ladder(c) {
    var i = D.tiers.indexOf(c.tier);
    return '<ol class="ladder" aria-label="Where the case goes if declined">' + D.tiers.map(function (t, k) {
      return '<li class="' + (k < i ? 'past' : k === i ? 'now' : '') + '">' + t + (t === acct().tier ? ' (you)' : '') + '</li>';
    }).join('') + '</ol>';
  }
  function demoReplyBox(c) {
    return '<div class="demobox"><p class="sm"><b>Demo only:</b> the caller answers the automated call by keypad. Try each answer.</p><div class="btns">' +
      '<button class="btn go" data-a="reply" data-r="yes" data-id="' + c.id + '">Caller presses 1: fixed</button>' +
      '<button class="btn no" data-a="reply" data-r="no" data-id="' + c.id + '">Caller presses 2: not fixed</button>' +
      '<button class="btn ghost" data-a="reply" data-r="none" data-id="' + c.id + '">No answer</button></div></div>';
  }
  function answersBlock(c) {
    return '<section class="ans"><h4>What the caller pressed</h4><ol>' + SC.map(function (s, i) {
      var k = c.ans[i];
      return '<li class="' + (k === 0 ? 'ns' : '') + '"><span class="qn">' + (i + 1) + '</span><span class="qt">' + esc(s.q) + '</span><b class="qa">Pressed ' + k + ' · ' + esc(k === 0 ? 'Not sure' : s.opts[k]) + '</b></li>';
    }).join('') + '</ol></section>';
  }
  function voiceBlock(c) {
    var open = ui.voice[c.id];
    return '<section class="vm"><button class="play" data-a="voice" data-id="' + c.id + '" aria-label="Play the voice message">' + (open ? '■' : '▶') + '</button><div><b>Voice message</b> <span class="sm">in ' + esc(c.lang) + (c.name !== 'Not left' ? ', left by ' + esc(c.name) : ', cut off when the line dropped') + '</span>' +
      (open ? '<p class="vt"><span class="sm">Demo only: what the recording says</span><br>“' + esc(c.voice) + '”</p>' : '') + '</div></section>';
  }
  function verifyPanel(c) {
    return '<div class="zone verify"><p><b>Call the caller.</b> Check what they pressed and the exact place. ' + (c.band === 'immediate' ? 'For Immediate cases the unit can move first and you call on the way.' : 'Record what you hear.') + '</p>' +
      '<label class="fld">Exact place<input id="vplace" type="text" value="' + esc(c.exact) + '"></label>' +
      '<div class="btns"><button class="btn go" data-a="verify" data-o="confirmed" data-id="' + c.id + '">Confirmed</button><button class="btn imm" data-a="verify" data-o="up" data-id="' + c.id + '">Worse than reported</button>' +
      '<button class="btn ghost" data-a="verify" data-o="down" data-id="' + c.id + '">Less serious</button><button class="btn no" data-a="verify" data-o="fake" data-id="' + c.id + '">Not genuine</button></div></div>';
  }
  function mapBlock(c) {
    var arrived = c.step >= 3 || c.status === 'awaiting', ux = arrived ? 210 : 40, uy = arrived ? 40 : 118;
    return '<section class="map"><h4>Route to the caller</h4><svg viewBox="0 0 320 140" role="img" aria-label="Map with the unit, the route and the caller’s pin"><rect width="320" height="140" fill="#E6ECFF"/>' +
      '<path d="M0 100H320M0 40H320M80 0V140M210 0V140M0 70H320" stroke="#fff" stroke-width="9" fill="none"/><path d="M0 100H320M0 40H320M80 0V140M210 0V140M0 70H320" stroke="#C3CCEA" stroke-width="1" fill="none"/>' +
      '<polyline points="40,118 80,100 80,40 210,40" fill="none" stroke="#1E4BDB" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + ux + '" cy="' + uy + '" r="8" fill="#118542" stroke="#fff" stroke-width="3"/><text x="' + (arrived ? 222 : 52) + '" y="' + (arrived ? 62 : 128) + '" font-size="11" font-weight="700" fill="#0F1B4D">' + (arrived ? 'Unit on site' : 'Unit') + '</text>' +
      '<path d="M210 40 l-9 -14 a11 11 0 1 1 18 0 z" fill="#D92D20" stroke="#fff" stroke-width="2"/><circle cx="210" cy="22" r="4" fill="#fff"/>' +
      '<text x="228" y="22" font-size="11" font-weight="700" fill="#0F1B4D">Caller</text></svg>' +
      '<p class="sm">' + c.km + ' km · ' + esc(c.exact) + '</p></section>';
  }
  function caseDetail(c) {
    var see = canSeeExact(c) || partnerTask(c), u = unit(c.unit), zone, strikes = S.strikes[c.contact] || 0;
    if (c.status === 'offered' && offeredToMe(c)) {
      var m = matchUnit(c);
      zone = '<div class="zone"><p><b>Respond in <span data-cd="' + c.offerExp + '">' + dur(c.offerExp - S.t) + '</span>,</b> or it climbs to the next tier.</p>' +
        '<p class="sm">' + (m ? 'Best match: <b>' + esc(m.name) + '</b> (' + esc(m.org) + ').' : 'No free unit with the right kit. You can still accept and source one.') + '</p>' +
        '<div class="btns"><button class="btn go" data-a="accept" data-id="' + c.id + '">Accept</button><button class="btn no" data-a="decline" data-id="' + c.id + '">Decline</button></div>' + ladder(c) + '</div>';
    } else if (c.status === 'active' && c.owner === S.role) {
      zone = (c.checked ? '' : verifyPanel(c)) + '<div class="zone task"><p>' + (u ? '<b>' + esc(u.name) + '</b> assigned. ' : '') + 'Status: <b>' + STEPS[c.step - 1] + '</b>' + (c.checked ? ' · Call-back: <b>' + esc(c.checked) + '</b>' : '') + '</p><div class="btns">' +
        (c.step < 3 ? '<button class="btn go" data-a="step" data-id="' + c.id + '">Mark “' + STEPS[c.step].toLowerCase() + '”</button>' :
          '<button class="btn go" data-a="done" data-id="' + c.id + '">Task done</button><button class="btn ghost" data-a="wasted" data-id="' + c.id + '">Nothing to do on arrival</button>') + '</div></div>';
    } else if (c.status === 'awaiting') {
      zone = '<div class="zone wait"><p><b>Awaiting confirmation.</b> The case closes only when the caller says it is fixed. An automated call went out at ' + hm(c.awaitSince) + '.</p>' + demoReplyBox(c) + '</div>';
    } else if (c.status === 'active') {
      zone = '<div class="zone muted"><p><b>' + esc(acct(c.owner).short) + '</b> is on it: ' + esc(STEPS[c.step - 1].toLowerCase()) + '.' + (u ? ' ' + esc(u.name) + ' assigned.' : '') + (c.checked ? ' Call-back: ' + esc(c.checked) + '.' : ' Call-back not yet recorded.') + '</p></div>';
    } else {
      zone = '<div class="zone muted"><p>' + (c.status === 'closed' ? (c.closedWhy ? 'Closed: ' + esc(c.closedWhy) + '.' : 'Closed. Confirmed fixed by the caller.') : 'Nothing for you to do on this case right now.') + '</p></div>';
    }
    var onRoute = (c.status === 'active' && c.step >= 2 || c.status === 'awaiting') && (c.owner === S.role || partnerTask(c));
    var chk = '<section class="chk"><h4>Told to the caller while help travels</h4><p class="sm">Signed off by an expert.</p><ol>' + c.script.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>' +
      (c.expert ? '<p class="okline">An expert is on the caller’s line.</p>' : (c.status === 'offered' || c.status === 'active') && visible(c) ? '<button class="btn ghost" data-a="expert" data-id="' + c.id + '">Bring an expert onto the line</button>' : '') + '</section>';
    return '<article class="case"><div class="case-h"><span class="band b-' + c.band + '">' + BAND[c.band] + '</span><span class="id">' + esc(c.id) + '</span></div>' +
      '<h2>' + esc(c.title) + '</h2><p class="risk">' + esc(riskLine(c)) + '</p>' + tracker(c) +
      (c.goAnyway && c.status !== 'closed' ? '<p class="goany"><b>Caller not reachable.</b> The unit goes anyway and asks locally for ' + esc(c.name) + ' near “' + esc(c.landmark) + '”.</p>' : '') +
      answersBlock(c) +
      '<dl class="facts"><dt>Where</dt><dd>' + esc(see ? c.place + '. ' + c.exact : c.place.split(',').pop().trim() + ' district (the exact place unlocks when you accept)') + '</dd>' +
      '<dt>Found by</dt><dd>' + esc(foundBy(c)) + '</dd>' +
      '<dt>Caller</dt><dd>' + esc(see ? c.contact : 'Number unlocks when you accept') + ', speaks ' + esc(c.lang) + (strikes ? ' · <b class="strike">' + strikes + ' earlier report' + (strikes > 1 ? 's' : '') + ' marked not genuine</b>' : '') + '</dd>' +
      '<dt>Left behind</dt><dd>' + esc(see ? (c.name === 'Not left' ? 'No name or landmark' : c.name + ', near “' + c.landmark + '”') : 'Name and landmark unlock when you accept') + '</dd>' +
      '<dt>Reports</dt><dd>' + c.callers + (c.callers > 1 ? ' calls merged into one case' : ' call') + (c.unconfirmed ? ', not yet confirmed by a second source' : '') + '</dd>' +
      '<dt>Suggested kit</dt><dd>' + esc(c.needs.join(', ')) + '</dd></dl>' + voiceBlock(c) + zone + (onRoute ? mapBlock(c) : '') +
      '<section class="why"><h4>Why it is ranked ' + BAND[c.band] + '</h4><p>' + esc(whyText(c)) + '</p></section>' + chk +
      '<details class="log"><summary>Audit trail (' + c.events.length + ')</summary><ul>' + c.events.slice().reverse().map(function (e) { return '<li><time>' + hm(e.t) + '</time><span>' + esc(e.text) + '</span></li>'; }).join('') + '</ul></details></article>';
  }
  function reviewDetail(c) {
    return '<article class="case"><div class="case-h"><span class="band b-urgent">Urgent for now</span><span class="id">' + esc(c.id) + '</span></div>' +
      '<h2>' + esc(c.title) + '</h2><p class="risk">' + esc(riskLine(c)) + '</p>' + tracker(c) + answersBlock(c) +
      '<dl class="facts"><dt>Where</dt><dd>' + esc(c.place) + '</dd><dt>Found by</dt><dd>' + esc(foundBy(c)) + '</dd></dl>' + voiceBlock(c) +
      '<div class="zone"><p><b>Set the band.</b> The rule cannot place this call because the caller was not sure. The case is then offered to the right tier.</p><label class="fld">Note for the audit trail<input id="revnote" type="text" placeholder="What you heard on the recording"></label>' +
      '<div class="btns"><button class="btn imm" data-a="review" data-band="immediate" data-id="' + c.id + '">Raise to Immediate</button>' +
      '<button class="btn go" data-a="review" data-band="urgent" data-id="' + c.id + '">Keep Urgent</button>' +
      '<button class="btn ghost" data-a="review" data-band="delayed" data-id="' + c.id + '">Lower to Delayed</button></div>' +
      '<p class="sm">Raising a call to Immediate counts as a miss in the audit, because the default was too low.</p></div></article>';
  }

  /* ----- requests ----- */
  function requestsView() {
    var pend = pendingReqs(), done = S.requests.filter(function (r) { return r.status !== 'pending'; }).reverse();
    var cards = pend.length ? pend.map(function (r) {
      var c = byId(r.caseId), e = evalRequest(r), a = acct(r.role);
      return '<article class="req"><div class="req-h"><span class="vbadge">Verified</span><b>' + esc(a.short) + '</b> asks to take <span class="band b-' + c.band + '">' + BAND[c.band] + '</span> <b>' + esc(c.title) + '</b></div>' +
        '<p class="quote">“' + esc(r.text) + '”</p>' +
        '<ul class="checks">' + e.checks.map(function (k) { return '<li class="' + (k.ok ? 'ok' : 'bad') + '">' + esc(k.text) + '</li>'; }).join('') + '</ul>' +
        '<p class="rec ' + (e.ok ? 'ok' : 'bad') + '">' + (e.ok ? 'Recommended: approve. Every check passes.' : 'Recommended: decline. ' + esc(e.first) + '.') + ' The decision is yours.</p>' +
        '<label class="fld">Note to ' + esc(a.short) + ' <span class="sm">(needed to decline)</span><input id="rqn-' + r.id + '" type="text" placeholder="For example: your engineers are the closest team"></label>' +
        '<div class="btns"><button class="btn go" data-a="reqdecide" data-ok="1" data-id="' + r.id + '">Approve</button><button class="btn no" data-a="reqdecide" data-ok="0" data-id="' + r.id + '">Decline</button></div></article>';
    }).join('') : '<p class="empty pad">No requests are waiting. Verified responders can ask to take higher-severity cases; their requests appear here with the checks already run.</p>';
    var hist = done.length ? '<h3 class="sec">Decided <i>' + done.length + '</i></h3><ol class="rows">' + done.map(function (r) {
      var c = byId(r.caseId);
      return '<li class="hist"><span class="chip2 s-' + r.status + '">' + { approved: 'Approved', declined: 'Declined', expired: 'Closed', withdrawn: 'Withdrawn' }[r.status] + '</span><span><b>' + esc(acct(r.role).short) + '</b> for ' + esc(c.title) + (r.note ? '<br><span class="sm">' + esc(r.note) + '</span>' : '') + '</span></li>';
    }).join('') + '</ol>' : '';
    return '<div class="reqwrap"><h3 class="sec">Waiting for your decision <i>' + pend.length + '</i></h3>' + cards + hist + '</div>';
  }
  function higherView(a) {
    if (isProbation(a)) {
      return '<div class="locked"><h2>Higher-severity cases open up after probation</h2><p>Verified responders can ask to take Urgent and Immediate cases. The duty officer checks each request before approving it.</p>' +
        '<p><b>' + tasksDone(a.id) + ' of ' + a.probation.need + '</b> confirmed tasks done. Finish ' + (a.probation.need - tasksDone(a.id)) + ' more to qualify.</p></div>';
    }
    var open = S.cases.filter(requestable).sort(rankSort), mine = S.requests.filter(function (r) { return r.role === S.role; }).slice().reverse();
    var cards = open.length ? '<ol class="rows">' + open.map(function (c) {
      var r = reqFor(c, S.role);
      return '<li class="hcard r-' + c.band + '"><div class="hc-top"><span class="band b-' + c.band + '">' + BAND[c.band] + '</span><b>' + esc(c.title) + '</b></div>' +
        '<p>' + esc(riskLine(c)) + '. Caller pressed: ' + esc(ansSummary(c)) + '.</p><p class="sm">' + esc(c.place.split(',').pop().trim()) + ' district · ' + c.km + ' km · needs ' + esc(c.needs.join(', ')) + ' · <span data-cd="' + c.offerExp + '">' + dur(c.offerExp - S.t) + '</span> before it moves up</p>' +
        (r ? '<div class="btns"><span class="chip2 s-pending">Request in review</span><button class="btn ghost" data-a="reqwithdraw" data-id="' + r.id + '">Withdraw</button></div>' : '<div class="btns"><button class="btn go" data-a="reqopen" data-id="' + c.id + '">Request this case</button></div>') + '</li>';
    }).join('') + '</ol>' : '<p class="empty pad">No higher-severity cases are open for requests. Press “Simulate a new call” in the demo controls to bring one in.</p>';
    var hist = mine.length ? '<h3 class="sec">Your requests <i>' + mine.length + '</i></h3><ol class="rows">' + mine.map(function (r) {
      var c = byId(r.caseId), label = { pending: 'In review', approved: 'Approved', declined: 'Not approved', expired: 'Closed', withdrawn: 'Withdrawn' }[r.status];
      var more = r.status === 'approved' ? 'Now in your tasks.' : r.note || '';
      return '<li class="hist"><span class="chip2 s-' + r.status + '">' + label + '</span><span><b>' + esc(c.title) + '</b>' + (more ? '<br><span class="sm">' + esc(more) + '</span>' : '') + '</span></li>';
    }).join('') + '</ol>' : '';
    return '<div class="reqwrap"><p class="lede">You can ask to take Urgent and Immediate cases. The duty officer checks each request and decides.</p><h3 class="sec">Open to requests <i>' + open.length + '</i></h3>' + cards + hist + '</div>';
  }

  function unitsView(units) {
    var rows = units.map(function (u) {
      var st = unitState(u);
      var label = { free: 'Free', busy: 'Busy', off: 'Off duty', stale: 'No reply for ' + Math.round((S.t - u.at) / MIN) + ' min, counted unavailable', waiting: 'Waiting for reply' }[st];
      return '<tr class="u-' + st + '"><td><b>' + esc(u.name) + '</b><span class="sm">' + esc(u.org) + '</span></td><td>' + esc(u.caps.join(', ')) + '</td><td><span class="ust">' + label + '</span></td><td>' + (st === 'waiting' ? '' : ago(S.t - u.at)) + '</td></tr>';
    }).join('');
    return '<div class="units"><div class="units-h"><p>Each unit answers an SMS check: 1 free, 2 busy, 3 off duty. A status older than two hours counts as unavailable, so only fresh, free units get offers.</p>' +
      '<button class="btn go" data-a="check">Send status check</button></div>' +
      '<table><thead><tr><th>Unit</th><th>Kit</th><th>Status</th><th>Last reply</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  /* ----- dialogs and toasts ----- */
  var REASONS = ['No unit is free', 'Wrong equipment', 'Too far away', 'Other'];
  function declineReason(m) { return m.reason === 'Other' ? (m.text || '').trim() : m.reason; }
  function declineReady(m) { return m.reason && (m.reason !== 'Other' || (m.text || '').trim().length >= 3); }
  function drawModal() {
    var m = ui.modal, el = $('#modal');
    if (!m) { el.innerHTML = ''; return; }
    var c = byId(m.id), target;
    if (m.kind === 'request') {
      el.innerHTML = '<div class="scrim" data-a="close"></div><div class="dlg req-dlg" role="dialog" aria-modal="true" aria-labelledby="dlg-h"><h2 id="dlg-h">Request: ' + esc(c.title) + '</h2>' +
        '<p><span class="band b-' + c.band + '">' + BAND[c.band] + '</span> This is above your usual level, so the duty officer will check your request before deciding.</p>' +
        '<label class="fld">Why is your team the right one?<textarea id="rqtext" data-f="rqtext" rows="4" placeholder="For example: our two engineers are 15 km away and free now">' + esc(m.text || '') + '</textarea></label>' +
        '<div class="btns"><button id="rqgo" class="btn go" data-a="reqsend"' + ((m.text || '').trim().length >= 10 ? '' : ' disabled') + '>Send request</button><button class="btn ghost" data-a="close">Cancel</button></div></div>';
      target = $('#rqtext');
    } else {
      el.innerHTML = '<div class="scrim" data-a="close"></div><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dlg-h"><h2 id="dlg-h">Decline: ' + esc(c.title) + '</h2>' +
        '<p>Tell the next tier why. The case moves up one tier right away, and your reason goes in the audit trail.</p><fieldset><legend>Reason</legend>' +
        REASONS.map(function (r) { return '<label class="rad"><input type="radio" name="why" value="' + esc(r) + '"' + (m.reason === r ? ' checked' : '') + '> ' + esc(r) + '</label>'; }).join('') + '</fieldset>' +
        (m.reason === 'Other' ? '<label class="fld">Type your reason<textarea id="declnote" data-f="declnote" rows="3" placeholder="For example: road to the site is flooded">' + esc(m.text || '') + '</textarea></label>' : '') +
        ladder(c) + '<div class="btns"><button id="declgo" class="btn no" data-a="decline-go"' + (declineReady(m) ? '' : ' disabled') + '>Decline and pass it up</button><button class="btn ghost" data-a="close">Cancel</button></div></div>';
      target = m.reason === 'Other' ? $('#declnote') : el.querySelector('input:checked') || el.querySelector('input');
    }
    if (target && m.focus) { target.focus(); m.focus = false; }
  }
  function drawToasts() {
    $('#toasts').innerHTML = ui.toasts.slice(-3).map(function (t) { return '<div class="toast ' + t.kind + '">' + esc(t.text) + '</div>'; }).join('');
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-a]'); if (!b) return;
    var a = b.getAttribute('data-a'), id = b.getAttribute('data-id');
    switch (a) {
      case 'role':
        S.role = b.getAttribute('data-v'); S.sel = null; S.tab = 'queue';
        if (S.role === 'ngo') S.walk.done.ngo = true;
        break;
      case 'newcase': addNewCase(); break;
      case 'repeat': repeatCall(); break;
      case 'voice': ui.voice[id] = !ui.voice[id]; break;
      case 'verify': verify(id, b.getAttribute('data-o'), (document.getElementById('vplace') || { value: '' }).value.trim()); break;
      case 'pause': S.running = !S.running; break;
      case 'ff': advance(S.t + Number(b.getAttribute('data-s'))); toast('Clock moved forward to ' + hm(S.t) + '.'); break;
      case 'net': S.net = !S.net; toast(S.net ? 'Network is back.' : 'Network is down: offers now go by SMS.', S.net ? 'good' : 'warn'); break;
      case 'reset': S = fresh(); ui.modal = null; ui.toasts = []; window.scrollTo(0, 0); toast('Demo reset. Everything is back to the start.', 'good'); break;
      case 'walk': S.walk.open = !S.walk.open; break;
      case 'tab': S.tab = b.getAttribute('data-tab'); S.sel = null; break;
      case 'open': S.sel = id; if (window.matchMedia('(max-width: 900px)').matches) setTimeout(function () { var d = document.querySelector('.detail'); if (d) d.scrollIntoView({ behavior: 'smooth' }); }, 0); break;
      case 'accept': accept(id); break;
      case 'decline': ui.modal = { kind: 'decline', id: id, reason: null, text: '', focus: true }; break;
      case 'decline-go':
        var m = ui.modal, c = byId(m.id);
        if (!declineReady(m)) return;
        climb(c, declineReason(m), false); if (S.role === 'officer') S.walk.done.declined = true;
        toast('Declined. It moved up to the ' + c.tier + ' tier and is no longer on your list.', 'warn'); ui.modal = null; S.sel = null; break;
      case 'close': ui.modal = null; break;
      case 'step': stepUp(id); break;
      case 'done': finish(id, false); break;
      case 'wasted': finish(id, true); break;
      case 'reply': reply(id, b.getAttribute('data-r')); break;
      case 'expert': callExpert(id); break;
      case 'review': var n = document.getElementById('revnote'); reviewSet(id, b.getAttribute('data-band'), n ? n.value.trim() : ''); S.sel = null; break;
      case 'check': sendCheck(); break;
      case 'reqopen': ui.modal = { kind: 'request', id: id, text: '', focus: true }; break;
      case 'reqsend': if ((ui.modal.text || '').trim().length < 10) return; sendRequest(ui.modal.id, ui.modal.text); ui.modal = null; break;
      case 'reqwithdraw': withdrawRequest(id); break;
      case 'reqdecide':
        var note = (document.getElementById('rqn-' + id) || { value: '' }).value.trim(), ok = b.getAttribute('data-ok') === '1';
        if (!ok && note.length < 3) { toast('Type a short reason for declining, so the NGO knows why.', 'warn'); return; }
        decideRequest(id, ok, note); break;
      default: return;
    }
    render();
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.name === 'why' && ui.modal) { ui.modal.reason = t.value; ui.modal.focus = true; drawModal(); }
  });
  document.addEventListener('input', function (e) {
    var t = e.target, f = t.getAttribute && t.getAttribute('data-f');
    if (!f || !ui.modal) return;
    ui.modal.text = t.value;
    if (f === 'declnote') { var g = $('#declgo'); if (g) g.disabled = !declineReady(ui.modal); }
    if (f === 'rqtext') { var q = $('#rqgo'); if (q) q.disabled = t.value.trim().length < 10; }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ui.modal) { ui.modal = null; render(); } });

  /* ---------- clock ---------- */
  function tick() {
    if (S.running && advance(S.t + 1)) { render(); return; }
    var ck = document.querySelector('[data-clock]'); if (ck) ck.textContent = clock(S.t);
    Array.prototype.forEach.call(document.querySelectorAll('[data-cd]'), function (el) { el.textContent = dur(Number(el.getAttribute('data-cd')) - S.t); });
    if (S.t % 5 === 0) save();
  }

  render();
  setInterval(tick, 1000);
})();
