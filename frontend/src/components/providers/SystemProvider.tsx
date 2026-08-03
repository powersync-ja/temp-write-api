import { NavigationPanelContextProvider } from '@/components/navigation/NavigationPanelContext';
import { AppSchema } from '@/library/powersync/AppSchema';
import { DemoConnector } from '@/library/powersync/DemoConnector';
import { createSharedMutators } from '@/library/mutators/sharedClient';
import { sharedMutators } from '@shared/mutators';
import { CircularProgress } from '@mui/material';
import { PowerSyncContext } from '@powersync/react';
import { PowerSyncDatabase } from '@powersync/web';
import Logger from 'js-logger';
import React, { Suspense } from 'react';

export const db = new PowerSyncDatabase({
  database: {
    dbFilename: 'example.db'
  },
  schema: AppSchema,
  logger: Logger
});

// Make db accessible on the console for debugging
(window as any).db = db;

const ConnectorContext = React.createContext<DemoConnector | null>(null);
export const useConnector = () => React.useContext(ConnectorContext);

// Isomorphic mutators — the SAME definitions the backend runs, applied locally via Drizzle.
const MutatorsContext = React.createContext<ReturnType<typeof createSharedMutators> | null>(null);
export const useMutators = () => {
  const ctx = React.useContext(MutatorsContext);
  if (!ctx) throw new Error('useMutators must be used inside SystemProvider');
  return ctx;
};

export const SystemProvider = ({ children }: { children: React.ReactNode }) => {
  const [connector] = React.useState(new DemoConnector());
  const [powerSync] = React.useState(db);
  const [mutate] = React.useState(() =>
    createSharedMutators(db, sharedMutators, () => ({ userId: connector.userId }))
  );

  React.useEffect(() => {
    // Linting thinks this is a hook due to it's name
    Logger.useDefaults(); // eslint-disable-line
    Logger.setLevel(Logger.DEBUG);

    // For console testing purposes
    (window as any)._powersync = powerSync;

    powerSync.init();
    powerSync.connect(connector);
  }, [powerSync, connector]);

  return (
    <Suspense fallback={<CircularProgress />}>
      <PowerSyncContext.Provider value={powerSync}>
        <ConnectorContext.Provider value={connector}>
          <MutatorsContext.Provider value={mutate}>
            <NavigationPanelContextProvider>{children}</NavigationPanelContextProvider>
          </MutatorsContext.Provider>
        </ConnectorContext.Provider>
      </PowerSyncContext.Provider>
    </Suspense>
  );
};

export default SystemProvider;
