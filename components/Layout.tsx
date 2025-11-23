import React, { ReactNode } from 'react';

interface LayoutProps {
  children: ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  return (
    <div className="min-h-screen w-full bg-souls-black text-souls-text overflow-hidden relative selection:bg-souls-red selection:text-white">
      <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/dark-matter.png')] opacity-30 pointer-events-none"></div>
      <div className="relative z-10 flex flex-col min-h-screen">
        <header className="p-6 border-b border-souls-gray bg-souls-dark/80 backdrop-blur-sm flex justify-between items-center sticky top-0 z-50 shadow-lg">
          <div className="flex items-center gap-2">
            <div className="w-3 h-10 bg-gradient-to-b from-souls-gold to-transparent"></div>
            <h1 className="text-3xl font-display font-bold tracking-widest text-gray-100 uppercase shadow-black drop-shadow-lg">
              魂之<span className="text-souls-red">竞技场</span>
            </h1>
          </div>
          <div className="text-xs text-souls-muted font-serif tracking-widest">
            在线版本 1.02
          </div>
        </header>
        <main className="flex-grow container mx-auto p-4 md:p-8 flex flex-col">
            {children}
        </main>
        <footer className="p-4 text-center text-souls-muted text-xs border-t border-souls-gray bg-souls-dark">
          "罗德兰的时间是扭曲的..."
        </footer>
      </div>
    </div>
  );
};