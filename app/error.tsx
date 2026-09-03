"use client";

import { ErrorState } from "@/components/shared/ErrorState";

/**
 * Feature 365 — LA RED DE LA RAIZ. Es la que cubre los dos huecos que `app/(app)/error.tsx` no
 * puede cubrir, por como funcionan las fronteras de Next:
 *
 * 1. **El layout del portal** (`app/(app)/layout.tsx`): resuelve la sesion, el rol, el tema y
 *    pinta el sidebar. Un `error.tsx` se renderiza DENTRO del layout de su segmento, asi que el
 *    del grupo `(app)` no puede capturar un fallo de ese layout — la frontera de al lado no ve
 *    caerse a su propio padre. Sin esta, ese caso volvia a ser pantalla en blanco.
 * 2. **Las paginas publicas**: `/login`, la landing, `/paquete`, `/postulacion` y
 *    `/recuperar-contrasena`, que estan fuera del grupo `(app)` y no tenian NINGUNA red.
 *
 * ── POR QUE NO USA `AppPage`
 * Aqui no hay sidebar ni sesion garantizada: si lo que fallo fue el layout del portal, montar su
 * cabecera —que trae campana de notificaciones y «Salir»— seria pedirle datos a lo mismo que
 * acaba de caerse. Se pinta un armazon minimo y autosuficiente.
 *
 * La salida segura es `/` y no `/dashboard`: quien llega hasta esta frontera puede no tener
 * sesion (una pagina publica), y el middleware ya manda a `/dashboard` a quien si la tiene.
 */
export default function ErrorDeLaRaiz({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md">
        <h1 className="text-center text-2xl font-semibold tracking-tight text-foreground">
          No pudimos cargar la página
        </h1>
        <ErrorState
          error={error}
          reset={reset}
          titulo="Algo falló al mostrarla"
          descripcion="Probá de nuevo. Si vuelve a fallar, volvé al inicio y entrá otra vez."
          hrefInicio="/"
          etiquetaInicio="Volver al inicio"
        />
      </div>
    </main>
  );
}
