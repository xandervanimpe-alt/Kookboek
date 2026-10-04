export const MAALTIJDEN = ['Ontbijt', 'Brunch', 'Lunch', 'Aperitief/Hapjes', 'Voorgerecht', 'Hoofdgerecht', 'Bijgerecht', 'Dessert', 'Gebak', 'Snack', 'Soep', 'Salade', 'Saus/Dip', 'Drank']
export const INGREDIENTEN = ['Rund', 'Varken', 'Kip', 'Kalkoen', 'Lam', 'Wild', 'Vis', 'Schaaldieren', 'Zeevruchten', 'Ei', 'Kaas', 'Pasta', 'Rijst', 'Aardappelen', 'Groenten', 'Peulvruchten', 'Tofu/Tempeh']

export type Category = { id: string; naam: string; user_id: string | null }
export type Recipe = {
  id: string; user_id: string; titel: string; foto: string | null; originele_fotos: string[];
  ingredienten: string; bereidingswijze: string; bereidingstijd: string | null; bron: string | null;
  aangemaakt_op: string; positie: number;
  recept_maaltijden: { maaltijd_id: string }[]; recept_hoofdingredienten: { hoofdingredient_id: string }[]
}

export function groupedIndex(recipes: Recipe[], categories: Category[]) {
  return categories.map(category => ({ category, pages: recipes.flatMap((recipe, index) =>
    recipe.recept_maaltijden.some(item => item.maaltijd_id === category.id) ? [{ title: recipe.titel, page: index + 2 }] : [])
  })).filter(group => group.pages.length)
}
