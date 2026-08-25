import { useState } from "react";
import { AppShell } from "./components/AppShell";
import { Onboarding } from "./components/Onboarding";
import { useRoute } from "./hooks/useRoute";
import { useUnveil } from "./hooks/useUnveil";
import { DrawsPage } from "./pages/DrawsPage";
import { HistoryPage } from "./pages/HistoryPage";
import { LandingPage } from "./pages/LandingPage";
import { MorePage } from "./pages/MorePage";
import { OverviewPage } from "./pages/OverviewPage";
import { PrizesPage } from "./pages/PrizesPage";
import { SavePage } from "./pages/SavePage";
import { VaultPage } from "./pages/VaultPage";

export default function App() {
  const route = useRoute();
  const unveil = useUnveil();
  const [replayToken, setReplayToken] = useState(0);
  if (route === "/") return <LandingPage unveil={unveil} />;

  const page =
    route === "/app/save" ? (
      <SavePage unveil={unveil} />
    ) : route === "/app/draws" ? (
      <DrawsPage unveil={unveil} />
    ) : route === "/app/vault" ? (
      <VaultPage unveil={unveil} />
    ) : route === "/app/prizes" ? (
      <PrizesPage unveil={unveil} />
    ) : route === "/app/history" ? (
      <HistoryPage unveil={unveil} />
    ) : route === "/app/more" ? (
      <MorePage replayGuide={() => setReplayToken((value) => value + 1)} />
    ) : (
      <OverviewPage unveil={unveil} />
    );

  return (
    <AppShell route={route} unveil={unveil}>
      {page}
      <Onboarding replayToken={replayToken} />
    </AppShell>
  );
}
