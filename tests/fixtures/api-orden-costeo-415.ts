import type {
  ApiOrdenCongeladoRow,
  ApiOrdenCosteoRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { ApiZonaDTO } from "@/lib/types/api-orden";
import type { TarifaVigenteResuelta } from "@/lib/interfaces/repositories/ITarifaVigenteRepository";

/**
 * ⏳ 2026-09-10 — FEATURE 415: los dos campos que `ApiOrdenRow` gano (`zona` publicable y `costeo`
 * NO publicable), para las ~15 fixtures de test que construyen una fila del canal a mano.
 *
 * Vive en `tests/fixtures/` y no copiado en cada archivo por la razon de siempre: quince copias de
 * la misma fila por defecto son quince sitios que se quedan atras cuando la fila crece.
 *
 * ⚠️ ESTO ES UN DEFECTO NEUTRO, NO UN ESCENARIO. Los tests que afirman IMPORTES no lo usan tal
 * cual: construyen su tarifa y sus entradas a mano, con la aritmetica anotada al lado. Un defecto
 * que produjera importes «bonitos» invitaria a compararlos contra su propia fuente, que es la
 * trampa que esta ficha tiene prohibida.
 */

/** La zona por defecto del canal en los tests. `orden.zona_id` es NOT NULL: nunca es `null`. */
export const ZONA_FIXTURE: ApiZonaDTO = {
  id: "018f2c31-0000-4000-8000-00000000za01",
  nombre: "GAM",
};

/**
 * Tarifa VIGENTE de laboratorio. Los porcentajes y montos son REDONDOS a proposito, para que la
 * aritmetica de cada test se pueda escribir a mano en una linea:
 *   flete GAM 2500.00 · IVA flete 13 % · comision COD 3.50 % · IVA comision 13 % · fulfillment 696.00
 */
export const TARIFA_FIXTURE: TarifaVigenteResuelta = {
  tarifaId: "tarifa-1",
  valorFlete: "3000.00",
  valorFleteGam: "2500.00",
  valorFleteDevuelto: "1500.00",
  valorFleteDevueltoGam: "1200.00",
  comisionCod: "3.50",
  ivaFlete: "13.00",
  ivaComisionCod: "13.00",
  tarifaEspecial: null,
  tarifaEspecialDevuelta: null,
  fulfillment: "696.00",
};

/** Las entradas VIVAS por defecto: zona central, sin pacto especial, sin COD y sin comision. */
export function costeoFixture(overrides: Partial<ApiOrdenCosteoRow> = {}): ApiOrdenCosteoRow {
  return {
    zonaId: ZONA_FIXTURE.id,
    esCentral: true,
    esZonaEspecial: false,
    montoCobrar: null,
    cobraComision: false,
    congelado: null,
    ...overrides,
  };
}

/**
 * Lo que el `select` de `apiOrdenSelect(ownerId)` anade a la fila CRUDA que Prisma devuelve, para
 * los tests que mockean Prisma en vez del repositorio.
 *
 * Por defecto: zona GAM central, SIN distrito registrado (el unico FK nullable de `orden`) y SIN
 * ninguna fila congelada elegible —el 28 % medido de las ordenes vivas—. Los tests que miden el
 * costo congelado sobrescriben `cierreDetalles`.
 */
export const FILA_PRISMA_415 = {
  zonaId: ZONA_FIXTURE.id,
  cobraComision: false,
  zona: { id: ZONA_FIXTURE.id, nombre: ZONA_FIXTURE.nombre, esCentral: true },
  distrito: null,
  cierreDetalles: [] as unknown[],
};

/** Una fila congelada de laboratorio: sin tarifa congelada salvo que el test diga otra cosa. */
export function congeladoFixture(
  overrides: Partial<ApiOrdenCongeladoRow> = {},
): ApiOrdenCongeladoRow {
  return {
    tarifa: null,
    fulfillment: "0.00",
    esCentral: true,
    esZonaEspecial: false,
    montoCobrar: null,
    cobraComision: false,
    ...overrides,
  };
}
