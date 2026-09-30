"use client";

import {AppCard} from "@/components/AppCard";
import {Shell} from "@/components/Chrome";
import {PositionsList} from "@/components/PositionsList";
import {ProPanel} from "@/components/ProPanel";
import {usePrefs} from "@/lib/ui";

/**
 * The app, on its own page, so nobody has to scroll past the story to use it. Choose a half up
 * top, and what you hold sits right below. Pro swaps the card for the full terminal.
 */
export default function App() {
  const {view} = usePrefs();
  return (
    <Shell>
      {view === "terminal" ? <ProPanel /> : <AppCard />}
      <PositionsList />
    </Shell>
  );
}
