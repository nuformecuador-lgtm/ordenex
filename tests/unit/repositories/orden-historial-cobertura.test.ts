import { describe, it, expect } from "vitest";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { GestionOrdenRepository } from "@/lib/repositories/GestionOrdenRepository";
import { LiberacionReprogramadaRepository } from "@/lib/repositories/LiberacionReprogramadaRepository";
import { CierreDiaRepository } from "@/lib/repositories/CierreDiaRepository";
import { DevolucionSlaRepository } from "@/lib/repositories/DevolucionSlaRepository";
import { RecuperacionBodegaRepository } from "@/lib/repositories/RecuperacionBodegaRepository";
import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import { IncidenteAdminRepository } from "@/lib/repositories/IncidenteAdminRepository";
import { ORDEN_HISTORIAL_ORIGEN_TIPO_SEED } from "@/lib/types/orden-historial";

// Feature 49 — T5.2 (R6): TEST DE COBERTURA. Enumera los 12 call-sites que ESCRIBEN
// `orden.estatus_id` (design §2) como el CONJUNTO CERRADO conocido, con su repositorio,
// simbolo y `origen_tipo`. Sirve de GUARDIA para el reviewer: si aparece un metodo nuevo
// que escribe estado sin instrumentar (o se renombra uno instrumentado), este test rompe.
// TypeScript no puede forzar el choke point (3 mecanismos, incl. SQL crudo); esta es la
// mitigacion del riesgo de "olvidar un call-site" (design §3.3).
//
// Feature 67: el mapa crece a 12 con el DESHACER (`CierreDiaRepository` /
// `anularGestionYDevolverAGestion` / `deshacer_gestion`). A diferencia de la 47 y la 48 —que
// reutilizaron `gestion` y `ajuste_estado`—, esta SI trae valor de enum nuevo + migracion +
// down: el proposito de la feature es el RASTRO, y reusar `gestion` haria que la linea de
// tiempo mostrara "en_bodega_central -> en_reparto, origen: gestion", indistinguible de una gestion
// real (F1.4-b).

// Repositorio -> clase (para verificar que cada simbolo existe como metodo real).
const REPOS = {
  OrdenRepository: OrdenRepository.prototype as unknown as Record<string, unknown>,
  GestionOrdenRepository: GestionOrdenRepository.prototype as unknown as Record<string, unknown>,
  LiberacionReprogramadaRepository:
    LiberacionReprogramadaRepository.prototype as unknown as Record<string, unknown>,
  CierreDiaRepository: CierreDiaRepository.prototype as unknown as Record<string, unknown>,
  DevolucionSlaRepository: DevolucionSlaRepository.prototype as unknown as Record<string, unknown>,
  RecuperacionBodegaRepository:
    RecuperacionBodegaRepository.prototype as unknown as Record<string, unknown>,
  CierresAdminRepository: CierresAdminRepository.prototype as unknown as Record<string, unknown>,
  IncidenteAdminRepository: IncidenteAdminRepository.prototype as unknown as Record<
    string,
    unknown
  >,
};

