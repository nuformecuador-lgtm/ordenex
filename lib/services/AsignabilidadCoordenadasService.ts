// Feature 92 (design §7, R1-R7) — gate de asignabilidad por coordenadas. Sin este gate,
// una orden sin coordenadas entra a la ruta de un mensajero y queda invisible para el
// optimizador para siempre.
//
// ═══ EL ORDEN DEL ARBOL DE DECISION ES NORMATIVO. NO REORDENAR. ═══
//
//   R2  coordenadas presentes                  -> asignable                  (sin tocar `jobs`)
//   R3  geocode_status DETERMINISTA            -> direccion_no_geocodificable(sin tocar `jobs`)
//   R4  clave EXACTA reconstruida -> una consulta por lote
//   R5    job.estado === 'failed'              -> geocodificacion_agotada
//   R6    job.estado pending|processing        -> geocodificacion_en_curso
//   R7  sin job (o `done` sin resultado)       -> encolar puntual
//
// ── POR QUE R3 VA ANTES QUE LA COLA (design §0.1, verificado en `GeocodificacionService`)
// `GeocodificacionService` COMPLETA el job (lo deja en `done`, NO en `failed`) en los tres
// desenlaces deterministas: `sin_resultados` (ZERO_RESULTS, :141-152), `consulta_invalida`
// (INVALID_REQUEST, :153-163) y `SIN_DIRECCION` (:88-97). Es decir: el caso MAS FRECUENTE
// de "la direccion no se pudo geocodificar" NUNCA aparece en `jobs` como job agotado.
// Un gate que solo mirara la cola lo veria como "no hay job", volveria a encolar, el job
// volveria a terminar `done` sin coordenadas, y asi en bucle — PAGANDO una llamada al
// proveedor cada vez. La fuente de verdad de "direccion no encontrada" es la ORDEN.
//
// ── POR QUE "INTENTOS AGOTADOS" ⇔ `estado === 'failed'` Y NADA MAS (design §0.3)
// La tentacion es `intentos >= maxIntentos`. Es INCORRECTO: `JobRepository.claimBatch`
// (:116) incrementa `intentos` AL RECLAMAR, antes de ejecutar el handler, y
// `JobQueueService.manejarFallo` (:97-101) decide el dead-letter comparando
// `intentos >= maxIntentos` EN EL MOMENTO DEL FALLO. Por tanto una fila `processing` con
// `intentos === maxIntentos` esta corriendo su ULTIMO intento y todavia puede terminar en
// `done` con coordenadas. Usar ese predicado bloquearia ordenes que estan a punto de
// resolverse. El unico predicado correcto y estable es `estado = 'failed'`.
import type { IJobRepository } from "@/lib/interfaces/repositories/IJobRepository";
import type {
  EstadoAsignabilidad,
  IAsignabilidadCoordenadasService,
  OrdenAsignabilidadRow,
} from "@/lib/interfaces/services/IAsignabilidadCoordenadasService";
import { hashDireccion } from "@/lib/geo/direccion-query";
import {
  dedupeKeyGeocodificacion,
  encolarGeocodificacion,
} from "@/lib/services/jobs/geocodificacion-encolado";

/**
 * R3 — desenlaces DETERMINISTAS de la geocodificacion: reintentarlos no los mejora. Los
 * tres valores son exactamente los que `GeocodificacionService` persiste en la orden
 * cuando COMPLETA el job sin coordenadas.
 */
const STATUS_DETERMINISTAS = new Set(["ZERO_RESULTS", "INVALID_REQUEST", "SIN_DIRECCION"]);

export class AsignabilidadCoordenadasService implements IAsignabilidadCoordenadasService {
  constructor(private readonly jobs: IJobRepository) {}

