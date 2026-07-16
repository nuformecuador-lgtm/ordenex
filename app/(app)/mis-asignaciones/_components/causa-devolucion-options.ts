import { CAUSA_DEVOLUCION_SEED, type CausaDevolucion } from "@/lib/types/causa-devolucion";

// Feature 73 (R3): etiquetas legibles de la causa de devolucion. La fuente de verdad de
// los valores es CAUSA_DEVOLUCION_SEED (enum Postgres nativo); aqui solo se presenta cada
// valor. Anadir o quitar una causa del enum rompe el build por el Record exhaustivo (no
// silencioso). Espejo del hermano `metodo-pago-options.ts` de esta misma carpeta, que hace
// justo esto para el otro campo enum del mismo panel: SEED en `lib/types/`, labels junto a
// la pagina que los usa (un solo consumidor, docs/architecture.md "sin sobre-ingenieria").
// Las cadenas son las del pedido literal del humano (2026-07-15): ningun componente debe
// duplicarlas ni mostrar el slug crudo del enum.
export const CAUSA_DEVOLUCION_LABEL: Record<CausaDevolucion, string> = {
  not_found: "Cliente no localizado",
  wrong_number: "Número de celular errado",
  wrong_address: "Dirección errada",
};

/** Opcion del selector de causa (radios, F1.4-f). */
export interface CausaDevolucionOption {
  value: CausaDevolucion;
  label: string;
}

/** Opciones del selector de causa de la rama `devuelta`, derivadas del SEED (nunca de una
 * lista literal paralela). */
export const CAUSA_DEVOLUCION_OPTIONS: readonly CausaDevolucionOption[] = CAUSA_DEVOLUCION_SEED.map(
  (value) => ({ value, label: CAUSA_DEVOLUCION_LABEL[value] }),
);
