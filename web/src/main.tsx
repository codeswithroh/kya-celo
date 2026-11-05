import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import Landing from "./Landing";
import Dashboard from "./Dashboard";

const isApp = window.location.pathname.startsWith("/app");
document.title = isApp ? "KYA Dashboard" : "KYA: Know Your Agent";

createRoot(document.getElementById("root")!).render(<StrictMode>{isApp ? <Dashboard /> : <Landing />}</StrictMode>);
