import { NoEncontradoState } from "@/components/shared/NoEncontradoState";

/**
 * ⭑ FICHA 438 — EL 404 DE FUERA DEL PORTAL, Y EL DE LAS URL QUE NO CASAN CON NADA.
 *
 * Cubre los dos huecos que `app/(app)/not-found.tsx` no puede cubrir, por cómo funcionan las
 * fronteras de Next —el mismo reparto a dos alturas que ya tiene la red de errores de la
 * feature 365 (`app/error.tsx` frente a `app/(app)/error.tsx`)—:
 *
 * 1. **Las páginas públicas**: la landing, `/login`, `/paquete`, `/postulacion` y
 *    `/recuperar-contrasena`, que están fuera del grupo `(app)`.
 * 2. **Las URL que no casan con NINGUNA ruta del árbol**. Next resuelve esas con el
 *    `not-found` de la raíz, porque la petición no llegó a entrar en ningún segmento: el del
 *    grupo `(app)` no puede verlas.
 *
 * ── POR QUÉ NO USA `AppPage`
 *
 * Aquí no hay sidebar ni sesión garantizada, y `AppPage` monta el encabezado del portal —con
 * campana de notificaciones y «Salir»—, que pediría datos de una sesión que puede no existir.
 * Se pinta un armazón mínimo y autosuficiente, igual que `app/error.tsx`.
 *
 * Y por la misma razón esta pantalla NO LEE LA SESIÓN: la salida segura es `/` y no el inicio
 * por rol. Quien llega hasta aquí puede no tener sesión, y el middleware ya reparte desde la
 * raíz —a `/dashboard` si hay cookie, al login si no—. Además, Next prerenderiza esta pantalla
 * como la ruta `/_not-found`: leer la cookie aquí la volvería dinámica para todo el sitio.
 *
 * El texto es el MISMO que el del portal, y no por comodidad: vive entero en
 * `NoEncontradoState`, que explica por qué no puede nombrar el motivo (ficha 433).
 */
export default function NoEncontrado() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md">
        <h1 className="text-center text-2xl font-semibold tracking-tight text-foreground">
          No encontramos esta página
        </h1>
        <NoEncontradoState hrefInicio="/" />
      </div>
    </main>
  );
}
