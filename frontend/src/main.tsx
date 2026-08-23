import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./ErrorBoundary";
import NotificationCenter from "./NotificationCenter";
import "./styles.css";
import "./unveil-motion.css";
import "./notifications.css";
import "./error-boundary.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
      <NotificationCenter />
    </ErrorBoundary>
  </React.StrictMode>,
);
