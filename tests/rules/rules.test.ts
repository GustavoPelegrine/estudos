/**
 * Testes das regras de segurança executados nos emuladores oficiais do Firebase.
 * Rodar com: npm run test:emulator (inicia os emuladores automaticamente).
 */
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const PROJECT = "demo-estudos-odonto";
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8085 },
  });
});
afterAll(async () => env?.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users/alice"), { email: "alice@example.com" });
    await setDoc(doc(db, "users/alice/materials/m1"), { ownerUid: "alice", status: "awaiting_upload", maxBytes: 1024 });
    await setDoc(doc(db, "users/alice/materials/m2"), { ownerUid: "alice", status: "ready", maxBytes: 1024 });
    await setDoc(doc(db, "users/alice/materials/m1/pages/0001"), { page: 1, text: "texto privado" });
    await setDoc(doc(db, "users/alice/quizzes/q1"), { title: "simulado" });
    await setDoc(doc(db, "users/alice/quizKeys/q1"), { answers: {} });
    await setDoc(doc(db, "users/alice/usage/2026-10-19"), { aiCalls: 3 });
    await setDoc(doc(db, "users/alice/conversations/c1/messages/x"), { text: "oi" });
  });
});

const alice = () => env.authenticatedContext("alice", { email: "alice@example.com", firebase: { sign_in_provider: "password" } });
const bob = () => env.authenticatedContext("bob", { email: "bob@example.com", firebase: { sign_in_provider: "password" } });
const anon = () => env.unauthenticatedContext();
const anonymousUser = () => env.authenticatedContext("alice", { firebase: { sign_in_provider: "anonymous" } });

describe("Firestore: isolamento entre usuários", () => {
  it("a dona lê os próprios dados", async () => {
    const db = alice().firestore();
    await assertSucceeds(getDoc(doc(db, "users/alice")));
    await assertSucceeds(getDoc(doc(db, "users/alice/materials/m1")));
    await assertSucceeds(getDoc(doc(db, "users/alice/materials/m1/pages/0001")));
    await assertSucceeds(getDocs(collection(db, "users/alice/materials")));
    await assertSucceeds(getDoc(doc(db, "users/alice/conversations/c1/messages/x")));
  });

  it("outro usuário não lê nada da conta alheia", async () => {
    const db = bob().firestore();
    await assertFails(getDoc(doc(db, "users/alice")));
    await assertFails(getDoc(doc(db, "users/alice/materials/m1")));
    await assertFails(getDoc(doc(db, "users/alice/materials/m1/pages/0001")));
    await assertFails(getDocs(collection(db, "users/alice/materials")));
    await assertFails(getDoc(doc(db, "users/alice/quizzes/q1")));
    await assertFails(getDoc(doc(db, "users/alice/conversations/c1/messages/x")));
  });

  it("visitante não autenticado e conta anônima são negados", async () => {
    await assertFails(getDoc(doc(anon().firestore(), "users/alice/materials/m1")));
    await assertFails(getDoc(doc(anonymousUser().firestore(), "users/alice/materials/m1")));
  });

  it("nenhuma gravação direta do navegador é aceita, nem pelo dono", async () => {
    const db = alice().firestore();
    await assertFails(setDoc(doc(db, "users/alice/materials/novo"), { ownerUid: "alice" }));
    await assertFails(updateDoc(doc(db, "users/alice/materials/m1"), { status: "ready" }));
    await assertFails(deleteDoc(doc(db, "users/alice/materials/m1")));
    await assertFails(setDoc(doc(db, "users/alice/stats/summary"), { correct: 999 }));
    // tentar gravar dados na conta de outra pessoa
    await assertFails(setDoc(doc(bob().firestore(), "users/alice/materials/x"), { ownerUid: "bob" }));
  });

  it("gabaritos e contadores de uso não são legíveis pelo cliente", async () => {
    const db = alice().firestore();
    await assertFails(getDoc(doc(db, "users/alice/quizKeys/q1")));
    await assertFails(getDoc(doc(db, "users/alice/usage/2026-10-19")));
  });

  it("coleções fora de /users são negadas", async () => {
    await assertFails(getDoc(doc(alice().firestore(), "usageGlobal/2026-10-19")));
    await assertFails(setDoc(doc(alice().firestore(), "qualquer/coisa"), { a: 1 }));
  });
});
