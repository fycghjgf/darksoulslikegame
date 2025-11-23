import React, { useState } from 'react';
import { Item, Player, ItemType } from '../types';
import { SHOP_ITEMS } from '../constants';
import { Shield, Sword, Zap, Crown, Coins } from 'lucide-react';

interface ShopProps {
  player: Player;
  onBuy: (itemId: string) => void;
  onReady: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  'ALL': '全部',
  [ItemType.WEAPON]: '武器',
  [ItemType.ARMOR]: '防具',
  [ItemType.ACCESSORY]: '饰品',
  [ItemType.SPELL]: '法术'
};

export const Shop: React.FC<ShopProps> = ({ player, onBuy, onReady }) => {
  const [filter, setFilter] = useState<ItemType | 'ALL'>('ALL');

  const filteredItems = SHOP_ITEMS.filter(
    (item) => filter === 'ALL' || item.type === filter
  );

  const canAfford = (cost: number) => player.souls >= cost;

  return (
    <div className="flex flex-col h-full gap-6 animate-fade-in">
      <div className="flex justify-between items-end border-b border-souls-gray pb-4">
        <div>
          <h2 className="text-2xl font-display text-souls-gold mb-1">祭祀场的侍女</h2>
          <p className="text-souls-muted italic text-sm">"每一个灵魂都有它的价格..."</p>
        </div>
        <div className="flex items-center gap-3 bg-souls-dark px-4 py-2 border border-souls-gold/30 rounded">
          <Coins className="w-5 h-5 text-souls-gold animate-pulse-slow" />
          <span className="text-xl font-bold text-souls-gold tracking-widest">{player.souls}</span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {['ALL', ItemType.WEAPON, ItemType.ARMOR, ItemType.ACCESSORY, ItemType.SPELL].map((type) => (
          <button
            key={type}
            onClick={() => setFilter(type as any)}
            className={`px-4 py-1 text-sm border transition-all uppercase tracking-wider ${
              filter === type
                ? 'bg-souls-gray text-white border-souls-gold'
                : 'text-souls-muted border-souls-gray hover:border-souls-text'
            }`}
          >
            {TYPE_LABELS[type] || type}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 overflow-y-auto flex-grow max-h-[60vh] pr-2 custom-scrollbar">
        {filteredItems.map((item) => {
          const isOwned = player.inventory.some((i) => i.id === item.id);
          
          return (
            <div
              key={item.id}
              className={`group relative border p-4 transition-all duration-300 flex flex-col justify-between gap-4 ${
                canAfford(item.cost)
                  ? 'border-souls-gray bg-souls-dark/40 hover:border-souls-text hover:bg-souls-gray/20'
                  : 'border-red-900/30 bg-red-900/5 opacity-60 grayscale'
              }`}
            >
              <div>
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-display font-bold text-lg group-hover:text-souls-gold transition-colors">
                    {item.name}
                  </h3>
                  {item.type === ItemType.WEAPON && <Sword size={16} />}
                  {item.type === ItemType.ARMOR && <Shield size={16} />}
                  {item.type === ItemType.SPELL && <Zap size={16} />}
                  {item.type === ItemType.ACCESSORY && <Crown size={16} />}
                </div>
                <p className="text-xs text-souls-muted italic mb-3 leading-relaxed border-l-2 border-souls-gray pl-2">
                  {item.description}
                </p>
                
                {/* Stats Preview */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-400">
                  {item.stats.str && <span>力量: +{item.stats.str}</span>}
                  {item.stats.dex && <span>敏捷: +{item.stats.dex}</span>}
                  {item.stats.int && <span>智力: +{item.stats.int}</span>}
                  {item.stats.def && <span>防御: +{item.stats.def}</span>}
                  {item.stats.hp && <span>生命: +{item.stats.hp}</span>}
                  
                  {item.scaling && (
                     <div className="col-span-2 mt-1 pt-1 border-t border-white/10 flex gap-2">
                        <span className="text-souls-muted">补正:</span>
                        {item.scaling.str && <span className="text-red-400">力:{item.scaling.str}</span>}
                        {item.scaling.dex && <span className="text-green-400">敏:{item.scaling.dex}</span>}
                        {item.scaling.int && <span className="text-blue-400">智:{item.scaling.int}</span>}
                     </div>
                  )}
                </div>
              </div>

              <button
                onClick={() => onBuy(item.id)}
                disabled={!canAfford(item.cost)}
                className={`w-full py-2 border text-sm uppercase tracking-widest font-bold transition-all ${
                  canAfford(item.cost)
                    ? 'border-souls-gold text-souls-gold hover:bg-souls-gold hover:text-black'
                    : 'border-red-900 text-red-900 cursor-not-allowed'
                }`}
              >
                {isOwned ? '购买 (持有)' : '购买'} ({item.cost})
              </button>
            </div>
          );
        })}
      </div>

      <div className="mt-auto pt-4 border-t border-souls-gray flex justify-end">
         <button
            onClick={onReady}
            className="px-12 py-3 bg-souls-text text-black font-display font-bold text-xl uppercase tracking-[0.2em] hover:bg-white hover:scale-105 transition-transform shadow-[0_0_15px_rgba(229,229,229,0.3)]"
         >
            穿过雾门
         </button>
      </div>
    </div>
  );
};