// Los puntos del mapa (design §2), 1 por familia de transicion.
//
// EL `n` ES UN IDENTIFICADOR ESTABLE, NO UN INDICE. Lo citan `design §2` y cuatro casos de este
// mismo archivo, que buscan por `n === 12 / 24 / 25 / 26`. Por eso, cuando un punto se retira,
// su numero SE JUBILA y queda un HUECO: renumerar seria mas barato aqui y mucho mas caro fuera.
// Hueco vigente: el #2 (`OrdenRepository.create`, `creacion_manual`), retirado el 2026-08-07
// al borrarse el alta manual individual por quedarse sin superficie. Ver
// `FAMILIAS_CON_PRODUCTOR_RETIRADO` mas abajo.
const PUNTOS_DE_ESCRITURA = [
  { n: 1, repo: "OrdenRepository", simbolo: "createManyOrdenes", origenTipo: "carga_masiva" },
  { n: 3, repo: "OrdenRepository", simbolo: "generarGuiaLote", origenTipo: "generacion_guia" },
  { n: 4, repo: "OrdenRepository", simbolo: "asignarBodegaLote", origenTipo: "asignacion_bodega" },
  { n: 5, repo: "OrdenRepository", simbolo: "rutearBodegaSateliteLote", origenTipo: "ruteo_satelite" },
  { n: 6, repo: "OrdenRepository", simbolo: "recibirEnSatelite", origenTipo: "recepcion_satelite" },
  { n: 7, repo: "OrdenRepository", simbolo: "asignarSateliteLote", origenTipo: "asignacion_satelite" },
  { n: 8, repo: "GestionOrdenRepository", simbolo: "recogerLote", origenTipo: "recoleccion" },
  // #9: feature 47 lo convierte en una transicion COMPUESTA cuando el resultado es `devuelta`:
  // ademas del append de la gestion (en_reparto->devuelta, actor=mensajero), emite en la MISMA
  // tx un SEGUIMIENTO automatico (actor=null/sistema) hacia la bodega responsable
  // (en_bodega_central/en_bodega_satelite, reintento) o hacia rechazada (escalado). Reutiliza el mismo
  // `origen_tipo=gestion` (sin enum nuevo, sin migracion, R14/R21): sigue siendo UN punto.
  { n: 9, repo: "GestionOrdenRepository", simbolo: "crearGestionYTransicionar", origenTipo: "gestion" },
  {
    n: 10,
    repo: "LiberacionReprogramadaRepository",
    simbolo: "liberarOrden",
    origenTipo: "liberacion_reprogramada",
  },
  // #11: feature 48 (F1.4-e) DOCUMENTA que este punto (`OrdenRepository.update`/`ajuste_estado`)
  // TAMBIEN sirve el RETORNO a la tienda de origen (`rechazada -> devolviendo_a_tienda` via
  // `DevolucionOrigenService`), igual que la 47 documento que #9 sirve el seguimiento. NO se
  // agrega un call-site nuevo ni un `origen_tipo` nuevo: sigue siendo UN punto `ajuste_estado`.
  { n: 11, repo: "OrdenRepository", simbolo: "update", origenTipo: "ajuste_estado" },
  // #12: feature 67 (F1.4-b). El DESHACER devuelve la orden a `en_reparto` reponiendo la
  // asignacion al mensajero autor, en la MISMA tx que anula la gestion (R20/R21/R22). Trae
  // `origen_tipo` NUEVO (`deshacer_gestion`, 12.º valor del enum) para que la auditoria
  // distinga un deshacer de una gestion real: la migracion `*_gestion_orden_anulacion` lo
  // añade y su `down.sql` recrea el enum sin el.
  {
    n: 12,
    repo: "CierreDiaRepository",
    simbolo: "anularGestionYDevolverAGestion",
    origenTipo: "deshacer_gestion",
  },
  // #13: feature 88 (D7). La carga por API crea la orden y, en la MISMA tx, fija su estado
  // inicial (`en_ruta_bodega_central`) con `origen_tipo` NUEVO `carga_api` (13.º valor del
  // enum) para distinguir el canal integrador de la `carga_masiva` por sesion en metricas. La
  // migracion `*_orden_historial_origen_tipo_carga_api` lo añade y su `down.sql` recrea el enum
  // sin el. Es un NUEVO call-site de escritura de estado (no reusa createManyOrdenes: ese no
  // asigna num_guia inmediato).
  {
    n: 13,
    repo: "OrdenRepository",
    simbolo: "createManyOrdenesConGuia",
    origenTipo: "carga_api",
  },
  // #14/#15: feature 99. El cron SLA DIFIERE el re-ruteo de una devolucion: `DevolucionSlaRepository`
  // libera (`devuelta -> en_bodega_central/en_bodega_satelite`, reintento) o escala (`devuelta -> rechazada`,
  // con gestion sintetica que dispara el ingreso de bodega). Dos `origen_tipo` propios (aditivos,
  // migracion `*_orden_historial_origen_tipo_sla_devuelta` + su down) para que la linea de tiempo
  // distinga el reintento del escalado. Reemplazan la 2.ª transicion que la 47 emitia en
  // `crearGestionYTransicionar` (#9): esa RELOCALIZACION mantiene el choke point completo.
  {
    n: 14,
    repo: "DevolucionSlaRepository",
    simbolo: "liberarDevueltaSla",
    origenTipo: "liberacion_devuelta_sla",
  },
  {
    n: 15,
    repo: "DevolucionSlaRepository",
    simbolo: "escalarDevueltaSla",
    origenTipo: "escalado_devuelta_sla",
  },
  // #16/#17: feature 100. Acciones MANUALES que RESUELVEN una novedad ANTES de que venza su ventana
  // SLA (99). Reprogramar (adminTienda): `GestionOrdenRepository.reprogramarDesdeDevuelta` transiciona
  // `devuelta -> reprogramada` con gestion sintetica (`reprogramacion_tienda`). Recuperar (bodega
  // dueña): `RecuperacionBodegaRepository.recuperarABodega` transiciona `devuelta ->
  // en_bodega_central/en_bodega_satelite` limpiando el mensajero (`recuperacion_manual`, molde de
  // `liberarDevueltaSla` pero con actor y origen_tipo propios, gate F1.4-Q2). Dos `origen_tipo`
  // propios (aditivos, migracion `*_orden_historial_origen_tipo_resolver_novedad` + su down) para que
  // la linea de tiempo distinga tienda vs bodega vs cron.
  {
    n: 16,
    repo: "GestionOrdenRepository",
    simbolo: "reprogramarDesdeDevuelta",
    origenTipo: "reprogramacion_tienda",
  },
  {
    n: 17,
    repo: "RecuperacionBodegaRepository",
    simbolo: "recuperarABodega",
    origenTipo: "recuperacion_manual",
  },
  // #18: feature 106. La tienda CANCELA una orden por API key: `OrdenRepository.cancelarViaApi`
  // transiciona `en_bodega_central`/`en_ruta_bodega_central -> devolviendo_a_tienda` (estado EXISTENTE,
  // reutilizado) en la MISMA tx que registra el historial. Trae `origen_tipo` NUEVO
  // (`cancelacion_api`, 18.º valor del enum, migracion `*_cancelacion_api_por_key` + su down) para
  // que la linea de tiempo distinga esa cancelacion de integrador de una devolucion real (ambas
  // acaban en `devolviendo_a_tienda`); el marcador semantico adicional es `motivo="cancelada por tienda"`.
  {
    n: 18,
    repo: "OrdenRepository",
    simbolo: "cancelarViaApi",
    origenTipo: "cancelacion_api",
  },
  // #19: feature 109. El corte diario transiciona `en_reparto -> sin_gestionar` DENTRO de
  // `CierreDiaRepository.crearCierre` (input opcional `corteSinGestionar`), en la MISMA tx, via el
  // choke point con actor null y `origen_tipo` NUEVO `corte_sin_gestionar` (19.º valor del enum,
  // migracion `*_orden_historial_origen_sin_gestionar` + su down). crearCierre ahora SI escribe
  // `orden.estatus_id` (ya no solo `gestion_orden.cierre_id`).
  {
    n: 19,
    repo: "CierreDiaRepository",
    simbolo: "crearCierre",
    origenTipo: "corte_sin_gestionar",
  },
  // #20: feature 109. Al APROBAR el cierre, `CierresAdminRepository.resolverCierre` libera las
  // `sin_gestionar` del mensajero a `en_bodega_central`/`en_bodega_satelite` por zona (limpia mensajero,
  // prioridad=true) en la MISMA tx, via el choke point con actor=admin y `origen_tipo` NUEVO
  // `liberacion_sin_gestionar` (20.º valor del enum, misma migracion). Solo en la rama `aprobado`
  // (rechazar NO libera).
  {
    n: 20,
    repo: "CierresAdminRepository",
    simbolo: "resolverCierre",
    origenTipo: "liberacion_sin_gestionar",
  },
  // #21: feature 138. La recepcion en la BODEGA CENTRAL transiciona
  // `en_ruta_bodega_central -> en_bodega_central` dentro de `OrdenRepository.recibirEnBodegaCentral`
  // (escaneo QR del maestro/admin), en la MISMA tx, via el choke point con actor = el que recibe y
  // `origen_tipo` NUEVO `recepcion_bodega_central` (21.º valor del enum, migracion
  // `*_orden_historial_origen_recepcion_bodega_central` + su down). Cierra el dead-end de la carga por
  // API; distinguible en la linea de tiempo de la recepcion satelite (`recepcion_satelite`) y de la
  // recepcion en origen (`ajuste_estado`). NO enlaza gestion; destino != devuelta -> no altera intentos.
  {
    n: 21,
    repo: "OrdenRepository",
    simbolo: "recibirEnBodegaCentral",
    origenTipo: "recepcion_bodega_central",
  },
  // #22: feature 139. Al APROBAR el cierre, `CierresAdminRepository.resolverCierre` TAMBIEN dispara
  // la devolucion de las `rechazada` del mensajero a `por_devolver` (satelite) / `por_devolver_a_tienda`
  // (central) por zona, en la MISMA tx (tras la liberacion #20), via el choke point con actor=admin y
  // `origen_tipo` NUEVO `devolucion_rechazada` (22.º valor del enum, migracion
  // `*_orden_historial_origen_devolucion_rechazada` + su down). Money-neutral (NO toca mensajero/prioridad).
  // Solo en la rama `aprobado`. Es el 2.º `origen_tipo` que escribe `resolverCierre` (junto al #20).
  {
    n: 22,
    repo: "CierresAdminRepository",
    simbolo: "resolverCierre",
    origenTipo: "devolucion_rechazada",
  },
  // #23: feature 149. `OrdenRepository.deshacerAsignacionLote` REVIERTE una asignacion/ruteo antes
  // de la recogida (por_recoger -> en_bodega_central/en_bodega_satelite; en_ruta_bodega_satelite ->
  // en_bodega_central) via el choke point, con actor = maestro/admin/adminSatelite y `origen_tipo`
  // NUEVO `deshacer_asignacion` (25.º valor del enum tras integrar los dos de la 154, migracion
  // `*_orden_historial_origen_deshacer_asignacion` + su down). NO enlaza gestion; destino !=
  // devuelta ni reprogramada -> fuera de las dos ramas del criterio de intento (160/R1). NO toca
  // num_guia ni prioridad.
  {
    n: 23,
    repo: "OrdenRepository",
    simbolo: "deshacerAsignacionLote",
    origenTipo: "deshacer_asignacion",
  },
  // #24: feature 158 (Q-G). La gestion con `resultado = incidente` transiciona
  // `en_reparto -> incidente` (arista #44, que la 154 declaro) y appendea con la familia
  // `incidente`, NO con `gestion`: la 154 dio de alta ese valor del enum y lo dejo «declarado
  // SIN PRODUCTOR hasta la 158», y esta feature es el productor. La familia sale por tanto de
  // `FAMILIAS_SIN_PRODUCTOR` y entra aqui, que es lo que el propio archivo ORDENA hacer.
  //
  // Comparte simbolo con el #9 (`crearGestionYTransicionar`) y eso es correcto: el mapa es de
  // FAMILIAS, no de simbolos, y ya hay precedente (el #20 y el #22 son los dos
  // `CierresAdminRepository.resolverCierre`). El metodo elige la familia por `resultado`.
  // NO enlaza gestion aparte (la fila nace con `gestion_orden_id` poblado) y su destino
  // (`incidente`) NO es `devuelta` ni `reprogramada`, asi que queda fuera de las dos ramas del
  // criterio de intento (160/R1) y no adelanta el escalado del cron SLA.
  {
    n: 24,
    repo: "GestionOrdenRepository",
    simbolo: "crearGestionYTransicionar",
    origenTipo: "incidente",
  },
  // #25/#26: feature 158, PR 2 (camino del ADMIN). `IncidenteAdminRepository.reportar`
  // transiciona la orden desde uno de los CINCO estados de bodega/transito interno a `incidente`
  // (aristas #48-#52) y `.resolver` la DEVUELVE a su estado de origen cuando el incidente se
  // rechaza o se retracta (aristas #54-#58). Las dos escriben `orden.estatus_id` y las dos
  // appendean por el choke point con la MISMA familia `incidente` que el punto #24: no se anade
  // ninguna familia nueva, y design §9.10 midio por que (un value nuevo obligaria a editar ~9
  // archivos de test de otras features).
  //
  // NO enlazan `gestion_orden_id`: un incidente del admin NO es una gestion (design §9.7), y su
  // destino (`incidente`, o uno de los cinco de bodega) NO es `devuelta` ni `reprogramada`, asi
  // que queda fuera de las dos ramas del criterio de intento (160/R1).
  {
    n: 25,
    repo: "IncidenteAdminRepository",
    simbolo: "reportar",
    origenTipo: "incidente",
  },
  {
    n: 26,
    repo: "IncidenteAdminRepository",
    simbolo: "resolver",
    origenTipo: "incidente",
  },
  // #27: feature 157 (ampliacion 2026-07-31). La asignacion de una recoleccion pasa a ser una
  // TRANSICION (`por_recolectar_en_tienda -> recolectando`) y por tanto deja rastro con familia
  // propia. Antes solo escribia el mensajero, sin mover el estado: por eso la misma orden se
  // podia reasignar indefinidamente. La REVERSION reusa `deshacer_asignacion` (#23), que ya
  // significa revertir una asignacion antes de la recogida. NO enlaza gestion; destino !=
  // devuelta/reprogramada -> fuera del criterio de intento (160/R1). NO toca num_guia,
  // prioridad ni asignado_at.
  {
    n: 27,
    repo: "OrdenRepository",
    simbolo: "asignarRecoleccionLote",
    origenTipo: "asignacion_recoleccion",
  },
  // #28: feature 239 (2026-08-19). El ANCLAJE de la devolucion. Al APROBAR el cierre, la orden
  // pasa del pre-estado a `devuelta` DENTRO de la misma transaccion, y esa transicion es la que
  // arranca la ventana de SLA y hace visible la novedad para la tienda. Familia PROPIA porque el
  // cron la busca por ella. Es el TERCER punto del mismo simbolo (`resolverCierre` ya emitia
  // `liberacion_sin_gestionar` y `devolucion_rechazada`): mismo precedente que #20/#22. ENLAZA la
  // gestion ancla (`gestion_orden_id` poblado), a diferencia de las otras dos.
  {
    n: 28,
    repo: "CierresAdminRepository",
    simbolo: "resolverCierre",
    origenTipo: "anclaje_devolucion",
  },
  // #29/#30: feature 235 (2026-08-19). El viaje de ida y vuelta de la AYUDA A LA TIENDA. Las DOS
  // familias comparten simbolo (`OrdenRepository.transicionarAyuda`, el PUNTO UNICO de escritura
  // que R8 exige) y eso es correcto: el mapa es de FAMILIAS, no de simbolos, y ya hay precedente
  // (#20/#22 y #24/#25/#26). Lo que las distingue es el SENTIDO del viaje, que es lo que el
  // historial tiene que poder decir.
  //
  // NINGUNA enlaza gestion: sus filas nacen con `gestion_orden_id` nulo porque no vienen de
  // ninguna. Y NINGUNA es VISITA REAL (235/R11): pedir auxilio no es un intento de entrega
  // fallido, asi que no sube el conteo, no adelanta el escalado del cron SLA (99) y no cobra el
  // rechazo (56) antes de tiempo.
  //
  // ⚠️ La VUELTA (`rescate_ayuda_tienda`) es ademas la clave de la excepcion de webhook firmada en
  // P4: es la unica familia que NO emite evento publico pese a que su estado destino (`en_reparto`)
  // si lo es. Ver `lib/types/webhook-eventos.ts`.
  {
    n: 29,
    repo: "OrdenRepository",
    simbolo: "transicionarAyuda",
    origenTipo: "solicitud_ayuda_tienda",
  },
  {
    n: 30,
    repo: "OrdenRepository",
    simbolo: "transicionarAyuda",
    origenTipo: "rescate_ayuda_tienda",
  },
  // Feature 237 (T5.1) — EL DESENLACE de la ayuda: `ayuda_tienda -> reprogramada | rechazada`,
  // registrado por el adminTienda dueño desde la pestaña de ayuda y ATRIBUIDO al mensajero de la
  // orden. Familia propia (`gestion_tienda_ayuda`) porque quien registra y quien queda atribuido
  // son personas distintas, y el historial es la unica evidencia de quien decidio el rechazo que
  // se le cobra a la tienda.
  //
  // UN solo punto para los DOS destinos: el destino lo decide el mapa `ESTATUS_POR_RESULTADO`
  // (239) dentro del mismo metodo, no una familia por resultado.
  {
    n: 31,
    repo: "GestionOrdenRepository",
    simbolo: "crearGestionDesdeAyuda",
    origenTipo: "gestion_tienda_ayuda",
  },
  // 💰 Feature 240 (T2.2) — EL RECHAZO MANUAL DE LA TIENDA: `devuelta -> rechazada`, decidido por
  // el adminTienda dueño y ATRIBUIDO al mensajero de la ultima `devuelta` vigente (igual que el
  // punto #17, la reprogramacion de escritorio, con la que comparte transaccion via el helper
  // `transicionarDesdeDevuelta`).
  //
  // Familia propia (`rechazo_tienda`) y NO la del cron: el par origen->destino es el MISMO que el
  // del punto #14 (`escalarDevueltaSla`), asi que sin familia propia nadie podria distinguir «lo
  // decidio una persona» de «se vencio el plazo» — y de esa distincion cuelgan la pestaña
  // «Rechazadas por plazo vencido» (102) y `esRechazoSla`.
  {
    n: 32,
    repo: "GestionOrdenRepository",
    simbolo: "rechazarDesdeDevuelta",
    origenTipo: "rechazo_tienda",
  },
  // #33: feature 266 (2026-08-23) — LA HABILITACION POR API KEY. `ayuda_tienda -> en_reparto`,
  // pedida por el INTEGRADOR en un lote del canal por API key. TERCER punto del mismo simbolo
  // (`OrdenRepository.transicionarAyuda`, el PUNTO UNICO de escritura de esa arista que 235/R8
  // exige, junto a #29 y #30) y eso es correcto: el mapa es de FAMILIAS, no de simbolos, y ya hay
  // precedente (#20/#22 y #24/#25/#26). El endpoint NO abre un segundo `updateMany` sobre
  // `orden.estatus_id`: el `Pick` del constructor de `ApiHabilitacionService` lo hace
  // estructuralmente imposible.
  //
  // FAMILIA PROPIA Y NO REUSO DE `rescate_ayuda_tienda` (design §7, A3) — era la opcion barata,
  // porque la arista es LA MISMA y ya existe una familia para ella. Se descarto porque borraria la
  // unica distincion entre «el mensajero pulso Recuperar / la tienda pulso Habilitar» y «el
  // integrador habilito por API», y `actor_usuario_id` NO la recupera: el usuario dedicado de la
  // key ES la tienda (`tienda_id = ownerId`), el MISMO sujeto que el `adminTienda` del boton.
  // Precedente literal: `rechazo_tienda` (#32) nacio como familia propia frente a
  // `escalado_devuelta_sla` por este mismo argumento.
  //
  // 💰 NO enlaza gestion (su fila nace con `gestion_orden_id` nulo) y NO es VISITA REAL (266/R26):
  // habilitar no es un intento de entrega —nadie fue a ninguna puerta—, asi que no sube el conteo,
  // no adelanta el escalado del cron SLA (99) y no cobra el rechazo (56) antes de tiempo.
  {
    n: 33,
    repo: "OrdenRepository",
    simbolo: "transicionarAyuda",
    origenTipo: "habilitacion_api",
  },
  // #34: FEATURE 276 (T9, R21/R22, 2026-08-24) — EL RECHAZO POR AGOTAMIENTO DE INTENTOS.
  //
  // `sin_gestionar -> rechazada`, al APROBAR el cierre, sobre una orden que el corte de la noche
  // barrio y que ya alcanzo el umbral. Absorbe la ficha 218.
  //
  // MISMO metodo que el punto #21 (`liberacion_sin_gestionar`), y eso es correcto: son las DOS
  // ramas del MISMO bloque de `resolverCierre`. Lo que las separa es la familia, que es lo unico
  // que permite despues distinguir «volvio a bodega» de «se termino y se cobro» sobre una fila de
  // historial que es su unica evidencia.
  {
    n: 34,
    repo: "CierresAdminRepository",
    simbolo: "resolverCierre",
    origenTipo: "rechazo_tope_intentos",
  },
] as const;

