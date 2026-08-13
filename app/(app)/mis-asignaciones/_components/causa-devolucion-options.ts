import { CAUSA_DEVOLUCION_SEED, type CausaDevolucion } from "@/lib/types/causa-devolucion";

// Feature 73 (R3): etiquetas legibles de la causa de devolucion. La fuente de verdad de
// los valores es CAUSA_DEVOLUCION_SEED (enum Postgres nativo); aqui solo se presenta cada
// valor. Anadir o quitar una causa del enum rompe el build por el Record exhaustivo (no
// silencioso). El patron para un campo enum con un solo consumidor: el SEED vive en
// `lib/types/` y las etiquetas junto a la pagina que las usa, sin promoverlas a un modulo
// compartido mientras no haya un segundo consumidor (docs/architecture.md, "sin
// sobre-ingenieria").
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
