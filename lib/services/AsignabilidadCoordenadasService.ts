// Feature 92 (design §7, R1-R7) — gate de asignabilidad por coordenadas. Sin este gate,
// una orden sin coordenadas entra a la ruta de un mensajero y queda invisible para el
// optimizador para siempre.
//
// ═══ EL ORDEN DEL ARBOL DE DECISION ES NORMATIVO. NO REORDENAR. ═══
//
//   R2  coordenadas presentes                  -> asignable                  (sin tocar `jobs`)
//   R3  geocode_status DETERMINISTA            -> direccion_no_geocodificable(sin tocar `jobs`)
//   407   ...Y ADEMAS autorizada por una persona -> asignable_sin_ubicacion_autorizada
//   R4  clave EXACTA reconstruida -> una consulta por lote
//   400 job.lastError MARCADO de configuracion -> asignable_sin_ubicacion
//       Y job.estado en {failed,pending,processing}
//   R5    job.estado === 'failed'              -> geocodificacion_agotada
//   R6    job.estado pending|processing        -> geocodificacion_en_curso
//   R7  sin job (o `done` sin resultado)       -> encolar puntual
//
// ── FEATURE 400 (2026-09-09) — POR QUE EL PASO NUEVO VA EXACTAMENTE AHI (design §4.2)
// EL DEFECTO QUE CORRIGE: hasta esta ficha, R5 clasificaba CUALQUIER job `failed` como
// `geocodificacion_agotada` sin mirar POR QUE murio. Un corte de credencial y una direccion
// que el proveedor no resuelve caian en el mismo cubo. Medido: el 2026-09-08 la Google
// Geocoding API empezo a rechazar todas las peticiones (`REQUEST_DENIED`) y 42 ordenes
// quedaron 19 horas sin poder asignarse a NINGUN mensajero, con el operador leyendo
// «Direccion no encontrada» sobre direcciones perfectamente validas.
//
//   - DESPUES de R2 y R3, sin excepcion. La ORDEN sigue siendo la fuente de verdad de «la
//     direccion no existe»: una orden con `geocode_status = ZERO_RESULTS` SIGUE bloqueando
//     aunque un job posterior haya muerto por configuracion (R4 de la 400). Sin esta
//     precedencia, un corte de credencial ENMASCARARIA una direccion genuinamente mala y la
//     meteria en la ruta de un mensajero.
//   - ANTES de R5 y R6, y no DENTRO de R5. El criterio nuevo es la CAUSA, no el estado del
//     job. Meterlo dentro de R5 lo ataria a `failed` y dejaria fuera la mitad del incidente
//     medido: 23 de los 48 jobs estaban en `pending` (design §8-A4).
//   - SE EXIGE ADEMAS EL ESTADO no-`done`. Un job `done` termino su ultimo intento SIN
//     morir por configuracion; su `last_error` (si lo tiene) es la fotografia de un intento
//     anterior ya superado. Leerlo abriria la puerta con un dato obsoleto.
//   - COSTE: CERO consultas nuevas. `lastError` viene en el mismo `JobDTO` que
//     `findByDedupeKeys` ya devolvia.
//
// Y el marcador NO se queda pegado para siempre (design §4.3): si el job acaba con exito la
// orden gana coordenadas y R2 gana antes de llegar a la cola; si vuelve a fallar por otra
// causa, `fail()` SOBRESCRIBE `last_error` sin marcador; y si la direccion se corrige,
// cambia el hash, cambia la `dedupe_key` y el job viejo deja de responder por esa orden.
//
// ── FICHA 407 (2026-09-10) — POR QUE LA AUTORIZACION VIVE DENTRO DE R3 (design §3.2)
// El paso nuevo NO es un paso propio del arbol: es un `if` DENTRO de la rama de
// `STATUS_DETERMINISTAS`, y en ningun otro sitio. Es la decision estructural de la ficha.
//   - NO puede ganarle a R2: si la orden tiene coordenadas, R2 ya salio con `asignable` antes
//     de llegar aqui, asi que la marca no tiene NINGUN efecto observable (407/R4).
//   - NO puede comerse un estado de cola: `geocodificacion_en_curso`, `_encolada`,
//     `_no_encolable` y `_agotada` se calculan en otra rama a la que este codigo NO LLEGA.
//     Ninguno es un veredicto definitivo sobre la direccion y todavia pueden resolverse solos
//     (407/R2). Un paso propio antes de la cola dejaria esa puerta abierta; dentro de R3 es
//     estructuralmente IMPOSIBLE.
//   - NO puede tocar ordenes ajenas: el bucle solo recorre `ordenes`, asi que un id marcado
//     que no este en el lote no tiene donde aplicarse (407/R3).
//   - NO se queda pegada: el conjunto llega por parametro y muere con la llamada. La
//     siguiente peticion sin marca vuelve a bloquear (407/R9). Nada se persiste.
//   - COSTE: CERO consultas nuevas. Es una lectura de un `Set` en memoria.
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
//
// ⚠️ FEATURE 400 (2026-09-09) — MATIZ VIGENTE, LEE ESTO ANTES DE CITAR EL PARRAFO DE
// ARRIBA. `estado === 'failed'` sigue siendo el unico predicado de «intentos agotados»,
// pero YA NO es suficiente para clasificar `geocodificacion_agotada`: desde esta ficha, un
// job `failed` cuyo `last_error` lleva el marcador de fallo de configuracion NUESTRA sale
// como `asignable_sin_ubicacion` y no bloquea. «Agotado» describe el ESTADO del job;
// «bloquea o no» depende ademas de la CAUSA. Son dos preguntas distintas y esta ficha las
// separo.
import type { IJobRepository } from "@/lib/interfaces/repositories/IJobRepository";
import type {
  EstadoAsignabilidad,
  EstadoAsignable,
  IAsignabilidadCoordenadasService,
  OrdenAsignabilidadRow,
} from "@/lib/interfaces/services/IAsignabilidadCoordenadasService";
import { hashDireccion } from "@/lib/geo/direccion-query";
import { esFalloConfigGeocode } from "@/lib/geo/fallo-config-geocode";
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
    // FICHA 407 (R1/R5/R9): los ids que ESTA peticion autoriza a asignar sin ubicacion. El
    // `= new Set()` por defecto es lo que garantiza R5: un llamador que no lo pase obtiene
    // EXACTAMENTE el comportamiento previo a la ficha. Efimero: no se guarda en la instancia
    // (ver el caso R9 del test) ni en ningun otro sitio.
    autorizadasSinUbicacion: ReadonlySet<string> = new Set<string>(),
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
        // FICHA 407 (R1): la direccion es irresoluble, PERO una persona autorizo asignarla
        // igual en esta misma peticion. Es la unica puerta de la marca (ver cabecera).
        resultado.set(
          orden.id,
          autorizadasSinUbicacion.has(orden.id)
            ? "asignable_sin_ubicacion_autorizada"
            : "direccion_no_geocodificable", // R3
        );
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

      // FEATURE 400 (2026-09-09, R1) — LA CAUSA MANDA SOBRE EL ESTADO. Va ANTES de R5/R6 a
      // proposito (ver cabecera): si el ultimo intento murio por configuracion NUESTRA, la
      // direccion nunca llego a consultarse y bloquear la asignacion no protege nada — la
      // orden asignada sin ubicacion NO se pierde (feature 92 R37/R28/R30) y puede recibir
      // coordenadas despues, ya asignada. Se exige ADEMAS que el job no este `done`: un
      // `done` no murio, y su `last_error` seria una foto vieja.
      if (
        job !== undefined &&
        (job.estado === "failed" || job.estado === "pending" || job.estado === "processing") &&
        esFalloConfigGeocode(job.lastError)
      ) {
        resultado.set(orden.id, "asignable_sin_ubicacion");
        continue;
      }

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
 * writers. Es el vocabulario que la UI de asignacion (feature 93, R9) mapea a texto.
 *
 * FEATURE 400 (2026-09-09, R19/R22) — REGLA VIGENTE: los mensajes son TRES clases, no dos.
 * Hasta esta ficha este docstring decia «dos mensajes distintos segun si la direccion es
 * irresoluble o si aun se esta validando», y `geocodificacion_agotada` compartia texto con
 * `direccion_no_geocodificable` — es decir, un fallo del servicio de mapas se le mostraba
 * al operador como «Direccion no encontrada». Ahora son: direccion irresoluble > fallo del
 * servicio de geocodificacion > en validacion.
 *
 * Solo recibe estados BLOQUEANTES: los dos llamadores hacen `if (esAsignable(estado))
 * continue;` antes, asi que `asignable_sin_ubicacion` nunca llega aqui ni entra en ningun
 * `detalle` (R10).
 *
 * Se exporta como funcion (y no como literal inline en cada writer) para que los tres
 * services no puedan divergir en el texto.
 */
