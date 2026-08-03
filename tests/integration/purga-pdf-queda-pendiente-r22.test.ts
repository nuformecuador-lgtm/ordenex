// Feature 178 — R22: `quedaPendiente` con el SERVICE REAL + el REPOSITORIO REAL sobre un doble de
// Prisma con ESTADO MUTABLE.
//
// POR QUE ESTE TEST EXISTE (y por que el unitario del service NO basta): a nivel de service el
// repositorio es un doble, asi que puede reproducir CUALQUIER semantica de "¿queda pendiente?" —
// incluida la equivocada. La unica forma de fijar el contrato de verdad es correr el repositorio
// REAL contra un estado que la propia purga MUTA, y comprobar que la respuesta se calcula sobre el
// estado POSTERIOR a la purga.
//
// EL BUG QUE ESTE TEST BLOQUEA: la version original consultaba
// `findFirst({ where: candidatas, skip: tope, take: 1 })`. Ese `skip` presupone que las `tope`
// cargas ya purgadas siguen casando el `where`, y NO lo hacen: `limpiarReferencias` acaba de dejar
// a NULL las cuatro columnas testigo, asi que perdieron la "referencia viva" (R8) y salieron del
// predicado. El `skip` descontaba entonces un SEGUNDO lote de candidatas TODAVIA VIVAS y devolvia
// `false` con backlog pendiente para todo P con `tope < P <= 2*tope`. Por eso el caso central es
// AL LIMITE (3 candidatas con tope 2): con margen (5 y tope 2) el bug pasaria desapercibido.
//
// El doble de Prisma INTERPRETA el `where` real que emite el repositorio (incluidas las tres ramas
// de referencia viva, `ordenes.some` entre ellas) y LANZA ante cualquier filtro que no sepa leer,
// para que no se vuelva laxo si el repositorio cambia. Honra `skip` a proposito: asi, si alguien
// reintroduce el `skip`, este test falla con una asercion limpia y no con un error del doble.
import { describe, it, expect, vi } from "vitest";
import { PurgaPdfCargasRepository } from "@/lib/repositories/PurgaPdfCargasRepository";
import { PurgaPdfCargasService } from "@/lib/services/PurgaPdfCargasService";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";

const OWNER = "store-1";
const AHORA = new Date("2026-08-03T09:00:00.000Z");
const DIA_MS = 24 * 60 * 60 * 1000;
const RETENCION_DIAS = 7;

// ---------------------------------------------------------------------------
// Estado mutable
// ---------------------------------------------------------------------------

interface CargaRow {
  id: string;
  createdAt: Date;
  downloadUrl: string | null;
  downloadStoragePath: string | null;
}

interface OrdenRow {
  id: string;
  cargaId: string | null;
  deletedAt: Date | null;
  downloadUrl: string | null;
  downloadStoragePath: string | null;
}

interface EstadoDatos {
  cargas: CargaRow[];
  ordenes: OrdenRow[];
}

// ---------------------------------------------------------------------------
// Doble de Prisma que INTERPRETA el `where` real (y revienta con lo que no conoce)
// ---------------------------------------------------------------------------

type Filtro = Record<string, unknown>;

function esNotNull(cond: unknown): boolean {
  return typeof cond === "object" && cond !== null && "not" in cond && (cond as Filtro).not === null;
}

function casaOrden(orden: OrdenRow, where: Filtro): boolean {
  return Object.entries(where).every(([clave, valor]) => {
    switch (clave) {
      case "OR":
        return (valor as Filtro[]).some((sub) => casaOrden(orden, sub));
      case "downloadStoragePath":
        if (!esNotNull(valor)) throw new Error(`filtro de orden no soportado: ${clave}`);
        return orden.downloadStoragePath !== null;
      case "downloadUrl":
        if (!esNotNull(valor)) throw new Error(`filtro de orden no soportado: ${clave}`);
        return orden.downloadUrl !== null;
      case "cargaId": {
        if (typeof valor === "string") return orden.cargaId === valor;
        const dentro = (valor as { in?: string[] }).in;
        if (!dentro) throw new Error(`filtro de orden no soportado: ${clave}`);
        return orden.cargaId !== null && dentro.includes(orden.cargaId);
      }
      default:
        throw new Error(`filtro de orden no soportado: ${clave}`);
    }
  });
}

