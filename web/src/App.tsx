import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthProvider";
import { RequireAuth } from "./auth/RequireAuth";
import { Layout } from "./components/Layout";
import { ToastProvider } from "./components/Toast";
import { ForgotPasswordPage, LoginPage, SignupPage } from "./pages/AuthPages";
import { ContentPage } from "./pages/ContentPage";
import { DashboardPage } from "./pages/DashboardPage";
import { FlashcardsPage } from "./pages/FlashcardsPage";
import { MaterialDetailPage } from "./pages/MaterialDetailPage";
import { MaterialsPage } from "./pages/MaterialsPage";
import { PerformancePage } from "./pages/PerformancePage";
import { ExamPage, QuestionsPage, QuizRunnerPage } from "./pages/QuizPages";
import { SettingsPage } from "./pages/SettingsPage";
import { TutorPage } from "./pages/TutorPage";

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/entrar" element={<LoginPage />} />
            <Route path="/cadastro" element={<SignupPage />} />
            <Route path="/recuperar-senha" element={<ForgotPasswordPage />} />
            <Route element={<RequireAuth><Layout /></RequireAuth>}>
              <Route index element={<DashboardPage />} />
              <Route path="materiais" element={<MaterialsPage />} />
              <Route path="materiais/:id" element={<MaterialDetailPage />} />
              <Route path="conteudo" element={<ContentPage />} />
              <Route path="flashcards" element={<FlashcardsPage />} />
              <Route path="questoes" element={<QuestionsPage />} />
              <Route path="simulados" element={<ExamPage />} />
              <Route path="quiz/:id" element={<QuizRunnerPage />} />
              <Route path="tutor" element={<TutorPage />} />
              <Route path="desempenho" element={<PerformancePage />} />
              <Route path="configuracoes" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  );
}
