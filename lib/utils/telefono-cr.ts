// Feature 87 (T9, design §3.4) — normalizacion de telefono a E.164 Costa Rica para el
// enlace de WhatsApp (`wa.me/<normalizado>`). Funcion PURA, sin side-effects, testeable
// aislada (R13/R14). Reglas cerradas por el humano (gate F1.4 #4):
//   1. Si el crudo empieza por `+` -> se respeta el prefijo internacional: solo digitos.
//   2. Si ya trae `506` (codigo pais CR) -> se respeta, no se re-prefija.
//   3. Si tras limpiar quedan exactamente 8 digitos (numero local CR) -> se antepone `506`.
//   4. Cualquier otra longitud atipica -> solo digitos, SIN inventar prefijo.
export function normalizarTelefonoCR(raw: string): string {
  // R14: un `+` inicial indica prefijo internacional explicito; se respeta tal cual
  // (solo se quitan separadores), no se antepone `506`.
  if (raw.trim().startsWith("+")) {
    return raw.replace(/[^\d]/g, "");
  }

  const digitos = raw.replace(/[^\d]/g, "");

  // R14: ya trae el codigo de pais CR -> no duplicar `506`.
  if (digitos.startsWith("506")) {
    return digitos;
  }

  // R13: numero local CR de 8 digitos -> anteponer `506`.
  if (digitos.length === 8) {
    return `506${digitos}`;
  }

  // Longitudes atipicas: se devuelven los digitos sin prefijar (no se inventa `+506`).
  return digitos;
}