function casaCarga(estado: EstadoDatos, carga: CargaRow, where: Filtro): boolean {
  return Object.entries(where).every(([clave, valor]) => {
    switch (clave) {
      case "OR":
        return (valor as Filtro[]).some((sub) => casaCarga(estado, carga, sub));
      case "createdAt": {
        const lte = (valor as { lte?: Date }).lte;
        if (!lte) throw new Error(`filtro de carga no soportado: ${clave}`);
        return carga.createdAt.getTime() <= lte.getTime();
      }
      case "downloadStoragePath":
        if (!esNotNull(valor)) throw new Error(`filtro de carga no soportado: ${clave}`);
        return carga.downloadStoragePath !== null;
      case "downloadUrl":
        if (!esNotNull(valor)) throw new Error(`filtro de carga no soportado: ${clave}`);
        return carga.downloadUrl !== null;
      case "ordenes": {
        // Rama `some` = EXISTS: la carga esta viva por los PDF de sus ordenes aunque ella no
        // conserve ninguna columna. Es la rama que mas importa en este test.
        const some = (valor as { some?: Filtro }).some;
        if (!some) throw new Error(`filtro de carga no soportado: ${clave}`);
        return estado.ordenes.filter((o) => o.cargaId === carga.id).some((o) => casaOrden(o, some));
      }
      default:
        throw new Error(`filtro de carga no soportado: ${clave}`);
    }
  });
}

interface ArgsConsulta {
  where: Filtro;
  orderBy?: unknown;
  take?: number;
  skip?: number;
  select?: Record<string, boolean>;
}

function aplicarData(
  fila: { downloadUrl: string | null; downloadStoragePath: string | null },
  data: Filtro,
): void {
  for (const [clave, valor] of Object.entries(data)) {
    if (clave === "downloadUrl") fila.downloadUrl = valor as string | null;
    else if (clave === "downloadStoragePath") fila.downloadStoragePath = valor as string | null;
    else throw new Error(`columna no esperada en el UPDATE de la purga: ${clave}`);
  }
}

type PrismaPurga = ConstructorParameters<typeof PurgaPdfCargasRepository>[0];

function prismaDoble(estado: EstadoDatos): PrismaPurga {
  const cargasOrdenadas = (where: Filtro): CargaRow[] =>
    estado.cargas
      .filter((c) => casaCarga(estado, c, where))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const cliente = {
    carga: {
      findMany: async (args: ArgsConsulta) =>
        cargasOrdenadas(args.where)
          .slice(args.skip ?? 0, args.take === undefined ? undefined : (args.skip ?? 0) + args.take)
          .map((c) => ({ id: c.id, downloadStoragePath: c.downloadStoragePath })),
      // Honra `skip` a proposito (ver cabecera): la mutacion del bug debe fallar por ASERCION.
      findFirst: async (args: ArgsConsulta) => {
        const primera = cargasOrdenadas(args.where).slice(args.skip ?? 0)[0];
        return primera ? { id: primera.id } : null;
      },
      update: async (args: { where: { id: string }; data: Filtro }) => {
        const carga = estado.cargas.find((c) => c.id === args.where.id);
        if (!carga) throw new Error(`carga inexistente en el doble: ${args.where.id}`);
        aplicarData(carga, args.data);
        return { id: carga.id };
      },
    },
    orden: {
      findMany: async (args: ArgsConsulta) =>
        estado.ordenes
          .filter((o) => casaOrden(o, args.where))
          .map((o) => ({ cargaId: o.cargaId, downloadStoragePath: o.downloadStoragePath })),
      updateMany: async (args: { where: Filtro; data: Filtro }) => {
        const afectadas = estado.ordenes.filter((o) => casaOrden(o, args.where));
        for (const o of afectadas) aplicarData(o, args.data);
        return { count: afectadas.length };
      },
    },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(cliente),
  };
  return cliente as unknown as PrismaPurga;
}

function storageDoble(objetos: Set<string>): IFileStorage {
  return {
    upload: vi.fn(),
    remove: vi.fn(async (paths: string[]) => {
      for (const p of paths) objetos.delete(p);
    }),
  };
}

// ---------------------------------------------------------------------------
// Fixture: N cargas candidatas + una joven que NO lo es (control del corte)
// ---------------------------------------------------------------------------

/**
 * Candidata `n`: cuanto MAYOR es `n`, mas VIEJA es (se purga antes). La mas nueva (n = 1) es la
 * que sobra cuando el tope corta, y esta viva SOLO por su orden: asi, la comprobacion de R22
 * depende de la rama `ordenes.some` del predicado.
 */
