import type {
  CantonLightDTO,
  DistritoCatalogoDTO,
  ProvinciaLightDTO,
} from "@/lib/types/zona";
import type { Actor } from "@/lib/interfaces/services/IZonaService";

// Feature 55/R10. Servicio de lectura del catalogo geografico global (provincia ->
// canton -> distrito) para componer una zona. La lectura es EXCLUSIVA del rol
// maestro (patron ZonaService); reutiliza el Actor de IZonaService.
export type { Actor };

export type ListarProvinciasServiceResult =
  | { status: "ok"; items: ProvinciaLightDTO[] }
  | { status: "forbidden" };

export type ListarCantonesServiceResult =
  | { status: "ok"; items: CantonLightDTO[] }
  | { status: "forbidden" };

export type ListarDistritosServiceResult =
  | { status: "ok"; items: DistritoCatalogoDTO[] }
  | { status: "forbidden" };

export interface IGeoService {
  /** Provincias del catalogo global (solo maestro). */
  listarProvincias(actor: Actor): Promise<ListarProvinciasServiceResult>;
  /** Cantones de una provincia (solo maestro). */
  listarCantones(provinciaId: string, actor: Actor): Promise<ListarCantonesServiceResult>;
  /** Distritos de un canton, con su zona asignada si la hay (solo maestro). */
  listarDistritos(cantonId: string, actor: Actor): Promise<ListarDistritosServiceResult>;
}
