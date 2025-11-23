import React, { useState, useEffect, useCallback } from 'react';
import { Layout } from './components/Layout';
import { Shop } from './components/Shop';
import { BattleArena } from './components/BattleArena';
import { 
  GamePhase, 
  GameState, 
  Player, 
  Item, 
  Stats, 
  CombatLog 
} from './types';
import { 
  BASE_STATS, 
  INITIAL_SOULS, 
  MAX_ROUNDS, 
  ROUND_WIN_BONUS, 
  ROUND_LOSS_BONUS, 
  SHOP_ITEMS 
} from './constants';
import { generateAiPurchases } from './services/geminiService';
import { Sword, Shield, Skull, Crown } from 'lucide-react';

const createPlayer = (id: string, name: string, isAi: boolean): Player => ({
  id,
  name,
  isAi,
  souls: INITIAL_SOULS,
  inventory: [],
  currentStats: { ...BASE_STATS },
  wins: 0
});

const calculateStats = (player: Player): Stats => {
  const stats = { ...BASE_STATS };
  player.inventory.forEach(item => {
    if (item.stats.hp) stats.hp += item.stats.hp;
    if (item.stats.str) stats.str += item.stats.str;
    if (item.stats.dex) stats.dex += item.stats.dex;
    if (item.stats.int) stats.int += item.stats.int;
    if (item.stats.def) stats.def += item.stats.def;
    if (item.stats.poise) stats.poise += item.stats.poise;
  });
  return stats;
};

