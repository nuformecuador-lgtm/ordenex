"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import useSWR from "swr";

import { Badge } from "@/components/ui/badge";
import { DEBOUNCE_MS_DEFAULT } from "@/components/shared/FilterComponent";
import { montoValido } from "@/components/shared/monto-cliente";
import { hrefDetalleCierre } from "@/app/(app)/cierres-admin/_components/cierre-enlace";
import { previsualizarRepartoMensajeroAction } from "@/lib/actions/liquidacion";
import { LIQUIDACION_MONTO_MAX } from "@/lib/types/liquidacion";
import type { PrevisualizacionRepartoDTO } from "@/lib/types/liquidacion-reparto";

import {
  CIERRE_ENLACE,
  ESTADO_CIERRE_PLURAL,
  REPARTO_PREVISUALIZACION,
} from "./wallet-mensajeros-labels";

// Feature 205 (T5.2/T6.2, design §6/§8) — la PREVISUALIZACIÓN del reparto, dentro del
// formulario de pago.
//
// LO QUE ESTE ARCHIVO NO HACE, y es su razón de ser: **no calcula nada**. El reparto —a qué
// cierres se aplicaría el monto, cuánto a cada uno, qué queda pendiente, si el importe sobra,
// cuánto se recorta por el tope y cuánta deuda no cuelga de ningún cierre— lo deriva el
// SERVIDOR con la misma función pura que aplica la escritura (design §6.1), y llega ya
// serializado como STRING. Acá se pinta TAL CUAL. Cero `Number(`, cero `parseFloat`, cero
// resta y —esto es lo que se olvida— **cero comparación de importes**: los booleanos
// (`parcial`, `excede`, `deudaNoImputable.hay`, `recorte.aplicado`) vienen decididos de allá.
// La única lectura que se hace de un monto es «¿tiene forma de monto?», y la hace
// `montoValido` comparando TEXTO, para no pedirle al servidor una previsualización de algo
// que el borde va a rechazar igualmente.
//
// **Es una ADVERTENCIA, no un contrato** (design §6.1, R23/R25). Entre que la persona mira
// esto y confirma, otro puede haber pagado: al confirmar, el servidor vuelve a calcular bajo
// bloqueo y lo que se aplica puede diferir. Por eso lo que se enseña al terminar es el reparto
// APLICADO (`PagoMensajeroAcciones`) y no esta pantalla congelada, y por eso acá no se reserva
// ni se bloquea nada.
//
// **No es una tabla, y no por gusto** (design §8): esto no ordena, no pagina y no se descarga;
// además el componente DataTable y la tabla cruda de HTML están censados por
// `cobertura-tablas.guardia`, así que meter una tabla de tres filas dentro de un modal movería
// ese censo por nada.
//
// Los dos se nombran SIN los ángulos A PROPÓSITO, y no es manía de estilo: esa guardia cuenta las
// instancias sobre el fuente CRUDO y no distingue el código de los comentarios, así que escribir
// aquí la etiqueta de apertura contaría como una tabla DE ESTE ARCHIVO y pondría el censo rojo
// por una frase en prosa. Ya mordió dos veces (features 200 y 205). No se los devuelvas.

/** Prefijo de la clave SWR de la previsualización. Identifica esta lectura entre todas. */
const CLAVE_PREVISUALIZACION = "liquidacion:reparto-previsualizacion";

/**
 * Clave SWR de la previsualización de UN mensajero para UN monto. El monto forma parte de la
 * clave a propósito: cada importe tecleado es una lectura distinta y se cachea por separado,
 * así que volver a un monto ya visto no cuesta otra consulta.
 */
export function clavePrevisualizacionReparto(
  mensajeroId: string,
  monto?: string,
): readonly [string, string, string] {
  return [CLAVE_PREVISUALIZACION, mensajeroId, monto ?? ""] as const;
}

/**
 * Filtro de `mutate` que alcanza TODAS las previsualizaciones de UN mensajero —la de cada
 * monto— y ninguna de los demás (design §8: refresco dirigido, R33 de la 172). Tras registrar
 * un pago hay que releerlas todas: el imputable de ese mensajero cambió y el de los otros no.
 */
export function esClavePrevisualizacionDe(mensajeroId: string): (clave: unknown) => boolean {
  return (clave) =>
    Array.isArray(clave) && clave[0] === CLAVE_PREVISUALIZACION && clave[1] === mensajeroId;
}

