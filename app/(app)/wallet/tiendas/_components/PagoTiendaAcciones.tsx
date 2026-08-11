"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import { Button } from "@/components/ui/button";
import { PagosRegistradosTabla } from "@/components/shared/liquidacion/PagosRegistradosTabla";
import { RegistrarPagoDialog } from "@/components/shared/liquidacion/RegistrarPagoDialog";
import {
  PAGOS_REGISTRADOS_TEXTO,
  REGISTRAR_PAGO_TEXTO,
} from "@/components/shared/liquidacion/liquidacion-labels";
import type { RegistrarPagoCampos } from "@/components/shared/liquidacion/RegistrarPagoDialog";
import type { PagoAnuladoOk } from "@/components/shared/liquidacion/AnularPagoDialog";
import { useToast } from "@/hooks/useToast";
import { money } from "@/lib/config/moneda";
import {
  anularPagoAction,
  listarPagosDeTiendaAction,
  registrarPagoTiendaAction,
} from "@/lib/actions/liquidacion";
import type { AnularPagoResult, PagoRegistradoDTO } from "@/lib/types/liquidacion";
import type { SaldoTiendaResumenDTO } from "@/lib/types/wallet-tienda";

import { claveDesgloseTienda } from "./DesgloseMovimientosTienda";
import { DESGLOSE_TIENDA_LABEL } from "./desglose-tienda-labels";

// Feature 172 (T D.3, design §10.1) — el CABLEADO del pago a una tienda. Se monta en el hueco
// `acciones` que la 171 dejó preparado en la cabecera del desglose (R45 de aquella), así que
// esta feature NO toca una línea de `DesgloseMovimientosTienda`: R34 pide conservar la tabla
// de saldos y el desglose exactamente como están, y la forma más barata de garantizarlo es no
// editarlos.
//
// Aquí viven las dos mitades que la pantalla añade: el botón que abre el diálogo compartido y
// la LISTA DE COMPROBANTES de esta tienda (R50), con su propia clave de SWR.
//
// REFRESCO DIRIGIDO (R33): tras registrar —y, desde T F.5, tras ANULAR— se invalidan
// EXACTAMENTE dos claves, las dos de ESTA tienda: la del desglose (`claveDesgloseTienda`, que
// la 171 exportó para esto) y la de su lista de comprobantes. Un `mutate()` sin argumentos
// refrescaría también los desgloses de las demás tiendas abiertas, que es lo que R33 prohíbe:
// cada fila abierta cuesta una consulta, y pagar a una tienda no es motivo para volver a leer
// las otras. Anular mueve exactamente lo mismo que pagar, así que refresca lo mismo.
//
// El `mutate` sale de `useSWRConfig()` y no del export global del módulo `swr`: aquel está
// atado a la caché por defecto, y esta pantalla puede vivir bajo un `SWRConfig` con caché
// propia. Con el del contexto, el refresco alcanza siempre a la caché en la que de verdad
// están los datos.

/** Prefijo de la clave SWR de la lista de comprobantes. Identifica esta lectura entre todas. */
const CLAVE_PAGOS_TIENDA = "liquidacion:pagos-tienda";

/**
 * Clave SWR de los comprobantes de UNA tienda. Exportada por el mismo motivo que
 * `claveDesgloseTienda`: es lo que permite refrescar esta lista —y solo esta— desde fuera.
 */
export function clavePagosDeTienda(tiendaId: string): readonly [string, string] {
  return [CLAVE_PAGOS_TIENDA, tiendaId] as const;
}

const PAGO_TIENDA_TEXTO = {
  /** R32: sin saldo a favor no hay nada que pagar, y la pantalla lo dice en vez de callar. */
  sinSaldo: "Esta tienda no tiene saldo a favor: no hay nada que pagar.",
  /**
   * Feature 201 (tanda C): el importe se compone con `money`, el MISMO formateador de la
   * cabecera del desglose y de la tabla de comprobantes de abajo. Con el `₡` a mano, esta
   * pantalla decía `₡9.000,00` arriba y `Pago de ₡4000.00 registrado.` en el toast, hablando
   * las dos del mismo dinero. `money` no convierte a número: sigue siendo money-safe.
   */
  registrado: (monto: string) => `Pago de ${money(monto)} registrado.`,
  /**
   * T F.5 — confirmación de la anulación con el saldo que devolvió el SERVIDOR, pintado tal
   * cual. **Puede ser NEGATIVO** (`-₡15.000,00`) cuando la tienda debe más de lo que se le
   * recaudó: es la cifra correcta y se enseña entera. Recortarla a cero, esconderla o
   * quitarle el signo sería mentir sobre dinero — y aquí no se toca ningún monto (el signo lo
   * coloca `money` DELANTE del símbolo, que es como se lee un negativo).
   */
  anulado: (saldo: string) => `Pago anulado. El saldo de la tienda quedó en ${money(saldo)}.`,
  /** R75: el segundo intento no anula nada nuevo; se conserva la anulación original. */
  yaAnulado: "Este pago ya estaba anulado.",
  /**
   * T F.6 — la limitación N1, declarada donde se leen las cifras que afecta (`design.md §6.4`,
   * default de `requirements.md § N1`). Se compone con los MISMOS rótulos que pinta la
   * cabecera del desglose, así que si mañana se renombra un importe el aviso lo sigue.
   *
   * Sin siglas ni vocabulario contable: dice qué cifras quedan altas, por qué, y cuál es la
   * que hay que mirar.
   */
  importesBrutos:
    `«${DESGLOSE_TIENDA_LABEL.pagado}» sigue contando los pagos que se anularon, y ` +
    `«${DESGLOSE_TIENDA_LABEL.aFavor}» suma la devolución de cada uno, así que esos dos ` +
    `importes quedan más altos de lo que se movió de verdad. «${DESGLOSE_TIENDA_LABEL.saldo}» ` +
    `ya tiene todo eso descontado: ese es el número correcto.`,
} as const;

