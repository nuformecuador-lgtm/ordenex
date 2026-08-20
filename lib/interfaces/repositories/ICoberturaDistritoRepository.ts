import type { ArbolGeograficoPublico } from "@/lib/types/cotizador";

// Feature 248 (design §4.3) — contrato de LECTURA del catalogo geografico del cotizador.
//
// ⛔ REPOSITORIO PROPIO Y NO UN METODO MAS EN `IOrdenRepository`, Y ES EL REQUISITO (R10):
// la proyeccion de listado de `OrdenRepository` trae `tarifasTienda`
// (`OrdenRepository.ts:354-357`), asi que reutilizarlo metaria el resolver de tarifas en el
// grafo de imports de la superficie publica y esta permitiria derivar un importe por
// diferencia. Aqui el camino al dinero NO EXISTE: ninguna fila de este contrato nombra una
// tarifa, un monto ni un porcentaje.
//
// Catalogo DELGADO: provincias, cantones, distritos y las ZONAS CRUDAS del distrito. La regla
// de "que zona cubre este distrito" NO vive aqui (un repositorio no decide negocio): vive una
// sola vez en `lib/utils/resolucion-geografica.ts` (`zonaDeDistrito`, R35) y la aplica el
// service sobre estas filas crudas.

/** Fila de provincia. Asignable a `ProvinciaLike` del util compartido. */
export interface ProvinciaCoberturaRow {
  readonly id: string;
  readonly nombre: string;
}

/** Fila de canton. Asignable a `CantonLike` del util compartido. */
export interface CantonCoberturaRow {
  readonly id: string;
  readonly nombre: string;
  readonly provinciaId: string;
}

/**
 * Una fila de la N:M `zona_distrito`, CRUDA. Es exactamente la forma que consume
 * `zonaDeDistrito`: **no existe `distrito.zona_id`** (la columna escalar se elimino en
 * 20260713000000), asi que un distrito puede tener 0, 1 o varias.
 */
export interface ZonaCrudaRow {
  readonly zonaId: string;
  readonly nombre: string;
  readonly esCentral: boolean;
}

/**
 * Distrito con sus zonas crudas SIN colapsar. El colapso a "unica / ninguna / ambigua" es del
 * util compartido; que aqui viajen todas es lo que permite distinguir R3 (0 zonas) de R4 (>1).
 */
export interface DistritoCoberturaRow {
  readonly id: string;
  readonly nombre: string;
  readonly cantonId: string;
  readonly zonas: readonly ZonaCrudaRow[];
}

export interface ICoberturaDistritoRepository {
  /** Todas las provincias (catalogo pequeño). El match por nombre lo hace el util, no la query. */
  listarProvincias(): Promise<readonly ProvinciaCoberturaRow[]>;

  /** Cantones de las provincias dadas. Lista vacia -> `[]`, sin consultar. */
  listarCantonesPorProvincias(
    provinciaIds: readonly string[],
  ): Promise<readonly CantonCoberturaRow[]>;

  /** Distritos de los cantones dados, con sus zonas crudas. Lista vacia -> `[]`, sin consultar. */
  listarDistritosPorCantones(
    cantonIds: readonly string[],
  ): Promise<readonly DistritoCoberturaRow[]>;

  /**
   * D13/R9 — el arbol provincia → canton → distrito **sin zonas**, ordenado alfabeticamente en
   * los tres niveles, para que el Server Component publico lo pase por props a la cascada.
   * La ausencia de `zona`/`esCentral` en esta proyeccion es R7.
   */
  listarArbolGeograficoPublico(): Promise<ArbolGeograficoPublico>;
}