// Feature 158/PR2 — familias con MAS DE UN punto de escritura, declaradas UNA A UNA con su
// razon. Hasta la 158 el mapa cumplia «1 punto por familia» y ese caso era su guardia; el camino
// del ADMIN lo rompe a proposito: reusa la familia `incidente` que la 154 dio de alta, en vez de
// pedir un value nuevo del enum (design §9.10 midio el coste de lo contrario en ~9 archivos de
// test ajenos).
//
// La lista NO es un `default` permisivo: es explicita y se compara por IGUALDAD. Una familia que
// gane un segundo productor sin declararse aqui pone el archivo en rojo, que es exactamente lo
// que hacia el caso viejo.
const FAMILIAS_CON_VARIOS_PUNTOS = [
  {
    origenTipo: "incidente",
    puntos: 3,
    razon:
      "un solo hecho (el paquete se dana/pierde/roba) con TRES productores: la gestion del " +
      "mensajero (#24), el reporte del admin (#25) y su reversion (#26). La direccion se lee " +
      "de `estatus_destino_id`, no de la familia.",
  },
] as const;

// Feature 154 (R28) — FAMILIAS DECLARADAS SIN PRODUCTOR. La 154 da de alta dos valores del enum
// `orden_historial_origen_tipo` (`recoleccion_tienda`, `incidente`) SIN ningun call-site que los
// emita: el catalogo, el mapa de transiciones y las migraciones los declaran, pero el productor
// llega en las features 157 (escaner de recoleccion en tienda) y 158 (resultado `incidente` de la
// gestion). Por eso NO estan en `PUNTOS_DE_ESCRITURA`: meterlos ahi mentiria (el test exige que
// cada simbolo sea un metodo REAL que escribe estado).
//
// Esta lista es la EXCEPCION EXPLICITA, no un agujero: en cuanto la 157/158 instrumenten su
// call-site, la familia debe MOVERSE de aqui a `PUNTOS_DE_ESCRITURA`, y este archivo lo obliga
// (la union de ambos conjuntos tiene que cubrir el enum exactamente).
//
// Feature 158 (Q-G, 2026-07-30) — CUMPLIDO para `incidente`: su productor ya existe
// (`crearGestionYTransicionar` con `resultado = incidente`, punto #24), asi que la familia se
// MOVIO a `PUNTOS_DE_ESCRITURA`. Queda UNA sola excepcion, `recoleccion_tienda`, esperando a
// la 157. La lista no se vacia ni se borra: si la 157 nunca llega, esta linea lo sigue diciendo.
const FAMILIAS_SIN_PRODUCTOR = [
  { origenTipo: "recoleccion_tienda", productorFuturo: "feature 157 (recoleccion en tienda)" },
] as const;