/** Fetcher: pide los comprobantes y traduce un status != ok a un throw (SWR lo marca error). */
async function leerPagos(tiendaId: string): Promise<PagoRegistradoDTO[]> {
  const res = await listarPagosDeTiendaAction({ tiendaId });
  if (res.status !== "ok") throw new Error(res.status);
  return res.pagos;
}

export interface PagoTiendaAccionesProps {
  /**
   * La fila de la tabla de saldos: `tiendaId`, `tiendaNombre` y su saldo agregado. El saldo
   * es el STRING que devolvió el servidor y es lo que prefija el monto del diálogo (R30);
   * aquí no se opera con él, solo se pasa.
   */
  resumen: SaldoTiendaResumenDTO;
  /**
   * T F.5 (R4/R81) — `true` solo si el actor puede ANULAR. Son los mismos roles que pueden
   * pagar (`esAccesoTotal`, resuelto en el servidor), y por eso la tabla la recibe derivada
   * del MISMO valor que decide montar este componente. **Default `false`: falla cerrado.**
   */
  puedeAnular?: boolean;
}

export function PagoTiendaAcciones({
  resumen,
  puedeAnular = false,
}: PagoTiendaAccionesProps) {
  const { tiendaId, tiendaNombre, saldo, signo } = resumen;
  const { mutate } = useSWRConfig();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);

  const { data, error, isLoading } = useSWR(clavePagosDeTienda(tiendaId), () =>
    leerPagos(tiendaId),
  );

  const hayQuePagar = signo === "positivo";

  async function registrar(campos: RegistrarPagoCampos) {
    return registrarPagoTiendaAction({ ...campos, tiendaId });
  }

  /** R33 — las dos claves de ESTA tienda, ninguna más. Vale igual al pagar y al anular. */
  async function refrescarEstaTienda() {
    await Promise.all([
      mutate(claveDesgloseTienda(tiendaId)),
      mutate(clavePagosDeTienda(tiendaId)),
    ]);
  }

  async function trasRegistrar(pago: PagoRegistradoDTO) {
    toast.success(PAGO_TIENDA_TEXTO.registrado(pago.monto));
    await refrescarEstaTienda();
  }

  /** T F.5 — la anulación: el borde solo lleva el pago y el motivo; el monto lo lee el servidor. */
  async function anular(pago: PagoRegistradoDTO, motivo: string): Promise<AnularPagoResult> {
    return anularPagoAction({ pagoId: pago.id, motivo });
  }

  async function trasAnular(resultado: PagoAnuladoOk) {
    if (resultado.status === "ok") {
      toast.success(PAGO_TIENDA_TEXTO.anulado(resultado.restante));
    } else {
      toast.info(PAGO_TIENDA_TEXTO.yaAnulado);
    }
    await refrescarEstaTienda();
  }

  return (
    <div className="flex w-full flex-col gap-3">
      {/* T F.6 — la limitación N1, junto a la cabecera del desglose: este bloque se monta en el
          hueco `acciones`, que se renderiza justo debajo de los cuatro importes. */}
      <p role="note" className="text-sm text-muted-foreground">
        {PAGO_TIENDA_TEXTO.importesBrutos}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => setAbierto(true)} disabled={!hayQuePagar}>
          {REGISTRAR_PAGO_TEXTO.abrir}
        </Button>
        {hayQuePagar ? null : (
          <span className="text-sm text-muted-foreground">
            {PAGO_TIENDA_TEXTO.sinSaldo}
          </span>
        )}
      </div>

      {/* R50 — los comprobantes de esta tienda, dentro de su propio desglose. */}
      <PagosRegistradosTabla
        pagos={data ?? []}
        beneficiario={tiendaNombre}
        isLoading={isLoading}
        error={error ? PAGOS_REGISTRADOS_TEXTO.error : null}
        puedeAnular={puedeAnular}
        onAnular={anular}
        onAnulado={trasAnular}
      />

      {/* El diálogo solo se monta si alguien puede pagar: sin saldo no hay nada que abrir. */}
      {hayQuePagar ? (
        <RegistrarPagoDialog
          open={abierto}
          onOpenChange={setAbierto}
          beneficiario={tiendaNombre}
          disponible={saldo}
          onRegistrar={registrar}
          onRegistrado={trasRegistrar}
        />
      ) : null}
    </div>
  );
}
