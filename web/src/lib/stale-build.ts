/**
 * Após uma nova publicação, os arquivos do site mudam de nome. Uma aba aberta antes disso
 * pode tentar baixar um arquivo antigo (que não existe mais) ao carregar algo sob demanda,
 * como o leitor de PDF. Nesse caso recarregamos a página uma única vez para pegar a versão nova.
 */
const KEY = "estudos:reloadedForNewVersion";
const STALE_CHUNK = /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i;

export function isStaleChunkError(err: unknown): boolean {
  return STALE_CHUNK.test(String((err as Error)?.message ?? err));
}

/** Retorna true se a página vai ser recarregada (não mostre erro nesse caso). */
export function reloadOnceForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 60_000) return false; // já recarregou há pouco: evita laço
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

export class NewVersionError extends Error {
  constructor() {
    super("O site foi atualizado. Recarregue a página (Ctrl+F5) e tente novamente.");
  }
}

/** Para importações sob demanda: em caso de arquivo antigo, recarrega a página ou explica o que fazer. */
export async function importFresh<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (err) {
    if (!isStaleChunkError(err)) throw err;
    reloadOnceForNewVersion();
    throw new NewVersionError();
  }
}

/** Vite dispara este evento quando falha ao pré-carregar um módulo sob demanda. */
export function installStaleBuildHandler(): void {
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadOnceForNewVersion()) event.preventDefault();
  });
}
