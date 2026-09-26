import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { AutoriaLibroCajaInput, AutoriaLibroCajaResult } from "@/lib/types/libro-caja-autoria";

/**
 * FICHA 458-B (design §3.4, R56/R57) — contrato del servicio que resuelve «A quien» y «Registro» de
 * las filas del libro de la caja, EN LOTE. Resultados de DOMINIO: la sesion y la forma son del borde.
 */
export type AutoriaLibroCajaServiceResult = Exclude<
  AutoriaLibroCajaResult,
  { status: "unauthenticated" } | { status: "validation_error" }
>;

export interface ILibroCajaAutoriaService {
  /** R82 — rol (acceso total) ANTES de leer; ids que no son del libro de la caja no vuelven. */
  resolver(input: AutoriaLibroCajaInput, actor: Actor): Promise<AutoriaLibroCajaServiceResult>;
}
