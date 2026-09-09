/** PokéAPI official-artwork sprite URLs, keyed by national dex id + shiny. */
export function spriteUrl(pokemonId: number, shiny = false): string {
  const base = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork';
  return shiny ? `${base}/shiny/${pokemonId}.png` : `${base}/${pokemonId}.png`;
}
