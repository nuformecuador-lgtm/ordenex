"use client";

// Lado CLIENTE de los mensajes de zod en español (`lib/validacion/zod-es.ts`). Importarlo desde un
// componente cliente del layout raíz es lo que mete el módulo en el bundle del navegador y lo
// evalúa en cada página, antes de que ningún formulario valide. El servidor lo carga aparte en
// `instrumentation.ts`.
//
// No pinta nada: el import es todo su trabajo.
import "@/lib/validacion/zod-es";

export function ZodEnEspanol(): null {
  return null;
}
