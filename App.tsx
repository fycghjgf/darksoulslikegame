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
  NetworkMessage
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
import { Sword, Shield, Skull, Crown, Users, Copy, Loader2 } from 'lucide-react';

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
  
  // REFS for Networking (Critical for avoiding stale closures in event listeners)
  const channelRef = useRef<BroadcastChannel | null>(null);
  const isHostRef = useRef(false);
  const connectionIntervalRef = useRef<any>(null); // For retrying JOIN

  // Sync refs with state
  useEffect(() => { isHostRef.current = isHost; }, [isHost]);

  // --- NETWORKING HELPERS ---
  const broadcast = useCallback((msg: NetworkMessage) => {
    if (channelRef.current) {
      channelRef.current.postMessage(msg);
    }
  }, []);

  // Helper to process a buy action (state update only)
  const processBuyItem = (state: GameState, playerId: string, itemId: string): GameState => {
      const player = state.players.find(p => p.id === playerId);
      const item = SHOP_ITEMS.find(i => i.id === itemId);
      if (!player || !item) return state;
      if (player.souls < item.cost) return state;

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
      if (msg.type === 'WELCOME') {
        // Connection successful!
        if (connectionIntervalRef.current) {
            clearInterval(connectionIntervalRef.current);
            connectionIntervalRef.current = null;
        }
        setGameState(msg.payload);
      }
      
      if (msg.type === 'SYNC') {
        setGameState(msg.payload);
      }
      return;
    } 

    // --- HOST LOGIC ---
    if (amIHost) {
      if (msg.type === 'JOIN') {
        // Deduplicate: If we already have 2 players, ignore (or check if it's a reconnect)
        setGameState(prev => {
           // If player 2 already exists with same ID, just resend welcome (idempotent)
           const existingP2 = prev.players[1];
           if (existingP2 && existingP2.id === msg.payload.id) {
               // Resend state to help client sync
               setTimeout(() => broadcast({ type: 'WELCOME', payload: prev }), 50);
               return prev;
           }
           
           // If a different player 2 is already there, ignore
           if (existingP2 && existingP2.id !== msg.payload.id) return prev;

           // Add new player
           const p1 = prev.players[0];
           const p2 = createPlayer(msg.payload.id, msg.payload.name, false);
           const newState = {
             ...prev,
             players: [p1, p2],
             phase: GamePhase.SHOP
           };
           
           // Reply to Client
           setTimeout(() => broadcast({ type: 'WELCOME', payload: newState }), 50);
           return newState;
        });
      }
      
      if (msg.type === 'ACTION_BUY') {
        const { playerId, itemId } = msg.payload;
        setGameState(prev => {
            const newState = processBuyItem(prev, playerId, itemId);
            // Host must broadcast the new state after processing action
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
  }, [broadcast]);

  // Keep the channel listener updated with the latest handleMessage closure
  useEffect(() => {
     if (channelRef.current) {
         channelRef.current.onmessage = (e) => handleMessage(e.data);
     }
  }, [handleMessage]);


  // --- GAME ACTIONS ---

  const handleLogin = () => {
    if (!localPlayerName.trim()) return;
    const pid = `p-${Math.random().toString(36).substr(2, 9)}`;
    setMyPlayerId(pid);
    setGameState(prev => ({ ...prev, phase: GamePhase.LOBBY }));
  };

  const setupChannel = (code: string) => {
    if (channelRef.current) channelRef.current.close();
    const ch = new BroadcastChannel(`souls-room-${code}`);
    ch.onmessage = (e) => handleMessage(e.data);
    channelRef.current = ch;
  };

  const handleCreateRoom = (mode: 'PVE' | 'PVP') => {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    // 1. Setup Channel
    setupChannel(code);
    
    // 2. Set Host State
    setIsHost(true);

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
      // PVP Host waiting
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
    
    // 1. Setup Channel
    setupChannel(code);
    setIsHost(false);
    
    // 2. UI Feedback
    setGameState(prev => ({
        ...prev,
        roomCode: code,
        phase: GamePhase.WAITING_FOR_OPPONENT 
    }));

    // 3. Start Connection Handshake (Retry until success)
    if (connectionIntervalRef.current) clearInterval(connectionIntervalRef.current);
    
    const sendJoin = () => {
        if (channelRef.current) {
            console.log("Sending JOIN request...");
            channelRef.current.postMessage({ 
                type: 'JOIN', 
                payload: { id: myPlayerId, name: localPlayerName } 
            });
        }
    };

    sendJoin(); // Send immediately
    connectionIntervalRef.current = setInterval(sendJoin, 1000); // Retry every second
  };

  // --- LOGIC: SHOP ---
  const handleBuyItemRequest = (itemId: string) => {
      // If Client
      if (!isHost) {
          broadcast({ type: 'ACTION_BUY', payload: { playerId: myPlayerId, itemId } });
          // We don't update local state immediately; wait for SYNC to ensure validity
          return;
      }

      // If Host
      setGameState(prev => {
          const newState = processBuyItem(prev, myPlayerId, itemId);
          broadcast({ type: 'SYNC', payload: newState });
          return newState;
      });
  };

  const handleShopReady = async () => {
    // If Client, send Ready
    if (!isHost) {
        broadcast({ type: 'ACTION_READY', payload: { playerId: myPlayerId } });
        setGameState(prev => ({
            ...prev,
            players: prev.players.map(p => p.id === myPlayerId ? { ...p, isReady: true } : p)
        }));
        return;
    }

    // Host Logic
    setGameState(prev => {
        const updatedPlayers = prev.players.map(p => p.id === myPlayerId ? { ...p, isReady: true } : p);
        const newState = { ...prev, players: updatedPlayers };
        broadcast({ type: 'SYNC', payload: newState });
        return newState;
    });
  };

  // Check if both ready (Effect on Host)
  useEffect(() => {
    if (!isHost) return;
    if (gameState.phase !== GamePhase.SHOP) return;
    
    const allReady = gameState.players.length === 2 && gameState.players.every(p => p.isReady);
    
    if (allReady) {
        startBattlePhase();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.players, gameState.phase, isHost]);

  const startBattlePhase = async () => {
      // If AI exists, do AI purchase now
      const aiPlayer = gameState.players.find(p => p.isAi);
      const humanPlayer = gameState.players.find(p => !p.isAi);
      
      let finalPlayers = [...gameState.players];

      if (aiPlayer && humanPlayer) {
          const itemsToBuyIds = await generateAiPurchases(aiPlayer, humanPlayer, gameState.round);
          let aiSouls = aiPlayer.souls;
          const aiInventory = [...aiPlayer.inventory];
          itemsToBuyIds.forEach(id => {
              const item = SHOP_ITEMS.find(i => i.id === id);
              if (item && item.cost <= aiSouls) {
                  aiSouls -= item.cost;
                  aiInventory.push(item);
              }
          });
          const aiStats = calculateStats({ ...aiPlayer, inventory: aiInventory });
          finalPlayers = finalPlayers.map(p => p.id === aiPlayer.id ? { ...p, souls: aiSouls, inventory: aiInventory, currentStats: aiStats } : p);
      }

      // Reset ready state for next round and start battle
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

      if (weapons.length > 0) {
        const weapon = weapons[Math.floor(Math.random() * weapons.length)];
        weaponName = weapon.name;
        baseDmg = 20; 
        const s = weapon.scaling || {};
        if (s.str) scalingDmg += attacker.currentStats.str * (s.str || 0);
        if (s.dex) scalingDmg += attacker.currentStats.dex * (s.dex || 0);
        if (s.int) scalingDmg += attacker.currentStats.int * (s.int || 0);
      } else {
         scalingDmg += attacker.currentStats.str * 0.5;
      }

      const rawDmg = baseDmg + scalingDmg;
      const mitigation = defender.currentStats.def;
      const finalDmg = Math.max(1, Math.floor(rawDmg - mitigation));
      const isCrit = Math.random() < (attacker.currentStats.dex * 0.01);
      const actualDmg = isCrit ? Math.floor(finalDmg * 1.5) : finalDmg;

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
      
      // Host syncs every turn
      broadcast({ type: 'SYNC', payload: nextState });
      return nextState;
    });
  }, [isHost, broadcast]);

  // Battle Loop
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (isHost && gameState.phase === GamePhase.BATTLE) {
      timer = setTimeout(() => {
        executeTurn();
      }, 1500);
    }
    return () => clearTimeout(timer);
  }, [gameState.phase, gameState.currentTurnIndex, executeTurn, isHost]);

  // Round Result Loop
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

      // Best of 3 check
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
                <Loader2 className="w-16 h-16 text-souls-text animate-spin" />
                <h2 className="text-2xl font-display text-white">正在入侵世界 {gameState.roomCode}...</h2>
                <p className="text-souls-muted">连接中... (如果长时间未响应，请检查代码)</p>
             </>
          )}
          <button onClick={resetGame} className="mt-8 text-sm text-red-500 hover:underline">取消</button>
      </div>
  );

  // Render logic...
  const myPlayer = gameState.players.find(p => p.id === myPlayerId) || gameState.players[0];

  return (
    <Layout>
      {/* HEADER INFO */}
      {gameState.roomCode && (
          <div className="absolute top-4 right-4 z-50 bg-black/50 px-3 py-1 border border-white/10 text-xs text-souls-muted font-mono">
              ROOM: {gameState.roomCode} | {isHost ? 'HOST' : 'CLIENT'}
          </div>
      )}

      {/* WINNER SCREEN */}
      {gameState.phase === GamePhase.GAME_OVER && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/95 animate-fade-in">
             <h1 className="text-6xl md:text-8xl font-display text-souls-gold mb-8 tracking-widest uppercase drop-shadow-[0_0_25px_rgba(255,215,0,0.5)] text-center">
                {gameState.gameWinnerId === myPlayerId || (isHost && gameState.gameWinnerId === gameState.players[0].id && gameState.players[0].isAi === false)
                  ? '战胜' 
                  : '你死了'}
             </h1>
             <p className="text-xl text-souls-muted font-serif italic mb-12">
                胜利者: {gameState.players.find(p => p.id === gameState.gameWinnerId)?.name}
             </p>
             <button onClick={resetGame} className="px-8 py-3 border border-souls-gold text-souls-gold hover:bg-souls-gold hover:text-black transition-all uppercase tracking-widest">
                返回篝火
             </button>
          </div>
      )}

      {/* ROUND OVERLAY */}
      {gameState.phase === GamePhase.ROUND_RESULT && (
          <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none">
              <div className="bg-black/80 p-8 border-y-2 border-souls-gold w-full text-center transform transition-all animate-pulse-slow">
                  <h2 className="text-4xl font-display text-souls-red uppercase tracking-[0.5em]">回合结束</h2>
                  <p className="text-souls-muted mt-2">正在准备下一个轮回...</p>
              </div>
          </div>
      )}

      {/* MAIN CONTENT SWITCHER */}
      {gameState.phase === GamePhase.LOGIN ? renderLogin() :
       gameState.phase === GamePhase.LOBBY ? renderLobby() :
       gameState.phase === GamePhase.WAITING_FOR_OPPONENT ? renderWaiting() :
       null}

      {/* GAME UI */}
      {(gameState.phase === GamePhase.SHOP || gameState.phase === GamePhase.BATTLE || gameState.phase === GamePhase.ROUND_RESULT) && (
        <div className="flex flex-col h-full">
            {/* Player Status Header */}
            <div className="flex justify-between items-center mb-4 border-b border-white/10 pb-2">
                 <div className="flex gap-4">
                     {gameState.players.map(p => (
                         <div key={p.id} className={`flex items-center gap-2 ${p.wins > 0 ? 'text-souls-gold' : 'text-gray-500'} ${p.isReady ? 'opacity-100' : 'opacity-70'}`}>
                             <Crown size={16} className={p.wins > 0 ? 'fill-current' : ''} />
                             <span className="font-bold">{p.name} {p.isReady && <span className="text-xs text-green-500 ml-1">[已准备]</span>}</span>
                         </div>
                     ))}
                 </div>
                 <div className="font-display text-xl text-souls-red">回合 {gameState.round} / {gameState.maxRounds}</div>
            </div>

            {/* Shop View: Only show shop if it's shop phase. If Battle, show Arena */}
            {gameState.phase === GamePhase.SHOP ? (
                <div className="relative h-full">
                    {/* Only render Shop controls for ME */}
                    <Shop 
                      player={myPlayer} 
                      onBuy={(itemId) => handleBuyItemRequest(itemId)}
                      onReady={handleShopReady}
                    />
                    {/* Waiting Overlay if I am ready but waiting for opponent */}
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
