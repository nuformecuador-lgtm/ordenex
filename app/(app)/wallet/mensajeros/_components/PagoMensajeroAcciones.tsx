"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import { Button } from "@/components/ui/button";
import { RegistrarPagoDialog } from "@/components/shared/liquidacion/RegistrarPagoDialog";
import type { RegistrarPagoCampos } from "@/components/shared/liquidacion/RegistrarPagoDialog";
import { montoValido } from "@/components/shared/monto-cliente";
import { useToast } from "@/hooks/useToast";
import { registrarRepartoMensajeroAction } from "@/lib/actions/liquidacion";
import type {
  RegistrarRepartoResult,
  RepartoAplicadoDTO,
} from "@/lib/types/liquidacion-reparto";
import type { CuentaPorPagarResumenDTO } from "@/lib/types/wallet-mensajero";

import {
  EnlaceCierre,
  RepartoPrevisualizacion,
  clavePrevisualizacionReparto,
  esClavePrevisualizacionDe,
  leerPrevisualizacionReparto,
} from "./RepartoPrevisualizacion";
import {
  PAGO_MENSAJERO_WALLET,
  REPARTO_APLICADO,
  money,
} from "./wallet-mensajeros-labels";

// Feature 205 (T5.2/T5.3, design §8, R3) — el CABLEADO del pago a un mensajero desde
// `/wallet/mensajeros`: el botón que abre el formulario compartido, la previsualización que
// se pinta dentro de él y el resultado que se enseña al terminar.
//
// Se monta en la cabecera del DESGLOSE expandido, espejo exacto de `PagoTiendaAcciones` en la
// pantalla de tiendas. Ahí y no en una columna de la tabla-resumen: esa lista se descarga y
// sus columnas están atadas a guardias, y además no hay sitio en una celda para los avisos de
// R37/R56.
//
// EL PERMISO. `/wallet/mensajeros` es una pantalla de ACCESO TOTAL entera (`page.tsx`:
// `notFound()` para cualquier otro rol), así que acá no se vuelve a decidir quién ve el
// control: no se puede, el rol no existe en el cliente. La barrera real es el servicio, que
// responde `forbidden` con el MISMO predicado (design §9, R1/R4). Ocultar un botón nunca fue
// una de las dos mitades del control de acceso.
//
// LA CLAVE DE IDEMPOTENCIA es la razón de reusar el diálogo de la 172 y no escribir uno
// propio (R27/R30/R31): se acuña AL ABRIR el formulario, se conserva entre reintentos —también
// si la red se cae y la respuesta se pierde— y solo se renueva cuando el pago quedó registrado.
// Acuñarla acá, o por envío, convertiría dos clics en dos pagos, que es exactamente lo que la
// tabla del reparto existe para impedir.
//
// MONEY-SAFE (R16/R34): ni un `Number(`, ni un `parseFloat`, ni una resta. El total, lo que
// queda pendiente y lo aplicado a cada cierre llegan derivados del SERVIDOR como STRING y se
// pintan tal cual. La única lectura de un monto es «¿hay algo que pagar?», y la hace
// `montoValido` comparando TEXTO.

export interface PagoMensajeroAccionesProps {
  /** La fila del mensajero: de acá salen su id y su nombre. Los montos vienen del servidor. */
  resumen: CuentaPorPagarResumenDTO;
  /**
   * Se invoca tras un pago registrado, para que el desglose vuelva a leerse. Lo llama el
   * PADRE porque es el dueño de esas claves de SWR: acá se refresca lo propio y nada más.
   */
  onRegistrado?: () => void | Promise<void>;
  /** Espera de la previsualización. Se pasa tal cual al hijo; existe para fijarla en tests. */
  esperaPrevisualizacionMs?: number;
}

