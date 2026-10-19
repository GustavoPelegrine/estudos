import { afterEach, describe, expect, it, vi } from "vitest";

const currentUser: { getIdToken: () => Promise<string> } | null = { getIdToken: async () => "token-123" };
const authMock: { currentUser: typeof currentUser | null } = { currentUser };
vi.mock("../lib/firebase", () => ({ auth: authMock, usingEmulators: false }));

const { api, ApiError, request } = await import("../lib/api");

afterEach(() => {
  vi.restoreAllMocks();
  authMock.currentUser = currentUser;
});

describe("cliente da API", () => {
  it("envia o token do Firebase no cabeçalho Authorization", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ subjects: [] }), { status: 200 }));
    await api.subjects();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/subjects");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer token-123");
  });

  it("nunca envia chave de IA nem identificador de dono escolhido pelo cliente", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    await api.createPdfMaterial({ subjectId: "s1", fileName: "a.pdf", sizeBytes: 10, pageCount: 1, warnings: [] });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({ subjectId: "s1", fileName: "a.pdf", sizeBytes: 10, pageCount: 1, warnings: [] });
    expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/apiKey|GEMINI|ownerUid/i);
  });

  it("converte erros do servidor em ApiError com a mensagem em português", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: { code: "ai_quota_user", message: "Você atingiu o limite diário." } }), { status: 429 }));
    await expect(request("POST", "/quizzes", {})).rejects.toMatchObject({ status: 429, code: "ai_quota_user", message: "Você atingiu o limite diário." });
  });

  it("trata falha de rede com mensagem amigável", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(api.materials()).rejects.toMatchObject({ code: "network" });
  });

  it("exige login antes de chamar a API", async () => {
    authMock.currentUser = null;
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(api.materials()).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
