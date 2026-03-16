import React, { createContext, useContext, useState, ReactNode } from 'react';

export type Range = '15m' | '1h' | '6h' | '24h' | '7d';

interface GlobalTimeContextProps {
  globalRange: Range;
  setGlobalRange: (range: Range) => void;
}

const GlobalTimeContext = createContext<GlobalTimeContextProps | undefined>(undefined);

export function GlobalTimeProvider({ children }: { children: ReactNode }) {
  const [globalRange, setGlobalRange] = useState<Range>('1h');

  return (
    <GlobalTimeContext.Provider value={{ globalRange, setGlobalRange }}>
      {children}
    </GlobalTimeContext.Provider>
  );
}

export function useGlobalTime() {
  const context = useContext(GlobalTimeContext);
  if (context === undefined) {
    throw new Error('useGlobalTime must be used within a GlobalTimeProvider');
  }
  return context;
}
