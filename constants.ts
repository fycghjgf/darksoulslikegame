import { Item, ItemType, Stats } from './types';

export const INITIAL_SOULS = 3000;
export const ROUND_WIN_BONUS = 2000;
export const ROUND_LOSS_BONUS = 1000;
export const MAX_ROUNDS = 3;

// Max quantity per item type
export const INVENTORY_LIMITS: Record<ItemType, number> = {
  [ItemType.WEAPON]: 2,
  [ItemType.ARMOR]: 1,
  [ItemType.ACCESSORY]: 4,
  [ItemType.SPELL]: 2
};

export const BASE_STATS: Stats = {
  hp: 100,
  str: 10,
  dex: 10,
  int: 10,
  def: 0,
  poise: 0
};

export const SHOP_ITEMS: Item[] = [
  // --- Weapons ---
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
    id: 'w_claymore',
    name: '大剑',
    type: ItemType.WEAPON,
    cost: 1000,
    description: '巨大的双手剑。攻击范围大。',
    stats: { },
    scaling: { str: 1.2, dex: 0.6 }
  },
  {
    id: 'w_zweihander',
    name: '双手巨剑',
    type: ItemType.WEAPON,
    cost: 1500,
    description: '超特大剑。能够击晕敌人，但挥舞缓慢。',
    stats: { poise: 20 },
    scaling: { str: 2.0 }
  },
  {
    id: 'w_uchigatana',
    name: '打刀',
    type: ItemType.WEAPON,
    cost: 900,
    description: '东方国度的武士刀。容易造成暴击。',
    stats: { dex: 5 },
    scaling: { dex: 1.6 }
  },
  {
    id: 'w_estoc',
    name: '刺剑',
    type: ItemType.WEAPON,
    cost: 800,
    description: '用于突刺的大剑。可以透过铠甲造成伤害。',
    stats: { },
    scaling: { dex: 1.2, str: 0.4 }
  },
  {
    id: 'w_staff',
    name: '魔法师杖',
    type: ItemType.WEAPON,
    cost: 600,
    description: '施展魔法的触媒。威力取决于智力。',
    stats: { int: 5 },
    scaling: { int: 1.4 }
  },
  {
    id: 'w_moonlight',
    name: '月光大剑',
    type: ItemType.WEAPON,
    cost: 2500,
    description: '传说中的魔力之剑。造成的伤害为魔法属性。',
    stats: { def: 5 },
    scaling: { int: 1.5, str: 0.5 }
  },

  // --- Armor ---
  {
    id: 'a_knight',
    name: '骑士盔甲',
    type: ItemType.ARMOR,
    cost: 600,
    description: '坚固的金属盔甲。提供基础防御。',
    stats: { def: 10, hp: 30 }
  },
  {
    id: 'a_elite',
    name: '上级骑士套装',
    type: ItemType.ARMOR,
    cost: 1000,
    description: '亚斯特拉骑士的著名装备。优秀的防御。',
    stats: { def: 15, hp: 50, poise: 5 }
  },
  {
    id: 'a_blackiron',
    name: '黑铁套装',
    type: ItemType.ARMOR,
    cost: 1400,
    description: '黑铁塔尔卡斯的重甲。极高的物理防御。',
    stats: { def: 25, hp: 80, poise: 15, dex: -5 }
  },
  {
    id: 'a_havel',
    name: '哈维尔套装',
    type: ItemType.ARMOR,
    cost: 2000,
    description: '岩石般的重甲。不仅坚不可摧，还提供强韧度。',
    stats: { def: 35, poise: 40, hp: 100, dex: -10 }
  },
  {
    id: 'a_robes',
    name: '绯红长袍',
    type: ItemType.ARMOR,
    cost: 400,
    description: '封印者的长袍。轻便且能增强魔力。',
    stats: { def: 5, int: 10, dex: 2 }
  },

  // --- Accessories ---
  {
    id: 'r_life',
    name: '生命戒指',
    type: ItemType.ACCESSORY,
    cost: 300,
    description: '提升最大生命值。',
    stats: { hp: 50 }
  },
  {
    id: 'r_chloranthy',
    name: '绿花戒指',
    type: ItemType.ACCESSORY,
    cost: 500,
    description: '提升精力和速度（敏捷）。',
    stats: { dex: 8 }
  },
  {
    id: 'r_havel',
    name: '哈维尔戒指',
    type: ItemType.ACCESSORY,
    cost: 800,
    description: '为了纪念老战友而制。极大提升负重（力量）。',
    stats: { str: 15 }
  },
  {
    id: 'r_fap',
    name: '宠爱与保护戒指',
    type: ItemType.ACCESSORY,
    cost: 1200,
    description: '女神的宠爱。全方位提升生命、体力和精力。',
    stats: { hp: 80, str: 5, dex: 5 }
  },
  {
    id: 'r_steel',
    name: '钢铁庇佑戒指',
    type: ItemType.ACCESSORY,
    cost: 600,
    description: '提升对物理攻击的防御力。',
    stats: { def: 15 }
  },
  {
    id: 'r_rtsr',
    name: '红泪石戒指',
    type: ItemType.ACCESSORY,
    cost: 1500,
    description: '濒死时攻击力大幅提升。',
    stats: { dex: 2, str: 2 } // Logic handled in battle engine
  },
  {
    id: 'r_wolf',
    name: '狼戒指',
    type: ItemType.ACCESSORY,
    cost: 700,
    description: '阿尔特留斯的戒指。提升强韧度。',
    stats: { poise: 30 }
  },
  
  // --- Spells ---
  {
    id: 's_arrow',
    name: '灵魂箭',
    type: ItemType.SPELL,
    cost: 400,
    description: '基础魔法。发射灵魂能量。',
    stats: { int: 8 }
  },
  {
    id: 's_harrow',
    name: '强力灵魂箭',
    type: ItemType.SPELL,
    cost: 800,
    description: '更强的灵魂魔法。',
    stats: { int: 15 }
  },
  {
    id: 's_soulmass',
    name: '灵魂块',
    type: ItemType.SPELL,
    cost: 1200,
    description: '浮游的灵魂块，会自动攻击敌人。',
    stats: { int: 25 }
  },
  {
    id: 's_spear',
    name: '雷枪',
    type: ItemType.SPELL,
    cost: 1000,
    description: '太阳教的奇迹。投掷闪电长枪。',
    stats: { str: 5, int: 10 }
  }
];