/**
 * Fetcher: pide la previsualización y traduce un status != ok a un throw (SWR lo marca error).
 *
 * Sin `monto` devuelve el conjunto imputable y sus avisos —es lo que abre el formulario y
 * decide si el botón se habilita (R15)—; con `monto`, además las imputaciones que produciría.
 */
export async function leerPrevisualizacionReparto(
  mensajeroId: string,
  monto?: string,
): Promise<PrevisualizacionRepartoDTO> {
  const res = await previsualizarRepartoMensajeroAction(
    monto === undefined ? { mensajeroId } : { mensajeroId, monto },
  );
  if (res.status !== "ok") throw new Error(res.status);
  return res.previsualizacion;
}

export interface EnlaceCierreProps {
  /** El cierre al que se va. Es el ÚNICO identificador que estos contratos emiten (R48). */
  cierreId: string;
}

/**
 * R43/R44 — el enlace al detalle de UN cierre, igual en las tres superficies de la feature: la
 * fila del desglose, la previsualización y el resultado del reparto.
 *
 * Vive acá y no en cada consumidor porque «el mismo enlace» es literalmente lo que R44 pide, y
 * tres copias serían tres formas de que uno se quedara sin nombre accesible o apuntando a otro
 * parámetro.
 *
 * El identificador va en un texto SOLO PARA LECTORES DE PANTALLA: una página puede tener veinte
 * enlaces «Ver el cierre» y sin él sonarían todos igual. Como se AÑADE al texto visible (no lo
 * sustituye), el nombre accesible sigue conteniendo lo que se ve, que es lo que exige «Label in
 * Name»; con un `aria-label` que lo reemplazara, quien dicta por voz no podría activarlo.
 */
export function EnlaceCierre({ cierreId }: Readonly<EnlaceCierreProps>) {
  return (
    <Link
      href={hrefDetalleCierre(cierreId)}
      className="rounded-sm text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {CIERRE_ENLACE.ver}
      <span className="sr-only">{CIERRE_ENLACE.identificacion(cierreId)}</span>
    </Link>
  );
}

export interface RepartoPrevisualizacionProps {
  /** A quién se le paga. El servidor decide contra qué cierres (R9). */
  mensajeroId: string;
  /** El monto TAL CUAL se está tecleando en el formulario. Puede no ser un monto todavía. */
  monto: string;
  /**
   * Espera entre la última tecla y la consulta. Por defecto la MISMA que el resto de la app
   * (`DEBOUNCE_MS_DEFAULT`): cada previsualización deriva el pendiente de todos los cierres del
   * mensajero, así que teclear «15000» sin esperar serían cinco derivaciones completas.
   * Inyectable para poder fijarla en los tests, igual que el `ahora` del formulario.
   */
  esperaMs?: number;
}

export function RepartoPrevisualizacion({
  mensajeroId,
  monto,
  esperaMs = DEBOUNCE_MS_DEFAULT,
}: Readonly<RepartoPrevisualizacionProps>) {
  /** Lo que YA viajó al servidor. Lo que se teclea llega acá tras la espera. */
  const [aplicado, setAplicado] = useState(monto);

  useEffect(() => {
    if (monto === aplicado) return;
    const temporizador = setTimeout(() => setAplicado(monto), esperaMs);
    return () => clearTimeout(temporizador);
  }, [monto, aplicado, esperaMs]);

  // Un monto que el borde va a rechazar no se manda: se pide la previsualización SIN monto,
  // que sigue diciendo cuánto se puede pagar y qué avisos hay. Es el mismo criterio del
  // formulario y la misma función, así que no puede divergir de él.
  const consultable = montoValido(aplicado, LIQUIDACION_MONTO_MAX)
    ? aplicado.trim()
    : undefined;

  const { data, error } = useSWR(clavePrevisualizacionReparto(mensajeroId, consultable), () =>
    leerPrevisualizacionReparto(mensajeroId, consultable),
  );

  return (
    <section
      aria-label={REPARTO_PREVISUALIZACION.seccion}
      className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3"
    >
      <h3 className="text-sm font-medium">{REPARTO_PREVISUALIZACION.seccion}</h3>
      {contenidoDe(data, error, consultable !== undefined)}
    </section>
  );
}

