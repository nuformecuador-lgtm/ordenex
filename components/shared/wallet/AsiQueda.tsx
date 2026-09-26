"use client";

import { useEffect, useState, type ReactNode } from "react";
import useSWR from "swr";

import { previsualizarMovimientoAction } from "@/lib/actions/efecto-movimiento";
import { money } from "@/lib/config/moneda";
import type { ConceptoRegistro, EfectoMovimientoDTO, LineaEfectoDTO } from "@/lib/types/efecto-movimiento";
import { cn } from "@/lib/utils";

import { CAJA_RESUMEN_LABEL, rotuloCifraPrincipal } from "@/app/(app)/wallet/_components/wallet-labels";

import { ASI_QUEDA_TEXTO } from "./registrar-movimiento-labels";

// FICHA 458-C (T C.2, design §4.4, R44–R47, R90) — «Así queda»: el antes y el después de registrar,
// CALCULADOS EN EL SERVIDOR (`previsualizarMovimientoAction`, que llama a `derivarCaja` y a la
// derivación del saldo de la cuenta). Aquí no se resta, no se suma y no se convierte ningún importe:
// cada cifra llega como STRING y se pinta con `money`.
//
//  - Se pide con RETARDO (la persona teclea «25000» y no son cinco lecturas) y NUNCA sin un monto
//    válido ni, si el concepto la lleva, sin la cuenta (design §4.4).
//  - Cargando y error se dicen en palabras, y el error NO enseña cifras (R46): ni las de antes.
//  - La línea que el concepto no mueve dice «no cambia» (R45), en vez de desaparecer.
//  - El aviso de saldo en contra (R47) y el del tope (`superaDisponible`) los decide el SERVIDOR.

/** Lo que pide la previsualización, o `null` si todavía no hay nada que pedir. */
export interface PeticionAsiQueda {
  concepto: ConceptoRegistro;
  cuentaId?: string;
  monto: string;
}

/** Espera entre la última tecla y la lectura. Inyectable para los tests. */
export const ASI_QUEDA_ESPERA_MS = 400;

/** La petición, con retardo: solo cambia cuando la persona deja de teclear. */
function useConRetardo<T>(valor: T, esperaMs: number): T {
  const [retrasado, setRetrasado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setRetrasado(valor), esperaMs);
    return () => clearTimeout(t);
  }, [valor, esperaMs]);
  return retrasado;
}

async function leerEfecto(peticion: PeticionAsiQueda): Promise<EfectoMovimientoDTO> {
  const res = await previsualizarMovimientoAction({
    concepto: peticion.concepto,
    monto: peticion.monto,
    ...(peticion.cuentaId === undefined ? {} : { cuentaId: peticion.cuentaId }),
  });
  if (res.status !== "ok") throw new Error(res.status);
  return res.efecto;
}

export interface AsiQuedaProps {
  /** `null` = aún falta el monto (o la cuenta): se dice qué falta, sin pedir nada. */
  peticion: PeticionAsiQueda | null;
  /** El concepto lleva cuenta: cambia el texto de lo que falta. */
  llevaCuenta: boolean;
  /** Nombre de la cuenta elegida, para rotular su línea (nunca su id). */
  nombreCuenta: string | null;
  /** Qué tope aplica si el servidor dice `superaDisponible`. */
  tope?: "pago_tienda" | "abono" | null;
  esperaMs?: number;
}

function claveDe(p: PeticionAsiQueda | null): readonly [string, string, string, string] | null {
  return p === null ? null : (["wallet:asi-queda", p.concepto, p.cuentaId ?? "", p.monto] as const);
}

function Linea({ nombre, linea }: { nombre: string; linea: LineaEfectoDTO }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 py-1 sm:grid-cols-[1fr_auto_auto]">
      <dt className="text-sm text-muted-foreground">{nombre}</dt>
      {linea.cambia ? (
        <>
          <dd className="text-right text-sm tabular-nums text-muted-foreground">
            <span className="sr-only">{`${ASI_QUEDA_TEXTO.antes}: `}</span>
            {money(linea.antes)}
          </dd>
          <dd className="col-start-2 text-right text-sm font-medium tabular-nums sm:col-start-3">
            <span className="sr-only">{`${ASI_QUEDA_TEXTO.despues}: `}</span>
            {money(linea.despues)}
          </dd>
        </>
      ) : (
        <dd className="text-right text-sm text-muted-foreground sm:col-span-2">
          {`${money(linea.antes)} · ${ASI_QUEDA_TEXTO.noCambia}`}
        </dd>
      )}
    </div>
  );
}

