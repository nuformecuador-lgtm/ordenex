// Ficha 474 (design §6.4/§6.5, R17/R29/R42) — validez y enmascarado del telefono de un destinatario.
//
// `normalizarTelefonoWa` NORMALIZA pero no VALIDA: un telefono vacio o truncado sale como una
// cadena de digitos cualquiera. Mandar a Meta un numero imposible gasta un intento y vuelve como
// un rechazo opaco; aqui se descarta antes (R29: la entrega queda `telefono_invalido`).
import { normalizarTelefonoWa } from "@/lib/utils/whatsapp-telefono";

/**
 * Valido si, normalizado, son solo digitos, de 10 a 15, y si empieza por `506` (Costa Rica)
 * exactamente 11. `""`, 7 digitos o un `506` truncado son invalidos.
 */
export function telefonoValido(raw: string | null | undefined): boolean {
  if (raw === null || raw === undefined) return false;
  const n = normalizarTelefonoWa(raw);
  if (!/^\d{10,15}$/.test(n)) return false;
  if (n.startsWith("506") && n.length !== 11) return false;
  return true;
}

/**
 * `•••• 7777`: solo los 4 ultimos digitos (R42). Lo aplica la capa de datos al leer el historial:
 * el telefono completo no sale hacia la UI. Menos de 4 digitos → solo los puntos.
 */
export function enmascararTelefono(n: string): string {
  const digitos = n.replace(/\D/g, "");
  if (digitos.length < 4) return "••••";
  return `•••• ${digitos.slice(-4)}`;
}
