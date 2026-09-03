"use client";

import { useEffect, type CSSProperties } from "react";

import { reemitirEnCliente } from "@/lib/errors/reemitir-en-cliente";

/**
 * Feature 365 — EL ULTIMO ESCALON DE LA RED: el fallo del propio `app/layout.tsx`.
 *
 * ── POR QUE HACE FALTA, con el caso concreto de ESTE repo
 * `app/error.tsx` se renderiza DENTRO del layout raiz, asi que no puede capturar un fallo DE ese
 * layout. Y el layout raiz de esta app no es un envoltorio vacio: carga dos fuentes de Google,
 * registra el service worker y construye `metadataBase` con
 * `new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000")` —un `URL` que lanza si
 * esa variable llega mal escrita en un despliegue—. No es hipotetico: es una linea que depende
 * de una variable de entorno editable desde el panel de Vercel.
 *
 * ── POR QUE NO REUSA `ErrorState` NI `AppPage`
 * Este componente SUSTITUYE al documento entero: tiene que traer su propio `<html>` y `<body>`.
 * Si el layout raiz no llego a renderizar, nada garantiza que su hoja de estilos este en el
 * documento, asi que una pantalla hecha con clases de Tailwind podria salir SIN NINGUN estilo.
 * Por eso —y solo por eso— aqui se escriben estilos en linea y los dos hex de marca en vez de
 * tokens: los tokens viven en `app/globals.css` y este es exactamente el caso en el que no se
 * puede contar con ese archivo. Es la misma decision que toma la pantalla interna de Next
 * (`next/dist/client/components/builtin/global-error.js`, que tambien va con estilos en linea).
 * Los valores son los de `--color-navy-deep` (#0d2444) y `--color-brand` (#f26419).
 *
 * ── LA SALIDA ES UNA RECARGA DURA, NO `reset()`
 * Si lo que fallo fue el layout raiz, `reset()` vuelve a montar exactamente lo mismo y falla
 * igual. `location.reload()` pide el documento entero de nuevo, que es la unica accion con
 * alguna posibilidad de arreglar esto desde el navegador. `reset` se acepta igual porque es el
 * contrato de Next, y se llama antes de recargar por si el fallo fue transitorio.
 */

interface PropsErrorGlobal {
  error: Error & { digest?: string };
  reset: () => void;
}

const ESTILO_CUERPO: CSSProperties = {
  margin: 0,
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "1.5rem",
  backgroundColor: "#0d2444",
  color: "#ffffff",
  fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
};

const ESTILO_BOTON: CSSProperties = {
  cursor: "pointer",
  border: "none",
  borderRadius: "0.5rem",
  padding: "0.625rem 1rem",
  fontSize: "0.875rem",
  fontWeight: 500,
  backgroundColor: "#f26419",
  color: "#ffffff",
};

const ESTILO_ENLACE: CSSProperties = {
  borderRadius: "0.5rem",
  padding: "0.625rem 1rem",
  fontSize: "0.875rem",
  fontWeight: 500,
  border: "1px solid rgba(255,255,255,0.4)",
  color: "#ffffff",
  textDecoration: "none",
};

/**
 * El CONTENIDO de la pantalla, separado del documento a proposito: `<html>`/`<body>` no se
 * pueden montar dentro de un contenedor de pruebas (React aplica sus atributos al documento
 * real y descarta los hijos), asi que sin esta separacion las garantias de esta frontera —que
 * re-emite el error, que no ensena el detalle tecnico, que ofrece salida— quedarian SIN TEST.
 * Next solo mira el `export default`; este export existe para poder comprobarlo.
 */
export function ContenidoErrorGlobal({ error, reset }: Readonly<PropsErrorGlobal>) {
  // La misma garantia que en el resto de la red: el error NO se queda mudo aqui dentro.
  useEffect(() => {
    reemitirEnCliente(error);
  }, [error]);

  return (
    <div role="alert" style={{ maxWidth: "28rem", textAlign: "center" }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: "0 0 0.75rem" }}>
        No pudimos cargar la aplicación
      </h1>
      <p style={{ margin: "0 0 1.5rem", lineHeight: 1.5, opacity: 0.85 }}>
        Recargá la página. Si vuelve a fallar, esperá unos minutos y probá otra vez.
      </p>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
          justifyContent: "center",
        }}
      >
        <button
          type="button"
          onClick={() => {
            reset();
            window.location.reload();
          }}
          style={ESTILO_BOTON}
        >
          Recargar la página
        </button>
        {/* `<a>` y NO `<Link>`, a proposito, y por eso se silencia la regla de Next: lo que
            acaba de fallar es el layout RAIZ, o sea el arbol de cliente entero. Una navegacion
            suave conservaria ese runtime roto; lo unico que sirve aqui es pedir el documento de
            nuevo. Ademas `<Link>` necesita el contexto del router de la app, que en esta
            frontera puede no existir. La pantalla interna de Next hace lo mismo por la misma
            razon (con `window.location.href`); aqui se usa un enlace de verdad porque un enlace
            es lo que un lector de pantalla y un «abrir en pestana nueva» esperan encontrar. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" style={ESTILO_ENLACE}>
          Volver al inicio
        </a>
      </div>
      {error.digest ? (
        <p style={{ marginTop: "1.5rem", fontSize: "0.75rem", opacity: 0.7 }}>
          Si nos escribís, pasanos este código. Código del error:{" "}
          <code style={{ fontFamily: "ui-monospace, monospace" }}>{error.digest}</code>
        </p>
      ) : null}
    </div>
  );
}

export default function GlobalError({ error, reset }: Readonly<PropsErrorGlobal>) {
  return (
    <html lang="es">
      <body style={ESTILO_CUERPO}>
        <ContenidoErrorGlobal error={error} reset={reset} />
      </body>
    </html>
  );
}
