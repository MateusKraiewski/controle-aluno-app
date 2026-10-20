import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lessonSearchText, normalizeForSearch } from './text';

describe('search normalisation', () => {
  it('folds case and accents', () => {
    assert.equal(normalizeForSearch('FÍSICA'), 'fisica');
    assert.equal(normalizeForSearch('Física'), 'fisica');
    assert.equal(normalizeForSearch('  Educação   Física '), 'educacao fisica');
    assert.equal(normalizeForSearch('Ñandú ÜBER Ação'), 'nandu uber acao');
    assert.equal(normalizeForSearch('100% _x_'), '100% _x_');
  });

  it('builds a per-lesson key whose fields cannot be matched across', () => {
    assert.equal(lessonSearchText({ teacher: 'Ana', plannedContent: null, studiedContent: 'Óptica' }), 'ana\n\noptica');
    assert.equal(lessonSearchText({ teacher: null, plannedContent: null, studiedContent: null }), '\n\n');
  });
});