  async evaluar(
    ordenes: OrdenAsignabilidadRow[],
  ): Promise<Map<string, EstadoAsignabilidad>> {
    const resultado = new Map<string, EstadoAsignabilidad>();
    if (ordenes.length === 0) return resultado;

    // ── Pasos R2 y R3: se resuelven SIN tocar la cola. ─────────────────────────────
    const pendientesDeCola: OrdenAsignabilidadRow[] = [];
    for (const orden of ordenes) {
      if (orden.latitud !== null && orden.longitud !== null) {
        resultado.set(orden.id, "asignable"); // R2
        continue;
      }
      if (orden.geocodeStatus !== null && STATUS_DETERMINISTAS.has(orden.geocodeStatus)) {
        resultado.set(orden.id, "direccion_no_geocodificable"); // R3
        continue;
      }
      pendientesDeCola.push(orden);
    }
    if (pendientesDeCola.length === 0) return resultado;

    // ── Paso R4: clave EXACTA reconstruida + UNA consulta para todo el lote. ───────
    // La clave se calcula igual que en el writer (`encolarGeocodificacion`): sobre la
    // direccion LIBRE cruda, no sobre la consulta completa con catalogo. Si divergiera,
    // el gate buscaria una clave que nadie escribio y re-encolaria siempre.
    const keyPorOrden = new Map<string, string>();
    for (const orden of pendientesDeCola) {
      keyPorOrden.set(
        orden.id,
        dedupeKeyGeocodificacion(orden.id, hashDireccion(orden.direccion ?? "")),
      );
    }
    const jobs = await this.jobs.findByDedupeKeys([...keyPorOrden.values()]);
    const jobPorKey = new Map(
      jobs
        .filter((j): j is typeof j & { dedupeKey: string } => j.dedupeKey !== null)
        .map((j) => [j.dedupeKey, j]),
    );

    for (const orden of pendientesDeCola) {
      const key = keyPorOrden.get(orden.id) as string;
      const job = jobPorKey.get(key);

      // R5: el UNICO predicado de "intentos agotados" (ver cabecera).
      if (job !== undefined && job.estado === "failed") {
        resultado.set(orden.id, "geocodificacion_agotada");
        continue;
      }
      // R6: todavia se esta resolviendo. Asignar ahora dejaria la orden fuera de la ruta.
      if (job !== undefined && (job.estado === "pending" || job.estado === "processing")) {
        resultado.set(orden.id, "geocodificacion_en_curso");
        continue;
      }

      // R7: no hay job para la direccion VIGENTE (nunca se intento, o la direccion se
      // corrigio y el job viejo responde por otra), o quedo `done` sin coordenadas y sin
      // status determinista. Se encola una geocodificacion puntual.
      //
      // OJO: este encolado corre FUERA de cualquier transaccion de asignacion. Es
      // deliberado (design §7): la asignacion se aborta de todas formas (R8), asi que el
      // job DEBE sobrevivir al abort. Por eso se pasa el propio repo como `tx`: la
      // insercion abre su propia transaccion, no se engancha a ninguna ajena.
      try {
        await encolarGeocodificacion(this.jobs, undefined, {
          id: orden.id,
          direccion: orden.direccion,
        });
        resultado.set(orden.id, "geocodificacion_encolada");
      } catch {
        // R7: el encolado lanzo (DB caida, por ejemplo). NO se propaga: el gate debe
        // devolver un estado por CADA orden para que el writer arme su `detalle`
        // completo, en vez de reventar el lote entero con una excepcion opaca.
        resultado.set(orden.id, "geocodificacion_no_encolable");
      }
    }

    return resultado;
  }
}

/**
 * R8 — traduccion del estado a un `motivo` estable para el `DetalleConflicto` de los tres
 * writers. Es el vocabulario que la UI de asignacion (feature 93, R9) mapea a texto: dos
 * mensajes distintos segun si la direccion es irresoluble o si aun se esta validando.
 *
 * Se exporta como funcion (y no como literal inline en cada writer) para que los tres
 * services no puedan divergir en el texto.
 */
export function motivoAsignabilidad(estado: EstadoAsignabilidad): string {
  return estado;
}

/** R8: `asignable` es el UNICO estado que deja pasar la asignacion. */
export function esAsignable(estado: EstadoAsignabilidad | undefined): boolean {
  return estado === "asignable";
}
