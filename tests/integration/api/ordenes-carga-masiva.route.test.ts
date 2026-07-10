import { describe, it, expect, vi } from "vitest";
import ExcelJS from "exceljs";
import type { RolValue } from "@prisma/client";
import { handleCargaMasiva, type CargaMasivaDeps } from "@/app/api/ordenes/carga-masiva/route";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IBulkOrdenService, BulkOrdenResult } from "@/lib/interfaces/services/IBulkOrdenService";
import type { BulkSummary } from "@/lib/types/carga-masiva";
import { cargaMasivaConfig } from "@/lib/config/carga-masiva";

const TIENDA: Actor = { usuarioId: "store1", rol: "adminTienda" };
const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "a1", rol: "admin" };
const MENSAJERO: Actor = { usuarioId: "msg1", rol: "mensajero" };
const DESCONOCIDO: Actor = { usuarioId: "x", rol: "invitado" as RolValue };

const REQUIRED_HEADER = "num_remision,destinatario,telefono,provincia,canton";

function csvFile(rows: string[], filename = "carga.csv"): File {
  const content = [REQUIRED_HEADER, ...rows].join("\r\n");
  return new File([content], filename, { type: "text/csv" });
}

async function xlsxFile(rows: string[][], filename = "carga.xlsx"): Promise<File> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Hoja 1");
  sheet.addRow(REQUIRED_HEADER.split(","));
  for (const row of rows) sheet.addRow(row);
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return new File([arrayBuffer], filename, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function formDataWithFile(file: File | null): FormData {
  const fd = new FormData();
  if (file) fd.append("file", file);
  return fd;
}

function requestWithFormData(formData: FormData): Request {
  return new Request("http://localhost/api/ordenes/carga-masiva", {
    method: "POST",
    body: formData,
  });
}

function okSummary(overrides: Partial<BulkSummary> = {}): BulkSummary {
  return {
    total: 1,
    creadas: 1,
    duplicadas: 0,
    conError: 0,
    filas: [{ fila: 1, numRemision: "REM-1", resultado: "creada", estatus: "en_preparacion" }],
    ...overrides,
  };
}

function fakeService(overrides: Partial<IBulkOrdenService> = {}): IBulkOrdenService {
  return {
    cargarMasiva: vi.fn().mockResolvedValue({ status: "ok", summary: okSummary() } satisfies BulkOrdenResult),
    ...overrides,
  };
}

function deps(actor: Actor | null, service: IBulkOrdenService): CargaMasivaDeps {
  return { getActor: async () => actor, bulkService: service };
}

describe("R10: sin sesion valida -> 401, sin procesar el archivo", () => {
  it("responde UNAUTHORIZED y no llama al service", async () => {
    const service = fakeService();
    const req = requestWithFormData(formDataWithFile(csvFile(["REM-1,Ana,099,Pichincha,Quito"])));

    const res = await handleCargaMasiva(req, deps(null, service));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("UNAUTHORIZED");
    expect(service.cargarMasiva).not.toHaveBeenCalled();
  });
});

describe("R11: roles distintos de adminTienda -> 403, sin procesar el archivo", () => {
  it.each([MAESTRO, ADMIN, MENSAJERO, DESCONOCIDO])("rol %o -> FORBIDDEN", async (actor) => {
    const service = fakeService();
    const req = requestWithFormData(formDataWithFile(csvFile(["REM-1,Ana,099,Pichincha,Quito"])));

    const res = await handleCargaMasiva(req, deps(actor, service));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("FORBIDDEN");
    expect(service.cargarMasiva).not.toHaveBeenCalled();
  });
});

describe("R9/R24: adminTienda -> procede, delega en el service con el actor", () => {
  it("200 y el service recibe el actor (tienda_id lo fija BulkOrdenService)", async () => {
    const service = fakeService();
    const req = requestWithFormData(formDataWithFile(csvFile(["REM-1,Ana,099,Pichincha,Quito"])));

    const res = await handleCargaMasiva(req, deps(TIENDA, service));

    expect(res.status).toBe(200);
    expect(service.cargarMasiva).toHaveBeenCalledWith(expect.any(Array), TIENDA);
    const rowsArg = (service.cargarMasiva as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(rowsArg).toHaveLength(1);
    expect(rowsArg[0].num_remision).toBe("REM-1");
  });
});

describe("R12: sin archivo -> 422 con fieldErrors.file", () => {
  it("no llama al service", async () => {
    const service = fakeService();
    const req = requestWithFormData(formDataWithFile(null));

    const res = await handleCargaMasiva(req, deps(TIENDA, service));

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.details.fieldErrors).toHaveProperty("file");
    expect(service.cargarMasiva).not.toHaveBeenCalled();
  });
});

describe("R13: tipo de archivo no soportado -> 422", () => {
  it("extension .txt es rechazada antes de parsear", async () => {
    const service = fakeService();
    const file = new File(["contenido"], "carga.txt", { type: "text/plain" });
    const req = requestWithFormData(formDataWithFile(file));

    const res = await handleCargaMasiva(req, deps(TIENDA, service));

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.details.fieldErrors).toHaveProperty("file");
    expect(service.cargarMasiva).not.toHaveBeenCalled();
  });
});

