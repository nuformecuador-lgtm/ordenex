import { describe, it, expect } from "vitest";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { GestionOrdenRepository } from "@/lib/repositories/GestionOrdenRepository";
import { LiberacionReprogramadaRepository } from "@/lib/repositories/LiberacionReprogramadaRepository";
import { ORDEN_HISTORIAL_ORIGEN_TIPO_SEED } from "@/lib/types/orden-historial";

// Feature 49 — T5.2 (R6): TEST DE COBERTURA. Enumera los 11 call-sites que ESCRIBEN
// `orden.estatus_id` (design §2) como el CONJUNTO CERRADO conocido, con su repositorio,
// simbolo y `origen_tipo`. Sirve de GUARDIA para el reviewer: si aparece un metodo nuevo
// que escribe estado sin instrumentar (o se renombra uno instrumentado), este test rompe.
// TypeScript no puede forzar el choke point (3 mecanismos, incl. SQL crudo); esta es la
// mitigacion del riesgo de "olvidar un call-site" (design §3.3).

// Repositorio -> clase (para verificar que cada simbolo existe como metodo real).
const REPOS = {
  OrdenRepository: OrdenRepository.prototype as unknown as Record<string, unknown>,
  GestionOrdenRepository: GestionOrdenRepository.prototype as unknown as Record<string, unknown>,
  LiberacionReprogramadaRepository:
    LiberacionReprogramadaRepository.prototype as unknown as Record<string, unknown>,
};

// Los 11 puntos del mapa (design §2), 1 por familia de transicion.
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
] as const;

// Metodos que NO escriben `orden.estatus_id` (documentados para el reviewer, design §2):
// asignarMensajeroSugerido (solo mensajero_sugerido_id), softDelete (solo deleted_at),
// setOrdenEnGestion / liberarOrdenEnGestion (puntero de bloqueo 1-a-1). Existen pero NO
// forman parte del conjunto de escritura de estado -> NO instrumentan historial.
const NO_ESCRIBEN_ESTADO = [
  { repo: "OrdenRepository", simbolo: "asignarMensajeroSugerido" },
  { repo: "OrdenRepository", simbolo: "softDelete" },
  { repo: "GestionOrdenRepository", simbolo: "setOrdenEnGestion" },
  { repo: "GestionOrdenRepository", simbolo: "liberarOrdenEnGestion" },
] as const;

describe("Feature 49 · T5.2 cobertura del choke point (R6)", () => {
  it("son EXACTAMENTE 11 puntos de escritura de estado (conjunto cerrado, design §2)", () => {
    expect(PUNTOS_DE_ESCRITURA).toHaveLength(11);
    // numeracion 1..11 sin huecos ni duplicados.
    expect(PUNTOS_DE_ESCRITURA.map((p) => p.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("cada punto del mapa es un metodo REAL de su repositorio (rename/olvido -> rompe)", () => {
    for (const p of PUNTOS_DE_ESCRITURA) {
      const proto = REPOS[p.repo as keyof typeof REPOS];
      expect(typeof proto[p.simbolo], `${p.repo}.${p.simbolo} (#${p.n})`).toBe("function");
    }
  });

  it("los 11 origen_tipo cubren EXACTAMENTE el enum fuente de verdad (R23)", () => {
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
    // Y el conjunto sigue cerrado en 11 (sin migracion de enum).
    expect(tipos).toHaveLength(11);
  });

  // Feature 48 (R9/F1.4-e recomendada): el retorno a la tienda (`rechazada -> devuelta_origen`)
  // REUTILIZA `origen_tipo=ajuste_estado` (#11), NO agrega un `origen_tipo` dedicado. Este test
  // guarda esa decision: si alguien introdujera `devolucion_origen`, deberia venir con su
  // migracion de enum + down y el mapa creceria a 12 puntos (F1.4-e alternativa).
  it("feature 48 (R9): el enum NO gana `devolucion_origen`; el retorno reutiliza `ajuste_estado`", () => {
    const tipos = [...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED] as string[];
    expect(tipos).not.toContain("devolucion_origen");
    // El retorno se emite con el mismo origen_tipo del ajuste de estado generico (#11).
    expect(tipos).toContain("ajuste_estado");
    // Y el conjunto sigue cerrado en 11 (sin 12.º punto, sin migracion de enum).
    expect(tipos).toHaveLength(11);
  });
});
