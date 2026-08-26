import type { EmailMessage } from "@/lib/interfaces/external/IEmailSender";

export interface OtpPlantillaParams {
  to: string;
  code: string;
  expiresInMinutes: number;
}

/** Escapa el texto que se interpola en el cuerpo HTML. */
function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Renderiza el correo del codigo de verificacion. Es una funcion pura: el mismo
 * mensaje se puede afirmar en un test sin abrir una conexion.
 */
export function plantillaOtpCodigo(params: OtpPlantillaParams): EmailMessage {
  const { code, expiresInMinutes } = params;
  const texto = [
    "Tu codigo de verificacion de Ordenex es:",
    "",
    code,
    "",
    `Vence en ${expiresInMinutes} minutos y solo sirve una vez.`,
    "Si no solicitaste este codigo, ignora este mensaje y no lo compartas con nadie.",
  ].join("\n");

  const html = [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#0b2545">',
    "<p>Tu codigo de verificacion de Ordenex es:</p>",
    `<p style="font-size:28px;font-weight:700;letter-spacing:6px;color:#f26419">${escaparHtml(code)}</p>`,
    `<p>Vence en ${expiresInMinutes} minutos y solo sirve una vez.</p>`,
    "<p>Si no solicitaste este codigo, ignora este mensaje y no lo compartas con nadie.</p>",
    "</div>",
  ].join("");

  return {
    to: params.to,
    subject: `Tu codigo de verificacion: ${code}`,
    text: texto,
    html,
  };
}
