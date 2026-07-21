import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";
import type { PeriodicidadUnidad } from "@/lib/utils/periodicidad";

// Feature 45 (design §2.1b) — contrato del repositorio de PLANTILLAS de gasto fijo
// (configuracion recurrente mutable). Solo queries Prisma; sin logica de negocio. Money-safe:
// el `monto` entra como STRING y sale como STRING (toFixed(2)) en el DTO. NO expone `delete`
// (R25): la desactivacion (setActiva) es el mecanismo para dejar de generar.

// Feature 84 — periodicidad del ciclo, comun a crear/actualizar. `fechaCobro` es el ancla
// (primer cobro) como `YYYY-MM-DD`; la impl la convierte a la columna DATE.
export interface PeriodicidadInput {
  periodicidadUnidad: PeriodicidadUnidad;
  periodicidadCantidad: number; // >= 1 (CHECK en la DB)
  fechaCobro: string; // `YYYY-MM-DD`
}

export interface CrearPlantillaInput extends PeriodicidadInput {
  concepto: string;
  monto: string; // STRING > 0 -> Prisma.Decimal en la impl
}

export interface ActualizarPlantillaInput extends PeriodicidadInput {
  concepto: string;
  monto: string; // STRING > 0
}

export interface IGastoFijoPlantillaRepository {
  /** R24: crea la plantilla (activa=true por default). Devuelve el DTO con monto STRING. */
  crear(input: CrearPlantillaInput): Promise<GastoFijoPlantillaDTO>;
  /** R25: edita concepto/monto de una plantilla existente. Devuelve el DTO actualizado. */
  actualizar(id: string, input: ActualizarPlantillaInput): Promise<GastoFijoPlantillaDTO>;
  /** R25: activa/desactiva una plantilla (sin borrado). Devuelve el DTO actualizado. */
  setActiva(id: string, activa: boolean): Promise<GastoFijoPlantillaDTO>;
  /** R26: lista TODAS las plantillas (activas e inactivas), mas recientes primero. */
  listar(): Promise<GastoFijoPlantillaDTO[]>;
  /** R27: lista solo las plantillas ACTIVAS (consumo del cron). */
  listarActivas(): Promise<GastoFijoPlantillaDTO[]>;
  /** Lee una plantilla por id; null si no existe. */
  obtenerPorId(id: string): Promise<GastoFijoPlantillaDTO | null>;
}
