import { useEffect, useState } from "react";

import LoginPage from "./components/LoginPage.jsx";
import ZonoticWatch from "./components/ZonoticWatch.jsx";
import { AuthProvider } from "./lib/auth.jsx";

/**
 * Tiny path-based router — only two screens, so no React Router needed.
 * `/login` renders the login form; everything else renders the dashboard.
 * `LoginPage` dispatches a `popstate` after a successful sign-in to flip
 * `pathname` back to `/`.
 */
function Routes() {
  const [pathname, setPathname] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  if (pathname === "/login") return <LoginPage />;
  return <ZonoticWatch />;
}

export default function App() {
  return (
    <AuthProvider>
      <main className="app-shell">
        <Routes />
      </main>
    </AuthProvider>
  );
}
