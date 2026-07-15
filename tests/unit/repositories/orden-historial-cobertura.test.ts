import { describe, it, expect } from "vitest";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { GestionOrdenRepository } from "@/lib/repositories/GestionOrdenRepository";
import { LiberacionReprogramadaRepository } from "@/lib/repositories/LiberacionReprogramadaRepository";
import { CierreDiaRepository } from "@/lib/repositories/CierreDiaRepository";
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
// tiempo mostrara "en_bodega -> en_reparto, origen: gestion", indistinguible de una gestion
// real (F1.4-b).

// Repositorio -> clase (para verificar que cada simbolo existe como metodo real).
const REPOS = {
  OrdenRepository: OrdenRepository.prototype as unknown as Record<string, unknown>,
  GestionOrdenRepository: GestionOrdenRepository.prototype as unknown as Record<string, unknown>,
  LiberacionReprogramadaRepository:
    LiberacionReprogramadaRepository.prototype as unknown as Record<string, unknown>,
  CierreDiaRepository: CierreDiaRepository.prototype as unknown as Record<string, unknown>,
};

// Los 12 puntos del mapa (design §2), 1 por familia de transicion.
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
  // ademas del append de la gestion (en_reparto->devuelta, actor=mensajero), emite en la MISMA
  // tx un SEGUIMIENTO automatico (actor=null/sistema) hacia la bodega responsable
  // (en_bodega/en_bodega_satelite, reintento) o hacia rechazada (escalado). Reutiliza el mismo
  // `origen_tipo=gestion` (sin enum nuevo, sin migracion, R14/R21): sigue siendo UN punto.
  { n: 9, repo: "GestionOrdenRepository", simbolo: "crearGestionYTransicionar", origenTipo: "gestion" },
  {
    n: 10,
    repo: "LiberacionReprogramadaRepository",
    simbolo: "liberarOrden",
    origenTipo: "liberacion_reprogramada",
  },
  // #11: feature 48 (F1.4-e) DOCUMENTA que este punto (`OrdenRepository.update`/`ajuste_estado`)
  // TAMBIEN sirve el RETORNO a la tienda de origen (`rechazada -> devuelta_origen` via
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
] as const;

// Metodos que NO escriben `orden.estatus_id` (documentados para el reviewer, design §2):
// asignarMensajeroSugerido (solo mensajero_sugerido_id), softDelete (solo deleted_at),
// setOrdenEnGestion / liberarOrdenEnGestion (puntero de bloqueo 1-a-1). Existen pero NO
// forman parte del conjunto de escritura de estado -> NO instrumentan historial.
// Feature 67: las dos LECTURAS del deshacer (`findGestionParaDeshacer`,
// `findUltimaGestionNoAnuladaId`) tampoco escriben estado — solo consultan la gestion y su
// orden para que el service decida; la UNICA escritura del deshacer es el punto #12.
// `crearCierre` (37) escribe `gestion_orden.cierre_id`, NO `orden.estatus_id`.
const NO_ESCRIBEN_ESTADO = [
  { repo: "OrdenRepository", simbolo: "asignarMensajeroSugerido" },
  { repo: "OrdenRepository", simbolo: "softDelete" },
  { repo: "GestionOrdenRepository", simbolo: "setOrdenEnGestion" },
  { repo: "GestionOrdenRepository", simbolo: "liberarOrdenEnGestion" },
  { repo: "CierreDiaRepository", simbolo: "findGestionParaDeshacer" }, // feature 67: solo query
  { repo: "CierreDiaRepository", simbolo: "findUltimaGestionNoAnuladaId" }, // feature 67: solo query
  { repo: "CierreDiaRepository", simbolo: "crearCierre" }, // 37: escribe cierre_id, no estatus_id
] as const;

describe("Feature 49 · T5.2 cobertura del choke point (R6)", () => {
  it("son EXACTAMENTE 12 puntos de escritura de estado (conjunto cerrado, design §2)", () => {
    expect(PUNTOS_DE_ESCRITURA).toHaveLength(12);
    // numeracion 1..12 sin huecos ni duplicados.
    expect(PUNTOS_DE_ESCRITURA.map((p) => p.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("cada punto del mapa es un metodo REAL de su repositorio (rename/olvido -> rompe)", () => {
    for (const p of PUNTOS_DE_ESCRITURA) {
      const proto = REPOS[p.repo as keyof typeof REPOS];
      expect(typeof proto[p.simbolo], `${p.repo}.${p.simbolo} (#${p.n})`).toBe("function");
    }
  });

  it("los 12 origen_tipo cubren EXACTAMENTE el enum fuente de verdad (R23)", () => {
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

  // Feature 47 (R14/R21): el seguimiento del reintento/escalado REUTILIZA `origen_tipo=gestion`.
  // El diseno recomendado (design 47 §6/§7) NO agrega valores al enum, asi que NO hubo migracion
  // de enum y el recuento sigue siendo EXACTAMENTE 11. Este test guarda esa decision: si alguien
  // introdujera `reintento_devolucion`/`escalado_rechazo`, deberia venir con su migracion + down.
  it("feature 47 (R14/R21): el enum NO gana valores nuevos; el seguimiento reutiliza `gestion`", () => {
    const tipos = [...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED] as string[];
    expect(tipos).not.toContain("reintento_devolucion");
    expect(tipos).not.toContain("escalado_rechazo");
    // El seguimiento se emite con el mismo origen_tipo que la gestion (sin enum nuevo).
    expect(tipos).toContain("gestion");
  });

  // Feature 48 (R9/F1.4-e recomendada): el retorno a la tienda (`rechazada -> devuelta_origen`)
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
    expect(tipos).toHaveLength(12);

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
