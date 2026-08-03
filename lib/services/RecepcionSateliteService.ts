import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { RecepcionSateliteRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
import type {
  IRecepcionSateliteService,
  ListarOrdenesBodegaPaginadoInput,
  ListarOrdenesBodegaPaginadoServiceResult,
  ListarRecepcionSateliteServiceResult,
  ObtenerCatalogoFiltrosSateliteServiceResult,
  RecepcionSateliteDTO,
  RecibirLoteInput,
  RecibirLoteServiceResult,
  RecibirServiceResult,
} from "@/lib/interfaces/services/IRecepcionSateliteService";
import {
  ESTADOS_BODEGA_SATELITE,
  estadosDelListado,
} from "@/lib/utils/estados-bodega-satelite";
import {
  derivarCantones,
  derivarDistritos,
} from "@/lib/utils/filtro-canton-distrito";
import { rangoDePagina } from "@/lib/utils/rango-pagina";

// Estado de ORIGEN de la recepcion (feature 30) y destino tras recibir (esta
// feature). Un solo estado de destino; el nombre de zona se deriva de orden.zonaId
// para el display (R9/R20).
const ORIGEN_RECEPCION = "en_ruta_bodega_satelite";
const ESTADO_RECIBIDA = "en_bodega_satelite";
// Feature 139/T2.5/R21: estado de las ordenes elegibles para "Enviar a central" (primer tramo del
// retorno satelite). REEMPLAZA a `rechazada` (feature 48): con la 139 una rechazada sale de ese
// estado SOLO al aprobar el cierre, que la deja en `por_devolver`; la accion satelite opera ahora
// sobre `por_devolver` (accionable por lote). Se listan acotadas a la zona del adminSatelite.
const ESTADO_POR_DEVOLVER = "por_devolver";
// Feature 139/T2.5/R21: estado INFORMATIVO de las ordenes ya enviadas a central y en transito
// (`devolviendo_a_bodega_central`). Se listan acotadas a la zona; no accionables desde satelite
// (la recepcion la hace la central por QR).
const ESTADO_EN_TRANSITO_CENTRAL = "devolviendo_a_bodega_central";
// Feature 100/T4.1/R12: estado de las ordenes `devuelta` (novedad que reposa bajo la
// feature 99) elegibles para "Recuperar a bodega" (nuevo intento). Mismo patron que
// `porDevolver` (48): SIEMPRE acotadas a la zona del adminSatelite. La transicion la
// ejecuta RecuperacionBodegaService (autz rol + zona); aqui SOLO listado por zona.
const ESTADO_DEVUELTA = "devuelta";
// Feature 149/T6.3/R35: estado de las ordenes de la zona YA ASIGNADAS a un mensajero que aun no
// las recogio (`por_recoger`), elegibles para la accion por lote "Deshacer asignacion". Mismo
// patron que `porDevolver` (139) y `devueltas` (100): SIEMPRE acotadas a la zona del
// adminSatelite por `findRecepcionSateliteByZona(zonaId, ...)`; aqui SOLO listado — la autz de
// ejecutar la reversion (rol + zona + destino derivado) la impone `DeshacerAsignacionService`.
// El caso (b) (`en_ruta_bodega_satelite`) NO entra en este bucket (R36): sigue en "Por recibir".
const ESTADO_ASIGNADA = "por_recoger";

// Solo el rol autorizado en el modulo (R3/R17): el adminSatelite, SIEMPRE acotado
// a su propia zona (R4/R12).
const ROL_AUTORIZADO = "adminSatelite";

// Metodos de repo que consume el service (inyeccion por constructor). Se declara
// como Pick para dobles de test sin DB/HTTP.
type RecepcionSateliteRepo = Pick<
  IOrdenRepository,
  | "findUsuarioZonaId"
  | "findRecepcionSateliteByZona"
  // Feature 170 — FASE 2 (T K.1/T K.2): la pagina del listado y el catalogo de sus filtros.
  | "findRecepcionSatelitePaginada"
  | "findRecepcionSateliteGeoByZona"
  | "findByNumGuiaForTransicion"
  | "findEstatusIdByValue"
  | "recibirEnSatelite"
  | "recibirLoteEnSatelite"
>;

// Feature 63: dedupe de ids del lote antes de la escritura (patron `recogerAsignaciones`).
function distinct(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Logica de negocio de la bodega satelite (feature 33). Resuelve el alcance por
 * zona del adminSatelite (server-side, R4), lista los dos grupos (R6/R8) y ejecuta
 * la recepcion por QR con guardias/idempotencia (R11-R18). No conoce HTTP ni
 * Prisma; testeable con dobles sin red/DB.
 */
export class RecepcionSateliteService implements IRecepcionSateliteService {
  constructor(
    private readonly repo: RecepcionSateliteRepo,
    // Feature 160 (R11/R12/R25): derivador de intentos EN LOTE, dependencia REQUERIDA.
    // `import type` + `Pick`: sin ciclo de modulos y testeable con dobles.
    private readonly historial: Pick<IOrdenHistorialService, "contarIntentosEnLote">,
  ) {}

  async listar(actor: Actor): Promise<ListarRecepcionSateliteServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R3/R17

    const zonaId = await this.repo.findUsuarioZonaId(actor.usuarioId); // R4
    if (zonaId === null) {
      // R5: adminSatelite sin zona -> modulo vacio + aviso accionable (sinZona).
      return {
        status: "ok",
        porRecibir: [],
        recibidas: [],
        porDevolver: [], // Feature 139/R21: sin zona -> tampoco hay `por_devolver`
        enTransitoACentral: [], // Feature 139/R21: sin zona -> tampoco hay `devolviendo_a_bodega_central`
        devueltas: [], // Feature 100/T4.1: sin zona -> tampoco hay ordenes por recuperar
        asignadas: [], // Feature 149/T6.3/R35: sin zona -> tampoco hay ordenes por deshacer
        zonaNombre: null,
        sinZona: true,
      };
    }

    // Feature 139/T2.5/R21: se listan `por_devolver` (accionable: "Enviar a central") y
    // `devolviendo_a_bodega_central` (informativo: en transito a central), SIEMPRE acotadas a la zona
    // del actor. `por_devolver` REEMPLAZA al viejo `rechazada` (feature 48): la rechazada sale de ese
    // estado solo al aprobar el cierre. Feature 100/T4.1/R12: `devuelta` sigue listandose para
    // "Recuperar a bodega".
    const rows = await this.repo.findRecepcionSateliteByZona(zonaId, [
      ORIGEN_RECEPCION,
      ESTADO_RECIBIDA,
      ESTADO_POR_DEVOLVER,
      ESTADO_EN_TRANSITO_CENTRAL,
      ESTADO_DEVUELTA,
      ESTADO_ASIGNADA, // Feature 149/T6.3/R35
    ]); // R6/R8 + Feature 139/R21 + Feature 100/R12 + Feature 149/R35

    // Feature 160 (R12/R13/R15): UN SOLO lote con la union de los ids de los CINCO grupos, ya
    // acotados a la zona del actor por `findRecepcionSateliteByZona`. Cinco llamadas (una por
    // grupo) serian un incumplimiento gratuito de R12. Sin filas -> 0 consultas (R13).
    const intentos = await this.historial.contarIntentosEnLote(rows.map((r) => r.id));

    const porRecibir: RecepcionSateliteDTO[] = [];
    const recibidas: RecepcionSateliteDTO[] = [];
    const porDevolver: RecepcionSateliteDTO[] = []; // Feature 139/R21: por_devolver (accionable)
    const enTransitoACentral: RecepcionSateliteDTO[] = []; // Feature 139/R21: en transito (informativo)
    const devueltas: RecepcionSateliteDTO[] = []; // Feature 100/T4.1/R12
    const asignadas: RecepcionSateliteDTO[] = []; // Feature 149/T6.3/R35 (por_recoger)
    let zonaNombre: string | null = null;
    for (const row of rows) {
      zonaNombre = row.zonaNombre; // derivado de orden.zonaId (misma zona para todas)
      // Feature 160 (R14/R19): `?? 0` — el `0` SIEMPRE se expone, no se omite.
      const dto = { ...toDTO(row), intentosEntrega: intentos.get(row.id) ?? 0 };
      if (row.estatusValue === ORIGEN_RECEPCION) porRecibir.push(dto);
      else if (row.estatusValue === ESTADO_RECIBIDA) recibidas.push(dto);
      else if (row.estatusValue === ESTADO_POR_DEVOLVER) porDevolver.push(dto);
      else if (row.estatusValue === ESTADO_EN_TRANSITO_CENTRAL) enTransitoACentral.push(dto);
      else if (row.estatusValue === ESTADO_DEVUELTA) devueltas.push(dto);
      else if (row.estatusValue === ESTADO_ASIGNADA) asignadas.push(dto); // feature 149/R35
    }
    return {
      status: "ok",
      porRecibir,
      recibidas,
      porDevolver,
      enTransitoACentral,
      devueltas,
      asignadas,
      zonaNombre,
      sinZona: false,
    };
  }

  /**
   * Feature 170 — FASE 2 (T K.1, R40/R41/R44/R45/R51) — la pagina del listado «Órdenes de la
   * bodega», con los TRES filtros resueltos aqui y no en el navegador.
   *
   * **Que cambia de verdad.** Hasta hoy la pantalla recibia el conjunto entero de la zona y
   * cruzaba estado ∧ canton ∧ distrito con `Array.filter`. Bajo paginacion ese filtro solo
   * veria la pagina: el usuario creeria estar filtrando su bodega y estaria filtrando 25
   * filas. Por eso el cruce se muda aqui, DELANTE del recorte, y el `total` que sale es el del
   * conjunto filtrado (R41) — el numero que la pantalla necesita para paginar y contar.
   *
   * **Que NO cambia.** El acotamiento: guard de rol (R3/R17) antes de tocar nada y zona
   * resuelta desde `usuario.zona_id` (R4). Los filtros solo pueden ESTRECHAR ese conjunto:
   * `estadosDelListado` interseca contra la lista blanca de los cinco estados, asi que ni un
   * `estados` inventado ni un canton de otra provincia amplian el alcance (R44). Sin zona no
   * se consulta la base: pagina vacia.
   */
  async listarOrdenesBodegaPaginado(
    input: ListarOrdenesBodegaPaginadoInput,
    actor: Actor,
  ): Promise<ListarOrdenesBodegaPaginadoServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R3/R17

    const zonaId = await this.repo.findUsuarioZonaId(actor.usuarioId); // R4
    if (zonaId === null) {
      // R5: el rol tiene acceso al modulo, lo que no tiene es alcance. Sin una consulta.
      return { status: "ok", items: [], page: input.page, pageSize: input.pageSize, total: 0 };
    }

    const { items: rows, total } = await this.repo.findRecepcionSatelitePaginada(
      {
        zonaId,
        estatusValues: estadosDelListado(input.estados),
        cantonNombres: input.cantones,
        distritoNombres: input.distritos,
      },
      rangoDePagina(input),
    );

    // Feature 160 (R12/R13/R15): UN SOLO lote, ahora con los ids de la PAGINA. Sin filas -> 0
    // consultas. El criterio de intentos es el mismo que el del listado sin paginar.
    const intentos = await this.historial.contarIntentosEnLote(rows.map((r) => r.id));

    return {
      status: "ok",
      items: rows.map((row) => ({
        ...toDTO(row),
        intentosEntrega: intentos.get(row.id) ?? 0, // R14/R19: el `0` SIEMPRE se expone
      })),
      page: input.page,
      pageSize: input.pageSize,
      total, // R41: el total del CONJUNTO filtrado, nunca `items.length`
    };
  }

  /**
   * Feature 170 — FASE 2 (T K.2, R44/R46) — las opciones de canton y distrito del CONJUNTO
   * del actor, independientes del recorte de pagina.
   *
   * Hoy esas opciones se derivan del array que la pantalla ya tiene cargado
   * (`construirFiltrosSatelite(ordenes)`). Con una pagina, derivarlas de `items` reduciria el
   * desplegable a los cantones de las 25 filas visibles: el usuario perderia opciones sin
   * enterarse y, peor, creeria que su bodega no tiene ordenes en el canton que busca.
   *
   * Se reusan `derivarCantones`/`derivarDistritos` —las MISMAS funciones que la pantalla usa—
   * sobre los pares distintos del conjunto: mismas etiquetas, mismo desempate de homonimos,
   * mismo orden alfabetico. Acotado por rol y zona igual que el listado (R44).
   */
  async obtenerCatalogoFiltros(
    actor: Actor,
  ): Promise<ObtenerCatalogoFiltrosSateliteServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R3/R17

    const zonaId = await this.repo.findUsuarioZonaId(actor.usuarioId); // R4
    if (zonaId === null) return { status: "ok", catalogo: { cantones: [], distritos: [] } };

    // El catalogo se deriva SIEMPRE de los cinco estados del listado: si se derivara de la
    // seleccion vigente, elegir un estado borraria cantones del desplegable.
    const geo = await this.repo.findRecepcionSateliteGeoByZona(zonaId, [
      ...ESTADOS_BODEGA_SATELITE,
    ]);

    const cantones = derivarCantones(geo);
    return {
      status: "ok",
      catalogo: {
        cantones,
        distritos: cantones.flatMap((canton) =>
          derivarDistritos(geo, canton.value).map((distrito) => ({
            ...distrito,
            parentValue: canton.value,
          })),
        ),
      },
    };
  }

  async recibir(numGuia: number, actor: Actor): Promise<RecibirServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R17

    const zonaId = await this.repo.findUsuarioZonaId(actor.usuarioId); // R4
    if (zonaId === null) return { status: "sin_zona" }; // R5

    // El QR codifica `/paquete/<numGuia>`: la orden se resuelve por `num_guia`
    // (UNIQUE); el `id` sale de la fila para la transicion guardada.
    const row = await this.repo.findByNumGuiaForTransicion(numGuia);
    // R15: inexistente o borrada -> no_encontrada, sin efectos.
    if (!row || row.deletedAt !== null) return { status: "no_encontrada" };
    const ordenId = row.id;
    // R12: orden de otra zona -> zona_ajena, sin efectos.
    if (row.zonaId !== zonaId) return { status: "zona_ajena" };
    // R14: ya recibida (misma zona) -> idempotente, sin escribir.
    if (row.estatusValue === ESTADO_RECIBIDA) return { status: "ya_recibida" };
    // R13: origen distinto de en_ruta_bodega_satelite -> estado_invalido, sin efectos.
    if (row.estatusValue !== ORIGEN_RECEPCION) {
      return { status: "estado_invalido", estado: row.estatusValue };
    }

    const destinoId = await this.repo.findEstatusIdByValue(ESTADO_RECIBIDA);
    if (destinoId === null) {
      return {
        status: "validation_error",
        fieldErrors: { estatus: ["catalogo de estados incompleto (seed pendiente)"] },
      };
    }

    // R11/R18: transicion atomica guardada por estado de origen + zona.
    // Feature 49/#6 (R14): actor = el adminSatelite; destino en_bodega_satelite.
    const ok = await this.repo.recibirEnSatelite(ordenId, zonaId, destinoId, {
      actorUsuarioId: actor.usuarioId,
      origenTipo: "recepcion_satelite",
    });
    if (ok) return { status: "ok", ordenId, estado: ESTADO_RECIBIDA };

    // R18: race — otro escaneo la movio entre la lectura y la escritura. Re-lee y
    // decide: si ahora esta recibida -> ya_recibida (idempotente); si no -> conflict.
    const actual = await this.repo.findByNumGuiaForTransicion(numGuia);
    if (actual && actual.deletedAt === null && actual.estatusValue === ESTADO_RECIBIDA) {
      return { status: "ya_recibida" };
    }
    return { status: "conflict" };
  }

  async recibirLote(
    input: RecibirLoteInput,
    actor: Actor,
  ): Promise<RecibirLoteServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R17 (paridad)

    const zonaId = await this.repo.findUsuarioZonaId(actor.usuarioId); // R4
    if (zonaId === null) return { status: "sin_zona" }; // R5

    const ordenIds = distinct(input.ordenIds);
    if (ordenIds.length === 0) return { status: "ok", recibidas: 0 };

    // Origen (en_ruta_bodega_satelite) y destino (en_bodega_satelite) pre-resueltos:
    // el origen es necesario para la guarda del UPDATE en lote y para el historial.
    const [origenId, destinoId] = await Promise.all([
      this.repo.findEstatusIdByValue(ORIGEN_RECEPCION),
      this.repo.findEstatusIdByValue(ESTADO_RECIBIDA),
    ]);
    if (origenId === null || destinoId === null) {
      return {
        status: "validation_error",
        fieldErrors: { estatus: ["catalogo de estados incompleto (seed pendiente)"] },
      };
    }

    // Alcance por ZONA + estado de origen impuesto server-side en el WHERE guardado:
    // las ordenes ajenas a la zona o fuera de en_ruta_bodega_satelite se OMITEN (no
    // cuentan). Idempotente: re-ejecutar no vuelve a transicionar (ya no estan en el
    // origen). Atomico + append de historial en la MISMA tx (choke point feature 49).
    const recibidas = await this.repo.recibirLoteEnSatelite(
      ordenIds,
      zonaId,
      origenId,
      destinoId,
      { actorUsuarioId: actor.usuarioId, origenTipo: "recepcion_satelite" },
    );
    return { status: "ok", recibidas };
  }
}

function toDTO(row: RecepcionSateliteRow): RecepcionSateliteDTO {
  return {
    id: row.id,
    numGuia: row.numGuia,
    numRemision: row.numRemision,
    estatusValue: row.estatusValue,
    destinatario: row.destinatario,
    telefonoDest: row.telefonoDest,
    direccion: row.direccion,
    producto: row.producto,
    montoCobrar: row.montoCobrar,
    tiendaNombre: row.tiendaNombre,
    zonaNombre: row.zonaNombre,
    provinciaNombre: row.provinciaNombre,
    cantonNombre: row.cantonNombre,
    distritoNombre: row.distritoNombre,
    prioridad: row.prioridad, // feature 101/R9: propaga el flag al DTO (resalte de fila R8)
  };
}