export function motivoAsignabilidad(estado: EstadoAsignabilidad): string {
  return estado;
}

/**
 * R8 — los estados que DEJAN PASAR la asignacion.
 *
 * ⚠️ SI AMPLIAS ESTE DOCSTRING, ESCRIBE POR ENCIMA DE ESTA LINEA.
 * `marcador-fallo-config-declaracion-unica.guardia` lee una VENTANA FIJA de 1400 caracteres
 * inmediatamente anterior a la firma y exige encontrar «FEATURE 400» dentro. Todo lo que se
 * anada DEBAJO empuja ese texto fuera de la ventana y pone el guardia rojo — le paso a la
 * ficha 407 el 2026-09-10, con 235 caracteres de mas. Lo escrito ARRIBA no consume margen.
 *
 * FEATURE 400 (2026-09-09, R6) — REGLA VIGENTE: son DOS, no uno. Hasta esta ficha este
 * docstring decia «`asignable` es el UNICO estado que deja pasar la asignacion», y era
 * cierto; desde la 400 tambien pasa `asignable_sin_ubicacion` — la orden no tiene
 * coordenadas, pero la culpa es de NUESTRA configuracion (el proveedor rechazo la peticion,
 * o falta la credencial) y la direccion nunca llego a consultarse. Rio abajo esa orden esta
 * cubierta por el modo degradado que ya existia (feature 92 R37/R28/R30).
 *
 * FICHA 407 (2026-09-10, R1) — REGLA VIGENTE: son TRES. El tercero,
 * `asignable_sin_ubicacion_autorizada`, es la direccion irresoluble que una PERSONA autoriza
 * a sabiendas en esa misma peticion (efimero, no se persiste: R9).
 *
 * ⚠️ El tipo NO protege esta lista: un array mas CORTO compila igual, y olvidar un valor
 * seria un fallo MUDO. Por eso hay un caso por valor en el test de la 407.
 *
 * `undefined` (la orden no existe) NUNCA pasa: no se deja pasar nada por omision.
 *
 * Se implementa contra `EstadoAsignable`, no con literales sueltos: la lista vive en el
 * contrato (`IAsignabilidadCoordenadasService`) y `EstadoBloqueante` se deriva de ella, asi
 * que anadir un estado sin clasificarlo rompe la compilacion del mapa de mensajes (R25).
 */
export function esAsignable(estado: EstadoAsignabilidad | undefined): boolean {
  if (estado === undefined) return false;
  const asignables: readonly EstadoAsignable[] = [
    "asignable",
    "asignable_sin_ubicacion",
    "asignable_sin_ubicacion_autorizada",
  ];
  return (asignables as readonly string[]).includes(estado);
}
