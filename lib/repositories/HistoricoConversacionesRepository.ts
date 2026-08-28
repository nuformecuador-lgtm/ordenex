// Feature 321 (T3.1-T3.5, design §2.3 y §2.4) — repositorio del HISTORICO de conversaciones.
//
// SOLO LECTURA, y eso es una propiedad del TIPO, no una costumbre: el cliente Prisma que este
// repositorio acepta esta acotado a `$queryRaw` (ver `HistoricoPrismaClient`). No hay forma de
// escribir desde aqui —ni de tocar `chat_conversacion.mensajero_leido_at` (R25)— porque el
// objeto que recibe no expone `update`, `create`, `upsert`, `delete` ni `$executeRaw`. El test
// del service (T3.6) lo confirma por comportamiento con un doble que LANZA ante cualquiera de
// esos metodos.
//
// SIN AUTORIZACION AQUI (design §2.5, `docs/architecture.md`): quien puede leer el histórico lo
// decide `HistoricoConversacionesService` con `ROLES_HISTORICO_CONVERSACIONES`. El `mensajeroId`
// que viaja en las consultas es PARTE DE LA CLAVE DEL HILO (R42), no un scope de sesion. Esa es
// la diferencia deliberada con `ChatConversacionRepository.findByOrdenParaMensajero`, que si
// lleva el scope en el `WHERE` y que esta feature NO toca (R26).
//
// SIN MIGRACION (R27): no se crea ni un indice. Las consultas se apoyan en lo que ya hay —
// `chat_mensaje(conversacion_id, ocurrido_at)`, `chat_mensaje_reaccion_idx`,
// `chat_conversacion(mensajero_id)`, `orden_busqueda_texto_trgm_idx` y el unico de `num_guia`.
//
// POR QUE SQL CRUDO Y NO EL QUERY BUILDER: el listado agrupa por un par de columnas, calcula la
// ultima actividad con un `LATERAL`, ordena por ese agregado y pagina por un cursor de TRES
// componentes en el `HAVING`. Prisma no expresa nada de eso. Todo valor que viene de fuera viaja
// como PARAMETRO (`Prisma.sql`); lo unico interpolado son literales de este archivo.
import { Prisma, type ChatMensajeDireccion, type ChatMensajeEstado, type ChatMensajeTipo, type PrismaClient } from "@prisma/client";

import type {
  IHistoricoConversacionesRepository,
  ListarHilosPagina,
  ListarHilosQuery,
  ListarMensajesPagina,
  ListarMensajesQuery,
} from "@/lib/interfaces/repositories/IHistoricoConversacionesRepository";
import { parsearContactosGuardados } from "@/lib/types/chat-contactos";
import type { ChatMensajeVista } from "@/lib/types/chat-whatsapp";
import type { CursorHilo, HiloHistoricoDTO } from "@/lib/types/historico-conversaciones";
import { sqlNormalizarTextoBusqueda } from "@/lib/utils/busqueda-texto-sql";
import { agregarReacciones, type MensajeConReaccion } from "@/lib/utils/chat-reacciones";
import { escaparComodinesLike } from "@/lib/utils/escapar-like";
import { terminoDeBusqueda } from "@/lib/utils/filtros-listado-ordenes";
import { inicioDelDiaCREnUtc, inicioDelDiaSiguienteCREnUtc } from "@/lib/utils/fecha-cr";

/**
 * El cliente Prisma que este repositorio admite: SOLO `$queryRaw`. Es la mitad estructural de
 * R25 (la otra mitad es el test del service). Ampliar este `Pick` con un metodo de escritura es
 * una decision visible en el diff, no un descuido posible.
 */
export type HistoricoPrismaClient = Pick<PrismaClient, "$queryRaw">;

// ---------------------------------------------------------------------------
// Helpers de SQL — instantes que ENTRAN y que SALEN
// ---------------------------------------------------------------------------

/**
 * Un instante que SALE, ya como texto ISO 8601 en UTC.
 *
 * POR QUE NO SE DEVUELVE UN `Date`: las columnas de tiempo del chat son `timestamp` SIN zona y
 * guardan UTC. Que un driver las reconstruya como `Date` depende de como interprete ese
 * `timestamp` (node-postgres, por su cuenta, lo lee en la zona LOCAL del proceso), y los DTOs de
 * esta feature exponen `string` ISO de todas formas. Formatear en Postgres elimina el viaje de
 * ida y vuelta y con el, la clase entera de off-by-N-horas.
 */