export function PagoMensajeroAcciones({
  resumen,
  onRegistrado,
  esperaPrevisualizacionMs,
}: Readonly<PagoMensajeroAccionesProps>) {
  const { mensajeroId, mensajeroNombre } = resumen;
  const { mutate } = useSWRConfig();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  /** R25 — el reparto REALMENTE aplicado. `null` mientras no se haya registrado ninguno. */
  const [aplicado, setAplicado] = useState<RepartoAplicadoDTO | null>(null);

  // La previsualización SIN monto: dice cuánto puede saldar un pago (el imputable de la
  // ventana) y es lo que prefija el formulario y decide si el botón se habilita (R15).
  const { data, error } = useSWR(clavePrevisualizacionReparto(mensajeroId), () =>
    leerPrevisualizacionReparto(mensajeroId),
  );

  const cargando = data === undefined && !error;
  const imputable = data?.imputable ?? null;
  // R15: sin cierres aprobados con saldo no hay nada que pagar. Comparación por TEXTO.
  const hayQuePagar = imputable !== null && montoValido(imputable);

  /** Refresco DIRIGIDO (design §8): las claves de ESTE mensajero, ninguna más. */
  async function refrescarEsteMensajero() {
    await mutate(esClavePrevisualizacionDe(mensajeroId));
    await onRegistrado?.();
  }

  async function registrar(campos: RegistrarPagoCampos): Promise<RegistrarRepartoResult> {
    let resultado: RegistrarRepartoResult;
    try {
      resultado = await registrarRepartoMensajeroAction({ ...campos, mensajeroId });
    } catch (fallo) {
      toast.error(PAGO_MENSAJERO_WALLET.noRegistrado);
      // Se RELANZA: el diálogo deja el formulario abierto y CONSERVA la clave, porque esa
      // petición pudo escribirse aunque la respuesta se perdiera (R31).
      throw fallo;
    }
    if (resultado.status === "ok" || resultado.status === "ya_registrado") {
      // Lo que se enseña es lo APLICADO, no lo previsualizado (R25): el servidor recalculó
      // bajo bloqueo y pudo repartir distinto de lo que la persona vio hace un momento.
      setAplicado(resultado.reparto);
      if (resultado.status === "ok") {
        toast.success(PAGO_MENSAJERO_WALLET.registrado(resultado.reparto.totalImputado));
      } else {
        toast.info(PAGO_MENSAJERO_WALLET.yaRegistrado);
      }
      await refrescarEsteMensajero();
    }
    // Los rechazos de dominio los explica el propio formulario, que se queda abierto con lo
    // escrito y con la misma clave; duplicarlos en un aviso flotante sería ruido.
    return resultado;
  }

  return (
    <section
      aria-label={`${PAGO_MENSAJERO_WALLET.seccion}: ${mensajeroNombre}`}
      className="flex w-full flex-col gap-3"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-muted-foreground">
            {PAGO_MENSAJERO_WALLET.disponible}
          </span>
          {/* Money-safe: el STRING del servidor, con formato y nada más. */}
          <span className="text-lg font-medium text-warning-strong">{money(imputable)}</span>
          <span className="text-xs text-muted-foreground">
            {PAGO_MENSAJERO_WALLET.disponibleHint}
          </span>
        </div>

        <Button
          type="button"
          loading={cargando}
          disabled={!hayQuePagar}
          onClick={() => setAbierto(true)}
        >
          {PAGO_MENSAJERO_WALLET.abrir}
        </Button>
      </div>

      {/* El motivo de que el control esté apagado se dice con TEXTO, no con su ausencia. */}
      {!cargando && !error && !hayQuePagar ? (
        <p className="text-sm text-muted-foreground">{PAGO_MENSAJERO_WALLET.sinImputable}</p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {PAGO_MENSAJERO_WALLET.error}
        </p>
      ) : null}

      {aplicado ? <RepartoAplicado reparto={aplicado} /> : null}

      {/* El formulario solo se monta si hay algo que pagar: sin imputable no hay nada que
          abrir, y montarlo acuñaría una clave de idempotencia para una solicitud imposible. */}
      {hayQuePagar ? (
        <RegistrarPagoDialog
          open={abierto}
          onOpenChange={setAbierto}
          beneficiario={mensajeroNombre}
          disponible={imputable}
          mensajeSinSaldo={PAGO_MENSAJERO_WALLET.sinSaldo}
          onRegistrar={registrar}
          renderPrevisualizacion={(monto) => (
            <RepartoPrevisualizacion
              mensajeroId={mensajeroId}
              monto={monto}
              esperaMs={esperaPrevisualizacionMs}
            />
          )}
        />
      ) : null}
    </section>
  );
}

/**
 * R25/R44 — el reparto que de verdad se escribió: cuánto se aplicó en total, a qué cierres y
 * qué sigue debiéndose por cierres después.
 *
 * **No es la previsualización confirmada.** El servidor releyó cada pendiente bajo bloqueo y
 * volvió a repartir; si entre mirar y confirmar alguien pagó, esto difiere de lo que se vio, y
 * enseñarlo es la única forma de que la persona se entere. `restanteImputable` mayor que cero
 * después de un pago no es un error: es lo que dice que hace falta otro registro.
 */
function RepartoAplicado({ reparto }: Readonly<{ reparto: RepartoAplicadoDTO }>) {
  return (
    <section
      aria-label={REPARTO_APLICADO.titulo}
      className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3"
    >
      <h3 className="text-sm font-medium">{REPARTO_APLICADO.titulo}</h3>

      <div className="flex flex-wrap gap-6">
        <p className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">{REPARTO_APLICADO.total}</span>
          <span className="text-sm font-medium text-success-strong">
            {money(reparto.totalImputado)}
          </span>
        </p>
        <p className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">{REPARTO_APLICADO.restante}</span>
          <span className="text-sm font-medium text-warning-strong">
            {money(reparto.restanteImputable)}
          </span>
          <span className="text-xs text-muted-foreground">
            {REPARTO_APLICADO.restanteHint}
          </span>
        </p>
      </div>

      <h4 className="text-xs text-muted-foreground">{REPARTO_APLICADO.imputaciones}</h4>
      <ul className="flex flex-col gap-1">
        {reparto.imputaciones.map((imputacion) => (
          <li key={imputacion.cierreId} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-success-strong">{money(imputacion.monto)}</span>
            <span className="text-xs text-muted-foreground">
              {REPARTO_APLICADO.quedaPendiente(imputacion.pendienteDespues)}
            </span>
            <EnlaceCierre cierreId={imputacion.cierreId} />
          </li>
        ))}
      </ul>
    </section>
  );
}
