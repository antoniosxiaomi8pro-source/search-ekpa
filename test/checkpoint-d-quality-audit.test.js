const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Engine = require('../public/search-engine.js');
const programs = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/programs.json'), 'utf8'));
const concepts = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/concepts.json'), 'utf8'));

const audited = [
  ['νοσηλευτική', 'Νοσηλευτική'],
  ['οινολογία', 'Οινολογία'],
  ['coaching', 'Coaching'],
  ['φιλοσοφια', 'Φιλοσοφία'],
];

for (const [query, category] of audited) {
  test(`Checkpoint D: bare official category "${query}" returns exactly all official ${category} members`, () => {
    assert.equal(Engine.resolveCategoryIntent(programs, query), category);
    const expected = programs.filter(p => p.primary_area === category || (p.areas_of_study || []).includes(category));
    const actual = Engine.rank(programs, concepts, query);
    assert.deepEqual(new Set(actual.map(p => p.slug)), new Set(expected.map(p => p.slug)));
    assert.equal(actual.length, expected.length);
  });
}
