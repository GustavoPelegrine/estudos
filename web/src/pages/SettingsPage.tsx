import { deleteUser, EmailAuthProvider, reauthenticateWithCredential, sendEmailVerification } from "firebase/auth";
import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { applyTheme } from "../components/Layout";
import { useToast } from "../components/Toast";
import { useAction } from "../hooks/useApi";
import { api } from "../lib/api";
import { authErrorMessage } from "../lib/auth-errors";
import { auth } from "../lib/firebase";
import { formatBytes } from "../lib/format";

export function SettingsPage() {
  const { me, user, refreshMe, logout } = useAuth();
  const toast = useToast();
  const { busy, run } = useAction();
  const [password, setPassword] = useState("");
  if (!me) return null;
  const prefs = me.profile.preferences;

  const save = (patch: Partial<typeof prefs>) =>
    run(async () => {
      try {
        await api.updatePreferences(patch);
        if (patch.theme) applyTheme(patch.theme);
        await refreshMe();
        toast("Preferências salvas.");
      } catch (err) {
        toast((err as Error).message, "error");
      }
    });

  const exportData = () =>
    run(async () => {
      try {
        const data = await api.exportData();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `estudos-odonto-dados-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        toast("Dados exportados.");
      } catch (err) {
        toast((err as Error).message, "error");
      }
    });

  const importLegacy = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = () =>
      void run(async () => {
        try {
          const file = input.files?.[0];
          if (!file) return;
          const data = JSON.parse(await file.text()) as { materials?: unknown[] };
          if (!Array.isArray(data.materials)) throw new Error("Arquivo de backup inválido.");
          if (!confirm(`Importar ${data.materials.length} material(is) do backup da versão anterior?`)) return;
          const r = await api.importLegacy({ materials: data.materials });
          toast(`${r.imported} material(is) importados.${r.skipped.length ? ` Ignorados: ${r.skipped.join(", ")}.` : ""}`);
        } catch (err) {
          toast(err instanceof SyntaxError ? "Arquivo de backup inválido." : (err as Error).message, "error");
        }
      });
    input.click();
  };

  const deleteAccount = () =>
    run(async () => {
      if (!user?.email) return;
      if (!confirm("Excluir DEFINITIVAMENTE sua conta e todos os seus dados (PDFs, textos, flashcards, simulados e conversas)? Esta ação não pode ser desfeita.")) return;
      try {
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
        await api.deleteAccountData();
        await deleteUser(user);
        toast("Conta excluída.");
        await logout();
      } catch (err) {
        toast((err as { code?: string }).code ? authErrorMessage(err) : (err as Error).message, "error");
      }
    });

  return (
    <section className="stack">
      <div className="grid two-col">
        <div className="panel stack">
          <h2>Conta</h2>
          <p className="muted small" style={{ margin: 0 }}>
            {me.profile.email} {user?.emailVerified ? <span className="pill good">e-mail confirmado</span> : <span className="pill warn">e-mail não confirmado</span>}
          </p>
          {!user?.emailVerified && (
            <div><button className="btn sm" onClick={() => void run(async () => { if (auth.currentUser) await sendEmailVerification(auth.currentUser); toast("E-mail de confirmação enviado."); })} disabled={busy}>Reenviar confirmação</button></div>
          )}
          <h3>Preferências</h3>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="pref-theme">Tema</label>
              <select id="pref-theme" value={prefs.theme} onChange={(e) => void save({ theme: e.target.value as "dark" | "light" })}>
                <option value="dark">Escuro</option>
                <option value="light">Claro</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="pref-semester">Semestre atual</label>
              <select id="pref-semester" value={prefs.defaultSemester} onChange={(e) => void save({ defaultSemester: Number(e.target.value) })}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((s) => <option key={s} value={s}>{s}º semestre</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="pref-count">Questões por sessão (padrão)</label>
              <select id="pref-count" value={prefs.defaultQuestionCount} onChange={(e) => void save({ defaultQuestionCount: Number(e.target.value) })}>
                {[3, 5, 10, 15, 20].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
          <h3>Limites e uso</h3>
          <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
            <li>Uso de IA hoje: {me.usage.aiCalls} de {me.usage.aiDailyLimit} gerações (renova à meia-noite, horário de Brasília).</li>
            <li>PDF: até {formatBytes(me.limits.maxPdfBytes)} por arquivo; até {me.limits.maxMaterials} materiais.</li>
            <li>Até {me.limits.maxQuestionsPerQuiz} questões por simulado e {me.limits.maxMaterialsPerRequest} materiais por geração.</li>
            <li>Modelo de IA: {me.model ?? "não configurado"}.</li>
          </ul>
        </div>
        <div className="panel stack">
          <h2>Seus dados</h2>
          <p className="muted small" style={{ margin: 0 }}>Exporte uma cópia de todos os seus textos, flashcards, simulados e conversas (os PDFs originais podem ser baixados em cada material).</p>
          <div className="row">
            <button className="btn" onClick={() => void exportData()} disabled={busy}>Exportar dados (JSON)</button>
            <button className="btn" onClick={importLegacy} disabled={busy}>Importar backup da versão antiga</button>
          </div>
          <p className="footer-note" style={{ marginTop: 0 }}>A importação aceita o arquivo “backup-estudos-odonto.json” gerado pelo botão “Exportar dados” da versão HTML anterior.</p>
          <h3>Privacidade</h3>
          <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
            <li>Os PDFs ficam em armazenamento privado, sem links públicos.</li>
            <li>Para gerar questões, flashcards e respostas, apenas trechos relevantes dos materiais selecionados são enviados à Gemini API pelo servidor.</li>
            <li>A IA pode errar. Confira sempre as páginas citadas.</li>
          </ul>
          <h3 style={{ color: "var(--bad)" }}>Excluir conta</h3>
          <div className="field">
            <label htmlFor="del-pass">Confirme sua senha</label>
            <input id="del-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div><button className="btn danger" onClick={() => void deleteAccount()} disabled={busy || !password}>Excluir conta e todos os dados</button></div>
        </div>
      </div>
    </section>
  );
}
