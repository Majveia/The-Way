// THE WAY — deterministic universe model. Pure data: every scale derives from seeds, so the
// same galaxy/system/planet always comes back identical. Scenes turn this data into pictures.
//
// Hierarchy: cosmos (cosmic web sim) → galaxy(id) → system(galaxyId, index) → planet / moon.
// Galaxy 0 is our home, "The Way". System 0 inside it, "Aster", is a curated showcase where
// every world archetype lives, so the first journey is the most beautiful one.

import { hash32, Random, clamp } from './rng.js';
import { makeName, roman } from './names.js';

export const UNIVERSE_SEED = 0x7e3779b9;
export const AU = 1.495978707e11; // meters

// ---------------------------------------------------------------------------------------------
// World archetypes. Each is a mood board in data: palette, sky, terrain grammar, life, culture.
// "inspiration" is guidance for the art direction (moods, not copies).
// ---------------------------------------------------------------------------------------------
export const PLANET_THEMES = {
  verdant: {
    title: 'The Green Reverie',
    inspiration: 'Pastoral sublime: Constable cloudscapes, Ghibli-like rolling meadows and wind, Planet Earth grasslands at golden hour, Caspar David Friedrich cliffs.',
    tongue: 'aelian',
    terrain: { amplitude: 3200, seaLevel: 0.12, continent: 1.6, mountains: 0.75, ridge: 0.6, warp: 0.6, hills: 0.7, plateaus: 0.0, dunes: 0.0, craters: 0.0, canyons: 0.15, islands: 0.2, terraces: 0.1 },
    palette: { deep: '#0b2a4a', shallow: '#1d7f8c', beach: '#d9c9a0', low: '#4f8a2b', mid: '#3b6e26', high: '#7d7a5a', rock: '#6b6358', cliff: '#5a5148', snow: '#f4f7fb', accent: '#f2d16b' },
    atmosphere: { rayleigh: [5.8, 13.5, 33.1], mie: 21, mieG: 0.78, density: 1.0, height: 1.0, ozone: 1.0, tint: '#ffffff', sunset: '#ff9b54' },
    clouds: { type: 'cumulus', coverage: 0.48, density: 0.9, color: '#ffffff', altitude: 2200, speed: 1.0 },
    ocean: { deep: '#06223f', shallow: '#1b8a95', foam: '#f2fbff', roughness: 0.25 },
    flora: { density: 0.9, kinds: ['broadleaf', 'conifer', 'giantTree', 'fern', 'flowers'], leaf: ['#4b8f2f', '#6aa83a', '#2f6b2a', '#a7c94f'], trunk: '#5b4632', grass: { color: '#5f9a35', tip: '#c9d86a', height: 0.7, density: 1.0 }, flowers: ['#f6e27a', '#f0f0ff', '#d86fa3', '#7aa6f0'], glow: 0 },
    fauna: { density: 0.8, kinds: ['birds', 'grazers', 'butterflies', 'fish'] },
    civ: { level: 3, style: 'pastoral', cities: 3, towns: 9, villages: 24, monuments: ['whiteCitadel', 'windmills', 'stoneBridge', 'lighthouse'], lights: '#ffc27a', palette: ['#efe6d6', '#c8553d', '#8a9a5b', '#d9cbb3'], traffic: 'gliders' },
    sky: { day: '#7fb3ff', horizon: '#dfeeff', night: '#020611', aurora: 0 },
    ambience: 'meadow',
  },
  dune: {
    title: 'Sea of Amber',
    inspiration: 'Monumental minimalism: Moebius deserts, vast dune seas with tiny figures, brutalist megastructures half-swallowed by sand, heat shimmer, long shadows (Lawrence of Arabia vistas, Villeneuve scale).',
    tongue: 'kharic',
    terrain: { amplitude: 2600, seaLevel: -1, continent: 1.0, mountains: 0.35, ridge: 0.8, warp: 0.4, hills: 0.3, plateaus: 0.8, dunes: 1.0, craters: 0.1, canyons: 0.6, islands: 0, terraces: 0.6 },
    palette: { deep: '#3a2412', shallow: '#6b4422', beach: '#e9c48a', low: '#e2b06c', mid: '#d39a55', high: '#b8743d', rock: '#9a5a33', cliff: '#7d4628', snow: '#f6e7cf', accent: '#ffd28a' },
    atmosphere: { rayleigh: [9.0, 9.5, 12.0], mie: 60, mieG: 0.82, density: 0.9, height: 1.1, ozone: 0.2, tint: '#ffd9a8', sunset: '#ff6a2b' },
    clouds: { type: 'wisps', coverage: 0.12, density: 0.4, color: '#fff1dd', altitude: 6000, speed: 1.6 },
    ocean: null,
    flora: { density: 0.06, kinds: ['cactus', 'deadTree', 'rocks'], leaf: ['#7b8a4a', '#9aa05a'], trunk: '#6b5038', grass: { color: '#bfa56a', tip: '#e8d39a', height: 0.35, density: 0.08 }, flowers: ['#ff7e5f'], glow: 0 },
    fauna: { density: 0.2, kinds: ['leviathan', 'birds', 'caravan'] },
    civ: { level: 3, style: 'monolithic', cities: 2, towns: 6, villages: 10, monuments: ['buriedColossus', 'obelisk', 'stepPyramid', 'sandArch'], lights: '#ffb35c', palette: ['#c9a27a', '#8c6a4f', '#e8d5b5', '#4d3b2e'], traffic: 'caravans' },
    sky: { day: '#d8b088', horizon: '#ffe2bf', night: '#0a0604', aurora: 0 },
    ambience: 'desert',
  },
  archipelago: {
    title: 'Thousand Isles',
    inspiration: 'Mediterranean light (Sorolla), Cycladic whitewash villages, turquoise shallows over white sand, sea stacks, sailboats, lighthouses, gulls.',
    tongue: 'aelian',
    terrain: { amplitude: 1800, seaLevel: 0.55, continent: 2.6, mountains: 0.45, ridge: 0.5, warp: 0.8, hills: 0.6, plateaus: 0.1, dunes: 0, craters: 0, canyons: 0, islands: 1.0, terraces: 0.3 },
    palette: { deep: '#062a52', shallow: '#22c3c9', beach: '#f3e6c4', low: '#7fae4a', mid: '#5f8d3a', high: '#a49a7a', rock: '#c7b9a0', cliff: '#b0a088', snow: '#ffffff', accent: '#2a7bd8' },
    atmosphere: { rayleigh: [5.5, 13.0, 34.0], mie: 14, mieG: 0.76, density: 0.95, height: 1.0, ozone: 1.0, tint: '#ffffff', sunset: '#ff8a5c' },
    clouds: { type: 'cumulus', coverage: 0.32, density: 0.8, color: '#ffffff', altitude: 1800, speed: 1.2 },
    ocean: { deep: '#03305c', shallow: '#2fd4d0', foam: '#ffffff', roughness: 0.2 },
    flora: { density: 0.6, kinds: ['palm', 'cypress', 'olive', 'flowers'], leaf: ['#5d8f3a', '#86a84a', '#3e6e34'], trunk: '#7a6248', grass: { color: '#8bb252', tip: '#e2e08a', height: 0.45, density: 0.6 }, flowers: ['#e0457b', '#fff6e0', '#ff9f43'], glow: 0 },
    fauna: { density: 0.7, kinds: ['seabirds', 'fish', 'whales', 'boats'] },
    civ: { level: 3, style: 'cycladic', cities: 2, towns: 14, villages: 20, monuments: ['lighthouse', 'harborArch', 'domeChapel'], lights: '#ffd59a', palette: ['#ffffff', '#f5f1e8', '#2a6fdb', '#e8d8b8'], traffic: 'sailboats' },
    sky: { day: '#6fb2ff', horizon: '#e6f6ff', night: '#020814', aurora: 0 },
    ambience: 'coast',
  },
  crystal: {
    title: 'Prism Reach',
    inspiration: 'Moebius and Roger Dean dreamscapes: violet plains, towering refracting crystal spires, rose skies, floating rock islands, glass cities ringed in light.',
    tongue: 'lucent',
    terrain: { amplitude: 3800, seaLevel: 0.05, continent: 1.2, mountains: 0.9, ridge: 1.0, warp: 1.1, hills: 0.4, plateaus: 0.5, dunes: 0, craters: 0.05, canyons: 0.5, islands: 0.1, terraces: 0.5 },
    palette: { deep: '#2a0f4a', shallow: '#7b4fd8', beach: '#e7d2ff', low: '#8a6bc9', mid: '#6d4fb0', high: '#b9a5e8', rock: '#4a3c74', cliff: '#3a2e5e', snow: '#f7f0ff', accent: '#7ff7ff' },
    atmosphere: { rayleigh: [22.0, 7.0, 26.0], mie: 18, mieG: 0.8, density: 1.0, height: 1.2, ozone: 0.4, tint: '#ffd6f4', sunset: '#ff5fa2' },
    clouds: { type: 'stratus', coverage: 0.25, density: 0.5, color: '#ffe6fb', altitude: 5200, speed: 0.6 },
    ocean: { deep: '#1d0a3a', shallow: '#8c62e8', foam: '#f6eaff', roughness: 0.08 },
    flora: { density: 0.35, kinds: ['crystal', 'glassTree', 'coralFan'], leaf: ['#a8f0ff', '#e6a8ff', '#7fffd4'], trunk: '#c7b8ff', grass: { color: '#9b7fd6', tip: '#f0d8ff', height: 0.3, density: 0.4 }, flowers: ['#7ff7ff', '#ff9ef0'], glow: 0.6 },
    fauna: { density: 0.4, kinds: ['floaters', 'glassBirds'] },
    civ: { level: 4, style: 'crystalline', cities: 3, towns: 5, villages: 6, monuments: ['prismSpire', 'haloRing', 'floatingIsle'], lights: '#9ff3ff', palette: ['#e8f7ff', '#c9b6ff', '#7ff7ff', '#ffffff'], traffic: 'lightRails' },
    sky: { day: '#e59ad0', horizon: '#ffd9ee', night: '#0b0218', aurora: 0.3 },
    ambience: 'crystal',
  },
  biolume: {
    title: 'Lantern Wilds',
    inspiration: 'Deep-sea bioluminescence on land: towering mushroom forests, drifting spores, jelly-like sky creatures, tree-top lantern cities. Long twilight, cyan & magenta glow on black.',
    tongue: 'sylvan',
    terrain: { amplitude: 2400, seaLevel: 0.2, continent: 1.4, mountains: 0.5, ridge: 0.4, warp: 1.0, hills: 0.9, plateaus: 0.2, dunes: 0, craters: 0, canyons: 0.3, islands: 0.3, terraces: 0 },
    palette: { deep: '#02101c', shallow: '#0d5a5e', beach: '#2b3b3a', low: '#1d3b2c', mid: '#173025', high: '#2a2f3a', rock: '#1f2228', cliff: '#181a20', snow: '#cfe9ff', accent: '#40ffe0' },
    atmosphere: { rayleigh: [4.0, 16.0, 22.0], mie: 40, mieG: 0.7, density: 1.3, height: 1.0, ozone: 1.4, tint: '#c9fff4', sunset: '#ff4fb8' },
    clouds: { type: 'stratus', coverage: 0.55, density: 0.8, color: '#d8fff6', altitude: 2600, speed: 0.5 },
    ocean: { deep: '#010a14', shallow: '#0b4a55', foam: '#7ffff0', roughness: 0.3 },
    flora: { density: 1.0, kinds: ['mushroomTree', 'glowFern', 'tendril', 'spores'], leaf: ['#1f6b5a', '#2d4f7a', '#5a2d7a'], trunk: '#2a2433', grass: { color: '#1b4038', tip: '#3fffd2', height: 0.6, density: 0.9 }, flowers: ['#40ffe0', '#ff4fd8', '#7fa0ff'], glow: 1.0 },
    fauna: { density: 0.9, kinds: ['skyJellies', 'fireflies', 'moths'] },
    civ: { level: 2, style: 'arboreal', cities: 1, towns: 6, villages: 18, monuments: ['lanternTree', 'rootGate'], lights: '#7affd8', palette: ['#3b2f4a', '#6b4f3a', '#40ffe0', '#ff4fd8'], traffic: 'lanternGliders' },
    sky: { day: '#4aa6a0', horizon: '#c8fff0', night: '#01040a', aurora: 0.6 },
    ambience: 'jungle_night',
  },
  glacier: {
    title: 'White Silence',
    inspiration: 'Tarkovsky stillness, Friedrich\'s "Sea of Ice", blue crevasse light, aurora curtains, a lone observatory with warm windows in endless white.',
    tongue: 'nordic',
    terrain: { amplitude: 3000, seaLevel: 0.1, continent: 1.3, mountains: 0.85, ridge: 0.9, warp: 0.5, hills: 0.5, plateaus: 0.4, dunes: 0.2, craters: 0.05, canyons: 0.4, islands: 0.2, terraces: 0.2 },
    palette: { deep: '#0a1f33', shallow: '#3c7ea0', beach: '#cfe3ef', low: '#e9f3fa', mid: '#d6e8f5', high: '#ffffff', rock: '#5d6b78', cliff: '#4a5866', snow: '#ffffff', accent: '#8fd3ff' },
    atmosphere: { rayleigh: [6.5, 14.0, 30.0], mie: 10, mieG: 0.8, density: 0.85, height: 0.9, ozone: 1.2, tint: '#eaf6ff', sunset: '#ffb08a' },
    clouds: { type: 'stratus', coverage: 0.45, density: 0.7, color: '#f4fbff', altitude: 3000, speed: 1.4 },
    ocean: { deep: '#061a2b', shallow: '#4a90b0', foam: '#ffffff', roughness: 0.15, ice: 0.7 },
    flora: { density: 0.08, kinds: ['conifer', 'iceShard'], leaf: ['#2e4a42', '#3c5a50'], trunk: '#4a3a30', grass: { color: '#9fb0a8', tip: '#e6f2f2', height: 0.2, density: 0.1 }, flowers: ['#bfe8ff'], glow: 0.1 },
    fauna: { density: 0.25, kinds: ['birds', 'herdBeasts'] },
    civ: { level: 1, style: 'outpost', cities: 0, towns: 3, villages: 6, monuments: ['observatory', 'beacon', 'iceArch'], lights: '#ffcf8a', palette: ['#3a3f47', '#d94f3d', '#e8e8e8', '#ffcf8a'], traffic: 'sleds' },
    sky: { day: '#9cc9ef', horizon: '#f2fbff', night: '#01030a', aurora: 1.0 },
    ambience: 'tundra',
  },
  forge: {
    title: 'Ember Throne',
    inspiration: 'Turner\'s fire skies and Beksiński gloom: black basalt, rivers of lava, ash storms, colossal gothic forge-cities and statues lit from below by furnaces.',
    tongue: 'kharic',
    terrain: { amplitude: 4200, seaLevel: 0.15, continent: 1.1, mountains: 1.0, ridge: 1.0, warp: 0.7, hills: 0.4, plateaus: 0.3, dunes: 0, craters: 0.3, canyons: 0.8, islands: 0, terraces: 0.2 },
    palette: { deep: '#ff4a0a', shallow: '#ffb03a', beach: '#2a1a14', low: '#2b211d', mid: '#1f1a18', high: '#3a302b', rock: '#16110f', cliff: '#0f0b0a', snow: '#6e625c', accent: '#ff5a1f' },
    atmosphere: { rayleigh: [14.0, 7.0, 4.0], mie: 90, mieG: 0.7, density: 1.2, height: 1.0, ozone: 0.0, tint: '#ffb08a', sunset: '#ff3b0a' },
    clouds: { type: 'ash', coverage: 0.6, density: 1.0, color: '#3a2a26', altitude: 4000, speed: 1.8 },
    ocean: { deep: '#ff3c00', shallow: '#ffd25a', foam: '#fff2b0', roughness: 0.9, lava: 1.0 },
    flora: { density: 0.02, kinds: ['charredTree', 'emberVine'], leaf: ['#ff5a1f'], trunk: '#1a1212', grass: { color: '#2a1d18', tip: '#ff6a2a', height: 0.15, density: 0.05 }, flowers: ['#ff8a2a'], glow: 0.8 },
    fauna: { density: 0.15, kinds: ['emberBirds', 'salamanders'] },
    civ: { level: 3, style: 'gothic', cities: 2, towns: 4, villages: 3, monuments: ['forgeColossus', 'chainBridge', 'blackSpire'], lights: '#ff7a2a', palette: ['#1c1816', '#3b2f2a', '#ff7a2a', '#7a5a40'], traffic: 'emberBarges' },
    sky: { day: '#5a2a1a', horizon: '#ff8a4a', night: '#0a0201', aurora: 0 },
    ambience: 'volcanic',
  },
  metropolis: {
    title: 'Ecumenopolis Lumen',
    inspiration: 'Syd Mead futurism, Deakins sodium-and-teal fog photography, planet-wide megacity canyons, rivers of flying traffic, holographic art, rain-slick reflections.',
    tongue: 'lucent',
    terrain: { amplitude: 1600, seaLevel: 0.25, continent: 1.5, mountains: 0.3, ridge: 0.4, warp: 0.4, hills: 0.3, plateaus: 0.6, dunes: 0, craters: 0, canyons: 0.1, islands: 0.2, terraces: 0.7 },
    palette: { deep: '#03101e', shallow: '#0f3a4f', beach: '#4a4a52', low: '#3a3d44', mid: '#2e3138', high: '#5a5d66', rock: '#2a2c31', cliff: '#202226', snow: '#c8d0dc', accent: '#ff3fa4' },
    atmosphere: { rayleigh: [7.0, 11.0, 18.0], mie: 70, mieG: 0.75, density: 1.1, height: 1.0, ozone: 0.8, tint: '#cfe2ff', sunset: '#ff7a3a' },
    clouds: { type: 'stratus', coverage: 0.65, density: 0.9, color: '#c9d2e0', altitude: 2400, speed: 1.0 },
    ocean: { deep: '#020a14', shallow: '#0c2c3c', foam: '#a8c8e0', roughness: 0.12 },
    flora: { density: 0.15, kinds: ['parkTree', 'hedge'], leaf: ['#2f6a4a', '#3d7f58'], trunk: '#3a2f28', grass: { color: '#3a6a44', tip: '#7ab07a', height: 0.25, density: 0.2 }, flowers: ['#ff3fa4'], glow: 0.2 },
    fauna: { density: 0.3, kinds: ['birds', 'drones'] },
    civ: { level: 4, style: 'neon', cities: 12, towns: 20, villages: 0, monuments: ['arcology', 'skyBridge', 'holoMonument'], lights: '#ffb46a', palette: ['#1b1e24', '#2c3340', '#ff3fa4', '#3fd6ff'], traffic: 'skyLanes' },
    sky: { day: '#8fa8c8', horizon: '#d8e2ef', night: '#03040a', aurora: 0 },
    ambience: 'city',
  },
  ruins: {
    title: 'The Quiet Colossi',
    inspiration: 'Melancholic monumentality (Fumito Ueda mood): fog-veiled highlands, ancient colossal statues and broken temples, waterfalls, long god-ray shadows, a single bird crossing a vast sky.',
    tongue: 'kharic',
    terrain: { amplitude: 3600, seaLevel: 0.15, continent: 1.2, mountains: 0.8, ridge: 0.7, warp: 0.7, hills: 0.7, plateaus: 0.6, dunes: 0, craters: 0, canyons: 0.5, islands: 0.1, terraces: 0.3 },
    palette: { deep: '#0d2233', shallow: '#3f6f75', beach: '#a59f8a', low: '#6f8a58', mid: '#5c7348', high: '#8a8a78', rock: '#7c7a70', cliff: '#66645c', snow: '#f0f2f2', accent: '#d8c690' },
    atmosphere: { rayleigh: [6.0, 12.0, 26.0], mie: 45, mieG: 0.85, density: 1.1, height: 1.0, ozone: 0.9, tint: '#f1f2ea', sunset: '#ffb070' },
    clouds: { type: 'cumulus', coverage: 0.55, density: 0.8, color: '#f2f2ee', altitude: 2800, speed: 0.7 },
    ocean: { deep: '#0a1c2a', shallow: '#3a6a6c', foam: '#e8f0ee', roughness: 0.3 },
    flora: { density: 0.5, kinds: ['broadleaf', 'cypress', 'moss', 'ivy'], leaf: ['#5d7a3e', '#4a6a36', '#7d9a52'], trunk: '#4e4234', grass: { color: '#6f8a4a', tip: '#c8c890', height: 0.6, density: 0.8 }, flowers: ['#f2f0d8'], glow: 0 },
    fauna: { density: 0.3, kinds: ['birds', 'colossalBeasts'] },
    civ: { level: 1, style: 'ancient', cities: 0, towns: 2, villages: 4, monuments: ['colossus', 'ruinedTemple', 'stoneCircle', 'stairway'], lights: '#ffcf8a', palette: ['#b8b2a2', '#8c8676', '#d8d0b8', '#5e5a50'], traffic: 'none' },
    sky: { day: '#a8c0d8', horizon: '#eef2f2', night: '#03050a', aurora: 0 },
    ambience: 'highland',
  },
  savanna: {
    title: 'Golden Monoliths',
    inspiration: 'Planet Earth migrations at golden hour, flat-topped trees on endless gold grass, dust plumes, and Kubrick-black monoliths standing in perfect silence.',
    tongue: 'sylvan',
    terrain: { amplitude: 1800, seaLevel: 0.08, continent: 1.2, mountains: 0.35, ridge: 0.4, warp: 0.5, hills: 0.5, plateaus: 0.7, dunes: 0.1, craters: 0, canyons: 0.2, islands: 0, terraces: 0.4 },
    palette: { deep: '#123040', shallow: '#3f7a7a', beach: '#d8c08a', low: '#c9a24a', mid: '#b88f3e', high: '#9a7a4a', rock: '#8a6a4a', cliff: '#74583c', snow: '#f4ead8', accent: '#111111' },
    atmosphere: { rayleigh: [6.2, 12.5, 28.0], mie: 38, mieG: 0.8, density: 1.0, height: 1.0, ozone: 1.0, tint: '#fff2d8', sunset: '#ff8a3a' },
    clouds: { type: 'cumulus', coverage: 0.25, density: 0.7, color: '#fff8ec', altitude: 2600, speed: 0.9 },
    ocean: { deep: '#0e2a3a', shallow: '#3a7a74', foam: '#fff', roughness: 0.3 },
    flora: { density: 0.35, kinds: ['acacia', 'baobab', 'bush'], leaf: ['#6a7a2a', '#8a8a3a', '#5a6a28'], trunk: '#4a3a2a', grass: { color: '#c9a24a', tip: '#f2dc8a', height: 0.9, density: 1.0 }, flowers: ['#ff9a3a'], glow: 0 },
    fauna: { density: 1.0, kinds: ['herds', 'birds', 'giants'] },
    civ: { level: 2, style: 'tribal', cities: 0, towns: 4, villages: 16, monuments: ['monolith', 'standingStones', 'mudTower'], lights: '#ffb35c', palette: ['#b07a4a', '#d8b88a', '#7a4a2a', '#f2e2c2'], traffic: 'none' },
    sky: { day: '#86b6e8', horizon: '#fff0d8', night: '#03050c', aurora: 0 },
    ambience: 'savanna',
  },
  sakura: {
    title: 'Petal Coast',
    inspiration: 'Hokusai and Hiroshige prints, Kurosawa weather, mist-layered mountains, pink blossom forests and red maples, pagoda towers, paper lanterns over rivers.',
    tongue: 'sylvan',
    terrain: { amplitude: 3400, seaLevel: 0.2, continent: 1.4, mountains: 0.9, ridge: 0.8, warp: 0.6, hills: 0.8, plateaus: 0.1, dunes: 0, craters: 0, canyons: 0.3, islands: 0.4, terraces: 0.5 },
    palette: { deep: '#0c2238', shallow: '#3d8c8a', beach: '#e8dcc0', low: '#6a9a4a', mid: '#4f7a3e', high: '#6a6a5a', rock: '#5a5650', cliff: '#4a4640', snow: '#ffffff', accent: '#ff8fb8' },
    atmosphere: { rayleigh: [6.0, 12.0, 30.0], mie: 30, mieG: 0.8, density: 1.0, height: 1.0, ozone: 1.0, tint: '#fff2f6', sunset: '#ff8a9a' },
    clouds: { type: 'cumulus', coverage: 0.4, density: 0.8, color: '#fff8fb', altitude: 2400, speed: 0.8 },
    ocean: { deep: '#071c30', shallow: '#3a9a98', foam: '#ffffff', roughness: 0.25 },
    flora: { density: 0.85, kinds: ['blossom', 'maple', 'pine', 'bamboo'], leaf: ['#ffb7d0', '#ff8fb8', '#e8425a', '#3f6a3a'], trunk: '#3a2a26', grass: { color: '#6a9a4a', tip: '#d8e8a0', height: 0.5, density: 0.8 }, flowers: ['#ffd0e0', '#ffffff', '#ff6a8a'], glow: 0 },
    fauna: { density: 0.6, kinds: ['cranes', 'koi', 'deer', 'butterflies'] },
    civ: { level: 3, style: 'pagoda', cities: 2, towns: 8, villages: 20, monuments: ['pagoda', 'toriiGate', 'lanternBridge'], lights: '#ffb46a', palette: ['#c8442a', '#2a2a2a', '#f2e8d8', '#6a4a3a'], traffic: 'lanternBoats' },
    sky: { day: '#9cc2f0', horizon: '#ffeef2', night: '#04030c', aurora: 0 },
    ambience: 'temple',
  },
  ocean: {
    title: 'The Deep Blue',
    inspiration: 'Turner seascapes, mountainous swells, storm light breaking through, stilted sea-cities, and leviathans breaching in the silver distance.',
    tongue: 'aelian',
    terrain: { amplitude: 2000, seaLevel: 0.85, continent: 1.0, mountains: 0.4, ridge: 0.5, warp: 0.7, hills: 0.5, plateaus: 0.1, dunes: 0, craters: 0, canyons: 0, islands: 0.5, terraces: 0 },
    palette: { deep: '#021226', shallow: '#126a8a', beach: '#cfc2a0', low: '#4a7a4a', mid: '#3a5a3a', high: '#7a7a6a', rock: '#4a4a46', cliff: '#3a3a36', snow: '#ffffff', accent: '#9fe8ff' },
    atmosphere: { rayleigh: [5.6, 13.2, 33.5], mie: 26, mieG: 0.78, density: 1.05, height: 1.0, ozone: 1.0, tint: '#f2f8ff', sunset: '#ff9a6a' },
    clouds: { type: 'storm', coverage: 0.6, density: 1.0, color: '#f4f6f8', altitude: 2200, speed: 1.5 },
    ocean: { deep: '#010e20', shallow: '#0e5a7a', foam: '#ffffff', roughness: 0.35, waves: 2.2 },
    flora: { density: 0.3, kinds: ['palm', 'kelp'], leaf: ['#3a6a3a'], trunk: '#5a4a3a', grass: { color: '#4a7a4a', tip: '#a8c87a', height: 0.4, density: 0.4 }, flowers: ['#fff'], glow: 0 },
    fauna: { density: 0.8, kinds: ['whales', 'seabirds', 'fish', 'leviathan'] },
    civ: { level: 2, style: 'stilts', cities: 1, towns: 6, villages: 6, monuments: ['seaGate', 'lighthouse'], lights: '#ffd08a', palette: ['#e8e2d2', '#4a6a8a', '#c8a26a', '#2a3a4a'], traffic: 'sailboats' },
    sky: { day: '#7aaee8', horizon: '#e8f2fa', night: '#02060e', aurora: 0 },
    ambience: 'ocean',
  },
  barren: {
    title: 'Grey Vigil',
    inspiration: 'Apollo photography: hard black shadows, airless grey regolith, crater rims, a giant parent planet hanging in a black sky; a small domed station keeps its quiet watch.',
    tongue: 'nordic',
    terrain: { amplitude: 2400, seaLevel: -1, continent: 0.6, mountains: 0.4, ridge: 0.3, warp: 0.2, hills: 0.4, plateaus: 0.2, dunes: 0, craters: 1.0, canyons: 0.1, islands: 0, terraces: 0 },
    palette: { deep: '#2a2a2a', shallow: '#3a3a3a', beach: '#8a8884', low: '#8f8c86', mid: '#7a7872', high: '#a8a5a0', rock: '#5f5d58', cliff: '#4a4844', snow: '#d8d6d2', accent: '#c8c4bc' },
    atmosphere: null,
    clouds: null,
    ocean: null,
    flora: { density: 0, kinds: [], leaf: [], trunk: '#000', grass: { color: '#000', tip: '#000', height: 0, density: 0 }, flowers: [], glow: 0 },
    fauna: { density: 0, kinds: [] },
    civ: { level: 1, style: 'research', cities: 0, towns: 1, villages: 2, monuments: ['domeBase', 'antennaArray', 'landingPad'], lights: '#e8f0ff', palette: ['#e8e8e8', '#c8c8c8', '#d8a03a', '#2a2a2a'], traffic: 'rovers' },
    sky: { day: '#000000', horizon: '#000000', night: '#000000', aurora: 0 },
    ambience: 'vacuum',
  },
  gasgiant: {
    title: 'Storm Crown',
    inspiration: 'Juno-probe Jupiter: turbulent cream and rust bands, folded vortices, a great storm eye; brass-and-glass cloud cities riding the haze above the abyss.',
    tongue: 'lucent',
    terrain: null,
    palette: { deep: '#3a1f12', shallow: '#c8865a', beach: '#e8d2b0', low: '#d8a878', mid: '#a86a48', high: '#f2e2c8', rock: '#7a4a32', cliff: '#5a3424', snow: '#fff8ee', accent: '#e85a3a' },
    atmosphere: { rayleigh: [5.0, 9.0, 16.0], mie: 30, mieG: 0.8, density: 1.6, height: 2.0, ozone: 0.3, tint: '#ffe8d0', sunset: '#ff8a4a' },
    clouds: { type: 'bands', coverage: 1.0, density: 1.0, color: '#f2e2c8', altitude: 0, speed: 1.0 },
    ocean: null,
    bands: { colors: ['#f2e2c8', '#d8a878', '#a86a48', '#e8d2b0', '#c8865a', '#fff2dc', '#8a5a3a'], turbulence: 1.0, storms: 3 },
    flora: { density: 0, kinds: [], leaf: [], trunk: '#000', grass: { color: '#000', tip: '#000', height: 0, density: 0 }, flowers: [], glow: 0 },
    fauna: { density: 0.4, kinds: ['skyWhales'] },
    civ: { level: 3, style: 'floating', cities: 1, towns: 3, villages: 0, monuments: ['cloudCity'], lights: '#ffcf8a', palette: ['#c8a26a', '#e8e2d2', '#8a6a4a', '#ffffff'], traffic: 'airships' },
    sky: { day: '#d8b898', horizon: '#ffe8d0', night: '#0a0604', aurora: 0.4 },
    ambience: 'gasgiant',
  },
};

