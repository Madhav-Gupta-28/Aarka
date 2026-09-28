"use client";

import {WagmiProvider} from "wagmi";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {useState} from "react";
import {wagmiConfig} from "@/lib/wagmi";
import {PrefsProvider, ToastProvider} from "@/lib/ui";

export function Providers({children}: {children: React.ReactNode}) {
  const [qc] = useState(() => new QueryClient({defaultOptions: {queries: {staleTime: 5_000, retry: 2}}}));
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>
        <PrefsProvider>
          <ToastProvider>{children}</ToastProvider>
        </PrefsProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
