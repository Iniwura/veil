import { useState } from "react";
import { AppShell } from "./components/AppShell";
import { Onboarding } from "./components/Onboarding";
import { useRoute } from "./hooks/useRoute";
import { useDocumentMotion } from "./hooks/useMotion";
import { useTheme } from "./hooks/useTheme";
import { useUnveil } from "./hooks/useUnveil";
import { DrawPage } from "./pages/DrawPage";
import { LandingPage } from "./pages/LandingPage";
import { HomePage } from "./pages/HomePage";
import { SavePage } from "./pages/SavePage";

export default function App() {
  useDocumentMotion();
  const route = useRoute();
  const unveil = useUnveil();
  const theme = useTheme();
  const [replayToken, setReplayToken] = useState(0);
  if (route === "/") return <LandingPage unveil={unveil} theme={theme} />;

  const page = route === "/app/save" ? <SavePage unveil={unveil} /> : route === "/app/draw" ? <DrawPage unveil={unveil} /> : <HomePage unveil={unveil} />;

  return (
    <AppShell route={route} unveil={unveil} theme={theme} onReplayGuide={() => setReplayToken((value) => value + 1)}>
      {page}
      <Onboarding replayToken={replayToken} />
    </AppShell>
  );
}
