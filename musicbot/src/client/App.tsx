import { Login } from "./pages/Login";
import { Chat } from "./pages/Chat";
import { Settings } from "./pages/Settings";
import { usePath } from "./lib/router";

export function App() {
	const path = usePath();
	if (path === "/login") return <Login />;
	if (path === "/settings") return <Settings />;
	return <Chat />;
}
