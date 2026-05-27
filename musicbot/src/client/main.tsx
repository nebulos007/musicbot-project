import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Player } from "./components/Player";
import { PlayerProvider } from "./lib/player";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");
// The player lives above the router so audio + the mini-bar survive tab/route
// changes (DESIGN §3). Player renders nothing until a track is loaded.
createRoot(root).render(
	<StrictMode>
		<PlayerProvider>
			<App />
			<Player />
		</PlayerProvider>
	</StrictMode>,
);
