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
  "listProvinciasLite" | "listCantonesLite" | "listDistritosLite"
>;

/**
 * R53 — roles que OPERAN el listado de `/ordenes` y, por tanto, su barra de filtros.
 * Mismo conjunto que el `ROLES_CON_FILTRO_ESTADO` de la page (feature 63): `mensajero`
 * y `adminSatelite` no llegan a `/ordenes` (tienen sus propias superficies) y cualquier
 * otro rol tampoco. La lista es una WHITELIST: un rol nuevo no hereda acceso.
 */
const ROLES_CON_CATALOGO = new Set<string>(["maestro", "admin", "adminTienda"]);

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

    // R47: las CINCO lecturas en PARALELO. Secuenciarlas sumaria cinco latencias al
    // TTFB de `/ordenes` sin ganar nada: son independientes entre si.
    const [zonas, tiendas, provincias, cantones, distritos] = await Promise.all([
      this.zonaRepo.listLite(),
      this.userRepo.listCuentasTienda(),
      this.geoRepo.listProvinciasLite(),
      this.geoRepo.listCantonesLite(),
      this.geoRepo.listDistritosLite(),
    ]);

    return {
      status: "ok",
      catalogo: { zonas, tiendas, provincias, cantones, distritos },
    };
  }
}
