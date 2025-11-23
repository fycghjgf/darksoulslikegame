import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Layout } from './components/Layout';
import { Shop } from './components/Shop';
import { BattleArena } from './components/BattleArena';
import { 
  GamePhase, 
  GameState, 
  Player, 
  Stats, 
  CombatLog,
  NetworkMessage,
  ItemType
} from './types';
import { 
  BASE_STATS, 
  INITIAL_SOULS, 
  MAX_ROUNDS, 
  ROUND_WIN_BONUS, 
  ROUND_LOSS_BONUS, 
  SHOP_ITEMS,
  INVENTORY_LIMITS
} from './constants';
import { generateAiPurchases } from './services/geminiService';
import { Skull, Crown, Users, Copy, Loader2, RefreshCw } from 'lucide-react';

const createPlayer = (id: string, name: string, isAi: boolean): Player => ({
  id,
  name,
  isAi,
  souls: INITIAL_SOULS,
  inventory: [],
  currentStats: { ...BASE_STATS },
  wins: 0,
  isReady: false
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
  // --- STATE ---
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
  
  // Networking State
  const [isHost, setIsHost] = useState(false);
  const [myPlayerId, setMyPlayerId] = useState<string>('');
  const [isConnected, setIsConnected] = useState(false);
  
  // REFS for Networking (Solves Stale Closures) and Async Locks
  const channelRef = useRef<BroadcastChannel | null>(null);
  const isHostRef = useRef(false);
  const gameStateRef = useRef(gameState);
  const connectionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startingBattleRef = useRef(false);

  // Sync refs
  useEffect(() => { isHostRef.current = isHost; }, [isHost]);
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

  // --- NETWORKING HELPERS ---
  const broadcast = useCallback((msg: NetworkMessage) => {
    if (channelRef.current) {
      channelRef.current.postMessage(msg);
    }
  }, []);

  // HOST HEARTBEAT: Broadcast state every 2s to ensure clients sync even if they miss packets
  useEffect(() => {
    if (!isHost || !gameState.roomCode) return;
    
    const interval = setInterval(() => {
        // Only broadcast if we have players (or waiting for them)
        if (gameStateRef.current.phase !== GamePhase.LOGIN) {
            broadcast({ type: 'SYNC', payload: gameStateRef.current });
        }
    }, 2000);

    return () => clearInterval(interval);
  }, [isHost, broadcast]); // Intentionally minimal dependencies, uses gameStateRef

  // Helper to process a buy action (state update only)
  const processBuyItem = (state: GameState, playerId: string, itemId: string): GameState => {
      const player = state.players.find(p => p.id === playerId);
      const item = SHOP_ITEMS.find(i => i.id === itemId);
      if (!player || !item) return state;
      if (player.souls < item.cost) return state;

      // CHECK LIMITS
      const typeCount = player.inventory.filter(i => i.type === item.type).length;
      if (typeCount >= INVENTORY_LIMITS[item.type]) {
          return state;
      }

      const newInventory = [...player.inventory, item];
      const newStats = calculateStats({ ...player, inventory: newInventory });
      
      const updatedPlayers = state.players.map(p => 
          p.id === playerId 
          ? { ...p, souls: p.souls - item.cost, inventory: newInventory, currentStats: newStats }
          : p
      );
      return { ...state, players: updatedPlayers };
  };

  // Handle incoming messages
  const handleMessage = useCallback((msg: NetworkMessage) => {
    const amIHost = isHostRef.current;

    // --- CLIENT LOGIC ---
    if (!amIHost) {
      if (msg.type === 'SYNC' || msg.type === 'WELCOME') {
        const serverState = msg.payload as GameState;
        
        // Check if I am in the game
        const amIInList = serverState.players.some(p => p.id === myPlayerId);

        if (amIInList) {
             // SUCCESS: I am officially connected
             if (connectionIntervalRef.current) {
                 clearInterval(connectionIntervalRef.current);
                 connectionIntervalRef.current = null;
             }
             setIsConnected(true);
             setGameState(serverState);
        } else {
             // FAILURE: I am not in the list yet. Keep retrying (handled by handleJoinRoom interval)
             // But we can optionally sync the phase if we want to see the lobby
        }
      }
      return;
    } 

    // --- HOST LOGIC ---
    if (amIHost) {
      const current = gameStateRef.current;

      if (msg.type === 'JOIN') {
        // Idempotency check: Is player already in?
        const existingPlayer = current.players.find(p => p.id === msg.payload.id);
        if (existingPlayer) {
            // Already joined, just resend state immediately so they stop asking
            broadcast({ type: 'SYNC', payload: current });
            return;
        }

        // Add new player
        setGameState(prev => {
           // Double check inside setter to prevent race conditions
           if (prev.players.find(p => p.id === msg.payload.id)) return prev;
           
           // If p2 spot is taken by someone else, ignore
           if (prev.players.length >= 2) return prev;

           const p2 = createPlayer(msg.payload.id, msg.payload.name, false);
           const newState = {
             ...prev,
             players: [...prev.players, p2],
             phase: GamePhase.SHOP
           };
           
           // Immediate response
           setTimeout(() => broadcast({ type: 'WELCOME', payload: newState }), 0);
           return newState;
        });
      }
      
      if (msg.type === 'ACTION_BUY') {
        const { playerId, itemId } = msg.payload;
        setGameState(prev => {
            const newState = processBuyItem(prev, playerId, itemId);
            setTimeout(() => broadcast({ type: 'SYNC', payload: newState }), 0);
            return newState;
        });
      }

      if (msg.type === 'ACTION_READY') {
         const { playerId } = msg.payload;
         setGameState(prev => {
             const updatedPlayers = prev.players.map(p => p.id === playerId ? { ...p, isReady: true } : p);
             const newState = { ...prev, players: updatedPlayers };
             broadcast({ type: 'SYNC', payload: newState });
             return newState;
         });
      }
    }
  }, [broadcast, myPlayerId]); // Add myPlayerId to deps

  // --- SETUP CHANNEL ---
  const setupChannel = (code: string) => {
    if (channelRef.current) {
        channelRef.current.close();
    }
    console.log(`Setting up channel: souls-room-${code}`);
    const ch = new BroadcastChannel(`souls-room-${code}`);
    ch.onmessage = (e) => handleMessage(e.data);
    channelRef.current = ch;
  };

  // --- GAME ACTIONS ---

  const handleLogin = () => {
    if (!localPlayerName.trim()) return;
    const pid = `p-${Math.random().toString(36).substr(2, 9)}`;
    setMyPlayerId(pid);
    setGameState(prev => ({ ...prev, phase: GamePhase.LOBBY }));
  };

  const handleCreateRoom = (mode: 'PVE' | 'PVP') => {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    setupChannel(code);
    setIsHost(true);
    setIsConnected(true);

    const p1 = createPlayer(myPlayerId, localPlayerName, false);

    if (mode === 'PVE') {
      const p2 = createPlayer('ai-gemini', '暗灵 Gemini', true);
      setGameState(prev => ({
        ...prev,
        phase: GamePhase.SHOP,
        roomCode: code,
        players: [p1, p2]
      }));
    } else {
      setGameState(prev => ({
        ...prev,
        phase: GamePhase.WAITING_FOR_OPPONENT,
        roomCode: code,
        players: [p1] 
      }));
    }
  };

  const handleJoinRoom = () => {
    if (!roomInput.trim()) return;
    const code = roomInput.trim().toUpperCase();
    setupChannel(code);
    setIsHost(false);
    setIsConnected(false); // Reset connection status
    
    // Set local state to waiting, so UI updates
    setGameState(prev => ({
        ...prev,
        roomCode: code,
        phase: GamePhase.WAITING_FOR_OPPONENT 
    }));

    if (connectionIntervalRef.current) clearInterval(connectionIntervalRef.current);
    
    // POLL FOR ENTRY
    // We keep sending JOIN requests until we receive a SYNC containing our ID
    const sendJoin = () => {
        if (channelRef.current) {
            console.log("Sending JOIN request...");
            channelRef.current.postMessage({ 
                type: 'JOIN', 
                payload: { id: myPlayerId, name: localPlayerName } 
            });
        }
    };
    sendJoin();
    connectionIntervalRef.current = setInterval(sendJoin, 1000);
  };

  const handleBuyItemRequest = (itemId: string) => {
      if (!isHost) {
          broadcast({ type: 'ACTION_BUY', payload: { playerId: myPlayerId, itemId } });
          return;
      }
      setGameState(prev => {
          const newState = processBuyItem(prev, myPlayerId, itemId);
          broadcast({ type: 'SYNC', payload: newState });
          return newState;
      });
  };

  const handleShopReady = async () => {
    if (!isHost) {
        broadcast({ type: 'ACTION_READY', payload: { playerId: myPlayerId } });
        // Optimistic update for UI responsiveness
        setGameState(prev => ({
            ...prev,
            players: prev.players.map(p => p.id === myPlayerId ? { ...p, isReady: true } : p)
        }));
        return;
    }

    setGameState(prev => {
        const updatedPlayers = prev.players.map(p => p.id === myPlayerId ? { ...p, isReady: true } : p);
        const newState = { ...prev, players: updatedPlayers };
        broadcast({ type: 'SYNC', payload: newState });
        return newState;
    });
  };

  // CHECK IF ALL READY (HOST ONLY)
  useEffect(() => {
    if (!isHost) return;
    if (gameState.phase !== GamePhase.SHOP) return;
    if (gameState.players.length < 2) return;
    
    // Fix: In PvE, the AI is always ready. In PvP, we wait for both.
    const allReady = gameState.players.every(p => p.isReady || p.isAi);
    
    if (allReady && !startingBattleRef.current) {
        startingBattleRef.current = true;
        console.log("Starting Battle Phase...");
        startBattlePhase().catch(err => {
            console.error("Error starting battle:", err);
            startingBattleRef.current = false;
        }).finally(() => {
            // Once we start, we don't expect to run this effect again until next shop phase
            // We release the lock at end of phase transition if needed, but since
            // component state changes to BATTLE, this useEffect won't run again immediately.
            startingBattleRef.current = false;
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.players, gameState.phase, isHost]);

  const startBattlePhase = async () => {
      const aiPlayer = gameState.players.find(p => p.isAi);
      const humanPlayer = gameState.players.find(p => !p.isAi);
      
      let finalPlayers = [...gameState.players];

      if (aiPlayer && humanPlayer) {
          const itemsToBuyIds = await generateAiPurchases(aiPlayer, humanPlayer, gameState.round);
          let aiSouls = aiPlayer.souls;
          const aiInventory = [...aiPlayer.inventory];
          itemsToBuyIds.forEach(id => {
              const item = SHOP_ITEMS.find(i => i.id === id);
              if (!item) return;

              // Simple check for limits in AI logic (though gemini service should handle, good to double check)
              const typeCount = aiInventory.filter(aiI => aiI.type === item.type).length;

              if (item.cost <= aiSouls && typeCount < INVENTORY_LIMITS[item.type]) {
                  aiSouls -= item.cost;
                  aiInventory.push(item);
              }
          });
          const aiStats = calculateStats({ ...aiPlayer, inventory: aiInventory });
          finalPlayers = finalPlayers.map(p => p.id === aiPlayer.id ? { ...p, souls: aiSouls, inventory: aiInventory, currentStats: aiStats } : p);
      }

      finalPlayers = finalPlayers.map(p => ({ ...p, isReady: false }));

      const battleStartState = {
          ...gameState,
          players: finalPlayers,
          phase: GamePhase.BATTLE,
          logs: []
      };

      setGameState(battleStartState);
      broadcast({ type: 'SYNC', payload: battleStartState });
  };

  // --- LOGIC: BATTLE ---
  const executeTurn = useCallback(() => {
    if (!isHost) return; 

    setGameState(prev => {
      const attackerIdx = prev.currentTurnIndex;
      const defenderIdx = attackerIdx === 0 ? 1 : 0;
      const attacker = prev.players[attackerIdx];
      const defender = prev.players[defenderIdx];

      // Damage Logic
      const weapons = attacker.inventory.filter(i => i.type === 'WEAPON' || i.type === 'SPELL');
      let baseDmg = 10;
      let scalingDmg = 0;
      let weaponName = "空手";
      let isMagic = false;

      if (weapons.length > 0) {
        const weapon = weapons[Math.floor(Math.random() * weapons.length)];
        weaponName = weapon.name;
        baseDmg = 20; 
        isMagic = weapon.type === ItemType.SPELL || weapon.name.includes("月光");
        const s = weapon.scaling || {};
        if (s.str) scalingDmg += attacker.currentStats.str * (s.str || 0);
        if (s.dex) scalingDmg += attacker.currentStats.dex * (s.dex || 0);
        if (s.int) scalingDmg += attacker.currentStats.int * (s.int || 0);
      } else {
         scalingDmg += attacker.currentStats.str * 0.5;
      }

      // Red Tearstone Ring Logic
      const hasRTSR = attacker.inventory.some(i => i.id === 'r_rtsr');
      const maxHp = 100 + (attacker.inventory.reduce((a,i)=>a+(i.stats.hp||0),0));
      const lowHp = (attacker.currentStats.hp / maxHp) < 0.2;
      let dmgMultiplier = 1;
      if (hasRTSR && lowHp) dmgMultiplier = 1.5;

      const rawDmg = (baseDmg + scalingDmg) * dmgMultiplier;
      const mitigation = defender.currentStats.def;
      
      const finalDmg = Math.max(1, Math.floor(rawDmg - mitigation));
      
      const isCrit = Math.random() < (attacker.currentStats.dex * 0.01);
      const actualDmg = isCrit ? Math.floor(finalDmg * 1.5) : finalDmg;

      const newDefenderHp = defender.currentStats.hp - actualDmg;
      const newDefenderStats = { ...defender.currentStats, hp: newDefenderHp };

      let actionText = `使用 ${weaponName} 攻击了`;
      if (isMagic) actionText = `施放 ${weaponName} 击中了`;
      if (hasRTSR && lowHp) actionText += " (红泪石激活!)";

      const newLog: CombatLog = {
        turn: prev.logs.length + 1,
        attacker: attacker.name,
        target: defender.name,
        damage: actualDmg,
        action: actionText,
        isCrit
      };

      const updatedPlayers = [...prev.players];
      updatedPlayers[defenderIdx] = { ...defender, currentStats: newDefenderStats };

      let nextState = { ...prev };

      if (newDefenderHp <= 0) {
        nextState = {
          ...prev,
          players: updatedPlayers,
          logs: [...prev.logs, newLog, { turn: prev.logs.length + 2, attacker: 'SYSTEM', target: '', damage: 0, action: `${defender.name} 死亡。`, isCrit: false }],
          roundWinnerId: attacker.id,
          phase: GamePhase.ROUND_RESULT
        };
      } else {
        nextState = {
          ...prev,
          players: updatedPlayers,
          logs: [...prev.logs, newLog],
          currentTurnIndex: defenderIdx
        };
      }
      
      // Host syncs after turn
      broadcast({ type: 'SYNC', payload: nextState });
      return nextState;
    });
  }, [isHost, broadcast]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (isHost && gameState.phase === GamePhase.BATTLE) {
      timer = setTimeout(() => {
        executeTurn();
      }, 1500);
    }
    return () => clearTimeout(timer);
  }, [gameState.phase, gameState.currentTurnIndex, executeTurn, isHost]);

  useEffect(() => {
    if (isHost && gameState.phase === GamePhase.ROUND_RESULT && gameState.roundWinnerId) {
      const timer = setTimeout(() => {
        handleNextRound();
      }, 3000);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.phase, isHost]);

  const handleNextRound = () => {
    setGameState(prev => {
      const winnerId = prev.roundWinnerId;
      const updatedPlayers = prev.players.map(p => {
        const isWinner = p.id === winnerId;
        return {
          ...p,
          souls: p.souls + (isWinner ? ROUND_WIN_BONUS : ROUND_LOSS_BONUS),
          wins: isWinner ? p.wins + 1 : p.wins,
          currentStats: calculateStats(p), // Heal
          isReady: false
        };
      });

      const winner = updatedPlayers.find(p => p.wins >= 2);
      let nextState;
      
      if (winner || prev.round >= MAX_ROUNDS) {
        const p1Wins = updatedPlayers[0].wins;
        const p2Wins = updatedPlayers[1].wins;
        let finalWinnerId = winner?.id;
        if (!finalWinnerId) {
             finalWinnerId = p1Wins >= p2Wins ? updatedPlayers[0].id : updatedPlayers[1].id;
        }
        nextState = {
            ...prev,
            players: updatedPlayers,
            phase: GamePhase.GAME_OVER,
            gameWinnerId: finalWinnerId
        };
      } else {
        nextState = {
            ...prev,
            players: updatedPlayers,
            round: prev.round + 1,
            roundWinnerId: null,
            logs: [],
            phase: GamePhase.SHOP
        };
      }
      
      broadcast({ type: 'SYNC', payload: nextState });
      return nextState;
    });
  };

  const resetGame = () => {
    if (channelRef.current) channelRef.current.close();
    if (connectionIntervalRef.current) clearInterval(connectionIntervalRef.current);
    
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
    setIsHost(false);
    setIsConnected(false);
  };

  // --- RENDERS ---
  const renderLogin = () => (
    <div className="flex flex-col items-center justify-center h-[60vh] gap-8 animate-fade-in z-20 relative">
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
    <div className="flex flex-col items-center justify-center h-[60vh] gap-8 animate-fade-in relative z-20">
      <h2 className="text-3xl font-display text-souls-gold mb-4">篝火已点燃</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-2xl">
        <div className="p-8 border border-souls-gray hover:border-souls-text transition-all cursor-pointer bg-souls-dark/50 flex flex-col items-center gap-4 group"
             onClick={() => handleCreateRoom('PVE')}>
           <Skull className="w-12 h-12 text-souls-muted group-hover:text-souls-red transition-colors" />
           <div className="text-center">
             <h3 className="text-xl font-bold uppercase tracking-wider mb-2">挑战暗灵 (PVE)</h3>
             <p className="text-sm text-souls-muted">对抗由 Gemini 驱动的 AI。</p>
           </div>
        </div>

        <div className="p-8 border border-souls-gray hover:border-souls-text transition-all cursor-pointer bg-souls-dark/50 flex flex-col items-center gap-4 group"
             onClick={() => handleCreateRoom('PVP')}>
           <Users className="w-12 h-12 text-souls-muted group-hover:text-souls-gold transition-colors" />
           <div className="text-center">
             <h3 className="text-xl font-bold uppercase tracking-wider mb-2">主持房间 (PVP)</h3>
             <p className="text-sm text-souls-muted">创建一个房间并邀请朋友。</p>
           </div>
        </div>
      </div>

      <div className="mt-8 w-full max-w-md border-t border-souls-gray/30 pt-6">
        <p className="text-xs text-center text-souls-muted uppercase mb-4">或者加入灵体世界</p>
        <div className="flex gap-2">
            <input 
                type="text" 
                value={roomInput} 
                onChange={(e) => setRoomInput(e.target.value)}
                placeholder="输入房间代码" 
                className="flex-grow bg-souls-dark border border-souls-gray p-2 text-center uppercase tracking-widest text-lg font-bold"
            />
            <button 
                onClick={handleJoinRoom}
                className="px-6 border border-souls-gray hover:bg-souls-gray text-souls-gold font-bold uppercase"
            >
                加入
            </button>
        </div>
      </div>
    </div>
  );

  const renderWaiting = () => (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-8 animate-fade-in relative z-20">
          {isHost ? (
              <>
                <Loader2 className="w-16 h-16 text-souls-gold animate-spin" />
                <div className="text-center">
                    <h2 className="text-2xl font-display text-white mb-2">等待挑战者...</h2>
                    <p className="text-souls-muted mb-6">分享此代码给你的对手</p>
                    <div className="flex items-center gap-4 bg-souls-gray/30 p-4 rounded border border-souls-gold/30">
                        <span className="text-4xl font-mono font-bold text-souls-gold tracking-[0.5em]">{gameState.roomCode}</span>
                        <button onClick={() => navigator.clipboard.writeText(gameState.roomCode || '')} className="p-2 hover:bg-white/10 rounded">
                            <Copy size={20} />
                        </button>
                    </div>
                </div>
              </>
          ) : (
             <>
                {isConnected ? (
                    <div className="flex flex-col items-center gap-4">
                        <Users className="w-16 h-16 text-green-500" />
                        <h2 className="text-2xl font-display text-white">已连接!</h2>
                        <p className="text-souls-muted">等待房主开始...</p>
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-4">
                        <RefreshCw className="w-16 h-16 text-souls-red animate-spin" />
                        <h2 className="text-2xl font-display text-white">正在入侵世界 {gameState.roomCode}...</h2>
                        <p className="text-souls-muted">正在同步灵体频率...</p>
                    </div>
                )}
             </>
          )}
          <button onClick={resetGame} className="mt-8 text-sm text-red-500 hover:underline">取消</button>
      </div>
  );

  const myPlayer = gameState.players.find(p => p.id === myPlayerId) || gameState.players[0];

  return (
    <Layout>
      {gameState.roomCode && (
          <div className="absolute top-4 right-4 z-50 bg-black/50 px-3 py-1 border border-white/10 text-xs text-souls-muted font-mono flex gap-2">
              <span>ROOM: {gameState.roomCode}</span>
              <span>|</span>
              <span className={isHost ? 'text-souls-gold' : 'text-blue-400'}>{isHost ? 'HOST' : 'CLIENT'}</span>
              <span>|</span>
              <span className={isConnected || isHost ? 'text-green-500' : 'text-red-500'}>
                  {isConnected || isHost ? 'ONLINE' : 'CONNECTING...'}
              </span>
          </div>
      )}

      {/* GAME OVER SCREEN */}
      {gameState.phase === GamePhase.GAME_OVER && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black animate-fade-in">
             <div className="absolute inset-0 bg-red-900/20 mix-blend-overlay pointer-events-none"></div>
             
             <h1 className={`text-6xl md:text-9xl font-display mb-8 tracking-widest uppercase scale-150 drop-shadow-[0_0_30px_rgba(139,0,0,0.8)] text-center animate-you-died ${
                gameState.gameWinnerId === myPlayerId || (isHost && gameState.gameWinnerId === gameState.players[0].id && gameState.players[0].isAi === false)
                ? 'text-souls-gold' 
                : 'text-souls-red'
             }`}>
                {gameState.gameWinnerId === myPlayerId || (isHost && gameState.gameWinnerId === gameState.players[0].id && gameState.players[0].isAi === false)
                  ? 'VICTORY ACH' 
                  : 'YOU DIED'}
             </h1>
             <p className="text-2xl text-souls-muted font-serif italic mb-12 relative z-10">
                胜利者: {gameState.players.find(p => p.id === gameState.gameWinnerId)?.name}
             </p>
             <button onClick={resetGame} className="relative z-10 px-8 py-3 border border-souls-muted text-souls-muted hover:border-white hover:text-white transition-all uppercase tracking-widest">
                返回篝火
             </button>
          </div>
      )}

      {gameState.phase === GamePhase.ROUND_RESULT && (
          <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none">
              <div className="bg-black/80 p-8 border-y-2 border-souls-gold w-full text-center transform transition-all animate-pulse-slow">
                  <h2 className="text-4xl font-display text-souls-red uppercase tracking-[0.5em]">回合结束</h2>
                  <p className="text-souls-muted mt-2">正在准备下一个轮回...</p>
              </div>
          </div>
      )}

      {gameState.phase === GamePhase.LOGIN ? renderLogin() :
       gameState.phase === GamePhase.LOBBY ? renderLobby() :
       gameState.phase === GamePhase.WAITING_FOR_OPPONENT ? renderWaiting() :
       null}

      {(gameState.phase === GamePhase.SHOP || gameState.phase === GamePhase.BATTLE || gameState.phase === GamePhase.ROUND_RESULT) && (
        <div className="flex flex-col h-full">
            <div className="flex justify-between items-center mb-4 border-b border-white/10 pb-2">
                 <div className="flex gap-4">
                     {gameState.players.map(p => (
                         <div key={p.id} className={`flex items-center gap-2 ${p.wins > 0 ? 'text-souls-gold' : 'text-gray-500'} ${(p.isReady || p.isAi) ? 'opacity-100' : 'opacity-70'}`}>
                             <Crown size={16} className={p.wins > 0 ? 'fill-current' : ''} />
                             <span className="font-bold">
                                {p.name} 
                                {(p.isReady || p.isAi) && <span className="text-xs text-green-500 ml-1">[已准备]</span>}
                             </span>
                         </div>
                     ))}
                 </div>
                 <div className="font-display text-xl text-souls-red">回合 {gameState.round} / {gameState.maxRounds}</div>
            </div>

            {gameState.phase === GamePhase.SHOP ? (
                <div className="relative h-full">
                    <Shop 
                      player={myPlayer} 
                      onBuy={(itemId) => handleBuyItemRequest(itemId)}
                      onReady={handleShopReady}
                    />
                    {myPlayer.isReady && (
                        <div className="absolute inset-0 bg-black/60 z-10 flex items-center justify-center backdrop-blur-sm">
                             <div className="text-center animate-pulse">
                                 <h3 className="text-2xl font-display text-souls-gold">等待对手...</h3>
                             </div>
                        </div>
                    )}
                </div>
            ) : (
                <BattleArena 
                    p1={gameState.players[0]} 
                    p2={gameState.players[1]} 
                    logs={gameState.logs} 
                    currentTurnId={gameState.players[gameState.currentTurnIndex].id}
                />
            )}
        </div>
      )}
    </Layout>
  );
}