function isoUtc(expr: string): Prisma.Sql {
  return Prisma.raw(`to_char(${expr}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);
}

/**
 * Un instante que ENTRA (cursor o cota de fecha), por la misma razon y en el sentido contrario:
 * el texto ISO se parsea como `timestamptz` —forma no ambigua— y se baja a `timestamp` en UTC,
 * que es exactamente lo que hay en la columna. Sin el `AT TIME ZONE 'UTC'` la comparacion
 * dependeria del `TimeZone` de la sesion.
 */
function instante(iso: string): Prisma.Sql {
  return Prisma.sql`(${iso}::timestamptz AT TIME ZONE 'UTC')`;
}

/** Patron `%valor%` con los comodines del propio valor neutralizados (`escaparComodinesLike`). */
function patronLike(valor: string): string {
  return `%${escaparComodinesLike(valor)}%`;
}

/** Nombre completo del mensajero tal como se compara en R36: tres columnas de `usuario`. */
const NOMBRE_MENSAJERO_SQL = "concat_ws(' ', u.nombre, u.primer_apellido, u.segundo_apellido)";

// ---------------------------------------------------------------------------
// Filas crudas
// ---------------------------------------------------------------------------

interface HiloRaw {
  orden_id: string;
  mensajero_id: string;
  num_guia: number | null;
  num_remision: string;
  destinatario: string;
  mensajero_nombre: string;
  ultima_actividad_at: string | null;
  total_mensajes: number;
  telefonos_count: number;
  telefono_vigente: string | null;
}

interface MensajeRaw {
  id: string;
  direccion: ChatMensajeDireccion;
  tipo: ChatMensajeTipo;
  cuerpo: string | null;
  estado: ChatMensajeEstado | null;
  latitud: number | null;
  longitud: number | null;
  media_id: string | null;
  media_mime: string | null;
  media_nombre: string | null;
  media_tamano_bytes: number | null;
  contactos_json: unknown;
  sistema_telefono_anterior: string | null;
  sistema_telefono_nuevo: string | null;
  wa_message_id: string | null;
  ocurrido_at: string;
}

interface ReaccionRaw {
  direccion: ChatMensajeDireccion;
  reaccion_a_wa_message_id: string | null;
  reaccion_emoji: string | null;
  ocurrido_at: string;
}

// ---------------------------------------------------------------------------
// Construccion de la consulta del LISTADO (design §2.4)
// ---------------------------------------------------------------------------

/** Restringe el listado a UN hilo concreto: es lo unico que distingue la cabecera (R43). */
export interface HiloConcreto {
  ordenId: string;
  mensajeroId: string;
}

/**
 * Las condiciones del `WHERE` del listado (R33-R36) mas, si lo hay, el hilo concreto de la
 * cabecera. Se devuelven como lista para que el `WHERE` se arme con `AND` sin casos especiales.
 */
function condicionesDelListado(
  filtro: ListarHilosQuery["filtro"],
  hilo: HiloConcreto | null,
): Prisma.Sql[] {
  const condiciones: Prisma.Sql[] = [];

  if (hilo !== null) {
    condiciones.push(Prisma.sql`c.orden_id = ${hilo.ordenId}`);
    condiciones.push(Prisma.sql`c.mensajero_id = ${hilo.mensajeroId}`);
  }

  // R33 — mensajeros seleccionados. La lista vacia NO llega aqui: el borde zod la rechaza
  // (`nonempty`), porque `IN ()` no es SQL valido y «ninguno seleccionado» se expresa
  // OMITIENDO la clave, no mandando `[]`.
  const mensajeros = filtro.mensajero_id;
  if (mensajeros !== undefined && mensajeros.length > 0) {
    condiciones.push(Prisma.sql`c.mensajero_id IN (${Prisma.join(mensajeros)})`);
  }

  // R34/R39 — el rango SELECCIONA hilos: entra el que tenga AL MENOS UN mensaje dentro.
  //
  // DOS decisiones que no son de estilo:
  //
  // 1. Las cotas salen de `inicioDelDiaCREnUtc` / `inicioDelDiaSiguienteCREnUtc`, NUNCA de
  //    `startOfDayCR`: se compara contra `ocurrido_at`, que es un instante, y confundirlas es el
  //    off-by-one de SEIS HORAS que documenta `lib/utils/fecha-cr.ts`. El extremo `hasta` es
  //    INCLUSIVO y por eso el limite superior es el inicio del dia SIGUIENTE, con `<` estricto.
  // 2. El `EXISTS` mira TODO EL GRUPO `(orden_id, mensajero_id)`, no solo la fila `c.id` (que es
  //    lo que insinuaba el borrador de design §2.4). Con la forma por fila, un hilo fusionado de
  //    dos numeros (R42/R43) del que solo UNO tuviera mensajes en el rango perderia la otra fila
  //    ANTES del `GROUP BY`, y entonces `totalMensajes`, `telefonosCount` y `telefonoVigente`
  //    saldrian calculados sobre medio hilo. La seleccion es del HILO; los agregados, del hilo
  //    entero.
  const desde = filtro.fecha_desde;
  const hasta = filtro.fecha_hasta;
  if (desde !== undefined || hasta !== undefined) {
    const cotas: Prisma.Sql[] = [];
    if (desde !== undefined) {
      cotas.push(Prisma.sql`m2.ocurrido_at >= ${instante(inicioDelDiaCREnUtc(desde).toISOString())}`);
    }
    if (hasta !== undefined) {
      cotas.push(
        Prisma.sql`m2.ocurrido_at < ${instante(inicioDelDiaSiguienteCREnUtc(hasta).toISOString())}`,
      );
    }
    condiciones.push(Prisma.sql`EXISTS (
      SELECT 1
      FROM chat_conversacion c2
      JOIN chat_mensaje m2 ON m2.conversacion_id = c2.id
      WHERE c2.orden_id = c.orden_id
        AND c2.mensajero_id = c.mensajero_id
        AND ${Prisma.join(cotas, " AND ")}
    )`);
  }

  // R35 (P7) — numero EXACTO. `=`, jamas `LIKE`/`ILIKE`: `REM-100` NO puede encontrar
  // `REM-1001`, y `1001` NO puede encontrar la guia `10011`. La rama de `num_guia` solo se añade
  // cuando el valor es un entero, porque comparar `int` con texto no numerico lanza `22P02`.
  const orden = filtro.orden;
  if (orden !== undefined) {
    const alternativas: Prisma.Sql[] = [Prisma.sql`o.num_remision = ${orden}`];
    if (/^\d+$/.test(orden)) {
      const guia = Number.parseInt(orden, 10);
      if (Number.isSafeInteger(guia)) {
        alternativas.push(Prisma.sql`(o.num_guia IS NOT NULL AND o.num_guia = ${guia})`);
      }
    }
    condiciones.push(Prisma.sql`(${Prisma.join(alternativas, " OR ")})`);
  }

  // R36 — busqueda libre. DOS mitades unidas por `OR`, y la segunda existe porque
  // `orden.busqueda_texto` NO contiene el nombre del mensajero (design §1.2):
  //   (1) la columna generada de `orden` (destinatario, num_guia, num_remision, telefono,
  //       producto), en las una o dos formas de `terminoDeBusqueda`;
  //   (2) el nombre completo del mensajero, normalizado EN LA CONSULTA con el espejo SQL del
  //       normalizador de Node (`sqlNormalizarTextoBusqueda`, con test de paridad propio).
  // `busqueda_texto` se USA en el `WHERE` pero NO se SELECCIONA en ningun sitio: sigue omitida
  // globalmente por `PRISMA_OMIT` y es PII duplicada (riesgo 6 del design).
  const q = filtro.q;
  if (q !== undefined) {
    const { busqueda, busquedaDigitos } = terminoDeBusqueda(q);
    const alternativas: Prisma.Sql[] = [
      Prisma.sql`o.busqueda_texto LIKE ${patronLike(busqueda)}`,
    ];
    if (busquedaDigitos !== undefined && busquedaDigitos !== busqueda) {
      alternativas.push(Prisma.sql`o.busqueda_texto LIKE ${patronLike(busquedaDigitos)}`);
    }
    alternativas.push(
      Prisma.sql`${Prisma.raw(sqlNormalizarTextoBusqueda(NOMBRE_MENSAJERO_SQL))} LIKE ${patronLike(busqueda)}`,
    );
    condiciones.push(Prisma.sql`(${Prisma.join(alternativas, " OR ")})`);
  }

  return condiciones;
}

/**
 * R13/R15 — el corte del cursor, en el `HAVING` porque el valor que ordena es un AGREGADO
 * (`MAX(act.ultima)`), no una columna.
 *
 * El orden del listado es `(ultima_actividad_at DESC NULLS LAST, orden_id DESC, mensajero_id
 * DESC)`, asi que «lo que va DESPUES del cursor» es «lo estrictamente MENOR» en esa clave, con
 * los `NULL` al final. Se escribe en dos ramas porque `NULL` no es un valor comparable:
 *
 * - cursor CON instante: pasa lo que tiene instante menor, lo que no tiene instante (va detras
 *   de todo) y lo que empata en instante pero tiene par `(orden_id, mensajero_id)` menor;
 * - cursor SIN instante (ya en la cola de los hilos sin mensajes): solo pasan los que tampoco
 *   tienen instante y ademas tienen par menor.
 *
 * Las DOS claves de desempate son las que hacen la paginacion TOTAL: sin ellas, tres hilos con
 * el mismo instante se pisarian entre paginas (R15).
 */
function corteDelCursor(cursor: CursorHilo): Prisma.Sql {
  const par = Prisma.sql`(c.orden_id, c.mensajero_id) < (${cursor.ordenId}, ${cursor.mensajeroId})`;
  if (cursor.ultimaActividadAt === null) {
    return Prisma.sql`(MAX(act.ultima) IS NULL AND ${par})`;
  }
  const tope = instante(cursor.ultimaActividadAt);
  return Prisma.sql`(
    MAX(act.ultima) IS NULL
    OR MAX(act.ultima) < ${tope}
    OR (MAX(act.ultima) = ${tope} AND ${par})
  )`;
}

/**
 * La consulta del listado, EXPUESTA a proposito (design §2.4): asi el test de T3.1/T3.4 puede
 * leer el SQL que de verdad se manda y afirmar `expect(sql).not.toMatch(/OFFSET/i)` sobre EL
 * TEXTO REAL, no sobre uno reconstruido a mano que no probaria nada.
 *
 * `limite` se pide con `+1` en el llamante: es como se sabe si hay pagina siguiente SIN un
 * `COUNT` y sin `OFFSET` (A4: con inserciones concurrentes, `OFFSET` repite y pierde filas).
 */
export function construirConsultaListarHilos(
  query: ListarHilosQuery,
  hilo: HiloConcreto | null = null,
): Prisma.Sql {
  const condiciones = condicionesDelListado(query.filtro, hilo);
  const where =
    condiciones.length === 0
      ? Prisma.empty
      : Prisma.sql`AND ${Prisma.join(condiciones, " AND ")}`;
  const having =
    query.cursor === null ? Prisma.empty : Prisma.sql`HAVING ${corteDelCursor(query.cursor)}`;

  return Prisma.sql`
    SELECT c.orden_id                                     AS orden_id,
           c.mensajero_id                                 AS mensajero_id,
           o.num_guia                                     AS num_guia,
           o.num_remision                                 AS num_remision,
           o.destinatario                                 AS destinatario,
           ${Prisma.raw(NOMBRE_MENSAJERO_SQL)}            AS mensajero_nombre,
           ${isoUtc("MAX(act.ultima)")}                   AS ultima_actividad_at,
           COALESCE(SUM(act.total), 0)::int               AS total_mensajes,
           COUNT(DISTINCT c.telefono_e164)::int           AS telefonos_count,
           (array_agg(c.telefono_e164 ORDER BY act.ultima DESC NULLS LAST))[1]
                                                          AS telefono_vigente
    FROM chat_conversacion c
    JOIN orden   o ON o.id = c.orden_id AND o.deleted_at IS NULL
    JOIN usuario u ON u.id = c.mensajero_id
    CROSS JOIN LATERAL (
      SELECT MAX(m.ocurrido_at) AS ultima, COUNT(*)::int AS total
      FROM chat_mensaje m
      WHERE m.conversacion_id = c.id
    ) act
    WHERE TRUE ${where}
    GROUP BY c.orden_id, c.mensajero_id,
             o.num_guia, o.num_remision, o.destinatario,
             u.nombre, u.primer_apellido, u.segundo_apellido
    ${having}
    ORDER BY MAX(act.ultima) DESC NULLS LAST, c.orden_id DESC, c.mensajero_id DESC
    LIMIT ${query.limite}
  `;
}

/**
 * La consulta de la pagina del hilo FUSIONADO (design §2.3, R42).
 *
 * Tres decisiones:
 *
 * - el `IN` resuelve TODAS las `chat_conversacion.id` del grupo `(orden, mensajero)`, que en la
 *   practica son una o dos; cada una se sirve por el prefijo del indice
 *   `(conversacion_id, ocurrido_at)` y el planner combina las secuencias ya ordenadas;
 * - se ORDENA por `(ocurrido_at, id)` y NUNCA por `direccion` (R40): entrantes y salientes van
 *   entrelazados en la misma cronologia. El desempate por `id` no es decorativo — sin el, dos
 *   mensajes con el mismo `ocurrido_at` procedentes de filas distintas se intercalarian de forma
 *   no determinista entre paginas (R20);
 * - las filas `tipo = 'reaccion'` se EXCLUYEN de la pagina (R28). No son burbujas, asi que
 *   tampoco deben ocupar sitio en la ventana ni mover el cursor: se traen aparte, ancladas a su
 *   objetivo, en `construirConsultaReaccionesDelHilo`.
 */
export function construirConsultaMensajesDelHilo(query: ListarMensajesQuery): Prisma.Sql {
  const corte =
    query.cursor === null
      ? Prisma.empty
      : Prisma.sql`AND (m.ocurrido_at, m.id) < (${instante(query.cursor.ocurridoAt)}, ${query.cursor.id})`;

  return Prisma.sql`
    SELECT m.id                        AS id,
           m.direccion                 AS direccion,
           m.tipo                      AS tipo,
           m.cuerpo                    AS cuerpo,
           m.estado                    AS estado,
           m.latitud                   AS latitud,
           m.longitud                  AS longitud,
           m.media_id                  AS media_id,
           m.media_mime                AS media_mime,
           m.media_nombre              AS media_nombre,
           m.media_tamano_bytes        AS media_tamano_bytes,
           m.contactos_json            AS contactos_json,
           m.sistema_telefono_anterior AS sistema_telefono_anterior,
           m.sistema_telefono_nuevo    AS sistema_telefono_nuevo,
           m.wa_message_id             AS wa_message_id,
           ${isoUtc("m.ocurrido_at")}  AS ocurrido_at
    FROM chat_mensaje m
    WHERE m.conversacion_id IN (${conversacionesDelGrupo(query.ordenId, query.mensajeroId)})
      AND m.tipo <> 'reaccion'::"chat_mensaje_tipo"
      ${corte}
    ORDER BY m.ocurrido_at DESC, m.id DESC
    LIMIT ${query.limite}
  `;
}

/**
 * R28 — las reacciones de la pagina, buscadas por su OBJETIVO y no por su posicion.
 *
 * Es la consulta que resuelve las dos formas en que una reaccion se separa de su burbuja:
 * cuando cae en OTRA PAGINA (llego mucho despues que el mensaje que reacciona) y cuando cae en
 * OTRA FILA del mismo grupo (el cliente reacciono desde su numero nuevo). Por eso el `IN` de
 * conversaciones vuelve a ser el del GRUPO entero y el filtro es
 * `reaccion_a_wa_message_id IN (<los wa_message_id de la pagina>)`, servido por
 * `chat_mensaje_reaccion_idx`. Sin esto, una reaccion se perderia o aparaceria como burbuja
 * suelta, que es justo lo que R28 prohibe.
 */
export function construirConsultaReaccionesDelHilo(
  ordenId: string,
  mensajeroId: string,
  waMessageIds: readonly string[],
): Prisma.Sql {
  return Prisma.sql`
    SELECT m.direccion                  AS direccion,
           m.reaccion_a_wa_message_id   AS reaccion_a_wa_message_id,
           m.reaccion_emoji             AS reaccion_emoji,
           ${isoUtc("m.ocurrido_at")}   AS ocurrido_at
    FROM chat_mensaje m
    WHERE m.conversacion_id IN (${conversacionesDelGrupo(ordenId, mensajeroId)})
      AND m.tipo = 'reaccion'::"chat_mensaje_tipo"
      AND m.reaccion_a_wa_message_id IN (${Prisma.join([...waMessageIds])})
    ORDER BY m.ocurrido_at ASC, m.id ASC
  `;
}

/**
 * Las filas de `chat_conversacion` del grupo `(orden, mensajero)`. Lleva el `JOIN orden` con
 * `deleted_at IS NULL` (R12): una orden borrada no da acceso a su hilo ni por esta via.
 */
function conversacionesDelGrupo(ordenId: string, mensajeroId: string): Prisma.Sql {
  return Prisma.sql`
        SELECT c.id
        FROM chat_conversacion c
        JOIN orden o ON o.id = c.orden_id AND o.deleted_at IS NULL
        WHERE c.orden_id = ${ordenId} AND c.mensajero_id = ${mensajeroId}
  `;
}

// ---------------------------------------------------------------------------
// Mapeos
// ---------------------------------------------------------------------------

/**
 * R43 / riesgo 6 — el telefono viaja ENMASCARADO: solo los cuatro ultimos digitos. Esta
 * pantalla no llama a nadie, asi que el numero completo no aporta nada y es PII del cliente. Un
 * numero mas corto que cuatro digitos (dato legado) sale entero: enmascarar menos de lo que hay
 * seria mentir sobre lo que se guarda.
 */
function enmascararTelefono(telefono: string | null): string {
  if (telefono === null) return "";
  const digitos = telefono.replace(/\D/g, "");
  return digitos.slice(-4);
}

function aHiloDTO(row: HiloRaw): HiloHistoricoDTO {
  return {
    ordenId: row.orden_id,
    mensajeroId: row.mensajero_id,
    numGuia: row.num_guia === null ? null : Number(row.num_guia),
    numRemision: row.num_remision,
    destinatario: row.destinatario,
    mensajeroNombre: row.mensajero_nombre,
    telefonoVigenteMasked: enmascararTelefono(row.telefono_vigente),
    telefonosCount: Number(row.telefonos_count),
    ultimaActividadAt: row.ultima_actividad_at,
    totalMensajes: Number(row.total_mensajes),
  };
}

/** La forma que `agregarReacciones` necesita, tanto de las burbujas como de las reacciones. */
function aMensajeConReaccion(
  row: Pick<MensajeRaw, "direccion" | "tipo" | "wa_message_id" | "ocurrido_at"> & {
    reaccion_a_wa_message_id?: string | null;
    reaccion_emoji?: string | null;
  },
): MensajeConReaccion {
  return {
    waMessageId: row.wa_message_id ?? null,
    direccion: row.direccion,
    tipo: row.tipo,
    reaccionAWaMessageId: row.reaccion_a_wa_message_id ?? null,
    reaccionEmoji: row.reaccion_emoji ?? null,
    ocurridoAt: new Date(row.ocurrido_at),
  };
}

// ---------------------------------------------------------------------------
// Repositorio
// ---------------------------------------------------------------------------

export class HistoricoConversacionesRepository implements IHistoricoConversacionesRepository {
  constructor(private readonly prisma: HistoricoPrismaClient) {}

  async listarHilos(query: ListarHilosQuery): Promise<ListarHilosPagina> {
    // `limite + 1`: la fila sobrante NO se devuelve, solo delata que hay pagina siguiente. Es la
    // alternativa barata al `COUNT(*)` sobre un agregado, y no necesita `OFFSET` (R13/A4).
    const sql = construirConsultaListarHilos({ ...query, limite: query.limite + 1 });
    const rows = await this.prisma.$queryRaw<HiloRaw[]>(sql);

    const hayMas = rows.length > query.limite;
    const pagina = hayMas ? rows.slice(0, query.limite) : rows;
    const items = pagina.map(aHiloDTO);
    const ultimo = items.at(-1);

    return {
      items,
      // El cursor se construye con el ULTIMO hilo DEVUELTO, no con la fila sobrante: asi la
      // siguiente pagina arranca exactamente donde termino esta, sin saltarse nada (R15).
      siguiente:
        hayMas && ultimo !== undefined
          ? {
              ultimaActividadAt: ultimo.ultimaActividadAt,
              ordenId: ultimo.ordenId,
              mensajeroId: ultimo.mensajeroId,
            }
          : null,
    };
  }

  async listarMensajes(query: ListarMensajesQuery): Promise<ListarMensajesPagina> {
    // Igual que en el listado: una fila de mas para saber si queda hilo hacia atras (R21).
    const rows = await this.prisma.$queryRaw<MensajeRaw[]>(
      construirConsultaMensajesDelHilo({ ...query, limite: query.limite + 1 }),
    );

    const hayMas = rows.length > query.limite;
    // Las filas llegan DESCENDENTES (lo mas reciente primero, que es como se pagina hacia
    // atras); la pagina se invierte a ASCENDENTE antes de devolverla porque el hilo se lee de
    // arriba abajo (R21/R40).
    const descendentes = hayMas ? rows.slice(0, query.limite) : rows;
    const ascendentes = [...descendentes].reverse();

    const waIds = ascendentes
      .map((m) => m.wa_message_id)
      .filter((id): id is string => id !== null);

    const reacciones =
      waIds.length === 0
        ? []
        : await this.prisma.$queryRaw<ReaccionRaw[]>(
            construirConsultaReaccionesDelHilo(query.ordenId, query.mensajeroId, waIds),
          );

    // `agregarReacciones` es la MISMA funcion que usa el chat del mensajero (D4 de la 311): las
    // reacciones se cuelgan de su objetivo y jamas se pintan como burbuja propia. Se le pasan las
    // burbujas de la pagina mas las reacciones que apuntan a ellas, vengan de donde vengan.
    const { reaccionesPorWaMessageId } = agregarReacciones([
      ...ascendentes.map(aMensajeConReaccion),
      ...reacciones.map((r) =>
        aMensajeConReaccion({
          direccion: r.direccion,
          tipo: "reaccion",
          wa_message_id: null,
          ocurrido_at: r.ocurrido_at,
          reaccion_a_wa_message_id: r.reaccion_a_wa_message_id,
          reaccion_emoji: r.reaccion_emoji,
        }),
      ),
    ]);

    const mensajes: ChatMensajeVista[] = ascendentes.map((m) => ({
      id: m.id,
      direccion: m.direccion,
      tipo: m.tipo,
      cuerpo: m.cuerpo,
      estado: m.estado,
      latitud: m.latitud === null ? null : Number(m.latitud),
      longitud: m.longitud === null ? null : Number(m.longitud),
      // El `media_id` de Meta NO viaja a la UI (R21 de la 311): la burbuja pide el binario por
      // `/api/chat/media/<id interno>`. Que `media` no sea `null` es lo unico que la UI necesita.
      media:
        m.media_id === null
          ? null
          : {
              mime: m.media_mime,
              nombre: m.media_nombre,
              tamanoBytes: m.media_tamano_bytes === null ? null : Number(m.media_tamano_bytes),
            },
      // `safeParse`, nunca un cast: un JSON legado o corrupto se lee como «sin contactos» y no
      // revienta la pagina entera del hilo.
      contactos: parsearContactosGuardados(m.contactos_json),
      sistema:
        m.tipo === "sistema"
          ? {
              telefonoAnterior: m.sistema_telefono_anterior,
              telefonoNuevo: m.sistema_telefono_nuevo,
            }
          : null,
      reacciones:
        m.wa_message_id === null ? [] : (reaccionesPorWaMessageId.get(m.wa_message_id) ?? []),
      ocurridoAt: m.ocurrido_at,
    }));

    const masAntiguo = descendentes.at(-1);
    return {
      mensajes,
      anterior:
        hayMas && masAntiguo !== undefined
          ? { ocurridoAt: masAntiguo.ocurrido_at, id: masAntiguo.id }
          : null,
    };
  }

  async obtenerCabecera(
    ordenId: string,
    mensajeroId: string,
  ): Promise<HiloHistoricoDTO | null> {
    // R43 — LA MISMA proyeccion que una fila del listado, por la misma consulta, restringida al
    // par. Dos consultas distintas para el mismo dato acabarian diciendo cosas distintas.
    const rows = await this.prisma.$queryRaw<HiloRaw[]>(
      construirConsultaListarHilos(
        { filtro: {}, cursor: null, limite: 1 },
        { ordenId, mensajeroId },
      ),
    );
    const row = rows[0];
    return row === undefined ? null : aHiloDTO(row);
  }
}
