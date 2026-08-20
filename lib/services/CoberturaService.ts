import type {
  DistritoCoberturaRow,
  ICoberturaDistritoRepository,
} from "@/lib/interfaces/repositories/ICoberturaDistritoRepository";
import type { ICoberturaService } from "@/lib/interfaces/services/ICoberturaService";
import type { ConsultaCobertura, ResultadoCobertura } from "@/lib/types/cotizador";
import { indexBy, normalize, resolveGeo, zonaDeDistrito } from "@/lib/utils/resolucion-geografica";

// Feature 248 (design §1/§3 D2/D12, R2/R3/R4/R5) — resolucion de COBERTURA por distrito.
//
// ⛔ ESTE MODULO NO CONOCE EL DINERO, Y ESA ES LA FEATURE. No importa `ingreso-ordenex`, no
// importa `TarifaVigentePorTiendaRepository` y su repositorio no proyecta tarifas: la superficie
// publica no puede devolver ni derivar un importe porque su grafo de dependencias NO LLEGA
// hasta el (R10). Una guardia estatica lo mide; el comentario solo explica por que.
//
// Toda la logica se prueba con dobles: sin Prisma, sin `next/headers`, sin HTTP.

/**
 * D12/R35 — MARCA no nula con la que se apaga UNA rama de `resolveGeo`, y merece explicacion.
 *
 * `resolveGeo` es del camino que CREA ordenes, donde `orden.zona_id` es NOT NULL: por eso, tras
 * resolver el distrito, rechaza el que no tenga zona con un error de fila. Ese rechazo COLAPSA
 * "0 zonas" y ">1 zona" en el mismo mensaje, que es justo lo que el cotizador tiene que
 * distinguir (R3 vs R4).
 *
 * La solucion NO es duplicar el matching por nombre —eso es lo que R35 prohibe—, sino repartir
 * las dos preguntas entre los dos simbolos del util compartido que ya las contestan:
 *
 *   · `resolveGeo`      -> ¿a que distrito apunta este trio? (y sus `fieldErrors`, R5)
 *   · `zonaDeDistrito`  -> ¿que zona lo cubre? (los tres estados, R2/R3/R4)
 *
 * Para preguntar solo la primera se le pasa el catalogo con la zona marcada como presente. El
 * valor NO SE USA JAMAS: el resultado `geo.zonaId` se descarta y la zona real se resuelve
 * despues sobre las filas crudas de `zona_distrito`.
 */
const ZONA_NO_CONSULTADA_AQUI = "resuelta-por-zonaDeDistrito";

/** El primer mensaje de cada campo, que es lo que el formulario publico pinta bajo el input. */
function primerMensajePorCampo(fieldErrors: Record<string, string[]>): Record<string, string> {
  const campos: Record<string, string> = {};
  for (const [campo, errores] of Object.entries(fieldErrors)) {
    const primero = errores[0];
    if (primero !== undefined) campos[campo] = primero;
  }
  return campos;
}

export class CoberturaService implements ICoberturaService {
  constructor(private readonly repo: ICoberturaDistritoRepository) {}

  async consultar(entrada: ConsultaCobertura): Promise<ResultadoCobertura> {
    const distritos = await this.cargarCatalogo();
    const geo = resolveGeo(
      entrada,
      distritos.provinciaIndex,
      distritos.cantonIndex,
      distritos.distritoIndex,
    );

    // R5 — trio no resoluble: error de validacion POR CAMPO. No se ha tocado `tarifas` (no hay
    // forma de tocarla desde aqui) ni se ha leido una sola zona.
    if (!geo.ok) return { estado: "validation_error", campos: primerMensajePorCampo(geo.fieldErrors) };

    const distritoId = geo.geo.distritoId;
    const fila = distritoId === null ? undefined : distritos.porId.get(distritoId);
    if (fila === undefined) {
      // Inalcanzable con el catalogo que acabamos de indexar; se contempla para no depender de
      // que `distritoId` sea no nulo por invariante ajena.
      return { estado: "validation_error", campos: { distrito: "distrito no encontrado en el canton" } };
    }

    // R2/R3/R4 — LA regla del distrito multi-zona, en el unico sitio donde vive (R35). Aqui solo
    // se ramifica por sus tres estados.
    const zona = zonaDeDistrito(fila.zonas);
    switch (zona.estado) {
      case "unica":
        return {
          estado: "cubierto",
          distritoId: fila.id,
          zonaId: zona.zonaId,
          zonaNombre: zona.zonaNombre,
          esCentral: zona.esCentral,
        };
      case "ninguna":
        // R3 — no hay cobertura y NO se nombra ninguna zona (no hay ninguna que nombrar).
        return { estado: "sin_cobertura" };
      case "ambigua":
        // R4/D2 — ni cubierto ni no cubierto. No se elige la primera, ni la mas antigua, ni se
        // devuelven las N: prometer un flete que la carga de esa misma orden rechazaria por
        // ambigua es peor que decir "no determinado".
        return { estado: "no_determinado", cuantas: zona.cuantas };
    }
  }

  /**
   * Los tres indices que consume `resolveGeo`, con las MISMAS claves normalizadas que usa la
   * carga (`BulkOrdenService:515-523`). El catalogo geografico del pais es pequeño y estatico
   * dentro de una consulta, asi que se carga entero en tres queries, igual que la carga masiva.
   */
  private async cargarCatalogo() {
    const provincias = await this.repo.listarProvincias();
    const cantones = await this.repo.listarCantonesPorProvincias(provincias.map((p) => p.id));
    const filas = await this.repo.listarDistritosPorCantones(cantones.map((c) => c.id));

    const porId = new Map<string, DistritoCoberturaRow>(filas.map((d) => [d.id, d]));
    // La marca no nula solo viaja hacia `resolveGeo`; `zonas` no entra en el indice.
    const paraResolver = filas.map((d) => ({
      id: d.id,
      nombre: d.nombre,
      cantonId: d.cantonId,
      zonaId: ZONA_NO_CONSULTADA_AQUI,
      esCentral: false,
    }));

    return {
      porId,
      provinciaIndex: indexBy([...provincias], (p) => normalize(p.nombre)),
      cantonIndex: indexBy([...cantones], (c) => `${c.provinciaId}::${normalize(c.nombre)}`),
      distritoIndex: indexBy(paraResolver, (d) => `${d.cantonId}::${normalize(d.nombre)}`),
    };
  }
}
