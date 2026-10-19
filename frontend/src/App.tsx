import { Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { useAuth } from './lib/auth';
import { BoardPage } from './pages/BoardPage';
import { DashboardPage } from './pages/DashboardPage';
import { JoinPage } from './pages/JoinPage';
import { LoginPage, RegisterPage } from './pages/AuthPages';

function RequireHost({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  return token ? <>{children}</> : <Navigate to="/login" replace />;
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<JoinPage />} />
        <Route path="join/:code" element={<JoinPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route
          path="host"
          element={
            <RequireHost>
              <DashboardPage />
            </RequireHost>
          }
        />
        <Route path="s/:sessionId" element={<BoardPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
