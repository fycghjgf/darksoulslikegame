import { GoogleGenAI, Type } from "@google/genai";
import { Item, Player, Stats } from "../types";
import { SHOP_ITEMS } from "../constants";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const generateAiPurchases = async (
  aiPlayer: Player,
  humanPlayer: Player,
  round: number
): Promise<string[]> => {
  try {
    // If API key is missing, fallback to basic logic
    if (!process.env.API_KEY) {
      console.warn("Gemini API Key not found, using fallback AI.");
      return basicFallbackAi(aiPlayer);
    }

    const shopContext = SHOP_ITEMS.map(i => `${i.id}: ${i.name} (${i.cost} 魂) - ${i.type} - ${i.description}`).join('\n');
    const opponentContext = `对手 (人类) 属性: HP:${humanPlayer.currentStats.hp}, 力量:${humanPlayer.currentStats.str}, 敏捷:${humanPlayer.currentStats.dex}, 智力:${humanPlayer.currentStats.int}, 防御:${humanPlayer.currentStats.def}. 物品: ${humanPlayer.inventory.map(i => i.name).join(', ')}`;
    const selfContext = `你 (AI) 拥有: ${aiPlayer.souls} 魂. 当前物品: ${aiPlayer.inventory.map(i => i.name).join(', ')}`;

    const prompt = `
      你是一位《黑暗之魂》PvP 专家，正在玩一款自动对战游戏。
      回合数: ${round}.
      
      商店物品列表:
      ${shopContext}
      
      对手情况:
      ${opponentContext}
      
      你的情况:
      ${selfContext}
      
      任务: 选择一个物品 ID 列表从商店购买，以克制对手或加强你的构建。
      你不能花费超过你拥有的魂。
      只返回要购买的物品 ID 列表。
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            itemsToBuy: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          }
        }
      }
    });

    const json = JSON.parse(response.text || "{}");
    const suggestedIds = json.itemsToBuy || [];
    
    // Validate affordance locally
    let currentSouls = aiPlayer.souls;
    const validIds: string[] = [];
    
    for (const id of suggestedIds) {
      const item = SHOP_ITEMS.find(i => i.id === id);
      if (item && item.cost <= currentSouls) {
        validIds.push(id);
        currentSouls -= item.cost;
      }
    }

    return validIds;

  } catch (error) {
    console.error("Gemini AI Error:", error);
    return basicFallbackAi(aiPlayer);
  }
};

// Fallback if Gemini fails or no key
const basicFallbackAi = (player: Player): string[] => {
  const purchases: string[] = [];
  let currentSouls = player.souls;
  // Simple greedy alg: buy most expensive affordable item not in inventory (unless stackable)
  // For simplicity, just buy random affordable items
  const affordable = SHOP_ITEMS.filter(i => i.cost <= currentSouls);
  
  // Try to get at least one weapon if missing
  const hasWeapon = player.inventory.some(i => i.type === 'WEAPON');
  if (!hasWeapon) {
    const weapons = affordable.filter(i => i.type === 'WEAPON').sort((a, b) => b.cost - a.cost);
    if (weapons.length > 0) {
        purchases.push(weapons[0].id);
        currentSouls -= weapons[0].cost;
    }
  }

  // Spend rest
  const remainingAffordable = SHOP_ITEMS.filter(i => i.cost <= currentSouls && !purchases.includes(i.id));
  for (const item of remainingAffordable) {
    if (currentSouls >= item.cost) {
        purchases.push(item.id);
        currentSouls -= item.cost;
    }
  }
  
  return purchases;
};

export const generateBattleFlavorText = async (
    attackerName: string,
    defenderName: string,
    weaponName: string,
    damage: number
): Promise<string> => {
    return `${attackerName} 使用 ${weaponName} 击中了 ${defenderName} 造成了 ${damage} 点伤害。`;
}