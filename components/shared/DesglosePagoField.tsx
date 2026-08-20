"use client";

import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  formatMonto as formatMontoConfigurado,
  SIN_MONTO_RAYA,
} from "@/lib/config/moneda";
import { aCentimos } from "@/lib/utils/pagos-recaudo";
import {
  acotarMonto,
  lineaNueva,
  opcionesPara,
  pendiente,
  puedeAnadirLinea,
  sinPendiente,
  totalCapturado,
  type LineaEnEdicion,
} from "@/app/(app)/mis-asignaciones/_components/desglose-captura";

// Feature 213 (R8/R9) — textos del editor de líneas de pago, en un solo sitio (i18n-ready) y
// FUERA del JSX, igual que los avisos de la 158/193. Viajan CON el componente: los dos
// consumidores tienen que llamar a las mismas cosas por el mismo nombre.
/**
 * R8: los tres importes del resumen, con la moneda de CONFIGURACIÓN. Viaja con el campo —y no
 * se recibe por props— para que los dos consumidores enseñen el mismo número con el mismo
 * formato: aquí no se escribe ningún símbolo de moneda.
 */
function money(monto: number): string {
  return formatMontoConfigurado(monto, SIN_MONTO_RAYA);
}

export const DESGLOSE_TEXTOS = {
  titulo: "Método de pago",
  linea: "Línea de pago",
  metodoLinea: "Método de pago línea",
  montoLinea: "Monto línea",
  quitarLinea: "Quitar línea",
  resumen: "Resumen del cobro",
  aCobrar: "A cobrar",
  capturado: "Capturado",
  diferencia: "Diferencia",
  anadir: "Añadir método",
  /**
   * R9: el descuadre se dice ANTES de pulsar. No es un "revisa los datos": el mensajero
   * necesita saber QUÉ no cuadra, porque este número acaba siendo la `E` del `min(P, E)` con
   * el que se le paga (feature 44).
   */
  noCuadra: "El desglose debe sumar exactamente el monto a cobrar.",
} as const;

/**
 * Feature 213 (R1-R9) — EDITOR DE LÍNEAS del recaudo.
 *
 * Pedido humano (2026-08-19): sale de `GestionarOrdenPanel` a `components/shared` porque ya
 * tiene DOS consumidores. El segundo es la CORRECCIÓN del desglose que un admin/maestro hace
 * desde el detalle de un cierre abierto, y el pedido fue literal: «como en el detalle de la
 * orden del mensajero». Copiarlo habría sido tener dos editores del mismo dato que se separan
 * a la primera —uno acota el monto al total y el otro no, uno deshabilita los métodos ya
 * usados y el otro no— sobre un dato que es dinero.
 *
 * Cada línea es un grupo con nombre accesible propio («Línea de pago N») y DOS controles y nada
 * más [D3/R7]: el método y el monto. Sin referencia y sin nota — un campo más en la calle, con
 * una mano, es un campo que se rellena mal.
 *
 * La lógica (opciones deshabilitadas, pendiente, cuadre, errores por línea) NO está aquí: está
 * en `desglose-captura.ts`, que se testea sin montar React. Aquí solo se pinta.
 */
