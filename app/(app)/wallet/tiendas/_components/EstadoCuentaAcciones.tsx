"use client";

import { Button } from "@/components/ui/button";
import { RegistrarMovimientoDialog } from "@/components/shared/wallet/RegistrarMovimientoDialog";
import type { EstadoCuentaDTO } from "@/lib/types/estado-cuenta";

import { ACCIONES_TIENDA_TEXTO } from "./estado-cuenta-tienda-labels";

// FICHA 458-D (T D.2, design §5; R26–R28, R40, R48) — las ACCIONES del estado de cuenta de una tienda.
// Cada una abre el diálogo ÚNICO de la 458-C con el concepto y ESTA tienda fijos (R40):
//
//  - «La tienda le paga a Ordenex» (457): SOLO con saldo en contra (R26).
//  - «Ordenex le cobra a la tienda» (461): siempre (R27).
//  - «Ordenex le paga a la tienda» (172): con saldo a favor; sin él, deshabilitado y diciendo por qué
//    en texto visible (R28). El tope del pago lo decide el SERVIDOR en «Así queda» (`superaDisponible`)
//    y al registrar; aquí no se compara ningún importe.
//
// Quién debe a quién lo dice el `signo` que manda el servidor, no una comparación en el cliente (R90).
// Tras registrar se relee SOLO esta cuenta (R30, `onCambio` = `refrescarCuenta`).

export interface EstadoCuentaAccionesProps {
  /** El estado de cuenta VIGENTE (lo que dice el servidor ahora). */
  estado: EstadoCuentaDTO;
  /** Relee las claves de ESTA cuenta (R30). */
  onCambio: () => Promise<void>;
}

export function EstadoCuentaAcciones({ estado, onCambio }: Readonly<EstadoCuentaAccionesProps>) {
  const { id, nombre } = estado.cuenta;
  const cuenta = { id, nombre };
  const aFavor = estado.signo === "positivo";
  const enContra = estado.signo === "negativo";
  const refrescar = () => void onCambio();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {enContra ? (
          <RegistrarMovimientoDialog
            conceptoInicial="abono_tienda"
            cuentaFija={cuenta}
            etiquetaBoton={ACCIONES_TIENDA_TEXTO.tiendaPaga}
            onRegistrado={refrescar}
          />
        ) : null}
        <RegistrarMovimientoDialog
          conceptoInicial="cobro_tienda"
          cuentaFija={cuenta}
          etiquetaBoton={ACCIONES_TIENDA_TEXTO.ordenexCobra}
          onRegistrado={refrescar}
        />
        {aFavor ? (
          <RegistrarMovimientoDialog
            conceptoInicial="pago_a_tienda"
            cuentaFija={cuenta}
            etiquetaBoton={ACCIONES_TIENDA_TEXTO.ordenexPaga}
            onRegistrado={refrescar}
          />
        ) : (
          <Button type="button" variant="outline" disabled aria-describedby="estado-cuenta-sin-saldo-a-favor">
            {ACCIONES_TIENDA_TEXTO.ordenexPaga}
          </Button>
        )}
      </div>
      {aFavor ? null : (
        <p id="estado-cuenta-sin-saldo-a-favor" className="text-sm text-muted-foreground">
          {ACCIONES_TIENDA_TEXTO.sinSaldoAFavor(nombre)}
        </p>
      )}
    </div>
  );
}