/** El cuerpo del bloque según el estado de la lectura. Fuera del componente: no usa hooks. */
function contenidoDe(
  data: PrevisualizacionRepartoDTO | undefined,
  error: unknown,
  hayMonto: boolean,
): ReactNode {
  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {REPARTO_PREVISUALIZACION.error}
      </p>
    );
  }
  if (data === undefined) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {REPARTO_PREVISUALIZACION.cargando}
      </p>
    );
  }
  return (
    <>
      {hayMonto ? (
        <ImputacionesPrevistas imputaciones={data.imputaciones} />
      ) : (
        <p className="text-sm text-muted-foreground">{REPARTO_PREVISUALIZACION.sinMonto}</p>
      )}
      <Avisos previsualizacion={data} />
    </>
  );
}

/** R32/R33 — a qué cierres se aplicaría el monto y cuánto a cada uno. */
function ImputacionesPrevistas({
  imputaciones,
}: Readonly<{ imputaciones: PrevisualizacionRepartoDTO["imputaciones"] }>) {
  if (imputaciones.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {REPARTO_PREVISUALIZACION.sinImputaciones}
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {imputaciones.map((imputacion) => (
        <li
          key={imputacion.cierreId}
          className="flex flex-col gap-1 border-b border-border pb-2 last:border-b-0 last:pb-0"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">
              {/* El cierre se nombra por el día TRABAJADO, que es la antigüedad que ordena
                  el reparto (R8). La hora no aporta nada acá. */}
              {REPARTO_PREVISUALIZACION.cierre(imputacion.solicitadoAt.slice(0, 10))}
            </span>
            {/* R33: la parcial va MARCADA. Solo la última puede serlo. */}
            {imputacion.parcial ? (
              <Badge variant="warning">{REPARTO_PREVISUALIZACION.parcial}</Badge>
            ) : null}
            <EnlaceCierre cierreId={imputacion.cierreId} />
          </div>
          <p className="text-sm font-medium text-warning-strong">
            {REPARTO_PREVISUALIZACION.seAplica(imputacion.monto)}
          </p>
          <p className="text-xs text-muted-foreground">
            {REPARTO_PREVISUALIZACION.pendienteActual(imputacion.pendienteActual)} ·{" "}
            {REPARTO_PREVISUALIZACION.pendienteDespues(imputacion.pendienteDespues)}
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * Los avisos, y **son tres cosas distintas** (design §8, R56 exige distinguir las dos últimas):
 *
 *  - el importe NO CABE (R38): sobra dinero del que se teclea;
 *  - el RECORTE por el tope (R56): deuda pagable acá mismo, en el siguiente registro;
 *  - la deuda NO IMPUTABLE (R37): deuda que esta pantalla no sabe pagar porque no cuelga de
 *    ningún cierre.
 *
 * Fundir los dos últimos en un mensaje sería mentir sobre qué se puede cobrar y cuándo.
 */
function Avisos({
  previsualizacion,
}: Readonly<{ previsualizacion: PrevisualizacionRepartoDTO }>) {
  const { excede, sobrante, imputable, recorte, deudaNoImputable, excluidos } = previsualizacion;
  return (
    <>
      {excede ? (
        <p role="status" className="text-sm text-warning-strong">
          {REPARTO_PREVISUALIZACION.excede(sobrante, imputable)}
        </p>
      ) : null}

      {recorte.aplicado ? (
        <p role="note" className="text-xs text-muted-foreground">
          {REPARTO_PREVISUALIZACION.recorte(
            recorte.enVentana,
            recorte.fuera,
            recorte.montoFuera,
          )}
        </p>
      ) : null}

      {deudaNoImputable.hay ? (
        <p role="note" className="text-xs text-muted-foreground">
          {REPARTO_PREVISUALIZACION.deudaNoImputable(deudaNoImputable.monto)}
        </p>
      ) : null}

      {excluidos.length > 0 ? (
        <p role="note" className="text-xs text-muted-foreground">
          {REPARTO_PREVISUALIZACION.excluidos(
            excluidos
              .map((grupo) =>
                REPARTO_PREVISUALIZACION.excluido(
                  grupo.cantidad,
                  ESTADO_CIERRE_PLURAL[grupo.estado],
                ),
              )
              .join(", "),
          )}
        </p>
      ) : null}
    </>
  );
}
