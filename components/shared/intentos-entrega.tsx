import type { Column } from "@/components/shared/DataTable";
import { cn } from "@/lib/utils";

// Feature 160 (D6, design §5.1) — pieza compartida del dato "intentos de entrega".
// Un solo modulo con las DOS formas de presentacion del MISMO dato, para que las
// superficies de tabla y las de card/lista/dialogo no se desincronicen:
//   1. `columnaIntentos()`  -> columna propia "Intentos" de cualquier `DataTable` (R17),
//   2. `IntentosDato`       -> dato etiquetado "Intentos: N" fuera de tablas (R18),
//   3. `valorIntentos`      -> la unica regla de resolucion del valor (R19).
//
// NO es un chip: el diseno de badge/pastilla (`IntentosEntregaBadge`, `conChipIntentos`)
// quedo DESCARTADO por D6 (design §7.6). Un chip es un marcador de EXCEPCION; los
// intentos son un DATO de la orden y merecen encabezado propio y valor en todas las
// filas.
//
// El UMBRAL de reintentos NO aparece aqui ni se envia al cliente (R20): es
// configuracion server-only y el "X de N" sigue estando a un clic, en el drawer de
// historial de la feature 47. Hay un test de contrato que falla si este modulo llegara
// a nombrarlo o importarlo.

/** Id de la columna "Intentos". Unico para las dos tablas que la montan (R21). */
export const INTENTOS_COLUMN_ID = "intentos";

/**
 * Etiqueta unica del dato: encabezado de la columna Y etiqueta del dato etiquetado.
 * Constante exportada (no literal repetido) para dejar la puerta abierta a i18n.
 */
export const INTENTOS_LABEL = "Intentos";

/** Cualquier fila que traiga el conteo del backend (los 6 DTO internos de la 160). */
export interface FilaConIntentos {
  /** Opcional por el patron aditivo del repo; el servicio SIEMPRE lo envia, `0` incluido. */
  intentosEntrega?: number;
}

/**
 * Valor a pintar. UNICA regla de resolucion, compartida por las dos formas: el conteo
 * es un derivado que el backend garantiza numerico (R14), asi que un `undefined` en la
 * UI solo puede venir de un fixture viejo -> se pinta `0`, nunca celda vacia ni `—`
 * (R19; en este repo `—` significa "relacion opcional que no resolvio", design §5.3).
 */
export function valorIntentos(row: FilaConIntentos): number {
  return row.intentosEntrega ?? 0;
}

/**
 * Enfasis tipografico REDUNDANTE a partir de un intento: el portador de la informacion
 * es el propio numero, el color solo lo hace saltar a la vista en una tabla densa
 * (a11y: nunca se comunica solo por color). Con `0`, sin clase: neutro, pero visible.
 * Una sola definicion para las dos formas de presentacion.
 */
function claseEnfasis(intentos: number): string | undefined {
  return intentos >= 1 ? "font-semibold text-warning-strong" : undefined;
}

/** El NUMERO suelto, con su enfasis. Para superficies que ya ponen la etiqueta aparte. */
export function IntentosValor({ intentos }: { intentos: number }) {
  return (
    <span className={cn("tabular-nums", claseEnfasis(intentos))}>{intentos}</span>
  );
}

/**
 * Columna "Intentos" reutilizable por CUALQUIER tabla de ordenes (R17). Generica: la
 * misma definicion sirve a `Column<OrdenListItemDTO>` y a `Column<RecepcionSateliteDTO>`
 * sin duplicar nada. El consumidor la INSERTA justo despues de su columna `estatus`
 * (design §5.2), no al final.
 */
export function columnaIntentos<T extends FilaConIntentos>(): Column<T> {
  return {
    id: INTENTOS_COLUMN_ID,
    value: INTENTOS_LABEL,
    render: (row: T) => <IntentosValor intentos={valorIntentos(row)} />,
  };
}

/**
 * Dato etiquetado "Intentos: N" para cards, elementos de lista y dialogos (R18). Va en
 * un solo nodo de texto (etiqueta + valor juntos): asi se lee como una sola idea, se
 * traduce como una sola cadena y no queda partido para los lectores de pantalla.
 *
 * No trae tamano de texto propio: hereda del contenedor para quedar con el MISMO
 * tratamiento visual y la misma jerarquia que los campos hermanos de esa superficie.
 * Donde la superficie ya tiene su propio envoltorio etiqueta/valor (`<dt>`/`<dd>`), se
 * usa ese envoltorio con `INTENTOS_LABEL` + `IntentosValor` en vez de este componente:
 * la jerarquia de la lista de definicion es parte de ese "mismo tratamiento".
 */
export function IntentosDato({
  intentos,
  className,
}: {
  intentos: number;
  className?: string;
}) {
  return (
    <span className={cn("tabular-nums", claseEnfasis(intentos), className)}>
      {`${INTENTOS_LABEL}: ${intentos}`}
    </span>
  );
}
