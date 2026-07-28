import { describe, it, expect } from "vitest";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { GestionOrdenRepository } from "@/lib/repositories/GestionOrdenRepository";
import { LiberacionReprogramadaRepository } from "@/lib/repositories/LiberacionReprogramadaRepository";
import { CierreDiaRepository } from "@/lib/repositories/CierreDiaRepository";
import { DevolucionSlaRepository } from "@/lib/repositories/DevolucionSlaRepository";
import { RecuperacionBodegaRepository } from "@/lib/repositories/RecuperacionBodegaRepository";
import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
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
// tiempo mostrara "en_bodega_central -> en_ruta, origen: gestion", indistinguible de una gestion
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
};

// Los 23 puntos del mapa (design §2), 1 por familia de transicion.
const PUNTOS_DE_ESCRITURA = [
  { n: 1, repo: "OrdenRepository", simbolo: "createManyOrdenes", origenTipo: "carga_masiva" },
  { n: 2, repo: "OrdenRepository", simbolo: "create", origenTipo: "creacion_manual" },
  { n: 3, repo: "OrdenRepository", simbolo: "generarGuiaLote", origenTipo: "generacion_guia" },
  { n: 4, repo: "OrdenRepository", simbolo: "asignarBodegaLote", origenTipo: "asignacion_bodega" },
  { n: 5, repo: "OrdenRepository", simbolo: "rutearBodegaSateliteLote", origenTipo: "ruteo_satelite" },
  { n: 6, repo: "OrdenRepository", simbolo: "recibirEnSatelite", origenTipo: "recepcion_satelite" },
  { n: 7, repo: "OrdenRepository", simbolo: "asignarSateliteLote", origenTipo: "asignacion_satelite" },
  { n: 8, repo: "GestionOrdenRepository", simbolo: "recogerLote", origenTipo: "recoleccion" },
  // #9: feature 47 lo convierte en una transicion COMPUESTA cuando el resultado es `devuelta`:
  // ademas del append de la gestion (en_ruta->devuelta, actor=mensajero), emite en la MISMA
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
  // #12: feature 67 (F1.4-b). El DESHACER devuelve la orden a `en_ruta` reponiendo la
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
  // #19: feature 109. El corte diario transiciona `en_ruta -> sin_gestionar` DENTRO de
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
  // NUEVO `deshacer_asignacion` (23.º valor del enum, migracion
  // `*_orden_historial_origen_deshacer_asignacion` + su down). NO enlaza gestion; destino !=
  // devuelta -> no altera intentos. NO toca num_guia ni prioridad.
  {
    n: 23,
    repo: "OrdenRepository",
    simbolo: "deshacerAsignacionLote",
    origenTipo: "deshacer_asignacion",
  },
] as const;

// Metodos que NO escriben `orden.estatus_id` (documentados para el reviewer, design §2):
// asignarMensajeroSugerido (solo mensajero_sugerido_id), softDelete (solo deleted_at),
// setOrdenEnGestion / liberarOrdenEnGestion (puntero de bloqueo 1-a-1). Existen pero NO
// forman parte del conjunto de escritura de estado -> NO instrumentan historial.
// Feature 67: las dos LECTURAS del deshacer (`findGestionParaDeshacer`,
// `findUltimaGestionNoAnuladaId`) tampoco escriben estado — solo consultan la gestion y su
// orden para que el service decida; la UNICA escritura del deshacer es el punto #12.
// `crearCierre` (37) escribe `gestion_orden.cierre_id`; feature 109 lo convierte ADEMAS en el
// punto #19 (`corte_sin_gestionar`) cuando recibe el input del corte -> ya NO va en esta lista.
const NO_ESCRIBEN_ESTADO = [
  { repo: "OrdenRepository", simbolo: "asignarMensajeroSugerido" },
  { repo: "OrdenRepository", simbolo: "softDelete" },
  { repo: "GestionOrdenRepository", simbolo: "setOrdenEnGestion" },
  { repo: "GestionOrdenRepository", simbolo: "liberarOrdenEnGestion" },
  { repo: "CierreDiaRepository", simbolo: "findGestionParaDeshacer" }, // feature 67: solo query
  { repo: "CierreDiaRepository", simbolo: "findUltimaGestionNoAnuladaId" }, // feature 67: solo query
] as const;

describe("Feature 49 · T5.2 cobertura del choke point (R6)", () => {
  it("son EXACTAMENTE 23 puntos de escritura de estado (conjunto cerrado, design §2)", () => {
    expect(PUNTOS_DE_ESCRITURA).toHaveLength(23);
    // numeracion 1..23 sin huecos ni duplicados.
    expect(PUNTOS_DE_ESCRITURA.map((p) => p.n)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
    ]);
  });

  it("cada punto del mapa es un metodo REAL de su repositorio (rename/olvido -> rompe)", () => {
    for (const p of PUNTOS_DE_ESCRITURA) {
      const proto = REPOS[p.repo as keyof typeof REPOS];
      expect(typeof proto[p.simbolo], `${p.repo}.${p.simbolo} (#${p.n})`).toBe("function");
    }
  });

  it("los 23 origen_tipo cubren EXACTAMENTE el enum fuente de verdad (R23)", () => {
    const tiposDelMapa = PUNTOS_DE_ESCRITURA.map((p) => p.origenTipo).sort();
    const tiposDelSeed = [...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED].sort();
    expect(tiposDelMapa).toEqual(tiposDelSeed);
  });

  it("cada familia (origen_tipo) aparece UNA sola vez en el mapa (1 punto por familia)", () => {
    const tipos = PUNTOS_DE_ESCRITURA.map((p) => p.origenTipo);
    expect(new Set(tipos).size).toBe(tipos.length);
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
