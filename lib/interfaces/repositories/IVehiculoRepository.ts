import type { VehiculoDTO } from "@/lib/types/vehiculos";

// Contrato de acceso a datos del catalogo vehiculos. Solo lectura (P1=A): el
// catalogo es sembrado + solo-lectura, sin create/update/delete. Solo queries
// Prisma, sin logica de negocio (esa vive en VehiculoService).
export interface IVehiculoRepository {
  /** Todas las filas del catalogo, ordenadas por name (3: moto/carro/camion). */
  findMany(): Promise<VehiculoDTO[]>;
  // BORRADO 2026-08-07 (tanda 2): `findById`, sin llamador desde que se retiro
  // `VehiculoService.obtener`. El catalogo son tres filas y se lee entero.
}
