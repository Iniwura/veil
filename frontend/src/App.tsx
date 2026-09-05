import { useState } from "react";
import { AppShell } from "./components/AppShell";
import { ProductTour } from "./components/ProductTour";
import { RouteTransition } from "./components/RouteTransition";
import { UnveilCursor } from "./components/UnveilCursor";
import { useRoute } from "./hooks/useRoute";
import { useDocumentMotion } from "./hooks/useMotion";
import { useUnveilV4 } from "./hooks/useUnveilV4";
import { DrawPage } from "./pages/DrawPage";
import { LandingPage } from "./pages/LandingPage";
import { HomePage } from "./pages/HomePage";
import { SavePage } from "./pages/SavePage";

export default function App() {
  useDocumentMotion();
  const { route, transitioning } = useRoute();
  const unveil = useUnveilV4();
  const [replayToken, setReplayToken] = useState(0);
  const page =
    route === "/app/save" ? (
      <SavePage unveil={unveil} />
    ) : route === "/app/draw" ? (
      <DrawPage unveil={unveil} />
    ) : (
      <HomePage unveil={unveil} />
    );

  return (
    <>
      <UnveilCursor />
      {route === "/" ? (
        <LandingPage unveil={unveil} />
      ) : (
        <AppShell route={route} unveil={unveil} onReplayGuide={() => setReplayToken((value) => value + 1)}>
          {page}
        </AppShell>
      )}
      <ProductTour route={route} replayToken={replayToken} />
      <RouteTransition visible={transitioning} />
    </>
  );
}
