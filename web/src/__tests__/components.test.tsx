import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/firebase", () => ({ auth: { currentUser: null }, usingEmulators: false }));
import type { Material } from "@estudos/shared";
import { MaterialPicker } from "../components/MaterialPicker";
import { PageText } from "../pages/ContentPage";
import { useAction } from "../hooks/useApi";
import { authErrorMessage } from "../lib/auth-errors";

const material = (id: string, status: Material["status"] = "ready"): Material => ({
  id,
  ownerUid: "u",
  kind: "pdf",
  subjectId: "s",
  subjectName: "Histologia",
  semester: 2,
  topic: "",
  fileName: `${id}.pdf`,
  sizeBytes: 100,
  uploadedAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  status,
  pageCount: 3,
  extraction: null,
  errorMessage: null,
  studied: false,
});

describe("useAction", () => {
  it("ignora cliques repetidos enquanto a ação está em andamento", async () => {
    const { result } = renderHook(() => useAction());
    let calls = 0;
    let release!: () => void;
    const slow = () => new Promise<void>((r) => { calls++; release = r; });
    let p1!: Promise<unknown>;
    await act(async () => {
      p1 = result.current.run(slow);
      void result.current.run(slow);
      void result.current.run(slow);
    });
    expect(calls).toBe(1);
    await act(async () => {
      release();
      await p1;
    });
    expect(result.current.busy).toBe(false);
  });
});

describe("MaterialPicker", () => {
  it("lista apenas materiais aprovados e respeita o limite", () => {
    let selected: string[] = ["a"];
    const { rerender } = render(
      <MemoryRouter>
        <MaterialPicker materials={[material("a"), material("b"), material("c", "needs_review")]} selected={selected} onChange={(s) => (selected = s)} max={1} />
      </MemoryRouter>,
    );
    expect(screen.queryByText("c.pdf")).toBeNull();
    const b = screen.getByRole("checkbox", { name: /b\.pdf/ });
    expect(b).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /a\.pdf/ }));
    expect(selected).toEqual([]);
    rerender(
      <MemoryRouter>
        <MaterialPicker materials={[]} selected={[]} onChange={() => undefined} max={1} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Nenhum material pronto")).toBeInTheDocument();
  });
});

describe("PageText", () => {
  it("renderiza títulos e parágrafos sem interpretar HTML do PDF", () => {
    const { container } = render(<PageText text={"# Esmalte\n\nTexto <img src=x onerror=alert(1)> normal."} />);
    expect(screen.getByRole("heading", { name: "Esmalte" })).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});

describe("mensagens de autenticação", () => {
  it("traduz códigos do Firebase e não revela se o e-mail existe", () => {
    expect(authErrorMessage({ code: "auth/user-not-found" })).toBe(authErrorMessage({ code: "auth/wrong-password" }));
    expect(authErrorMessage({ code: "auth/email-already-in-use" })).toMatch(/Já existe/);
    expect(authErrorMessage({ code: "desconhecido" })).toMatch(/Tente novamente/);
  });
});
