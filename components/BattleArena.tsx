import React, { useEffect, useRef, useState } from 'react';
import { CombatLog, Player } from '../types';
import { Skull } from 'lucide-react';

interface BattleArenaProps {
  p1: Player;
  p2: Player;
  logs: CombatLog[];
  currentTurnId: string;
}

type AnimState = 'idle' | 'attack' | 'hit' | 'die';

// Simple SVG Pixel Art Components
const PixelKnight = ({ color }: { color: string }) => (
  <svg viewBox="0 0 24 24" className="w-full h-full drop-shadow-lg" shapeRendering="crispEdges">
    {/* Helmet */}
    <rect x="9" y="3" width="6" height="6" fill={color} />
    <rect x="10" y="4" width="4" height="2" fill="#000" />
    <rect x="11" y="9" width="2" height="2" fill={color} />
    {/* Body */}
    <rect x="7" y="10" width="10" height="8" fill="#555" />
    <rect x="9" y="11" width="6" height="6" fill={color} />
    {/* Arms */}
    <rect x="5" y="11" width="2" height="6" fill="#777" />
    <rect x="17" y="11" width="2" height="6" fill="#777" />
    {/* Legs */}
    <rect x="8" y="18" width="3" height="4" fill="#333" />
    <rect x="13" y="18" width="3" height="4" fill="#333" />
    {/* Weapon hint */}
    <rect x="18" y="8" width="2" height="10" fill="#bbb" />
    <rect x="17" y="14" width="4" height="2" fill="#999" />
  </svg>
);

const PixelInvader = ({ color }: { color: string }) => (
  <svg viewBox="0 0 24 24" className="w-full h-full drop-shadow-[0_0_10px_rgba(255,0,0,0.5)]" shapeRendering="crispEdges">
    {/* Hood */}
    <rect x="8" y="2" width="8" height="7" fill={color} />
    <rect x="10" y="4" width="4" height="2" fill="#000" />
    {/* Robe */}
    <rect x="7" y="9" width="10" height="10" fill={color} />
    <rect x="9" y="10" width="6" height="9" fill="#330000" />
    {/* Arms */}
    <rect x="5" y="10" width="2" height="6" fill={color} />
    <rect x="17" y="10" width="2" height="6" fill={color} />
    {/* Legs */}
    <rect x="8" y="19" width="3" height="3" fill="#111" />
    <rect x="13" y="19" width="3" height="3" fill="#111" />
    {/* Aura */}
    <rect x="6" y="8" width="1" height="1" fill="#f00" opacity="0.5" />
    <rect x="18" y="5" width="1" height="1" fill="#f00" opacity="0.5" />
  </svg>
);