export const THEME_IDS = Object.keys(PLANET_THEMES);
const HOT_THEMES = ['forge', 'dune', 'crystal'];
const TEMPERATE_THEMES = ['verdant', 'archipelago', 'sakura', 'savanna', 'ruins', 'biolume', 'metropolis', 'ocean'];
const COLD_THEMES = ['glacier', 'barren'];

// ---------------------------------------------------------------------------------------------
// Stars
// ---------------------------------------------------------------------------------------------
const SPECTRAL = [
  { cls: 'O', tMin: 30000, tMax: 42000, r: [6.6, 12], m: [16, 40], w: 0.02 },
  { cls: 'B', tMin: 10000, tMax: 30000, r: [1.8, 6.6], m: [2.1, 16], w: 0.06 },
  { cls: 'A', tMin: 7500, tMax: 10000, r: [1.4, 1.8], m: [1.4, 2.1], w: 0.1 },
  { cls: 'F', tMin: 6000, tMax: 7500, r: [1.15, 1.4], m: [1.04, 1.4], w: 0.16 },
  { cls: 'G', tMin: 5200, tMax: 6000, r: [0.96, 1.15], m: [0.8, 1.04], w: 0.24 },
  { cls: 'K', tMin: 3700, tMax: 5200, r: [0.7, 0.96], m: [0.45, 0.8], w: 0.22 },
  { cls: 'M', tMin: 2400, tMax: 3700, r: [0.1, 0.7], m: [0.08, 0.45], w: 0.2 },
];

