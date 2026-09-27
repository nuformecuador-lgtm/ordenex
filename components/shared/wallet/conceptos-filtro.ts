// Ficha 458-A (TA.3, design §3.5, R13–R15) — las opciones del filtro de CONCEPTO de la wallet.
// Modulo PURO (sin React): lo comparten los tres filtros (`/wallet`, el desglose de una tienda en
// `/wallet/tiendas` y `/mi-wallet`), cada uno con el diccionario de SU superficie.
//
// Hasta la 458 los tres se poblaban del catalogo COMPLETO (el SEED del enum): ofrecian conceptos que
// no tenian ni un movimiento —«Otro gasto de Ordenex» (`egreso_gasto`), que nadie produce— y no
// decian cuantos habia de cada uno. Ahora la lista es la que devuelve el servidor
// (`conceptosConMovimientosAction`): solo los conceptos con movimientos en el periodo y la cuenta que
// se miran, cada uno con su numero (R13/R14). El elegido se CONSERVA aunque se quede en 0 (R15).

import type { SelectOption } from "@/components/ui/select";
import type { ConceptoConMovimientosDTO } from "@/lib/types/wallet-filtros";

/** «Sueldo (3)»: el rotulo del diccionario de la superficie y cuantos movimientos tiene. */
export function rotuloConCuenta(rotulo: string, movimientos: number): string {
  return `${rotulo} (${movimientos})`;
}

/**
 * Las opciones del `Select` de concepto: la de «todos» al frente, luego los conceptos con
 * movimientos EN EL ORDEN DEL SERVIDOR (el del catalogo) y, si el elegido ya no esta, el elegido
 * con 0 al final (R15), para que el filtro no mienta sobre lo que esta aplicado.
 *
 * Un concepto que el diccionario de la superficie no nombra no se ofrece: el diccionario es un
 * `Record` total sobre su catalogo, asi que no pasa, y si pasara no se pintaria un valor tecnico.
 */
export function opcionesDeConceptos(
  conceptos: readonly ConceptoConMovimientosDTO[] | undefined,
  rotulos: Readonly<Record<string, string>>,
  elegido: string,
  todos: SelectOption,
): SelectOption[] {
  const opciones: SelectOption[] = [todos];
  for (const c of conceptos ?? []) {
    const rotulo = rotulos[c.categoria];
    if (rotulo !== undefined) opciones.push({ value: c.categoria, label: rotuloConCuenta(rotulo, c.movimientos) });
  }
  const rotuloElegido = elegido === "" ? undefined : rotulos[elegido];
  if (rotuloElegido !== undefined && !opciones.some((o) => o.value === elegido)) {
    opciones.push({ value: elegido, label: rotuloConCuenta(rotuloElegido, 0) });
  }
  return opciones;
}

/** Los avisos del filtro de concepto, iguales en las tres superficies. */
export const CONCEPTOS_FILTRO_AVISO = {
  error: "No pudimos cargar los conceptos del periodo.",
  vacio: "No hay movimientos en este periodo.",
} as const;