export const BattleArena: React.FC<BattleArenaProps> = ({ p1, p2, logs, currentTurnId }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [p1Anim, setP1Anim] = useState<AnimState>('idle');
  const [p2Anim, setP2Anim] = useState<AnimState>('idle');

  // Animation trigger logic
  useEffect(() => {
    if (logs.length === 0) return;
    
    const lastLog = logs[logs.length - 1];
    // Ignore system messages for animation logic unless death
    if (lastLog.attacker === 'SYSTEM') {
        if (lastLog.action.includes('死亡')) {
            const isP1Dead = p1.currentStats.hp <= 0;
            const isP2Dead = p2.currentStats.hp <= 0;
            if (isP1Dead) setP1Anim('die');
            if (isP2Dead) setP2Anim('die');
        }
        return;
    }

    const isP1Attacker = lastLog.attacker === p1.name;
    
    if (isP1Attacker) {
        setP1Anim('attack');
        setTimeout(() => setP2Anim('hit'), 200);
        setTimeout(() => {
            setP1Anim('idle');
            setP2Anim('idle');
        }, 600);
    } else {
        setP2Anim('attack');
        setTimeout(() => setP1Anim('hit'), 200);
        setTimeout(() => {
            setP2Anim('idle');
            setP1Anim('idle');
        }, 600);
    }

  }, [logs, p1.name, p1.currentStats.hp, p2.currentStats.hp]);


  // Auto scroll logs
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const getHealthPercent = (current: number, max: number) => {
    return Math.max(0, Math.min(100, (current / max) * 100));
  };

  const getAnimClass = (anim: AnimState, isLeft: boolean) => {
    if (anim === 'idle') return 'animate-pulse-slow';
    if (anim === 'die') return 'animate-die opacity-50 grayscale';
    if (anim === 'hit') return 'animate-hit';
    if (anim === 'attack') return isLeft ? 'animate-attack-right' : 'animate-attack-left';
    return '';
  };

  const PlayerCard = ({ player, isLeft, animState }: { player: Player; isLeft: boolean; animState: AnimState }) => {
    const calculatedMaxHp = 100 + player.inventory.reduce((acc, i) => acc + (i.stats.hp || 0), 0);
    const hpPercent = getHealthPercent(player.currentStats.hp, calculatedMaxHp);
    const isDead = player.currentStats.hp <= 0;
    const isTurn = currentTurnId === player.id && !isDead;

    return (
      <div className={`flex flex-col w-full md:w-1/3 gap-4 transition-all duration-500 relative z-10`}>
        <div className={`flex items-center gap-4 ${isLeft ? 'flex-row' : 'flex-row-reverse'}`}>
           <div className={`w-16 h-16 border-2 ${isTurn ? 'border-souls-gold shadow-[0_0_15px_rgba(255,215,0,0.3)]' : 'border-souls-gray'} flex items-center justify-center bg-souls-dark rotate-45 overflow-hidden transition-all duration-300`}>
              {isDead ? <Skull className="text-red-800 rotate-[-45deg]" /> : <div className={`text-2xl font-display font-bold rotate-[-45deg] ${isTurn ? 'text-souls-gold' : 'text-gray-500'}`}>{player.name[0]}</div>}
           </div>
           <div className={`flex flex-col ${isLeft ? 'items-start' : 'items-end'}`}>
              <h3 className="font-display text-xl font-bold tracking-wider">{player.name}</h3>
              <span className="text-xs text-souls-muted uppercase tracking-widest">{player.isAi ? '暗灵' : '火之宿主'}</span>
           </div>
        </div>

        {/* HP Bar */}
        <div className="relative h-6 bg-gray-900 border border-gray-700 w-full shadow-inner">
           <div 
              className="absolute top-0 left-0 h-full bg-gradient-to-r from-red-900 to-souls-red transition-all duration-300" 
              style={{ width: `${hpPercent}%` }}
           ></div>
           <div className="absolute inset-0 flex items-center justify-center text-xs font-bold drop-shadow-md z-10 text-white">
              {Math.ceil(player.currentStats.hp)} / {calculatedMaxHp}
           </div>
        </div>

        {/* Equipment Icons (Mini) */}
        <div className={`flex gap-1 flex-wrap ${isLeft ? 'justify-start' : 'justify-end'}`}>
            {player.inventory.slice(0, 6).map((item, i) => (
              <div key={i} className="w-6 h-6 bg-souls-gray/50 border border-white/10 rounded flex items-center justify-center text-[10px] cursor-help" title={item.name}>
                {item.name[0]}
              </div>
            ))}
        </div>

        {/* Pixel Character Render */}
        <div className={`mt-8 w-32 h-32 self-center transition-all duration-300 ${getAnimClass(animState, isLeft)}`}>
           {isLeft ? <PixelKnight color="#a0aec0" /> : <PixelInvader color="#742a2a" />}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Visual Arena */}
      <div className="flex-grow flex items-end justify-between px-8 py-12 relative overflow-hidden bg-souls-black">
         {/* Background Floor */}
         <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-[#111] border-t-4 border-[#222]"></div>
         <div className="absolute top-0 left-0 right-0 h-2/3 bg-[url('https://www.transparenttextures.com/patterns/brick-wall-dark.png')] opacity-20"></div>

         <PlayerCard player={p1} isLeft={true} animState={p1Anim} />
         
         {/* VS Divider / Center Area */}
         <div className="absolute left-1/2 top-1/3 -translate-x-1/2 flex flex-col items-center z-0">
            <div className="text-6xl font-display text-souls-gray/20 font-black">VS</div>
         </div>

         <PlayerCard player={p2} isLeft={false} animState={p2Anim} />
      </div>

      {/* Combat Log */}
      <div className="h-48 border-t-2 border-souls-gray bg-black/80 p-4 font-serif text-sm overflow-y-auto custom-scrollbar shadow-[inset_0_0_20px_rgba(0,0,0,1)]" ref={scrollRef}>
         <div className="space-y-1">
            {logs.length === 0 && <div className="text-center text-souls-muted italic">正在召唤灵体...</div>}
            {logs.map((log, idx) => (
               <div key={idx} className={`flex gap-2 border-b border-white/5 pb-1 ${log.damage > 20 ? 'text-red-300' : 'text-gray-400'}`}>
                  <span className="text-souls-muted opacity-50">[{log.turn}]</span>
                  <span>
                    <span className="font-bold text-gray-300">{log.attacker}</span> 
                    <span className="italic mx-1 text-souls-muted">{log.action}</span>
                    <span className="font-bold text-gray-300">{log.target}</span>
                    {log.damage > 0 && <span> 造成了 <span className="text-souls-red font-bold">{log.damage}</span> 点伤害。</span>}
                    {log.isCrit && <span className="text-souls-gold font-bold ml-2">致命一击!</span>}
                  </span>
               </div>
            ))}
         </div>
      </div>
    </div>
  );
};