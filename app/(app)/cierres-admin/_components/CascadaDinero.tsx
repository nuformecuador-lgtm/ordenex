"use client";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { esMontoNegativo, money } from "./cierre-detalle-shared";

/**
 * Feature 393 (F1, design §7.3) — UNA CASCADA DE DINERO: unas cuantas líneas que se restan (o
 * se suman) y un resultado destacado al final.
 *
 * ── QUÉ NO HACE, Y ES LO QUE LA HACE SEGURA
 * **Ni una operación aritmética** (R13). Cada línea llega con su importe YA DERIVADO por el
 * servidor, como STRING de escala 2, y aquí sólo se decide qué OPERADOR lo precede, si va
 * destacado y de qué color. No hay `Number(`, `parseFloat(`, `parseInt(` ni `.toFixed(`: el
 * único que toca los importes es `money()`, y el único que mira su valor es `esMontoNegativo()`,
 * que lee el SIGNO DEL TEXTO (R14).
 *
 * ── EL OPERADOR, Y POR QUÉ VA PEGADO AL IMPORTE
 * Un sustraendo se pinta `-₡14.000` y un sumando `+₡0`, con el operador pegado al importe en vez
 * de en una columna aparte. Es deliberado y tiene una consecuencia medible: la cadena resultante
 * tiene EXACTAMENTE la forma de un importe con signo, así que la guardia de identidades de la
 * ficha 359 (`tests/components/DineroIdentidadesEnPantalla.test.tsx`) puede leer las cuatro
 * líneas del DOM, sumarlas y comprobar que la resta DA — que es lo que piden R6-R9, y lo que no
 * se puede comprobar si el signo vive en otro nodo.
 *
 * ── RESTAR UN IMPORTE QUE YA VIENE NEGATIVO
 * No pasa con los datos de hoy —los tres sustraendos son snapshots de pagos, nunca negativos—,
 * pero si pasara, pintar `--₡1.000` sería ilegible y pintar `-₡1.000` bajo un rótulo de resta
 * diría lo contrario de lo que ocurre: restar un negativo SUMA. Así que el operador se invierte
 * y el importe se pinta sin su signo. Es una regla sobre el TEXTO (mirar si empieza por `-` y
 * quitar ese carácter), no aritmética: el importe no se recalcula nunca.
 * **Decisión del frontend_dev**, no del humano ni del diseño, que no cubría este caso.
 *
 * ── EL NEGATIVO DEL RESULTADO (R11/R36)
 * Un resultado negativo se pinta CON SU SIGNO y en tono de atención (`text-danger-strong`, ya
 * censado por `factura-contraste.guardia`). Nunca se recorta a cero, nunca se esconde tras un
 * valor absoluto y nunca se trata como un fallo: sale de la estructura de la fórmula —el pago al
 * mensajero es fijo por entrega e independiente de lo recaudado— y medido contra producción el
 * 2026-09-08 ya le pasaba a 1 de 14 cierres de bodega. El tono se aplica sólo a las líneas
 * DESTACADAS: un sustraendo no es un resultado, y teñir de rojo lo que sólo es un descuento
 * gastaría la señal justo donde hace falta.
 */

/** Cómo entra una línea en la cuenta de su cascada. */
export type SignoCascada = "suma" | "resta" | "neutro";

/** Una línea de la cascada: rótulo, importe YA derivado y cómo entra en la cuenta. */
export interface LineaCascada {
  label: string;
  /** STRING money-safe escala 2, con su signo si lo tiene. El componente NO lo calcula. */
  monto: string;
  signo: SignoCascada;
  /** El resultado de la cascada: se destaca frente a las líneas que lo componen (R3/R4). */
  destacado?: boolean;
  /**
   * Explicaciones bajo el rótulo (de qué resta sale, qué significa el signo, por qué esa línea
   * no se resta de lo recaudado). Son VARIAS y no una cadena unida: un resultado negativo lleva
   * su nota además de la fija, y fundirlas en un párrafo dejaría a quien lee —y a quien la
   * busca en un test— sin poder distinguir cuál de ellas está puesta.
   */
  notas?: readonly string[];
}

export interface CascadaDineroProps {
  /** Rótulo visible de la cascada. */
  titulo: string;
  /** Nombre accesible de la región, PROPIO y distinto del de la otra cascada (R32). */
  ariaLabel: string;
  lineas: readonly LineaCascada[];
}

/**
 * El importe tal y como se lee, con su operador delante.
 *
 * `neutro` es la primera línea de la cascada (el minuendo): no lleva operador porque no se suma
 * a nada, se parte de ella. El resultado destacado tampoco: es el `=`, no un sumando más.
 */
function conOperador(monto: string, signo: SignoCascada): string {
  const pintado = money(monto);
  if (signo === "neutro") return pintado;

  // Regla sobre el TEXTO, no sobre el número: ver la nota de cabecera.
  const negativo = esMontoNegativo(monto);
  const sinSigno = pintado.startsWith("-") ? pintado.slice(1) : pintado;
  const resta = signo === "resta";
  const operador = resta === negativo ? "+" : "-";
  return `${operador}${sinSigno}`;
}

/** Una línea de la cascada: rótulo (y su nota) a la izquierda, importe a la derecha. */
function LineaDeCascada({ linea }: Readonly<{ linea: LineaCascada }>) {
  const { label, monto, signo, destacado = false, notas = [] } = linea;
  // R11/R36: el tono de atención es del RESULTADO, no de un descuento cualquiera.
  const enDeuda = destacado && esMontoNegativo(monto);

  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5",
        destacado && "border-t border-border pt-2.5",
      )}
    >
      <span className="flex flex-col gap-0.5">
        <span className={cn("text-sm", destacado && "font-semibold text-foreground")}>
          {label}
        </span>
        {notas.map((nota) => (
          <span key={nota} className="text-xs text-muted-foreground">
            {nota}
          </span>
        ))}
      </span>
      <span
        className={cn(
          "tabular-nums text-sm",
          destacado && "text-base font-semibold text-foreground",
          enDeuda && "text-danger-strong",
        )}
      >
        {conOperador(monto, signo)}
      </span>
    </div>
  );
}

/**
 * La cascada entera: una `region` accesible con su propio nombre (R32), su rótulo visible y sus
 * líneas en el orden en que se leen. El orden, las notas y qué línea es el resultado los decide
 * quien la monta: aquí no hay ni una decisión de dominio.
 */
export function CascadaDinero({
  titulo,
  ariaLabel,
  lineas,
}: Readonly<CascadaDineroProps>) {
  return (
    <section aria-label={ariaLabel} className="flex flex-col gap-3">
      <h3 className="text-base font-semibold">{titulo}</h3>
      <Card>
        <CardContent className="flex flex-col pt-6">
          {lineas.map((linea) => (
            <LineaDeCascada key={`${linea.label}-${linea.signo}`} linea={linea} />
          ))}
        </CardContent>
      </Card>
    </section>
  );
}
