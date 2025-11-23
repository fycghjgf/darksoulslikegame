import { Item, ItemType, Stats } from './types';

export const INITIAL_SOULS = 2500;
export const ROUND_WIN_BONUS = 1500;
export const ROUND_LOSS_BONUS = 800;
export const MAX_ROUNDS = 3;

export const BASE_STATS: Stats = {
  hp: 100,
  str: 10,
  dex: 10,
  int: 10,
  def: 0,
  poise: 0
};

export const SHOP_ITEMS: Item[] = [
  // Weapons
  {
    id: 'w_longsword',
    name: '长剑',
    type: ItemType.WEAPON,
    cost: 500,
    description: '一把广泛使用的直剑。平衡且可靠。',
    stats: { },
    scaling: { str: 0.8, dex: 0.8 }
  },
  {
    id: 'w_greatsword',
    name: '巨剑',
    type: ItemType.WEAPON,
    cost: 1200,
    description: '巨大的铁块。需要极大的力量才能挥舞。',
    stats: { },
    scaling: { str: 1.8, dex: 0.2 }
  },
  {
    id: 'w_uchigatana',
    name: '打刀',
    type: ItemType.WEAPON,
    cost: 900,
    description: '锻造于东方国度的武士刀。锋利且迅速。',
    stats: { },
    scaling: { dex: 1.6 }
  },
  {
    id: 'w_staff',
    name: '魔法师杖',
    type: ItemType.WEAPON,
    cost: 800,
    description: '施展魔法的触媒。威力取决于智力。',
    stats: { },
    scaling: { int: 1.5 }
  },
  {
    id: 'w_moonlight',
    name: '月光大剑',
    type: ItemType.WEAPON,
    cost: 2500,
    description: '传说中的剑，反射着月光。',
    stats: { },
    scaling: { int: 1.2, str: 0.5 }
  },

  // Armor
  {
    id: 'a_knight',
    name: '骑士盔甲',
    type: ItemType.ARMOR,
    cost: 600,
    description: '坚固的金属盔甲。提供基础防御。',
    stats: { def: 5, hp: 20 }
  },
  {
    id: 'a_havel',
    name: '哈维尔套装',
    type: ItemType.ARMOR,
    cost: 1500,
    description: '从巨石中雕刻出的盔甲。极其沉重。',
    stats: { def: 15, poise: 20, hp: 50 }
  },
  {
    id: 'a_robes',
    name: '绯红长袍',
    type: ItemType.ARMOR,
    cost: 400,
    description: '被淹没城市的魔法师所穿的长袍。',
    stats: { def: 2, int: 5 }
  },

  // Accessories
  {
    id: 'r_life',
    name: '生命戒指',
    type: ItemType.ACCESSORY,
    cost: 300,
    description: '微弱地提升最大生命值。',
    stats: { hp: 40 }
  },
  {
    id: 'r_chloranthy',
    name: '绿花戒指',
    type: ItemType.ACCESSORY,
    cost: 500,
    description: '稍微提升速度（敏捷）。',
    stats: { dex: 5 }
  },
  {
    id: 'r_havel',
    name: '哈维尔戒指',
    type: ItemType.ACCESSORY,
    cost: 800,
    description: '显著提升负重能力（力量）。',
    stats: { str: 10 }
  },
  
  // Spells
  {
    id: 's_arrow',
    name: '灵魂箭',
    type: ItemType.SPELL,
    cost: 400,
    description: '基础魔法。造成纯粹的魔法伤害。',
    stats: { int: 8 }
  },
  {
    id: 's_spear',
    name: '雷枪',
    type: ItemType.SPELL,
    cost: 1000,
    description: '太阳教的奇迹。投掷闪电长枪。',
    stats: { str: 5, int: 5 }
  }
];