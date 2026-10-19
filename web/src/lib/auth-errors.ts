/** Mensagens em português para os códigos de erro do Firebase Authentication. */
const MESSAGES: Record<string, string> = {
  "auth/invalid-email": "E-mail inválido.",
  "auth/missing-password": "Informe a senha.",
  "auth/weak-password": "A senha precisa ter pelo menos 8 caracteres.",
  "auth/email-already-in-use": "Já existe uma conta com este e-mail. Tente entrar ou recuperar a senha.",
  "auth/invalid-credential": "E-mail ou senha incorretos.",
  "auth/wrong-password": "E-mail ou senha incorretos.",
  "auth/user-not-found": "E-mail ou senha incorretos.",
  "auth/user-disabled": "Esta conta foi desativada.",
  "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
  "auth/network-request-failed": "Falha de conexão. Verifique sua internet.",
  "auth/password-does-not-meet-requirements": "A senha não atende aos requisitos de segurança.",
};

export function authErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  return MESSAGES[code] ?? "Não foi possível concluir a operação. Tente novamente.";
}
