// Next llama a `register()` una vez por arranque del servidor (y por instancia en Vercel), ANTES de
// atender ninguna petición: es el único punto de entrada de servidor que corre antes de cualquier
// server action, route handler o render.
//
// Hoy solo carga los mensajes de zod en español (`lib/validacion/zod-es.ts`). Esa configuración
// vive en `globalThis`, así que fijarla aquí vale para todas las copias de zod del proceso.
export async function register(): Promise<void> {
  await import("@/lib/validacion/zod-es");
}
