import assert from 'node:assert/strict'
import { groupedIndex } from '../lib/catalog.ts'

const categories = [{ id: 'lunch', naam: 'Lunch' }, { id: 'dinner', naam: 'Hoofdgerecht' }]
const recipes = [
  { titel: 'Soep', recept_maaltijden: [{ maaltijd_id: 'lunch' }] },
  { titel: 'Pasta', recept_maaltijden: [{ maaltijd_id: 'lunch' }, { maaltijd_id: 'dinner' }] }
]
assert.deepEqual(groupedIndex(recipes, categories).map(group => [group.category.naam, group.pages]), [
  ['Lunch', [{ title: 'Soep', page: 2 }, { title: 'Pasta', page: 3 }]],
  ['Hoofdgerecht', [{ title: 'Pasta', page: 3 }]]
])
console.log('Inhoudstafel klopt.')