export function DesglosePagoField({
  lineas,
  montoACobrar,
  errores,
  errorCuadre,
  errorMetodo,
  errorServidor,
  onChange,
}: {
  lineas: LineaEnEdicion[];
  montoACobrar: number;
  /** R13: error por línea, en la MISMA posición que la línea que lo provoca. */
  errores: (string | undefined)[];
  /** R9: la suma no iguala exactamente el monto a cobrar. */
  errorCuadre: string | undefined;
  /** R14: «método de pago requerido» (regla 3 del borde, campo `metodoPago`). */
  errorMetodo: string | undefined;
  /** R18: error del servidor en el campo `pagos`. */
  errorServidor: string | undefined;
  onChange: (lineas: LineaEnEdicion[]) => void;
}) {
  const capturado = totalCapturado(lineas);
  // R11: la diferencia se saca en CÉNTIMOS ENTEROS. `pendiente` no sirve aquí porque se acota a
  // 0: en el resumen hay que poder ver que se capturó de MÁS, y eso es una diferencia negativa.
  const diferencia = (aCentimos(montoACobrar) - aCentimos(capturado)) / 100;

  function cambiar(indice: number, cambio: Partial<LineaEnEdicion>) {
    onChange(lineas.map((l, i) => (i === indice ? { ...l, ...cambio } : l)));
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>{DESGLOSE_TEXTOS.titulo}</Label>

      {lineas.map((linea, i) => {
        const errorLinea = errores[i];
        return (
          <div
            key={linea.id}
            role="group"
            aria-label={`${DESGLOSE_TEXTOS.linea} ${i + 1}`}
            className="flex flex-col gap-1.5"
          >
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Select
                  value={linea.metodo}
                  onValueChange={(next) =>
                    cambiar(i, { metodo: next as LineaEnEdicion["metodo"] })
                  }
                  options={opcionesPara(lineas, i)}
                  placeholder="Selecciona un método"
                  aria-label={`${DESGLOSE_TEXTOS.metodoLinea} ${i + 1}`}
                  aria-invalid={errorLinea ? true : undefined}
                />
              </div>
              {/* Sin decimales: `text` + `inputMode="numeric"` en vez de `type="number"`, porque
                  un input numerico devuelve "" ante un "." a medio teclear y se perderia lo ya
                  escrito. El filtro real es `acotarMonto`; el `pattern` solo abre el teclado.

                  `acotarMonto` filtra a digitos Y acota al TOPE de la linea (pedido 2026-08-14):
                  con 1.000 a cobrar y 700 en la primera, teclear 2.000 en la segunda deja 300. */}
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={linea.monto}
                onChange={(e) =>
                  cambiar(i, { monto: acotarMonto(e.target.value, lineas, i, montoACobrar) })
                }
                aria-label={`${DESGLOSE_TEXTOS.montoLinea} ${i + 1}`}
                aria-invalid={errorLinea ? true : undefined}
                className="w-28"
              />
              {/* R6: quitar se ofrece mientras quede más de una línea. Con una sola no hay nada
                  que quitar: el recaudo de un método es la línea, no un extra. */}
              {lineas.length > 1 ? (
                <button
                  type="button"
                  onClick={() => onChange(lineas.filter((_, j) => j !== i))}
                  aria-label={`${DESGLOSE_TEXTOS.quitarLinea} ${i + 1}`}
                  className="rounded-md p-2 text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>
            {errorLinea ? (
              <p role="alert" className="text-sm text-destructive">
                {errorLinea}
              </p>
            ) : null}
          </div>
        );
      })}

      {/* R3: no se ofrecen más líneas que métodos hay en el catálogo. */}
      {puedeAnadirLinea(lineas) ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start gap-1.5"
          // Pedido humano (2026-08-14): sin nada pendiente, la línea que nacería sería de monto 0
          // —`pendiente` se acota a 0— y solo serviría para descuadrar. Se DESHABILITA (no se
          // esconde, a diferencia del tope de catálogo): baja el monto de una línea y vuelve.
          disabled={sinPendiente(lineas, montoACobrar)}
          // R4 [Q4]: la línea nueva nace con lo que FALTA, no en blanco. `pendiente` ya acota a 0
          // cuando lo capturado iguala o supera el total: nunca se pre-carga un negativo.
          onClick={() => onChange([...lineas, lineaNueva(pendiente(lineas, montoACobrar))])}
        >
          <Plus className="size-4" aria-hidden="true" />
          {DESGLOSE_TEXTOS.anadir}
        </Button>
      ) : null}

      {/* R8: los tres importes, siempre visibles y recalculados en cada tecla. */}
      <dl
        aria-label={DESGLOSE_TEXTOS.resumen}
        className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground"
      >
        <div className="flex gap-1.5">
          <dt>{DESGLOSE_TEXTOS.aCobrar}</dt>
          <dd className="font-semibold text-foreground">{money(montoACobrar)}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt>{DESGLOSE_TEXTOS.capturado}</dt>
          <dd className="font-semibold text-foreground">{money(capturado)}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt>{DESGLOSE_TEXTOS.diferencia}</dt>
          <dd
            className={`font-semibold ${diferencia === 0 ? "text-foreground" : "text-destructive"}`}
          >
            {money(diferencia)}
          </dd>
        </div>
      </dl>

      {errorCuadre ? (
        <p role="alert" className="text-sm text-destructive">
          {errorCuadre}
        </p>
      ) : null}
      {errorMetodo ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMetodo}
        </p>
      ) : null}
      {errorServidor ? (
        <p role="alert" className="text-sm text-destructive">
          {errorServidor}
        </p>
      ) : null}
    </div>
  );
}
