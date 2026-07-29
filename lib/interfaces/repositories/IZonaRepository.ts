import type { ArbolZonas, ZonaDTO } from "@/lib/types/zona";
import type { OpcionCatalogo } from "@/lib/types/filtros-ordenes";

// Datos listos para persistir una fila de tarifa_zona_mensajero (numbers; el repo
// convierte a Prisma.Decimal). vehiculoId ya normalizado a string | null.
export interface TarifaZonaMensajeroData {
  cobroEntregado: number;
  cobroRechazado: number;
  vehiculoId: string | null;
}

// Crear/actualizar comparten forma: reemplazo completo de datos + N:M + tarifas.
export interface CreateZonaData {
  nombre: string;
  cobroVehiculo: boolean;
  esCentral: boolean; // feature 54: flag de zona central (antes esGam)
  distritoIds: string[];
  tarifas: TarifaZonaMensajeroData[];
}
export type UpdateZonaData = CreateZonaData;

export interface ListZonasParams {
  skip: number;
  take: number;
  includeTarifas: boolean;
}

export interface ListZonasResult {
  items: ZonaDTO[];
  total: number;
}

// Resultado del borrado fisico: `referenced` = la zona esta referenciada por
// provincia/orden/tarifas (FK RESTRICT), no se puede borrar.
export type DeleteZonaResult = "ok" | "not_found" | "referenced";

export interface IZonaRepository {
  /** Crea la zona + su N:M de distritos + sus tarifas, en una transaccion. */
  create(data: CreateZonaData): Promise<ZonaDTO>;
  /** null si no existe. Carga tarifas solo si includeTarifas. */
  findById(id: string, includeTarifas: boolean): Promise<ZonaDTO | null>;
  /** Listado paginado (orden por nombre asc). include tarifas opcional. */
  list(params: ListZonasParams): Promise<ListZonasResult>;
  /**
   * Feature 144/B2 (R48/R49): TODAS las zonas proyectadas a `{id, nombre}`, por nombre
   * asc. Metodo propio y no `list()`: aquel pagina y arrastra tarifas + conteo de
   * distritos, y `ZonaService.listar` ademas es `maestro`-only. El catalogo de filtros
   * lo consumen tambien `admin` y `adminTienda`, y no necesita nada de eso.
   */
  listLite(): Promise<OpcionCatalogo[]>;
  /** Reemplaza datos + N:M + tarifas; null si la zona no existe. */
  update(id: string, data: UpdateZonaData): Promise<ZonaDTO | null>;
  /** Borrado FISICO (cascade de zona_distrito y tarifas). */
  hardDelete(id: string): Promise<DeleteZonaResult>;
  /** Arbol zona -> canton -> distrito indexado por nombre normalizado. */
  arbol(): Promise<ArbolZonas>;
  /** Cuenta cuantos de `ids` existen como distrito (validacion de existencia). */
  countExistingDistritos(ids: string[]): Promise<number>;
  /** Cuenta cuantos de `ids` existen como vehiculo (validacion de existencia). */
  countExistingVehiculos(ids: string[]): Promise<number>;
  /**
   * feature 54: id de la zona con `esCentral = true`, o null si ninguna la tiene.
   * (antes findGamZonaId). El indice unico parcial garantiza a lo sumo una.
   */
  findCentralZonaId(): Promise<string | null>;
}