function montar(numCandidatas: number, tope: number) {
  const cargas: CargaRow[] = [];
  const ordenes: OrdenRow[] = [];
  const objetos = new Set<string>();

  for (let n = 1; n <= numCandidatas; n += 1) {
    const vivaSoloPorOrdenes = n === 1;
    const pathCarga = `${OWNER}/lote-${n}.pdf`;
    const pathOrden = `${OWNER}/orden-${n}.pdf`;
    cargas.push({
      id: `c${n}`,
      createdAt: new Date(AHORA.getTime() - (30 + n) * DIA_MS),
      downloadUrl: vivaSoloPorOrdenes ? null : `https://storage.test/${pathCarga}?firma`,
      downloadStoragePath: vivaSoloPorOrdenes ? null : pathCarga,
    });
    ordenes.push({
      id: `o${n}`,
      cargaId: `c${n}`,
      deletedAt: null,
      downloadUrl: `https://storage.test/${pathOrden}?firma`,
      downloadStoragePath: pathOrden,
    });
    if (!vivaSoloPorOrdenes) objetos.add(pathCarga);
    objetos.add(pathOrden);
  }

  // Control del corte (R5/R6): dentro de la ventana de retencion, NUNCA candidata. Si la purga
  // la contase, `quedaPendiente` seria true incluso en el caso "no queda nada".
  cargas.push({
    id: "c-joven",
    createdAt: new Date(AHORA.getTime() - 1 * DIA_MS),
    downloadUrl: `https://storage.test/${OWNER}/joven.pdf?firma`,
    downloadStoragePath: `${OWNER}/joven.pdf`,
  });
  ordenes.push({
    id: "o-joven",
    cargaId: "c-joven",
    deletedAt: null,
    downloadUrl: null,
    downloadStoragePath: `${OWNER}/joven-orden.pdf`,
  });
  objetos.add(`${OWNER}/joven.pdf`);
  objetos.add(`${OWNER}/joven-orden.pdf`);

  const estado: EstadoDatos = { cargas, ordenes };
  const storage = storageDoble(objetos);
  const service = new PurgaPdfCargasService(
    new PurgaPdfCargasRepository(prismaDoble(estado)),
    storage,
    () => ({
      PURGA_PDF_RETENCION_DIAS: RETENCION_DIAS,
      PURGA_PDF_MAX_CARGAS_POR_CORRIDA: tope,
    }),
  );

  return { estado, objetos, storage, service };
}

/** Cargas del estado que conservan alguna referencia viva (ellas o alguna de sus ordenes). */
function vivasCandidatas(estado: EstadoDatos): string[] {
  const corte = new Date(AHORA.getTime() - RETENCION_DIAS * DIA_MS);
  return estado.cargas
    .filter((c) => c.createdAt.getTime() <= corte.getTime())
    .filter(
      (c) =>
        c.downloadUrl !== null ||
        c.downloadStoragePath !== null ||
        estado.ordenes.some(
          (o) =>
            o.cargaId === c.id && (o.downloadUrl !== null || o.downloadStoragePath !== null),
        ),
    )
    .map((c) => c.id);
}

describe("Feature 178 R22 — quedaPendiente con service + repositorio REALES sobre estado mutable", () => {
  it("R22 (AL LIMITE): 3 candidatas con tope 2 -> purga 2 y declara quedaPendiente true", async () => {
    const { estado, service } = montar(3, 2);

    const resumen = await service.ejecutar(AHORA);

    expect(resumen.cargasPurgadas).toBe(2);
    expect(resumen.quedaPendiente).toBe(true);
    // Y el pendiente es REAL: queda exactamente una candidata viva, la mas nueva de las tres,
    // que ademas esta viva SOLO por su orden (rama `ordenes.some` del predicado).
    expect(vivasCandidatas(estado)).toEqual(["c1"]);
    expect(estado.cargas.find((c) => c.id === "c1")?.downloadStoragePath).toBeNull();
    expect(estado.ordenes.find((o) => o.id === "o1")?.downloadStoragePath).toBe(
      `${OWNER}/orden-1.pdf`,
    );
  });

  it("R22 (control, para que 'true' no sea trivial): 2 candidatas con tope 2 -> purga 2 y quedaPendiente false", async () => {
    const { estado, service } = montar(2, 2);

    const resumen = await service.ejecutar(AHORA);

    expect(resumen.cargasPurgadas).toBe(2);
    expect(resumen.quedaPendiente).toBe(false);
    // No queda ninguna candidata: la joven no cuenta (esta dentro de la ventana).
    expect(vivasCandidatas(estado)).toEqual([]);
  });

  it("R22: 4 candidatas con tope 2 -> purga 2 y quedaPendiente true con 2 vivas", async () => {
    const { estado, service } = montar(4, 2);

    const resumen = await service.ejecutar(AHORA);

    expect(resumen.cargasPurgadas).toBe(2);
    expect(resumen.quedaPendiente).toBe(true);
    // ASC: se purgaron las dos mas viejas (c4, c3); quedan c2 y c1.
    expect(vivasCandidatas(estado).sort()).toEqual(["c1", "c2"]);
  });

  it("R20/R22: la corrida siguiente termina el backlog y ya declara quedaPendiente false", async () => {
    const { estado, service } = montar(3, 2);

    const primera = await service.ejecutar(AHORA);
    expect(primera.quedaPendiente).toBe(true);

    const segunda = await service.ejecutar(AHORA);

    expect(segunda.cargasPurgadas).toBe(1);
    expect(segunda.quedaPendiente).toBe(false);
    expect(vivasCandidatas(estado)).toEqual([]);
    // La carga joven conserva intactas sus referencias: la purga nunca la toco (R6).
    expect(estado.cargas.find((c) => c.id === "c-joven")?.downloadStoragePath).toBe(
      `${OWNER}/joven.pdf`,
    );
    expect(estado.ordenes.find((o) => o.id === "o-joven")?.downloadStoragePath).toBe(
      `${OWNER}/joven-orden.pdf`,
    );
  });
});