describe("R16: cabeceras obligatorias ausentes -> 422", () => {
  it("archivo sin la columna canton", async () => {
    const service = fakeService();
    const content = ["num_remision,destinatario,telefono,provincia", "REM-1,Ana,099,Pichincha"].join(
      "\r\n",
    );
    const file = new File([content], "carga.csv", { type: "text/csv" });
    const req = requestWithFormData(formDataWithFile(file));

    const res = await handleCargaMasiva(req, deps(TIENDA, service));

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.details.fieldErrors).toHaveProperty("headers");
    expect(service.cargarMasiva).not.toHaveBeenCalled();
  });
});

describe("R17: archivo sin filas de datos -> 422", () => {
  it("solo cabecera", async () => {
    const service = fakeService();
    const req = requestWithFormData(formDataWithFile(csvFile([])));

    const res = await handleCargaMasiva(req, deps(TIENDA, service));

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.details.fieldErrors).toHaveProperty("file");
    expect(service.cargarMasiva).not.toHaveBeenCalled();
  });
});

describe("R28: excede el numero maximo de filas -> 422", () => {
  it("archivo con mas filas que MAX_ROWS", async () => {
    const service = fakeService();
    const rows = Array.from(
      { length: cargaMasivaConfig.MAX_ROWS + 1 },
      (_, i) => `REM-${i},Ana,099,Pichincha,Quito`,
    );
    const req = requestWithFormData(formDataWithFile(csvFile(rows)));

    const res = await handleCargaMasiva(req, deps(TIENDA, service));

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.details.fieldErrors).toHaveProperty("file");
    expect(service.cargarMasiva).not.toHaveBeenCalled();
  }, 20000);
});

describe("R30: CSV valido -> 200 con el resumen {total,creadas,duplicadas,conError,filas[]}", () => {
  it("devuelve exactamente la forma esperada", async () => {
    const service = fakeService();
    const req = requestWithFormData(formDataWithFile(csvFile(["REM-1,Ana,099,Pichincha,Quito"])));

    const res = await handleCargaMasiva(req, deps(TIENDA, service));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(okSummary());
  });
});

describe("R25: remision existente -> fila duplicada con estatus", () => {
  it("propaga el resumen del service con la fila duplicada", async () => {
    const summary = okSummary({
      creadas: 0,
      duplicadas: 1,
      filas: [{ fila: 1, numRemision: "REM-1", resultado: "duplicada", estatus: "entregada" }],
    });
    const service = fakeService({
      cargarMasiva: vi.fn().mockResolvedValue({ status: "ok", summary }),
    });
    const req = requestWithFormData(formDataWithFile(csvFile(["REM-1,Ana,099,Pichincha,Quito"])));

    const res = await handleCargaMasiva(req, deps(TIENDA, service));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.filas[0]).toMatchObject({ resultado: "duplicada", estatus: "entregada" });
  });
});

describe("R15: XLSX valido -> 200", () => {
  it("acepta .xlsx y delega en el service", async () => {
    const service = fakeService();
    const file = await xlsxFile([["REM-1", "Ana", "099", "Pichincha", "Quito"]]);
    const req = requestWithFormData(formDataWithFile(file));

    const res = await handleCargaMasiva(req, deps(TIENDA, service));

    expect(res.status).toBe(200);
    expect(service.cargarMasiva).toHaveBeenCalledTimes(1);
  });
});

describe("R32: la respuesta nunca expone deleted_at ni datos internos", () => {
  it("el resumen no contiene deletedAt/passwordHash", async () => {
    const service = fakeService();
    const req = requestWithFormData(formDataWithFile(csvFile(["REM-1,Ana,099,Pichincha,Quito"])));

    const res = await handleCargaMasiva(req, deps(TIENDA, service));
    const text = await res.text();

    expect(text).not.toContain("deletedAt");
    expect(text).not.toContain("deleted_at");
    expect(text).not.toContain("passwordHash");
    expect(text).not.toContain("password_hash");
  });
});

describe("R31: fallo interno inesperado -> AppErrorShape 500", () => {
  it("el service rechaza con un error desconocido", async () => {
    const service = fakeService({
      cargarMasiva: vi.fn().mockRejectedValue(new Error("boom")),
    });
    const req = requestWithFormData(formDataWithFile(csvFile(["REM-1,Ana,099,Pichincha,Quito"])));

    const res = await handleCargaMasiva(req, deps(TIENDA, service));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("INTERNAL");
    expect(body.status).toBe("error");
  });
});
