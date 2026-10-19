import { ref, uploadBytesResumable } from "firebase/storage";
import { PDF_CONTENT_TYPE } from "@estudos/shared";
import { storage } from "./firebase";

/**
 * Envia o PDF diretamente ao Firebase Storage, no caminho privado reservado pelo backend.
 * As regras do Storage conferem dono, tipo, tamanho e a existência do slot.
 */
export function uploadPdf(path: string, file: File, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(ref(storage, path), file, { contentType: PDF_CONTENT_TYPE });
    task.on(
      "state_changed",
      (snap) => onProgress(snap.totalBytes ? snap.bytesTransferred / snap.totalBytes : 0),
      (err) => reject(new Error(err.code === "storage/unauthorized" ? "Envio não autorizado. Verifique o tamanho e o tipo do arquivo." : "Falha no envio do arquivo. Verifique sua conexão.")),
      () => resolve(),
    );
  });
}