/** Approximate blackbody color (sRGB hex) for a temperature in Kelvin. */
export function blackbodyHex(T) {
  const t = clamp(T, 1000, 40000) / 100;
  let r, g, b;
  r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

function makeStar(r, forced) {
  const sp = forced ? SPECTRAL.find((s) => s.cls === forced.cls) : r.weighted(SPECTRAL, SPECTRAL.map((s) => s.w));
  const f = r.next();
  const temperature = forced?.temperature ?? Math.round(sp.tMin + (sp.tMax - sp.tMin) * f);
  const radius = forced?.radius ?? +(sp.r[0] + (sp.r[1] - sp.r[0]) * f).toFixed(3); // solar radii
  const mass = +(sp.m[0] + (sp.m[1] - sp.m[0]) * f).toFixed(3); // solar masses
  const luminosity = +(radius * radius * Math.pow(temperature / 5772, 4)).toFixed(4); // solar L
  let kind = 'main';
  const roll = r.next();
  if (!forced && roll < 0.05) kind = 'giant';
  else if (!forced && roll < 0.08) kind = 'whiteDwarf';
  else if (!forced && roll < 0.2) kind = 'binary';
  const star = { cls: sp.cls, temperature, radius, mass, luminosity, color: blackbodyHex(temperature), kind };
  if (kind === 'giant') { star.radius *= 18; star.temperature = Math.min(star.temperature, 4600); star.color = blackbodyHex(star.temperature); star.luminosity *= 40; }
  if (kind === 'whiteDwarf') { star.radius = 0.012; star.temperature = 14000 + Math.round(r.next() * 12000); star.color = blackbodyHex(star.temperature); star.luminosity = 0.01; }
  if (kind === 'binary') {
    const t2 = Math.round(3000 + r.next() * 4500);
    star.companion = { temperature: t2, radius: +(0.3 + r.next() * 0.7).toFixed(2), color: blackbodyHex(t2), separation: +(0.1 + r.next() * 0.3).toFixed(3) };
  }
  return star;
}

// ---------------------------------------------------------------------------------------------
// Galaxies
// ---------------------------------------------------------------------------------------------
const GALAXY_TYPES = ['spiral', 'barred', 'elliptical', 'lenticular', 'irregular', 'ring'];

export function getGalaxy(id) {
  const seed = hash32(UNIVERSE_SEED, 0x6a1, id);
  const r = new Random(seed);
  if (id === 0) {
    return {
      id, seed, name: 'The Way', type: 'barred', arms: 4, pitch: 13.5, radius: 50000, thickness: 0.06,
      bulge: 0.28, bar: 0.42, starCount: 1.4e11,
      colors: { core: '#ffd9a0', old: '#ffcf96', young: '#9cc8ff', dust: '#2a1408', hii: '#ff5a8a' },
      dust: 0.85, tilt: [0.35, 0.0], blackHole: { mass: 4.3e6, spin: 0.7, diskTemp: 9000, jets: false, name: 'The Heart' },
      home: true,
    };
  }
  const type = r.weighted(GALAXY_TYPES, [0.38, 0.24, 0.16, 0.08, 0.1, 0.04]);
  const tongue = r.pick(['aelian', 'lucent', 'kharic', 'sylvan', 'nordic']);
  const youngHue = r.pick(['#9cc8ff', '#a8d8ff', '#b8b8ff', '#8fe0ff', '#c8a8ff']);
  return {
    id, seed, name: makeName(seed, tongue, r.int(1, 2)), type,
    arms: type === 'spiral' || type === 'barred' ? r.int(2, 5) : 0,
    pitch: +(r.float(9, 26)).toFixed(1),
    radius: Math.round(r.float(15000, 90000)),
    thickness: +(r.float(0.04, 0.1)).toFixed(3),
    bulge: +(type === 'elliptical' ? 1 : r.float(0.12, 0.45)).toFixed(2),
    bar: type === 'barred' ? +(r.float(0.25, 0.55)).toFixed(2) : 0,
    starCount: Math.round(r.float(1e9, 4e11)),
    colors: { core: r.pick(['#ffd9a0', '#ffe2b8', '#ffcf8a']), old: '#ffc890', young: youngHue, dust: '#2a1408', hii: r.pick(['#ff5a8a', '#ff4a6a', '#ff6aa8']) },
    dust: +(type === 'elliptical' ? 0.05 : r.float(0.3, 1.0)).toFixed(2),
    tilt: [+(r.float(-1.2, 1.2)).toFixed(2), +(r.float(0, Math.PI * 2)).toFixed(2)],
    blackHole: { mass: Math.round(10 ** r.float(5.5, 9.8)), spin: +(r.float(0.1, 0.99)).toFixed(2), diskTemp: Math.round(r.float(5000, 20000)), jets: r.bool(0.3), name: 'Core of ' + makeName(seed ^ 77, tongue, 1) },
  };
}

// ---------------------------------------------------------------------------------------------
// Star systems & planets
// ---------------------------------------------------------------------------------------------

/** Curated home system "Aster": every archetype, ordered warm → cold. */
const HOME_PLANETS = [
  { theme: 'forge', name: 'Khar Vesh', radius: 2.6e5, a: 0.32 },
  { theme: 'crystal', name: 'Prismae', radius: 2.8e5, a: 0.5 },
  { theme: 'dune', name: 'Saurak', radius: 3.2e5, a: 0.72 },
  { theme: 'verdant', name: 'Elaria', radius: 3.4e5, a: 1.0, moons: [{ theme: 'barren', name: 'Selen', radius: 1.1e5 }] },
  { theme: 'archipelago', name: 'Maelis', radius: 3.1e5, a: 1.28 },
  { theme: 'sakura', name: 'Hanaori', radius: 2.9e5, a: 1.55 },
  { theme: 'metropolis', name: 'Lyxion', radius: 3.6e5, a: 1.9 },
  { theme: 'savanna', name: 'Ukuru', radius: 3.3e5, a: 2.3 },
  { theme: 'gasgiant', name: 'Orovane', radius: 4.2e6, a: 4.8, rings: true, moons: [{ theme: 'biolume', name: 'Nyxara', radius: 2.4e5 }, { theme: 'ruins', name: 'Ondrast', radius: 2.2e5 }] },
  { theme: 'ocean', name: 'Pelagos', radius: 3.8e5, a: 7.5 },
  { theme: 'glacier', name: 'Isvarr', radius: 2.7e5, a: 11.0 },
];

export function systemSeed(galaxyId, index) { return hash32(UNIVERSE_SEED, 0x5157, galaxyId, index); }

export function getSystem(galaxyId, index) {
  const seed = systemSeed(galaxyId, index);
  const r = new Random(seed);
  const home = galaxyId === 0 && index === 0;
  const star = home ? makeStar(r, { cls: 'G', temperature: 5780, radius: 1.0 }) : makeStar(r);
  const tongue = r.pick(['aelian', 'lucent', 'kharic', 'sylvan', 'nordic']);
  const name = home ? 'Aster' : makeName(seed, tongue, r.int(1, 2));
  const sys = {
    id: `${galaxyId}:${index}`, galaxyId, index, seed, name, star, home,
    planets: [],
    belt: null,
    comets: home ? 3 : r.int(0, 4),
    nebula: {
      seed: hash32(seed, 0x4e42),
      colors: r.pick([
        ['#ff3d6e', '#2ad1c9', '#ffb35c'], ['#c84bff', '#3d8bff', '#ff6a9a'], ['#ff6a3d', '#ffd36a', '#4ad1ff'],
        ['#3dffb0', '#2a6bff', '#d84bff'], ['#ff4a4a', '#ff9a3d', '#6a3dff'],
      ]),
      density: +(r.float(0.4, 1.0)).toFixed(2),
      direction: r.unitVec(),
    },
  };
  const sqrtL = Math.sqrt(star.luminosity);
  const planetDefs = [];
  if (home) {
    HOME_PLANETS.forEach((p) => planetDefs.push({ ...p }));
    sys.belt = { inner: 3.0, outer: 3.8, count: 9000 };
  } else {
    const n = r.int(2, 9);
    let a = r.float(0.18, 0.5) * Math.max(0.4, sqrtL);
    for (let i = 0; i < n; i++) {
      const teq = 278 / Math.sqrt(a / sqrtL); // equilibrium temperature (K), albedo ignored
      const frost = a > 2.7 * sqrtL;
      let theme;
      if (frost && r.bool(0.65)) theme = 'gasgiant';
      else if (teq > 420) theme = r.pick(HOT_THEMES);
      else if (teq > 230) theme = r.bool(0.85) ? r.pick(TEMPERATE_THEMES) : r.pick(HOT_THEMES);
      else theme = r.pick(COLD_THEMES);
      const pr = theme === 'gasgiant' ? r.float(2.5e6, 6e6) : r.float(1.8e5, 4.2e5);
      const moons = [];
      const moonCount = theme === 'gasgiant' ? r.int(1, 4) : r.int(0, 2);
      for (let m = 0; m < moonCount; m++) moons.push({ theme: r.bool(0.7) ? 'barren' : r.pick([...TEMPERATE_THEMES, 'glacier']), radius: r.float(0.7e5, 2.2e5) });
      planetDefs.push({ theme, radius: pr, a, rings: theme === 'gasgiant' ? r.bool(0.55) : r.bool(0.04), moons });
      a *= r.float(1.4, 1.9);
    }
    if (r.bool(0.55)) { const ba = r.float(1.5, 4) * sqrtL; sys.belt = { inner: ba, outer: ba * r.float(1.15, 1.4), count: r.int(3000, 12000) }; }
  }
  planetDefs.forEach((def, i) => sys.planets.push(buildPlanet(sys, def, i, null, tongue)));
  return sys;
}

function buildPlanet(sys, def, index, parent, tongue) {
  const seed = hash32(sys.seed, 0x91a7, parent ? parent.index : -1, index);
  const r = new Random(seed);
  const theme = PLANET_THEMES[def.theme];
  const isGas = def.theme === 'gasgiant';
  const name = def.name || (parent ? `${parent.name} ${String.fromCharCode(97 + index)}` : `${makeName(seed, theme.tongue, r.int(1, 2))}`);
  const radius = def.radius;
  const a = parent ? null : def.a;
  const period = parent ? null : Math.sqrt(a * a * a / Math.max(0.1, sys.star.mass)); // years (Kepler III)
  const planet = {
    id: parent ? `${sys.id}:${parent.index}:m${index}` : `${sys.id}:${index}`,
    systemId: sys.id, index, seed, name, theme: def.theme, themeData: theme,
    kind: isGas ? 'gas' : parent ? 'moon' : 'terrestrial',
    radius,
    gravity: isGas ? 24 : +(9.81 * Math.pow(radius / 3.4e5, 0.6)).toFixed(2),
    dayLength: isGas ? 900 : Math.round(r.float(900, 2400)), // game seconds for a full rotation
    axialTilt: +(r.float(0, 0.45)).toFixed(3),
    orbit: parent
      ? { parent: parent.index, a: +(parent.radius * r.float(8, 30)).toFixed(0), e: +(r.float(0, 0.05)).toFixed(3), i: +(r.float(-0.1, 0.1)).toFixed(3), node: +(r.float(0, Math.PI * 2)).toFixed(3), peri: +(r.float(0, Math.PI * 2)).toFixed(3), M0: +(r.float(0, Math.PI * 2)).toFixed(3), period: +(r.float(0.02, 0.15)).toFixed(4) }
      : { a, e: +(r.float(0, 0.08)).toFixed(3), i: +(r.float(-0.06, 0.06)).toFixed(3), node: +(r.float(0, Math.PI * 2)).toFixed(3), peri: +(r.float(0, Math.PI * 2)).toFixed(3), M0: +(r.float(0, Math.PI * 2)).toFixed(3), period: +period.toFixed(4) },
    terrain: theme.terrain ? { ...theme.terrain, amplitude: theme.terrain.amplitude * r.float(0.85, 1.2), seed: hash32(seed, 7) } : null,
    palette: { ...theme.palette },
    atmosphere: theme.atmosphere ? { ...theme.atmosphere } : null,
    clouds: theme.clouds ? { ...theme.clouds, coverage: clamp(theme.clouds.coverage + r.float(-0.08, 0.08), 0, 1), seed: hash32(seed, 11) } : null,
    ocean: theme.ocean ? { ...theme.ocean } : null,
    bands: theme.bands ? { ...theme.bands, seed: hash32(seed, 13) } : null,
    flora: theme.flora, fauna: theme.fauna,
    civ: { ...theme.civ, seed: hash32(seed, 17), name: makeName(hash32(seed, 19), theme.tongue, 2) },
    rings: def.rings ? { inner: +(r.float(1.25, 1.5)).toFixed(3), outer: +(r.float(1.9, 2.6)).toFixed(3), color: r.pick(['#e8d8c0', '#c8b8a8', '#d8c8e8', '#f2e8d8']), opacity: +(r.float(0.5, 0.9)).toFixed(2), seed: hash32(seed, 23) } : null,
    moons: [],
  };
  if (def.moons) def.moons.forEach((md, mi) => planet.moons.push(buildPlanet(sys, md, mi, planet, tongue)));
  return planet;
}

/** Look up a planet or moon by id string "g:s:p" or "g:s:p:mK". */
export function getPlanet(id) {
  const parts = String(id).split(':');
  const sys = getSystem(+parts[0], +parts[1]);
  const p = sys.planets[+parts[2]];
  if (!p) return null;
  if (parts[3]) return p.moons[+parts[3].slice(1)] || null;
  return p;
}

/** Solve Kepler's equation; returns position [x,y,z] in orbit units (AU or meters for moons) at time t (years). */
export function orbitPosition(orbit, tYears, out = [0, 0, 0]) {
  const n = (Math.PI * 2) / orbit.period;
  const M = orbit.M0 + n * tYears;
  const e = orbit.e;
  let E = M;
  for (let k = 0; k < 8; k++) E = E - (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xv = orbit.a * (Math.cos(E) - e);
  const yv = orbit.a * Math.sqrt(1 - e * e) * Math.sin(E);
  const v = Math.atan2(yv, xv), rr = Math.hypot(xv, yv);
  const cosN = Math.cos(orbit.node), sinN = Math.sin(orbit.node), cosI = Math.cos(orbit.i), sinI = Math.sin(orbit.i);
  const u = v + orbit.peri, cu = Math.cos(u), su = Math.sin(u);
  // y-up convention: orbital plane ≈ XZ
  out[0] = rr * (cosN * cu - sinN * su * cosI);
  out[2] = rr * (sinN * cu + cosN * su * cosI);
  out[1] = rr * (su * sinI);
  return out;
}

export const Universe = { seed: UNIVERSE_SEED, getGalaxy, getSystem, getPlanet, orbitPosition, PLANET_THEMES, THEME_IDS };
export default Universe;

export { roman };
