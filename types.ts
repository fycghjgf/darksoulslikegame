export enum ItemType {
  WEAPON = 'WEAPON',
  ARMOR = 'ARMOR',
  ACCESSORY = 'ACCESSORY',
  SPELL = 'SPELL'
}

export interface Stats {
  hp: number;
  str: number; // Strength - Heavy weapon dmg
  dex: number; // Dexterity - Fast weapon dmg + initiative
  int: number; // Intelligence - Spell dmg
  def: number; // Defense - Damage reduction
  poise: number; // Poise - Stun resistance (simplified as crit reduce)
}

export interface Item {
  id: string;
  name: string;
  type: ItemType;
  cost: number;
  description: string;
  stats: Partial<Stats>;
  scaling?: {
    str?: number; // Multiplier e.g. 1.5 means 1.5x STR added to dmg
    dex?: number;
    int?: number;
  };
}

export interface Player {
  id: string;
  name: string;
  isAi: boolean;
  souls: number;
  inventory: Item[];
  currentStats: Stats;
  wins: number;
  isReady?: boolean; // For shop phase
}

export enum GamePhase {
  LOGIN = 'LOGIN',
  LOBBY = 'LOBBY',
  WAITING_FOR_OPPONENT = 'WAITING_FOR_OPPONENT',
  SHOP = 'SHOP',
  BATTLE = 'BATTLE',
  ROUND_RESULT = 'ROUND_RESULT',
  GAME_OVER = 'GAME_OVER'
}

export interface CombatLog {
  turn: number;
  attacker: string;
  target: string;
  damage: number;
  action: string; // e.g. "slashed with Claymore"
  isCrit: boolean;
}

export interface GameState {
  phase: GamePhase;
  round: number;
  maxRounds: number;
  roomCode: string | null;
  players: Player[];
  logs: CombatLog[];
  currentTurnIndex: number; // 0 or 1
  roundWinnerId: string | null;
  gameWinnerId: string | null;
}

// Network Types
export type MessageType = 'JOIN' | 'WELCOME' | 'SYNC' | 'ACTION_BUY' | 'ACTION_READY';

export interface NetworkMessage {
  type: MessageType;
  payload?: any;
}