export default function App() {
  const [gameState, setGameState] = useState<GameState>({
    phase: GamePhase.LOGIN,
    round: 1,
    maxRounds: MAX_ROUNDS,
    roomCode: null,
    players: [],
    logs: [],
    currentTurnIndex: 0,
    roundWinnerId: null,
    gameWinnerId: null
  });

  const [localPlayerName, setLocalPlayerName] = useState('');
  const [roomInput, setRoomInput] = useState('');

  // Helper to update a specific player
  const updatePlayer = (id: string, updates: Partial<Player>) => {
    setGameState(prev => ({
      ...prev,
      players: prev.players.map(p => p.id === id ? { ...p, ...updates } : p)
    }));
  };

  // --- PHASE: LOGIN & LOBBY ---
  const handleLogin = () => {
    if (!localPlayerName.trim()) return;
    // Simulate "Login" by just setting name and moving to Lobby
    setGameState(prev => ({ ...prev, phase: GamePhase.LOBBY }));
  };

  const handleCreateRoom = (mode: 'PVE' | 'PVP') => {
    const p1 = createPlayer('p1', localPlayerName, false);
    const p2 = mode === 'PVE' 
      ? createPlayer('p2', '暗灵 Gemini', true)
      : createPlayer('p2', '玩家 2', false); // Mock local PVP for now

    setGameState(prev => ({
      ...prev,
      phase: GamePhase.SHOP,
      roomCode: Math.random().toString(36).substring(7).toUpperCase(),
      players: [p1, p2]
    }));
  };

  // --- PHASE: SHOP ---
  const handleBuyItem = (playerId: string, itemId: string) => {
    const player = gameState.players.find(p => p.id === playerId);
    const item = SHOP_ITEMS.find(i => i.id === itemId);
    if (!player || !item) return;
    if (player.souls < item.cost) return;

    const newInventory = [...player.inventory, item];
    // Recalculate stats purely for display/logic, but reset HP to full (base + bonus)
    const newBaseStats = calculateStats({ ...player, inventory: newInventory });

    updatePlayer(playerId, {
      souls: player.souls - item.cost,
      inventory: newInventory,
      currentStats: newBaseStats
    });
  };

  const handleShopReady = async () => {
    // If PVE, AI buys items now
    const p2 = gameState.players[1];
    const p1 = gameState.players[0];

    if (p2.isAi) {
      // AI LOGIC
      const itemsToBuyIds = await generateAiPurchases(p2, p1, gameState.round);
      
      let aiSouls = p2.souls;
      const aiInventory = [...p2.inventory];
      
      itemsToBuyIds.forEach(id => {
        const item = SHOP_ITEMS.find(i => i.id === id);
        if (item && item.cost <= aiSouls) {
          aiSouls -= item.cost;
          aiInventory.push(item);
        }
      });
      
      const aiStats = calculateStats({ ...p2, inventory: aiInventory });
      
      setGameState(prev => {
         const updatedPlayers = [...prev.players];
         updatedPlayers[1] = { 
             ...p2, 
             souls: aiSouls, 
             inventory: aiInventory, 
             currentStats: aiStats 
         };
         return { ...prev, players: updatedPlayers, phase: GamePhase.BATTLE, logs: [] };
      });
    } else {
        // Local PVP: In a real app, we'd wait for P2. Here, we assume P2 (hotseat) is ready or just start.
        // For simplicity of the "Invite friend" requirement being simulated, let's just start.
        setGameState(prev => ({ ...prev, phase: GamePhase.BATTLE, logs: [] }));
    }
  };

  // --- PHASE: BATTLE LOGIC ---
  const executeTurn = useCallback(() => {
    setGameState(prev => {
      const attackerIdx = prev.currentTurnIndex;
      const defenderIdx = attackerIdx === 0 ? 1 : 0;
      const attacker = prev.players[attackerIdx];
      const defender = prev.players[defenderIdx];

      // Calc Damage
      // 1. Find best weapon (highest scaling)
      const weapons = attacker.inventory.filter(i => i.type === 'WEAPON' || i.type === 'SPELL');
      // Default unarmed if no weapon
      let baseDmg = 10;
      let scalingDmg = 0;
      let weaponName = "空手";

      if (weapons.length > 0) {
        // Simple: pick random weapon for variety or first one
        const weapon = weapons[Math.floor(Math.random() * weapons.length)];
        weaponName = weapon.name;
        baseDmg = 20; // Base weapon dmg flat for simplicity
        
        // Apply Scaling
        const s = weapon.scaling || {};
        if (s.str) scalingDmg += attacker.currentStats.str * s.str;
        if (s.dex) scalingDmg += attacker.currentStats.dex * s.dex;
        if (s.int) scalingDmg += attacker.currentStats.int * s.int;
      } else {
         // Unarmed scaling
         scalingDmg += attacker.currentStats.str * 0.5;
      }

      const rawDmg = baseDmg + scalingDmg;
      // Defense mitigation: damage / (1 + def/100) standard RPG formula or flat
      const mitigation = defender.currentStats.def;
      const finalDmg = Math.max(1, Math.floor(rawDmg - mitigation));
      
      // Critical hit chance (Dex based)
      const isCrit = Math.random() < (attacker.currentStats.dex * 0.01);
      const actualDmg = isCrit ? Math.floor(finalDmg * 1.5) : finalDmg;

      // Update Defender HP
      const newDefenderHp = defender.currentStats.hp - actualDmg;
      const newDefenderStats = { ...defender.currentStats, hp: newDefenderHp };

      const newLog: CombatLog = {
        turn: prev.logs.length + 1,
        attacker: attacker.name,
        target: defender.name,
        damage: actualDmg,
        action: `使用 ${weaponName} 攻击了`,
        isCrit
      };

      const updatedPlayers = [...prev.players];
      updatedPlayers[defenderIdx] = { ...defender, currentStats: newDefenderStats };

      // Check Death
      if (newDefenderHp <= 0) {
        return {
          ...prev,
          players: updatedPlayers,
          logs: [...prev.logs, newLog, { turn: prev.logs.length + 2, attacker: 'SYSTEM', target: '', damage: 0, action: `${defender.name} 死亡。`, isCrit: false }],
          roundWinnerId: attacker.id,
          phase: GamePhase.ROUND_RESULT
        };
      }

      return {
        ...prev,
        players: updatedPlayers,
        logs: [...prev.logs, newLog],
        currentTurnIndex: defenderIdx
      };
    });
  }, []);

  // Battle Loop Timer
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (gameState.phase === GamePhase.BATTLE) {
      timer = setTimeout(() => {
        executeTurn();
      }, 1500); // 1.5s per turn
    }
    return () => clearTimeout(timer);
  }, [gameState.phase, gameState.currentTurnIndex, executeTurn]);


  // --- PHASE: ROUND RESULT ---
  useEffect(() => {
    if (gameState.phase === GamePhase.ROUND_RESULT && gameState.roundWinnerId) {
      const timer = setTimeout(() => {
        handleNextRound();
      }, 3000);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.phase]);

  const handleNextRound = () => {
    setGameState(prev => {
      const winnerId = prev.roundWinnerId;
      
      // Update Wins
      const updatedPlayers = prev.players.map(p => {
        const isWinner = p.id === winnerId;
        return {
          ...p,
          souls: p.souls + (isWinner ? ROUND_WIN_BONUS : ROUND_LOSS_BONUS),
          wins: isWinner ? p.wins + 1 : p.wins,
          // Heal for next round logic: Reset HP to calculated Max
          currentStats: calculateStats(p) 
        };
      });

      // Check Game Over (Best of 3)
      const winner = updatedPlayers.find(p => p.wins >= 2);
      if (winner || prev.round >= MAX_ROUNDS) {
        // If max rounds reached, who has more wins?
        const p1Wins = updatedPlayers[0].wins;
        const p2Wins = updatedPlayers[1].wins;
        let finalWinnerId = winner?.id;
        if (!finalWinnerId) {
            if (p1Wins > p2Wins) finalWinnerId = updatedPlayers[0].id;
            else if (p2Wins > p1Wins) finalWinnerId = updatedPlayers[1].id;
            else finalWinnerId = 'DRAW'; // unlikely in bo3
        }

        return {
            ...prev,
            players: updatedPlayers,
            phase: GamePhase.GAME_OVER,
            gameWinnerId: finalWinnerId || null
        };
      }

      return {
        ...prev,
        players: updatedPlayers,
        round: prev.round + 1,
        roundWinnerId: null,
        logs: [],
        phase: GamePhase.SHOP // Go back to shop
      };
    });
  };

  const resetGame = () => {
    setGameState({
      phase: GamePhase.LOBBY,
      round: 1,
      maxRounds: MAX_ROUNDS,
      roomCode: null,
      players: [],
      logs: [],
      currentTurnIndex: 0,
      roundWinnerId: null,
      gameWinnerId: null
    });
  };

  // --- RENDER HELPERS ---
  const renderLogin = () => (
    <div className="flex flex-col items-center justify-center h-[60vh] gap-8 animate-fade-in">
      <div className="text-center space-y-2">
        <h2 className="text-4xl font-display text-souls-text">输入你的名字, 不死人</h2>
        <p className="text-souls-muted">准备受死，或者夺取余火。</p>
      </div>
      <input
        type="text"
        value={localPlayerName}
        onChange={(e) => setLocalPlayerName(e.target.value)}
        placeholder="角色名..."
        className="bg-transparent border-b-2 border-souls-gray text-center text-2xl p-2 focus:border-souls-gold outline-none text-souls-gold placeholder-gray-700 transition-colors"
        maxLength={12}
      />
      <button
        onClick={handleLogin}
        disabled={!localPlayerName}
        className="px-8 py-3 border border-souls-gray hover:border-souls-gold hover:text-souls-gold transition-all uppercase tracking-[0.2em]"
      >
        开始旅程
      </button>
    </div>
  );

  const renderLobby = () => (
    <div className="flex flex-col items-center justify-center h-[60vh] gap-8 animate-fade-in">
      <h2 className="text-3xl font-display text-souls-gold mb-4">篝火已点燃</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-2xl">
        <div className="p-8 border border-souls-gray hover:border-souls-text transition-all cursor-pointer bg-souls-dark/50 flex flex-col items-center gap-4 group"
             onClick={() => handleCreateRoom('PVE')}>
           <Skull className="w-12 h-12 text-souls-muted group-hover:text-souls-red transition-colors" />
           <div className="text-center">
             <h3 className="text-xl font-bold uppercase tracking-wider mb-2">挑战灵体</h3>
             <p className="text-sm text-souls-muted">对抗由 Gemini 驱动的暗灵 AI。</p>
           </div>
        </div>

        <div className="p-8 border border-souls-gray hover:border-souls-text transition-all cursor-pointer bg-souls-dark/50 flex flex-col items-center gap-4 group"
             onClick={() => handleCreateRoom('PVP')}>
           <Sword className="w-12 h-12 text-souls-muted group-hover:text-souls-gold transition-colors" />
           <div className="text-center">
             <h3 className="text-xl font-bold uppercase tracking-wider mb-2">决斗</h3>
             <p className="text-sm text-souls-muted">创建一个房间进行本地双人对战。</p>
           </div>
        </div>
      </div>

      <div className="mt-8 w-full max-w-md">
        <p className="text-xs text-center text-souls-muted uppercase mb-2">或者加入特定的灵魂频率</p>
        <div className="flex gap-2">
            <input 
                type="text" 
                value={roomInput} 
                onChange={(e) => setRoomInput(e.target.value)}
                placeholder="输入房间代码" 
                className="flex-grow bg-souls-dark border border-souls-gray p-2 text-center uppercase"
            />
            <button className="px-4 border border-souls-gray hover:bg-souls-gray">加入</button>
        </div>
      </div>
    </div>
  );

  const renderGameOver = () => {
     const winner = gameState.players.find(p => p.id === gameState.gameWinnerId);
     return (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/90 animate-fade-in">
           <h1 className="text-6xl md:text-8xl font-display text-souls-gold mb-8 tracking-widest uppercase drop-shadow-[0_0_25px_rgba(255,215,0,0.5)] text-center">
              {gameState.gameWinnerId === localPlayerName || (gameState.players[0].id === gameState.gameWinnerId && !gameState.players[0].isAi) 
                ? '战胜' 
                : '你死了'}
           </h1>
           <p className="text-xl text-souls-muted font-serif italic mb-12">
              胜利者: {winner?.name}
           </p>
           <button 
             onClick={resetGame}
             className="px-8 py-3 border border-souls-gold text-souls-gold hover:bg-souls-gold hover:text-black transition-all uppercase tracking-widest"
            >
              返回篝火
           </button>
        </div>
     )
  };

  const renderRoundResult = () => (
      <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none">
          <div className="bg-black/80 p-8 border-y-2 border-souls-gold w-full text-center transform transition-all animate-pulse-slow">
              <h2 className="text-4xl font-display text-souls-red uppercase tracking-[0.5em]">
                  回合结束
              </h2>
              <p className="text-souls-muted mt-2">正在准备下一个轮回...</p>
          </div>
      </div>
  );

  return (
    <Layout>
      {gameState.phase === GamePhase.GAME_OVER && renderGameOver()}
      
      {/* Header Stats for Game */}
      {gameState.phase !== GamePhase.LOGIN && gameState.phase !== GamePhase.LOBBY && (
          <div className="flex justify-between items-center mb-4 border-b border-white/10 pb-2">
             <div className="flex gap-4">
                 {gameState.players.map(p => (
                     <div key={p.id} className={`flex items-center gap-2 ${p.wins > 0 ? 'text-souls-gold' : 'text-gray-500'}`}>
                         <Crown size={16} className={p.wins > 0 ? 'fill-current' : ''} />
                         <span className="font-bold">{p.name}: {p.wins}</span>
                     </div>
                 ))}
             </div>
             <div className="font-display text-xl text-souls-red">回合 {gameState.round} / {gameState.maxRounds}</div>
          </div>
      )}

      {gameState.phase === GamePhase.LOGIN && renderLogin()}
      {gameState.phase === GamePhase.LOBBY && renderLobby()}
      
      {gameState.phase === GamePhase.SHOP && gameState.players.length > 0 && (
        <Shop 
          player={gameState.players[0]} // Always show P1 view for simplicity in this demo
          onBuy={(itemId) => handleBuyItem(gameState.players[0].id, itemId)}
          onReady={handleShopReady}
        />
      )}

      {(gameState.phase === GamePhase.BATTLE || gameState.phase === GamePhase.ROUND_RESULT) && (
        <>
            {gameState.phase === GamePhase.ROUND_RESULT && renderRoundResult()}
            <BattleArena 
                p1={gameState.players[0]} 
                p2={gameState.players[1]} 
                logs={gameState.logs} 
                currentTurnId={gameState.players[gameState.currentTurnIndex].id}
            />
        </>
      )}
    </Layout>
  );
}