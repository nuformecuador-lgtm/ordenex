import type { IGeoRepository } from "@/lib/interfaces/repositories/IGeoRepository";
import type { IUserRepository } from "@/lib/interfaces/repositories/IUserRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IFiltrosOrdenesService } from "@/lib/interfaces/services/IFiltrosOrdenesService";
import type { ObtenerCatalogoFiltrosOrdenesResult } from "@/lib/types/filtros-ordenes";

/**
 * Feature 144/B2 (design §3.3/§3.4) — catalogo precargado de los filtros de `/ordenes`.
 *
 * Se inyectan los repositorios ACOTADOS a los metodos que se usan (`Pick`), no las
 * interfaces enteras: el service no puede escribir nada aunque quiera, y el doble de
 * test no tiene que implementar treinta metodos ajenos.
 */
type ZonaRepo = Pick<IZonaRepository, "listLite">;
type UserRepo = Pick<IUserRepository, "listCuentasTienda">;
type GeoRepo = Pick<
  IGeoRepository,
  | "listProvinciasLite"
  | "listCantonesLite"
  | "listDistritosLite"
  | "listGeografiaLitePorZona"
>;

/**
 * R53 — roles a los que este catalogo responde algo. Sigue siendo una WHITELIST: un rol
 * nuevo no hereda acceso.
 *
 * Ya NO es «quien opera `/ordenes`»: este catalogo alimenta ademas la barra de la
 * analitica (`FiltrosEntregas`), a la que entran tambien el `adminSatelite`. Se le abre la
 * puerta, pero ACOTADO — ver `obtenerCatalogo`: recibe la geografia de SU zona y nada mas.
 * Entrar a `/ordenes` sigue siendo otra decision, y sigue negada en su `page.tsx`.
 */
const ROLES_CON_CATALOGO = new Set<string>([
  "maestro",
  "admin",
  "adminTienda",
  "adminSatelite",
]);

/**
 * Rol acotado a SU tienda. No recibe la lista de cuentas tienda: filtrar por tienda no le
 * añade nada (todas sus ordenes son suyas) y la lista es el directorio de sus competidores.
 * El control tampoco se le declara en las barras; esto es la defensa del dato.
 */
const ROL_ACOTADO_A_SU_TIENDA = "adminTienda";

/**
 * Rol acotado a SU zona. No recibe zonas —la suya esta fijada, y un selector con un unico
 * valor legal no informa— ni cuentas tienda, y su cadena geografica se lee de la N:M de su
 * zona en vez del pais entero.
 */
const ROL_ACOTADO_A_SU_ZONA = "adminSatelite";

export class FiltrosOrdenesService implements IFiltrosOrdenesService {
  constructor(
    private readonly zonaRepo: ZonaRepo,
    private readonly userRepo: UserRepo,
    private readonly geoRepo: GeoRepo,
  ) {}

  async obtenerCatalogo(actor: Actor | null): Promise<ObtenerCatalogoFiltrosOrdenesResult> {
    // Autorizacion ANTES de tocar datos: ninguna de las cinco lecturas se dispara si el
    // actor no pasa la puerta (R52/R53, "no devuelve datos" en sentido literal).
    if (!actor) return { status: "unauthenticated" }; // R52
    if (!ROLES_CON_CATALOGO.has(actor.rol)) return { status: "forbidden" }; // R53

    if (actor.rol === ROL_ACOTADO_A_SU_ZONA) return this.catalogoDeZona(actor);

    // El acotado a su tienda no pide el directorio de cuentas: la lectura NO se dispara y
    // la lista viaja vacia. «No se le ofrece el control» y «no se le entrega el dato» son
    // dos cosas distintas, y esta es la segunda.
    const conTiendas = actor.rol !== ROL_ACOTADO_A_SU_TIENDA;

    // R47: las lecturas en PARALELO. Secuenciarlas sumaria cinco latencias al TTFB de
    // `/ordenes` sin ganar nada: son independientes entre si.
    const [zonas, tiendas, provincias, cantones, distritos] = await Promise.all([
      this.zonaRepo.listLite(),
      conTiendas ? this.userRepo.listCuentasTienda() : Promise.resolve([]),
      this.geoRepo.listProvinciasLite(),
      this.geoRepo.listCantonesLite(),
      this.geoRepo.listDistritosLite(),
    ]);

    return {
      status: "ok",
      catalogo: { zonas, tiendas, provincias, cantones, distritos },
    };
  }

  /**
   * El catalogo del rol acotado a su zona: sin zonas, sin cuentas tienda y con la cadena
   * geografica de SU zona.
   *
   * La zona sale del ACTOR (`usuario.zona_id`, que `resolveActorFromSession` puebla
   * siempre), nunca de la peticion. Sin zona asignada no hay alcance sobre nada: el
   * catalogo va vacio y la barra se monta con los controles sin opciones, que es el mismo
   * trato que R64 le da a un catalogo caido — pantalla viva, filtros sin nada que ofrecer.
   */
  private async catalogoDeZona(
    actor: Actor,
  ): Promise<ObtenerCatalogoFiltrosOrdenesResult> {
    const zonaId = actor.zonaId ?? null;
    const geografia =
      zonaId === null
        ? { provincias: [], cantones: [], distritos: [] }
        : await this.geoRepo.listGeografiaLitePorZona(zonaId);

    return { status: "ok", catalogo: { zonas: [], tiendas: [], ...geografia } };
  }
}