export function AsiQueda({
  peticion,
  llevaCuenta,
  nombreCuenta,
  tope = null,
  esperaMs = ASI_QUEDA_ESPERA_MS,
}: AsiQuedaProps) {
  const pedida = useConRetardo(peticion, esperaMs);
  // Mientras la persona teclea, la lectura en curso es de la cifra ANTERIOR: se dice «calculando».
  const alDia = claveDe(pedida)?.join("|") === claveDe(peticion)?.join("|");
  const { data, error, isLoading } = useSWR(alDia ? claveDe(pedida) : null, () => leerEfecto(pedida as PeticionAsiQueda), {
    shouldRetryOnError: false,
    revalidateOnFocus: false,
  });

  let cuerpo: ReactNode;
  if (peticion === null) {
    cuerpo = (
      <p className="text-sm text-muted-foreground">
        {llevaCuenta ? ASI_QUEDA_TEXTO.inactivoConCuenta : ASI_QUEDA_TEXTO.inactivo}
      </p>
    );
  } else if (error !== undefined && alDia) {
    cuerpo = (
      <p role="alert" className="text-sm text-destructive">
        {ASI_QUEDA_TEXTO.error}
      </p>
    );
  } else if (!alDia || isLoading || data === undefined) {
    cuerpo = (
      <p role="status" className="text-sm text-muted-foreground">
        {ASI_QUEDA_TEXTO.cargando}
      </p>
    );
  } else {
    const { lineas } = data;
    const nombre = nombreCuenta ?? "";
    cuerpo = (
      <>
        <dl className="flex flex-col divide-y divide-border">
          {lineas.cuenta === null ? null : (
            <Linea
              nombre={
                lineas.cuenta.tipo === "tienda"
                  ? ASI_QUEDA_TEXTO.cuentaTienda(nombre)
                  : ASI_QUEDA_TEXTO.cuentaMensajero(nombre)
              }
              linea={lineas.cuenta}
            />
          )}
          <Linea
            nombre={rotuloCifraPrincipal({ periodoFiltrado: false, estado: lineas.cifraPrincipal.rotulo })}
            linea={lineas.cifraPrincipal}
          />
          <Linea nombre={CAJA_RESUMEN_LABEL.ganancia} linea={lineas.ganancia} />
          <Linea nombre={CAJA_RESUMEN_LABEL.deTerceros} linea={lineas.deTiendas} />
          <Linea nombre={CAJA_RESUMEN_LABEL.capital} linea={lineas.capital} />
        </dl>
        {data.saldoEnContra && lineas.cuenta !== null ? (
          <p role="alert" className="mt-2 text-sm font-medium text-danger-strong">
            {ASI_QUEDA_TEXTO.saldoEnContra(nombre, lineas.cuenta.despues)}
          </p>
        ) : null}
        {data.superaDisponible === true && tope !== null ? (
          <p role="alert" className="mt-2 text-sm font-medium text-danger-strong">
            {tope === "pago_tienda" ? ASI_QUEDA_TEXTO.superaPagoTienda : ASI_QUEDA_TEXTO.superaAbono}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <section
      aria-label={ASI_QUEDA_TEXTO.titulo}
      className={cn("rounded-lg border border-border bg-muted/30 px-3 py-2")}
    >
      <h3 className="mb-1 text-sm font-semibold">{ASI_QUEDA_TEXTO.titulo}</h3>
      {peticion !== null && !(error !== undefined && alDia) && data !== undefined && alDia ? (
        <div aria-hidden="true" className="hidden grid-cols-[1fr_auto_auto] gap-x-3 text-xs text-muted-foreground sm:grid">
          <span />
          <span className="text-right">{ASI_QUEDA_TEXTO.antes}</span>
          <span className="text-right">{ASI_QUEDA_TEXTO.despues}</span>
        </div>
      ) : null}
      {cuerpo}
    </section>
  );
}
