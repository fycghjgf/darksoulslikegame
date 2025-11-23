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
import { Skull, Crown, Users, Copy, Loader2, RefreshCw, Server, WifiOff, ShieldCheck } from 'lucide-react';

// Declare MQTT global from script tag
declare const mqtt: any;

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

// --- BROKER CONFIGURATION ---
// We use a list of public brokers to ensure connectivity even if one is down or blocked.
// Priority: 443 (HTTPS standard) -> 8000 -> 8084
const BROKERS = [
    { url: 'wss://mqtt.eclipseprojects.io:443/mqtt', name: 'Eclipse Cloud (443)' },
    { url: 'wss://broker.hivemq.com:8000/mqtt', name: 'HiveMQ Public (8000)' },
    { url: 'wss://broker.emqx.io:8084/mqtt', name: 'EMQX Global (8084)' }
];

const TOPIC_PREFIX = 'souls-arena/v3/';

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
  const [netStatus, setNetStatus] = useState<string>('离线');
  const [currentBrokerName, setCurrentBrokerName] = useState<string>('');
  
  // REFS for Networking and Logic
  const mqttClientRef = useRef<any>(null);
  const isHostRef = useRef(false);
  const gameStateRef = useRef(gameState);
  const startingBattleRef = useRef(false);
  const brokerIndexRef = useRef(0);

  // Sync refs
  useEffect(() => { isHostRef.current = isHost; }, [isHost]);
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

  // --- MQTT HELPERS ---

  const getMyPublishTopic = (code: string) => {
      return isHostRef.current 
        ? `${TOPIC_PREFIX}${code}/client` 
        : `${TOPIC_PREFIX}${code}/server`;
  };

  const send = useCallback((msg: NetworkMessage) => {
    if (mqttClientRef.current && mqttClientRef.current.connected && gameStateRef.current.roomCode) {
      try {
        const topic = getMyPublishTopic(gameStateRef.current.roomCode);
        mqttClientRef.current.publish(topic, JSON.stringify(msg));
      } catch (e) {
        console.error("MQTT Send failed", e);
      }
    }
  }, []);

  const handleMessage = useCallback((msg: NetworkMessage) => {
    const amIHost = isHostRef.current;
    
    // --- CLIENT LOGIC (Receiving State) ---
    if (!amIHost) {
      if (msg.type === 'SYNC' || msg.type === 'WELCOME') {
        const serverState = msg.payload as GameState;
        
        // Ensure I exist in the received state before accepting it entirely
        // This prevents accepting "empty" room states if the host reset
        const myPlayerExists = serverState.players.some(p => p.id === myPlayerId);
        
        if (msg.type === 'WELCOME' || myPlayerExists) {
            if (!isConnected) {
                setIsConnected(true);
            }
            setGameState(serverState);
        } else if (isConnected && !myPlayerExists) {
            // Disconnected or kicked?
            // console.warn("Received state without my player data");
        }
      }
      return;
    } 

    // --- HOST LOGIC (Receiving Actions) ---
    if (amIHost) {
      if (msg.type === 'JOIN') {
        const { id, name } = msg.payload;
        const currentState = gameStateRef.current;
        const existingPlayer = currentState.players.find(p => p.id === id);
        
        if (existingPlayer) {
            send({ type: 'SYNC', payload: currentState });
            return;
        }

        if (currentState.players.length >= 2) return;

        // Add new player
        const p2 = createPlayer(id, name, false);
        const newState = {
            ...currentState,
            players: [...currentState.players, p2],
            phase: GamePhase.SHOP
        };

        setGameState(newState);
        // Delay to allow React state update
        setTimeout(() => send({ type: 'WELCOME', payload: newState }), 50);
        return;
      }
      
      if (msg.type === 'ACTION_BUY') {
        const { playerId, itemId } = msg.payload;
        setGameState(prev => {
            const newState = processBuyItem(prev, playerId, itemId);
            setTimeout(() => send({ type: 'SYNC', payload: newState }), 0);
            return newState;
        });
      }

      if (msg.type === 'ACTION_READY') {
         const { playerId } = msg.payload;
         setGameState(prev => {
             const updatedPlayers = prev.players.map(p => p.id === playerId ? { ...p, isReady: true } : p);
             const newState = { ...prev, players: updatedPlayers };
             send({ type: 'SYNC', payload: newState });
             return newState;
         });
      }
    }
  }, [send, isConnected, myPlayerId]); 

  // --- INITIALIZE MQTT WITH FALLBACK ---
  const connectMqtt = (code: string, isHostRole: boolean) => {
      // Cleanup previous
      if (mqttClientRef.current) {
          try { mqttClientRef.current.end(); } catch(e) {}
      }

      const broker = BROKERS[brokerIndexRef.current];
      setNetStatus(`连接中: ${broker.name}...`);
      setCurrentBrokerName(broker.name);
      
      const clientId = `souls-${Math.random().toString(16).substr(2, 8)}`;
      
      console.log(`Attempting connection to ${broker.url}`);

      const client = mqtt.connect(broker.url, {
          clientId,
          clean: true,
          connectTimeout: 5000, 
          reconnectPeriod: 0 // Disable auto-reconnect to handle failover manually
      });

      client.on('connect', () => {
          console.log(`Connected to ${broker.name}`);
          setNetStatus(isHostRole ? '房间在线' : '已连接服务器');
          
          if (isHostRole) {
              setIsConnected(true);
              client.subscribe(`${TOPIC_PREFIX}${code}/server`);
          } else {
              client.subscribe(`${TOPIC_PREFIX}${code}/client`);
              // Send JOIN immediately once connected
              setTimeout(() => {
                 client.publish(`${TOPIC_PREFIX}${code}/server`, JSON.stringify({ 
                     type: 'JOIN', 
                     payload: { id: myPlayerId, name: localPlayerName } 
                 }));
              }, 500);
          }
      });

      client.on('message', (topic: string, message: any) => {
          try {
              const msgData = JSON.parse(message.toString()) as NetworkMessage;
              handleMessage(msgData);
          } catch (e) {
              console.error("Failed to parse message", e);
          }
      });

      client.on('error', (err: any) => {
          console.error(`MQTT Error on ${broker.name}:`, err);
          handleConnectionFail(code, isHostRole);
      });
      
      // If connection takes too long, force failover
      setTimeout(() => {
          if (!client.connected) {
              handleConnectionFail(code, isHostRole);
          }
      }, 6000);

      mqttClientRef.current = client;
  };

  const handleConnectionFail = (code: string, isHostRole: boolean) => {
      if (isConnected) return; // If already connected, ignore
      
      if (mqttClientRef.current) {
         try { mqttClientRef.current.end(); } catch(e){}
      }

      // Try next broker
      brokerIndexRef.current = (brokerIndexRef.current + 1);
      
      if (brokerIndexRef.current >= BROKERS.length) {
          brokerIndexRef.current = 0; // Loop back or stop? Let's loop.
          setNetStatus("所有服务器连接失败，正在重试...");
          // Wait a bit before restarting loop
          setTimeout(() => connectMqtt(code, isHostRole), 2000);
      } else {
          // Try next immediately
          connectMqtt(code, isHostRole);
      }
  };

  // HOST HEARTBEAT: Broadcast state frequently
  useEffect(() => {
    if (!isHost || !gameState.roomCode) return;
    
    const interval = setInterval(() => {
        if (gameStateRef.current.phase !== GamePhase.LOGIN && mqttClientRef.current?.connected) {
            send({ type: 'SYNC', payload: gameStateRef.current });
        }
    }, 1000); // 1s Heartbeat

    return () => clearInterval(interval);
  }, [isHost, send]); 
  
  // CLIENT RE-JOIN: If stuck in waiting but connected, resend JOIN
  useEffect(() => {
      if (isHost || !isConnected || gameState.phase !== GamePhase.WAITING_FOR_OPPONENT) return;
      
      const interval = setInterval(() => {
          // Keep knocking until phase changes
          if (mqttClientRef.current?.connected) {
             const code = gameState.roomCode;
             if (code) {
                 mqttClientRef.current.publish(`${TOPIC_PREFIX}${code}/server`, JSON.stringify({ 
                     type: 'JOIN', 
                     payload: { id: myPlayerId, name: localPlayerName } 
                 }));
             }
          }
      }, 2000);
      
      return () => clearInterval(interval);
  }, [isHost, isConnected, gameState.phase, myPlayerId, localPlayerName, gameState.roomCode]);


  // --- HELPER LOGIC (Purchasing, Battle) ---
  const processBuyItem = (state: GameState, playerId: string, itemId: string): GameState => {
      const player = state.players.find(p => p.id === playerId);
      const item = SHOP_ITEMS.find(i => i.id === itemId);
      if (!player || !item) return state;
      if (player.souls < item.cost) return state;

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

  // --- GAME ACTIONS ---

  const handleLogin = () => {
    if (!localPlayerName.trim()) return;
    const pid = `p-${Math.random().toString(36).substr(2, 9)}`;
    setMyPlayerId(pid);
    setGameState(prev => ({ ...prev, phase: GamePhase.LOBBY }));
  };

  const handleCreateRoom = (mode: 'PVE' | 'PVP') => {
    // 4 digit code for simplicity
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    
    setGameState(prev => ({
        ...prev,
        roomCode: code,
    }));
    
    setIsHost(true);
    const p1 = createPlayer(myPlayerId, localPlayerName, false);

    if (mode === 'PVE') {
      const p2 = createPlayer('ai-gemini', '暗灵 Gemini', true);
      setGameState(prev => ({
        ...prev,
        phase: GamePhase.SHOP,
        players: [p1, p2]
      }));
    } else {
      connectMqtt(code, true);
      setGameState(prev => ({
        ...prev,
        phase: GamePhase.WAITING_FOR_OPPONENT,
        players: [p1] 
      }));
    }
  };

  const handleJoinRoom = () => {
    if (!roomInput.trim()) return;
    const code = roomInput.trim();
    
    setIsHost(false);
    setIsConnected(false);
    
    setGameState(prev => ({
        ...prev,
        roomCode: code,
        phase: GamePhase.WAITING_FOR_OPPONENT 
    }));

    connectMqtt(code, false);
  };

  const handleBuyItemRequest = (itemId: string) => {
      if (!isHost) {
          send({ type: 'ACTION_BUY', payload: { playerId: myPlayerId, itemId } });
          return;
      }
      setGameState(prev => {
          const newState = processBuyItem(prev, myPlayerId, itemId);
          send({ type: 'SYNC', payload: newState });
          return newState;
      });
  };

  const handleShopReady = async () => {
    if (!isHost) {
        send({ type: 'ACTION_READY', payload: { playerId: myPlayerId } });
        // Optimistic update
        setGameState(prev => ({
            ...prev,
            players: prev.players.map(p => p.id === myPlayerId ? { ...p, isReady: true } : p)
        }));
        return;
    }

    setGameState(prev => {
        const updatedPlayers = prev.players.map(p => p.id === myPlayerId ? { ...p, isReady: true } : p);
        const newState = { ...prev, players: updatedPlayers };
        send({ type: 'SYNC', payload: newState });
        return newState;
    });
  };

  // CHECK IF ALL READY (HOST ONLY)
  useEffect(() => {
    if (!isHost) return;
    if (gameState.phase !== GamePhase.SHOP) return;
    if (gameState.players.length < 2) return;
    
    const allReady = gameState.players.every(p => p.isReady || p.isAi);
    
    if (allReady && !startingBattleRef.current) {
        startingBattleRef.current = true;
        startBattlePhase().catch(err => {
            console.error("Error starting battle:", err);
            startingBattleRef.current = false;
        }).finally(() => {
            startingBattleRef.current = false;
        });
    }
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
      send({ type: 'SYNC', payload: battleStartState });
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
      
      send({ type: 'SYNC', payload: nextState });
      return nextState;
    });
  }, [isHost, send]);

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
      
      send({ type: 'SYNC', payload: nextState });
      return nextState;
    });
  };

  const resetGame = () => {
    if (mqttClientRef.current) {
        try { mqttClientRef.current.end(); } catch (e) {}
    }
    
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
    setNetStatus('离线');
    brokerIndexRef.current = 0;
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
                    <p className="text-souls-muted mb-2">分享此代码给你的对手 (不同设备可用)</p>
                    <div className="text-xs text-blue-400 mb-6 font-mono flex flex-col items-center justify-center gap-1">
                        <span className="flex items-center gap-2"><Server size={12}/> {netStatus}</span>
                        {currentBrokerName && <span className="opacity-50">节点: {currentBrokerName}</span>}
                    </div>

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
                        <p className="text-xs text-blue-400 font-mono">{netStatus}</p>
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-4">
                        <RefreshCw className="w-16 h-16 text-souls-red animate-spin" />
                        <h2 className="text-2xl font-display text-white">正在入侵世界 {gameState.roomCode}...</h2>
                        <p className="text-souls-muted">正在尝试建立连接...</p>
                        <div className="text-xs text-blue-400 font-mono flex flex-col items-center">
                            <span>{netStatus}</span>
                        </div>
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
          <div className="absolute top-4 right-4 z-50 bg-black/80 px-4 py-2 border border-white/10 text-xs text-souls-muted font-mono flex gap-3 items-center rounded shadow-lg">
              <span>ROOM: <span className="text-white font-bold">{gameState.roomCode}</span></span>
              <span className="h-3 w-px bg-white/20"></span>
              <span className={isHost ? 'text-souls-gold' : 'text-blue-400'}>{isHost ? 'HOST' : 'CLIENT'}</span>
              <span className="h-3 w-px bg-white/20"></span>
              <div className="flex items-center gap-1">
                 {isConnected ? <ShieldCheck size={14} className="text-green-500"/> : <WifiOff size={14} className="text-red-500"/>}
                 <span className={isConnected ? 'text-green-500' : 'text-red-500'}>
                    {isConnected ? '已连接' : '连接中...'}
                 </span>
              </div>
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