const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../public/search-engine.js');
const programs = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/programs.json'), 'utf8'));
const concepts = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/concepts.json'), 'utf8'));

const thematic = new Set([
  'arxaia-ellhnika-gia-arxarious',
  'didaktiki-neoellinikon-keimenon',
  'methodologia-kai-didaktiki-tis-hstorias',
  'oi-piges-tou-hstorikou-ereunontas-tin-elliniki-hstoria-tou-20ou-aiona',
  'neoteri-kai-sugxroni-elliniki-hstoria-1821-2021-tomes-kai-gegonota',
  'anagnosi-filanagnosia-kai-paidiki-logotexnia',
  'h-epidimia-os-thema-kai-os-metafora-sti-logotexnia',
]);
const explicitAudience = new Set([
  'ypotitlismos-kai-optikoakoustiki-metafrasi-praktiki-efarmogi-stin-aggliki-i-kai-galliki-i-kai-germaniki-glossa',
  'metafrasi-kai-epimeleia-keimenon-stin-aggliki-i-kai-germaniki-i-kai-galliki-glossa',
  'efarmosmeni-sxoliki-psuxologia',
]);
const expected = new Set([...thematic, ...explicitAudience]);
function ranked(q, ps=programs){ return E.rank(ps, concepts, q); }
function slugs(q, ps=programs){ return new Set(ranked(q,ps).map(x=>x.slug)); }

for (const q of ['φιλόλογος','φιλολόγου','φιλόλογοι','φιλολόγους','πρόγραμμα για φιλόλογο','προγράμματα για φιλολόγους','filologos']) {
  test(`D.1 revised philologist intent: ${q}`, () => assert.deepEqual(slugs(q), expected));
}

test('D.1 revised: all audited thematic programs rank before audience-only programs', () => {
  const rs=ranked('προγράμματα για φιλολόγους');
  const lastThematic=Math.max(...rs.map((x,i)=>thematic.has(x.slug)?i:-1));
  const firstAudience=rs.findIndex(x=>explicitAudience.has(x.slug));
  assert.ok(firstAudience > lastThematic);
});

test('D.1 revised: a future program explicitly targeting philologists is included automatically without code changes', () => {
  const synthetic={
    slug:'future-philologist-program', title:'Νέο Πρόγραμμα', primary_area:null, areas_of_study:[], tags:[],
    description_for_matching:'Το πρόγραμμα απευθύνεται σε πτυχιούχους τμημάτων φιλολογίας και άλλων ανθρωπιστικών επιστημών.'
  };
  const rs=slugs('προγράμματα για φιλολόγους', [...programs, synthetic]);
  assert.ok(rs.has('future-philologist-program'));
});

test('D.1 revised: incidental Philology mention outside an explicit audience declaration does not qualify', () => {
  const synthetic={
    slug:'incidental-philology-mention', title:'Άσχετο Πρόγραμμα', primary_area:null, areas_of_study:[], tags:[],
    description_for_matching:'Ακαδημαϊκή Υπεύθυνη: Καθηγήτρια Νεοελληνικής Φιλολογίας στο Τμήμα Φιλολογίας ΕΚΠΑ.'
  };
  const rs=slugs('προγράμματα για φιλολόγους', [...programs, synthetic]);
  assert.ok(!rs.has('incidental-philology-mention'));
});

test('D.1 partial typeahead φιλολο remains normal search and keeps the three observed strong results first', () => {
  assert.equal(E.resolveAudienceProgramIntent(programs, 'φιλολο'), null);
  const titles=ranked('φιλολο').slice(0,3).map(x=>x.title);
  assert.deepEqual(titles,['Αρχαία Ελληνικά για Αρχάριους','Διδακτική Νεοελληνικών Κειμένων','Μεθοδολογία και Διδακτική της Ιστορίας']);
});

test('D.1 compound query does not collapse to philologist audience set', () => {
  assert.equal(E.resolveAudienceProgramIntent(programs, 'φιλόλογος marketing'), null);
});
