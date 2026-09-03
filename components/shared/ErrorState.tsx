"use client";

import { useEffect, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";

import { EmptyState } from "@/components/shared/EmptyState";
import { Button, buttonVariants } from "@/components/ui/button";
import { reemitirEnCliente } from "@/lib/errors/reemitir-en-cliente";

/**
 * Forma del error que Next entrega a un `error.tsx`. En produccion, si el fallo ocurrio en el
 * SERVIDOR, `message` viene REDACTADO por Next y lo unico util es `digest` —el mismo que sale
 * impreso en la linea del registro del servidor—. Se declara asi porque es el contrato, no
 * porque este componente vaya a leer `message`: NO lo lee, y hay una guardia que lo sostiene
 * (`tests/unit/guards/red-de-errores.guardia.test.ts`).
 */
export interface ErrorDeFrontera {
  digest?: string;
}

export interface ErrorStateProps {
  /** El error capturado por la frontera. Se re-emite; NUNCA se pinta. */
  error: ErrorDeFrontera;
  /** `reset` de la frontera de Next: vacia el estado de error y reintenta el subarbol. */
  reset: () => void;
  /** Que fallo, dicho al usuario. Entra por prop para que la traduccion futura no toque esto. */
  titulo: ReactNode;
  /** Que puede hacer a continuacion. */
  descripcion: ReactNode;
  /** Etiqueta del boton de reintento. */
  etiquetaReintentar?: string;
  /** Etiqueta de la salida segura. `null` la quita (util donde no hay portal al que volver). */
  etiquetaInicio?: string | null;
  /** Destino de la salida segura. `/dashboard` reparte por rol y sirve para todos. */
  hrefInicio?: string;
  /** Rotulo del identificador que el usuario puede dictarnos. */
  etiquetaCodigo?: string;
  /** Frase que explica para que sirve el codigo. */
  explicacionCodigo?: ReactNode;
}

/**
 * Pantalla de error compartida: lo que ve el usuario cuando una pantalla del portal no se pudo
 * renderizar. La montan TODAS las fronteras de error de la app (`app/error.tsx`,
 * `app/(app)/error.tsx` y las de seccion), y por eso concentra las cuatro garantias de la
 * feature 365 en un solo sitio auditable:
 *
 * 1. **Dice que algo fallo.** Icono de advertencia + texto de fallo. NO se disfraza de estado
 *    vacio: reusa `EmptyState` —que es el vocabulario de la app para «mensaje centrado + salida»,
 *    DESIGN.md— pero el mensaje habla de un fallo, no de una ausencia de datos. Un `?? []` que
 *    convierte un fallo en «no hay nada» es justamente lo que este repo rechaza.
 * 2. **Deja salir.** Dos salidas SIEMPRE: reintentar y volver al inicio. Sin callejon.
 * 3. **No amordaza el registro.** Re-emite el error (ver `lib/errors/reemitir-en-cliente.ts`,
 *    que explica por que anadir un `error.tsx` DEGRADA la senal del lado cliente si nadie la
 *    repone). El registro del SERVIDOR es independiente y sigue intacto: un fallo de render de
 *    Server Component se registra antes de que esta frontera exista.
 * 4. **No filtra el detalle tecnico.** No se pinta `message`, ni `stack`, ni `cause`. Lo unico
 *    que se ensena es el `digest`: un hash del mensaje + el stack, calculado por Next
 *    (`server/app-render/create-error-handler.js`), que NO contiene datos y que es la clave con
 *    la que se localiza la linea exacta en el registro del servidor. Sin `digest` (fallo de
 *    cliente) simplemente no se ensena nada.
 *
 * ── EL REINTENTO ES `refresh` + `reset`, Y NO SOLO `reset`
 * `reset()` a secas se limita a vaciar el estado de la frontera y volver a renderizar el mismo
 * arbol; si el fallo vino del servidor, el cliente reintenta con la MISMA carga rota y vuelve a
 * fallar al instante, que se ve como un boton que no hace nada. `router.refresh()` es lo que
 * pide de nuevo el RSC. Van juntos y dentro de una transicion, para que el boton pueda decir que
 * esta trabajando (`loading`) en vez de parecer muerto.
 */
export function ErrorState({
  error,
  reset,
  titulo,
  descripcion,
  etiquetaReintentar = "Reintentar",
  etiquetaInicio = "Ir al inicio",
  hrefInicio = "/dashboard",
  etiquetaCodigo = "Código del error",
  explicacionCodigo = "Si nos escribís, pasanos este código: con él ubicamos qué falló.",
}: Readonly<ErrorStateProps>) {
  const router = useRouter();
  const [reintentando, iniciarReintento] = useTransition();

  // El error se re-emite UNA vez por ocurrencia (el de-duplicado vive en `reemitirEnCliente`,
  // por identidad del objeto). Depende de `error` para que una ocurrencia NUEVA vuelva a emitir.
  useEffect(() => {
    reemitirEnCliente(error);
  }, [error]);

  function reintentar() {
    iniciarReintento(() => {
      router.refresh();
      reset();
    });
  }

  return (
    // `role="alert"` porque la pantalla de error SUSTITUYE al contenido sin que haya habido
    // navegacion: sin region viva, un lector de pantalla no anuncia nada y la persona se queda
    // esperando datos que ya no van a llegar. Es atomica a proposito: se lee el fallo Y las
    // salidas, que es lo unico accionable que queda en pantalla.
    <div role="alert">
      <EmptyState
        icon={TriangleAlert}
        // El disco del icono va en el par semantico de `danger` y no en el `bg-muted` neutro
        // del estado vacio: es lo unico que, de un vistazo y antes de leer nada, distingue
        // «algo se rompio» de «aqui no hay nada». Tecnica soft-badge de DESIGN.md, la misma
        // que usa `Badge` variante `danger`.
        iconClassName="bg-danger-soft text-danger-strong dark:bg-danger/15"
        title={titulo}
        description={descripcion}
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button type="button" onClick={reintentar} loading={reintentando}>
              {etiquetaReintentar}
            </Button>
            {etiquetaInicio === null ? null : (
              <Link href={hrefInicio} className={buttonVariants({ variant: "outline" })}>
                {etiquetaInicio}
              </Link>
            )}
          </div>
        }
      />

      {error.digest ? (
        <p className="mt-4 text-center text-xs text-muted-foreground">
          {explicacionCodigo}{" "}
          <span className="whitespace-nowrap">
            {etiquetaCodigo}:{" "}
            <code className="font-mono text-foreground">{error.digest}</code>
          </span>
        </p>
      ) : null}
    </div>
  );
}