// Familias cuyo productor EXISTIO y se RETIRO. No es lo mismo que `FAMILIAS_SIN_PRODUCTOR`
// —aquellas esperan a su feature; estas ya no esperan a nadie— y la diferencia importa para no
// leer un hueco como un olvido de implementacion.
//
// El valor NO se quita de `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED`, y esto es deliberado: es un valor
// sembrado en la base con FILAS HISTORICAS reales apuntandolo. Retirarlo del seed dejaria
// historial existente sin su familia. Lo que desaparece es la capacidad de producir filas
// NUEVAS con esa familia, no las que ya hay.
const FAMILIAS_CON_PRODUCTOR_RETIRADO = [
  {
    origenTipo: "creacion_manual",
    productorRetirado: "OrdenRepository.create (punto #2), borrado el 2026-08-07 con el alta " +
      "manual individual: nacio sin pantalla y nunca tuvo consumidor. Hoy TODAS las ordenes " +
      "nacen por lote (`carga_masiva` / `carga_api`).",
  },
] as const;

// Metodos que NO escriben `orden.estatus_id` (documentados para el reviewer, design §2):
// setOrdenEnGestion / liberarOrdenEnGestion (puntero de bloqueo 1-a-1). Existen pero NO
// forman parte del conjunto de escritura de estado -> NO instrumentan historial.
// Feature 67: las dos LECTURAS del deshacer (`findGestionParaDeshacer`,
// `findUltimaGestionNoAnuladaId`) tampoco escriben estado — solo consultan la gestion y su
// orden para que el service decida; la UNICA escritura del deshacer es el punto #12.
// `crearCierre` (37) escribe `gestion_orden.cierre_id`; feature 109 lo convierte ADEMAS en el
// punto #19 (`corte_sin_gestionar`) cuando recibe el input del corte -> ya NO va en esta lista.
// (`softDelete` figuraba aqui hasta el 2026-08-07; se borro del repositorio al retirarse el
// borrado logico de ordenes, que no tenia superficie.)
const NO_ESCRIBEN_ESTADO = [
  { repo: "GestionOrdenRepository", simbolo: "setOrdenEnGestion" },
  { repo: "GestionOrdenRepository", simbolo: "liberarOrdenEnGestion" },
  { repo: "CierreDiaRepository", simbolo: "findGestionParaDeshacer" }, // feature 67: solo query
  { repo: "CierreDiaRepository", simbolo: "findUltimaGestionNoAnuladaId" }, // feature 67: solo query
] as const;

describe("Feature 49 · T5.2 cobertura del choke point (R6)", () => {
  it("son EXACTAMENTE 33 puntos de escritura de estado (conjunto cerrado, design §2)", () => {
    // 30 - 1: el #2 se retiro el 2026-08-07. Feature 235 (2026-08-19): +2 (#29/#30, las dos
    // familias del viaje de la ayuda, con UN solo simbolo — el punto unico que R8 exige).
    expect(PUNTOS_DE_ESCRITURA).toHaveLength(33); // 2026-08-20 (237): +#31 · 2026-08-20 (240): +#32 · 2026-08-23 (266): +#33 · 2026-08-24 (276): +#34
    // Numeracion CRECIENTE y sin duplicados, con los numeros JUBILADOS declarados uno a uno.
    // No se exige contigüidad a proposito: `n` identifica el punto, no su posicion (ver la
    // cabecera del mapa). Un hueco no declarado aqui SI rompe.
    expect(PUNTOS_DE_ESCRITURA.map((p) => p.n)).toEqual([
      1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
      26, 27, 28, 29, 30, 31, 32, 33, 34,
    ]);
  });

  it("cada punto del mapa es un metodo REAL de su repositorio (rename/olvido -> rompe)", () => {
    for (const p of PUNTOS_DE_ESCRITURA) {
      const proto = REPOS[p.repo as keyof typeof REPOS];
      expect(typeof proto[p.simbolo], `${p.repo}.${p.simbolo} (#${p.n})`).toBe("function");
    }
  });

  it("las familias con productor + la 1 sin productor cubren EXACTAMENTE el enum (R23)", () => {
    // Feature 158/PR2: se compara por CONJUNTO de familias, no por lista de puntos, porque
    // desde el camino del ADMIN una familia (`incidente`) tiene TRES productores. La cobertura
    // del enum es lo que este caso mide y no se debilita: sigue exigiendo IGUALDAD exacta.
    const familiasDelMapa = [...new Set(PUNTOS_DE_ESCRITURA.map((p) => p.origenTipo))];
    const tiposSinProductor = FAMILIAS_SIN_PRODUCTOR.map((f) => f.origenTipo);
    const tiposRetirados = FAMILIAS_CON_PRODUCTOR_RETIRADO.map((f) => f.origenTipo);
    const tiposDelSeed = [...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED].sort();
    expect([...familiasDelMapa, ...tiposSinProductor, ...tiposRetirados].sort()).toEqual(
      tiposDelSeed,
    );
    // Y no se solapan: una familia o tiene productor instrumentado o no lo tiene, nunca las dos.
    for (const familia of [...tiposSinProductor, ...tiposRetirados]) {
      expect(familiasDelMapa as readonly string[]).not.toContain(familia);
    }
  });

  // Feature 154 (R28) + feature 158 (Q-G) — el caso NO se borra: se acota. La 154 declaro DOS
  // familias sin productor; la 158 le pone productor a `incidente` (punto #24), asi que queda
  // UNA. Si un repo empieza a emitir `recoleccion_tienda` antes de instrumentarla como punto
  // de escritura, este test se pone rojo exactamente igual que antes.
  it("feature 154/R28 + 158/Q-G: solo `recoleccion_tienda` sigue declarada y SIN productor", () => {
    expect(FAMILIAS_SIN_PRODUCTOR.map((f) => f.origenTipo)).toEqual(["recoleccion_tienda"]);
    const simbolosPorFamilia: string[] = PUNTOS_DE_ESCRITURA.map((p) => p.origenTipo);
    for (const familia of FAMILIAS_SIN_PRODUCTOR) {
      // Declarada en el enum fuente de verdad...
      expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED] as string[]).toContain(familia.origenTipo);
      // ...y sin ningun punto de escritura que la emita.
      expect(
        simbolosPorFamilia.filter((tipo) => tipo === (familia.origenTipo as string)),
        `${familia.origenTipo} ya tiene productor: muevelo a PUNTOS_DE_ESCRITURA (${familia.productorFuturo})`,
      ).toHaveLength(0);
    }
  });

  // Feature 158 (Q-G, R8): la familia `incidente` YA tiene productor y esta en el mapa con su
  // simbolo REAL. Este caso es la contraparte del de arriba: fija DONDE se emite, para que
  // renombrar el metodo o devolver el append a `origen_tipo = gestion` rompa aqui.
  it("feature 158/Q-G: `incidente` tiene productor (#24) y es la gestion del mensajero", () => {
    expect(FAMILIAS_SIN_PRODUCTOR.map((f) => f.origenTipo) as readonly string[]).not.toContain(
      "incidente",
    );
    const p24 = PUNTOS_DE_ESCRITURA.find((p) => p.n === 24);
    expect(p24).toMatchObject({
      repo: "GestionOrdenRepository",
      simbolo: "crearGestionYTransicionar",
      origenTipo: "incidente",
    });
    expect(typeof REPOS.GestionOrdenRepository.crearGestionYTransicionar).toBe("function");
    // El MISMO simbolo sirve DOS familias (`gestion` para los 4 resultados previos e
    // `incidente` para el quinto). Es deliberado y tiene precedente: el #20 y el #22 son los
    // dos `CierresAdminRepository.resolverCierre`.
    const puntosDelSimbolo = PUNTOS_DE_ESCRITURA.filter(
      (p) => p.simbolo === "crearGestionYTransicionar",
    ).map((p) => p.origenTipo);
    expect([...puntosDelSimbolo].sort()).toEqual(["gestion", "incidente"]);
  });

  // Feature 158/PR2 — el camino del ADMIN escribe estado en DOS puntos mas, los dos con la
  // familia `incidente`. Este caso fija QUE son y DONDE viven: si alguien los renombra, los
  // borra o hace que el reporte del admin appendee con otra familia, rompe aqui.
  it("feature 158/PR2: el camino del ADMIN aporta los puntos #25 (reporte) y #26 (reversion)", () => {
    expect(PUNTOS_DE_ESCRITURA.find((p) => p.n === 25)).toMatchObject({
      repo: "IncidenteAdminRepository",
      simbolo: "reportar",
      origenTipo: "incidente",
    });
    expect(PUNTOS_DE_ESCRITURA.find((p) => p.n === 26)).toMatchObject({
      repo: "IncidenteAdminRepository",
      simbolo: "resolver",
      origenTipo: "incidente",
    });
    expect(typeof REPOS.IncidenteAdminRepository.reportar).toBe("function");
    expect(typeof REPOS.IncidenteAdminRepository.resolver).toBe("function");
    // Y NO se anadio ninguna familia nueva al enum por el camino del admin: reusa la de la 154.
    expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED] as string[]).not.toContain("deshacer_incidente");
    expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED] as string[]).not.toContain("incidente_admin");
  });

  // Feature 158/PR2 — REESCRITO, no borrado. El caso afirmaba «cada familia aparece UNA sola vez
  // en el mapa». El camino del ADMIN lo rompe A PROPOSITO (reusa `incidente` en vez de pedir un
  // value nuevo del enum), asi que la regla pasa a ser: una familia puede tener varios puntos
  // SOLO si esta declarada en `FAMILIAS_CON_VARIOS_PUNTOS`, con su razon y su recuento EXACTO.
  // Conserva toda su fuerza: un duplicado no declarado sigue poniendo el archivo en rojo.
  it("cada familia aparece una sola vez, salvo las declaradas con varios puntos y su recuento", () => {
    const conteo = new Map<string, number>();
    for (const p of PUNTOS_DE_ESCRITURA) {
      conteo.set(p.origenTipo, (conteo.get(p.origenTipo) ?? 0) + 1);
    }
    const duplicadas = [...conteo.entries()]
      .filter(([, n]) => n > 1)
      .map(([familia, n]) => ({ origenTipo: familia, puntos: n }))
      .sort((a, b) => a.origenTipo.localeCompare(b.origenTipo));
    expect(duplicadas).toEqual(
      FAMILIAS_CON_VARIOS_PUNTOS.map((f) => ({ origenTipo: f.origenTipo, puntos: f.puntos })),
    );
  });

  it("documenta los metodos que NO escriben estado (no instrumentan historial)", () => {
    for (const m of NO_ESCRIBEN_ESTADO) {
      const proto = REPOS[m.repo as keyof typeof REPOS];
      // Existen (siguen siendo metodos reales)...
      expect(typeof proto[m.simbolo], `${m.repo}.${m.simbolo}`).toBe("function");
      // ...pero NO estan en el conjunto de escritura de estado.
      const simbolos: string[] = PUNTOS_DE_ESCRITURA.map((p) => p.simbolo);
      expect(simbolos.includes(m.simbolo)).toBe(false);
    }
  });

  // Feature 99 (R29/R30): INVIERTE la decision de la 47. El re-ruteo de la devolucion se DIFIRIO
  // al cron SLA (`DevolucionSlaRepository`), que YA NO reutiliza `gestion`: emite con sus DOS
  // origen_tipo propios (`liberacion_devuelta_sla`/`escalado_devuelta_sla`, puntos #14/#15). La
  // gestion del mensajero (`crearGestionYTransicionar`, #9) sigue usando `gestion` SOLO para la
  // transicion a `devuelta` (ya sin la 2.ª transicion de seguimiento que la 47 emitia).
  it("feature 99 (R29): el re-ruteo de la devolucion usa `origen_tipo` propios del cron, no `gestion`", () => {
    const tipos = [...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED] as string[];
    expect(tipos).toContain("liberacion_devuelta_sla");
    expect(tipos).toContain("escalado_devuelta_sla");
    // La gestion sigue existiendo (la transicion a `devuelta` la usa), pero YA NO carga el
    // reintento/escalado: eso vive en los dos puntos del cron (#14/#15).
    expect(tipos).toContain("gestion");
    const familiasDelCron = PUNTOS_DE_ESCRITURA.filter(
      (p) => p.repo === "DevolucionSlaRepository",
    ).map((p) => p.origenTipo);
    expect(familiasDelCron.sort()).toEqual(["escalado_devuelta_sla", "liberacion_devuelta_sla"]);
  });

  // Feature 48 (R9/F1.4-e recomendada): el retorno a la tienda (`rechazada -> devolviendo_a_tienda`)
  // REUTILIZA `origen_tipo=ajuste_estado` (#11), NO agrega un `origen_tipo` dedicado. Este test
  // guarda esa decision: si alguien introdujera `devolucion_origen`, deberia venir con su
  // migracion de enum + down y el mapa creceria un punto (F1.4-e alternativa).
  it("feature 48 (R9): el enum NO gana `devolucion_origen`; el retorno reutiliza `ajuste_estado`", () => {
    const tipos = [...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED] as string[];
    expect(tipos).not.toContain("devolucion_origen");
    // El retorno se emite con el mismo origen_tipo del ajuste de estado generico (#11).
    expect(tipos).toContain("ajuste_estado");
  });

  // Feature 67 (R21/F1.4-b): el deshacer SI añade el 12.º valor del enum, con su migracion y su
  // down.sql. Este test fija el punto #12 y su origen_tipo dedicado: si alguien lo reimplementara
  // reusando `gestion` (haciendo la auditoria ilegible) o escribiera `orden.estatus_id` fuera del
  // choke point, romperia aqui.
  it("feature 67 (R20/R21): el punto #12 es el deshacer, con `origen_tipo` dedicado `deshacer_gestion`", () => {
    const tipos = [...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED] as string[];
    expect(tipos).toContain("deshacer_gestion"); // 12.º valor (migracion *_gestion_orden_anulacion)
    // Invariante POSICIONAL, no de total: la feature 88 añadio `carga_api` como 13.º valor
    // (aditivo); lo que la 67 fija es que `deshacer_gestion` es el 12.º (indice 11).
    expect(tipos.indexOf("deshacer_gestion")).toBe(11);

    const p12 = PUNTOS_DE_ESCRITURA.find((p) => p.n === 12);
    expect(p12).toMatchObject({
      repo: "CierreDiaRepository",
      simbolo: "anularGestionYDevolverAGestion",
      origenTipo: "deshacer_gestion",
    });
    // Es un metodo REAL del repo (si se renombra sin actualizar el mapa, rompe).
    expect(typeof REPOS.CierreDiaRepository.anularGestionYDevolverAGestion).toBe("function");
    // Y NADIE mas usa `deshacer_gestion`: una sola familia, un solo punto.
    expect(PUNTOS_DE_ESCRITURA.filter((p) => p.origenTipo === "deshacer_gestion")).toHaveLength(1);
  });

  // Feature 67 (design §8) — CONVENCION para el reviewer: las gestiones NO se borran, se ANULAN
  // (`anulada_at`/`anulada_por`). Un `delete`/`deleteMany` sobre `gestion_orden` orfanaria filas
  // del historial y corromperia el derivador de intentos -> es rechazo automatico de review.
  // La FK `orden_historial_estado.gestion_orden_id` volvio a `ON DELETE RESTRICT` (F1.4-i) para
  // que la DB tambien lo impida, pero la convencion es la primera linea de defensa.
  it("feature 67 (design §8): ningun repo del mapa expone un borrado de gestiones", () => {
    for (const nombre of Object.keys(REPOS)) {
      const proto = REPOS[nombre as keyof typeof REPOS];
      expect(typeof proto.borrarGestion).not.toBe("function");
      expect(typeof proto.eliminarGestion).not.toBe("function");
    }
    // El deshacer ANULA: su simbolo lo dice (`anular...`), no `borrar...`.
    expect(typeof REPOS.CierreDiaRepository.anularGestionYDevolverAGestion).toBe("function");
  });
});
