import { describe, it, expect, vi } from "vitest";

import type { CuentaTiendaValidacion } from "@/lib/interfaces/repositories/IUserRepository";
import { AbonoTiendaService } from "@/lib/services/AbonoTiendaService";

import { ADMIN, MAESTRO, PDF, TIENDA_ID, entrada, montar, registro } from "./_abono-tienda-montar";

/**
 * FICHA 457 / T4.1 — `AbonoTiendaService.registrar` con dobles (R2, R10, R11, R14–R18, R20, R21, R25,
 * R28–R30, R66). Lo que decide QUE FILAS se escriben contra Postgres lo prueban
 * `tests/integration/db/abono-tienda-457.test.ts` (por la action) y el de concurrencia. Aqui se mide el
 * ORDEN de los pasos, los desenlaces y lo que viaja a cada escritura.
 *
 * MUTACIONES que este archivo pone en rojo (design §13): (1) el servicio no llama a
 * `emitirIngresoDeAbono`; (5) quitar el candado (el orden de llamadas lo delata); (6) tope `>` → `>=`.
 */

describe("457/T4.1 — registrar: quien puede y con que tienda", () => {
  it("R2: sin acceso total (incluida la propia tienda) -> forbidden ANTES de leer nada ni subir nada", async () => {
    for (const actor of [
      { usuarioId: TIENDA_ID, rol: "adminTienda" as const },
      { usuarioId: "m", rol: "mensajero" as const },
      { usuarioId: "s", rol: "adminSatelite" as const },
    ]) {
      const m = montar();
      const r = await m.svc.registrar(entrada(), PDF, actor);
      expect(r).toEqual({ status: "forbidden" });
      expect(m.usuarioRepo.obtenerCuentaTienda).not.toHaveBeenCalled();
      expect(m.tiendaRepo.agregarSaldoPorTienda).not.toHaveBeenCalled();
      expect(m.storage.upload).not.toHaveBeenCalled();
      expect(m.runTx).not.toHaveBeenCalled();
    }
  });

  it("admin puede registrar igual que maestro", async () => {
    expect((await montar().svc.registrar(entrada(), null, ADMIN)).status).toBe("ok");
    expect((await montar().svc.registrar(entrada(), null, MAESTRO)).status).toBe("ok");
  });

  it.each([
    [null, "La tienda no existe"],
    [{ rol: "mensajero", estado: "activo" } as CuentaTiendaValidacion, "La cuenta elegida no es una tienda"],
  ] as const)("R10: tienda %j -> validation_error bajo tiendaId y NADA escrito ni subido", async (cuenta, msg) => {
    const m = montar({ cuenta });
    const r = await m.svc.registrar(entrada(), PDF, MAESTRO);
    expect(r).toEqual({ status: "validation_error", fieldErrors: { tiendaId: [msg] } });
    expect(m.storage.upload).not.toHaveBeenCalled();
    expect(m.runTx).not.toHaveBeenCalled();
  });

  it("R11 (D2): una tienda INACTIVA con deuda se admite: la deuda no desaparece al desactivar la cuenta", async () => {
    const m = montar({ cuenta: { rol: "adminTienda", estado: "inactivo" } as CuentaTiendaValidacion });
    const r = await m.svc.registrar(entrada(), null, MAESTRO);
    expect(r.status).toBe("ok");
    expect(m.runTx).toHaveBeenCalledTimes(1);
  });
});

describe("457/T4.1 — registrar: las reglas del dinero", () => {
  it("R14: con saldo en cero o a favor -> sin_deuda con el saldo, sin subir nada y sin escribir nada", async () => {
    for (const saldo of [
      { creditos: "1000.00", debitos: "1000.00" },
      { creditos: "5000.00", debitos: "1000.00" },
    ]) {
      const m = montar({ saldos: [saldo] });
      const r = await m.svc.registrar(entrada(), PDF, MAESTRO);
      expect(r.status).toBe("sin_deuda");
      if (r.status !== "sin_deuda") return;
      expect(r.saldo.saldo).toBe(
        saldo.creditos === "1000.00" ? "0.00" : "4000.00",
      );
      expect(m.storage.upload).not.toHaveBeenCalled(); // el pre-chequeo ahorra la subida
      expect(m.abonoRepo.crear).not.toHaveBeenCalled();
      expect(m.tiendaRepo.crearMovimientos).not.toHaveBeenCalled();
      expect(m.caja.emitirIngresoDeAbono).not.toHaveBeenCalled();
    }
  });

  it("R15: un monto por encima de la deuda -> excede con la DEUDA (valor absoluto, escala 2), sin escribir nada", async () => {
    const m = montar({ saldos: [{ creditos: "5000.00", debitos: "15000.00" }] });
    const r = await m.svc.registrar(entrada({ monto: "10000.01" }), PDF, MAESTRO);
    expect(r).toEqual({ status: "excede", deuda: "10000.00" });
    expect(m.storage.upload).not.toHaveBeenCalled();
    expect(m.abonoRepo.crear).not.toHaveBeenCalled();
    expect(m.caja.emitirIngresoDeAbono).not.toHaveBeenCalled();
  });

  it("R15/R66 (mutacion 6): pagar EXACTAMENTE la deuda entra y deja el saldo en 0,00; un centimo mas, no", async () => {
    const igual = montar({
      saldos: [
        { creditos: "5000.00", debitos: "15000.00" }, // pre-chequeo
        { creditos: "5000.00", debitos: "15000.00" }, // bajo el candado
        { creditos: "15000.00", debitos: "15000.00" }, // despues
      ],
    });
    const r = await igual.svc.registrar(entrada({ monto: "10000.00" }), null, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.saldo).toEqual({ creditos: "15000.00", debitos: "15000.00", saldo: "0.00", signo: "cero" });
    const mas = montar();
    expect(await mas.svc.registrar(entrada({ monto: "10000.01" }), null, MAESTRO)).toEqual({
      status: "excede",
      deuda: "10000.00",
    });
  });

  it("R16: el saldo que DECIDE se lee BAJO el candado: si cambio entre el pre-chequeo y el candado, manda el segundo", async () => {
    // Pre-chequeo: debe 10 000. Bajo el candado (otra operacion se colo antes): debe solo 2 000.
    const m = montar({
      saldos: [
        { creditos: "5000.00", debitos: "15000.00" },
        { creditos: "13000.00", debitos: "15000.00" },
      ],
    });
    const r = await m.svc.registrar(entrada({ monto: "8000.00" }), null, MAESTRO);
    expect(r).toEqual({ status: "excede", deuda: "2000.00" });
    // El candado se tomo ANTES de la lectura que decidio, y no se escribio nada.
    expect(m.orden).toEqual(["saldo", "candado", "saldo"]);
    expect(m.abonoRepo.crear).not.toHaveBeenCalled();
  });

  it("R16/R17 (mutaciones 1 y 5): candado ANTES de leer el saldo; luego documento, credito y ENTRADA EN LA CAJA, en ese orden; saldo al final", async () => {
    const m = montar();
    const r = await m.svc.registrar(entrada(), null, MAESTRO);
    expect(r.status).toBe("ok");
    expect(m.orden).toEqual(["saldo", "candado", "saldo", "crear", "tienda:abono_tienda", "caja:ingreso", "saldo"]);
    expect(m.candado.bloquearBeneficiario).toHaveBeenCalledWith(m.tx, { tipo: "tienda", tiendaId: TIENDA_ID });
    // Las tres escrituras reciben la MISMA transaccion.
    expect(vi.mocked(m.abonoRepo.crear).mock.calls[0][0]).toBe(m.tx);
    expect(m.tiendaRepo.crearMovimientos.mock.calls[0][0]).toBe(m.tx);
    expect(vi.mocked(m.caja.emitirIngresoDeAbono).mock.calls[0][0]).toBe(m.tx);
  });
});

describe("457/T4.1 — registrar: lo que viaja a cada escritura", () => {
  it("R5/R17: las cuatro escrituras llevan el MISMO string de escala 2 (redondeo HALF_UP una sola vez)", async () => {
    const m = montar();
    await m.svc.registrar(entrada({ monto: "4000.005" }), null, MAESTRO);
    const doc = vi.mocked(m.abonoRepo.crear).mock.calls[0][1];
    const tienda = m.tiendaRepo.crearMovimientos.mock.calls[0][1][0];
    const caja = vi.mocked(m.caja.emitirIngresoDeAbono).mock.calls[0][1];
    expect([doc.monto, tienda.monto, caja.monto]).toEqual(["4000.01", "4000.01", "4000.01"]);
    expect(typeof doc.monto).toBe("string");
  });

  it("R20: el credito y la entrada llevan el MISMO instante —el inicio del dia CR de la fecha REAL— y el documento el dia calendario", async () => {
    const m = montar();
    await m.svc.registrar(entrada({ fechaPago: "2026-09-20" }), null, MAESTRO);
    const doc = vi.mocked(m.abonoRepo.crear).mock.calls[0][1];
    const tienda = m.tiendaRepo.crearMovimientos.mock.calls[0][1][0];
    const caja = vi.mocked(m.caja.emitirIngresoDeAbono).mock.calls[0][1];
    expect(tienda.fechaMovimiento?.toISOString()).toBe("2026-09-20T06:00:00.000Z");
    expect(caja.fechaMovimiento.toISOString()).toBe("2026-09-20T06:00:00.000Z");
    expect(doc.fechaPago.toISOString()).toBe("2026-09-20T00:00:00.000Z");
    // Ni el reloj del servicio ni el DEFAULT de la columna: la fecha REAL del pago.
    expect(tienda.fechaMovimiento?.toISOString()).not.toBe("2026-09-24T18:00:00.000Z");
  });

  it("R17/R22: el credito es `abono_tienda` con origen el DOCUMENTO; la caja recibe el mismo id; nada mas se escribe", async () => {
    const m = montar();
    await m.svc.registrar(entrada(), null, MAESTRO);
    const doc = vi.mocked(m.abonoRepo.crear).mock.calls[0][1];
    const tienda = m.tiendaRepo.crearMovimientos.mock.calls[0][1];
    expect(tienda).toHaveLength(1);
    expect(tienda[0]).toMatchObject({
      tiendaId: TIENDA_ID,
      tipo: "credito",
      categoria: "abono_tienda",
      origenTipo: "abono_tienda",
      origenId: doc.id,
      registradoPor: MAESTRO.usuarioId,
    });
    const caja = vi.mocked(m.caja.emitirIngresoDeAbono).mock.calls[0][1];
    expect(caja.abonoId).toBe(doc.id);
    expect(caja.registradoPor).toBe(MAESTRO.usuarioId);
    expect(m.caja.emitirReversoDeAbono).not.toHaveBeenCalled();
    expect(m.tiendaRepo.crearMovimientos).toHaveBeenCalledTimes(1);
    expect(m.caja.emitirIngresoDeAbono).toHaveBeenCalledTimes(1);
  });

  it("R21: descripciones con motivo, metodo y referencia; la caja ademas con el NOMBRE de la tienda; sin uuid", async () => {
    const m = montar();
    await m.svc.registrar(entrada(), null, MAESTRO);
    const tienda = m.tiendaRepo.crearMovimientos.mock.calls[0][1][0];
    const caja = vi.mocked(m.caja.emitirIngresoDeAbono).mock.calls[0][1];
    expect(tienda.descripcion).toBe("Pago de lo que debía por los fletes de septiembre · SINPE · 123456");
    expect(caja.descripcion).toBe("Nuform · Pago de lo que debía por los fletes de septiembre · SINPE · 123456");
    for (const d of [tienda.descripcion ?? "", caja.descripcion]) {
      expect(d).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      expect(d).not.toContain(TIENDA_ID);
    }
  });

  it("R18: devuelve el saldo DESPUES, con su signo (sigue en contra si el pago fue parcial)", async () => {
    const m = montar({
      saldos: [
        { creditos: "5000.00", debitos: "15000.00" },
        { creditos: "5000.00", debitos: "15000.00" },
        { creditos: "9000.00", debitos: "15000.00" },
      ],
    });
    const r = await m.svc.registrar(entrada({ monto: "4000.00" }), null, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.saldo).toEqual({ creditos: "9000.00", debitos: "15000.00", saldo: "-6000.00", signo: "negativo" });
  });

  it("R48: el DTO no lleva la tienda por id, ni la clave, ni la ruta del comprobante", async () => {
    const m = montar();
    const r = await m.svc.registrar(entrada(), PDF, MAESTRO);
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(Object.keys(r.abono).sort()).toEqual(
      [
        "anulado",
        "fechaPago",
        "id",
        "metodo",
        "monto",
        "motivo",
        "referencia",
        "registradoAt",
        "registradoPorNombre",
        "tieneComprobante",
        "tiendaNombre",
      ].sort(),
    );
    expect(r.abono.tieneComprobante).toBe(true);
    expect(r.abono.monto).toBe("4000.00");
    const volcado = JSON.stringify(r);
    expect(volcado).not.toContain(TIENDA_ID);
    expect(volcado).not.toContain("abonos-tienda/");
    expect(volcado).not.toContain("11111111-1111-4111-8111-111111111111");
  });
});

describe("457/T4.1 — registrar: el comprobante (R26–R30)", () => {
  it("R27: se guarda en la carpeta propia con nombre aleatorio y sin ids, ANTES de la transaccion", async () => {
    const m = montar();
    await m.svc.registrar(entrada(), PDF, MAESTRO);
    const subida = vi.mocked(m.storage.upload).mock.calls[0][0];
    expect(subida.path).toMatch(/^abonos-tienda\/[0-9a-f-]{36}\.pdf$/);
    expect(subida.path).not.toContain(TIENDA_ID);
    expect(subida.path).not.toContain(MAESTRO.usuarioId);
    const doc = vi.mocked(m.abonoRepo.crear).mock.calls[0][1];
    expect(subida.path).not.toContain(doc.id);
    expect(doc.comprobantePath).toBe(subida.path);
    expect(doc.comprobanteContentType).toBe("application/pdf");
    // El orden: la subida ocurre antes de abrir la transaccion.
    expect(vi.mocked(m.storage.upload).mock.invocationCallOrder[0]).toBeLessThan(m.runTx.mock.invocationCallOrder[0]);
  });

  it("R26: un tipo no admitido o un tamano por encima del tope -> validation_error bajo comprobante, sin subir", async () => {
    const gif = montar();
    expect(await gif.svc.registrar(entrada(), { contentType: "image/gif", bytes: new Uint8Array([1]) }, MAESTRO)).toEqual({
      status: "validation_error",
      fieldErrors: { comprobante: ["El comprobante debe ser una imagen JPEG, PNG o WebP, o un PDF."] },
    });
    expect(gif.storage.upload).not.toHaveBeenCalled();
    expect(gif.runTx).not.toHaveBeenCalled();
    const grande = montar();
    const r = await grande.svc.registrar(
      entrada(),
      { contentType: "application/pdf", bytes: new Uint8Array(4 * 1024 * 1024 + 1) },
      MAESTRO,
    );
    expect(r).toEqual({ status: "validation_error", fieldErrors: { comprobante: ["El comprobante no puede pesar mas de 4 MB."] } });
    expect(grande.storage.upload).not.toHaveBeenCalled();
  });

  it("R28: si el comprobante no se puede guardar -> comprobante_no_guardado y NADA escrito", async () => {
    const m = montar({
      upload: async () => {
        throw new Error("bucket inexistente");
      },
    });
    expect(await m.svc.registrar(entrada(), PDF, MAESTRO)).toEqual({ status: "comprobante_no_guardado" });
    expect(m.runTx).not.toHaveBeenCalled();
  });

  it("R29: con el archivo ya guardado, un fallo de escritura lo RETIRA (y el error sube)", async () => {
    const m = montar({
      caja: {
        emitirIngresoDeAbono: async () => {
          throw new Error("caida de la caja");
        },
      },
    });
    await expect(m.svc.registrar(entrada(), PDF, MAESTRO)).rejects.toThrow("caida de la caja");
    const subida = vi.mocked(m.storage.upload).mock.calls[0][0];
    expect(m.storage.remove).toHaveBeenCalledWith([subida.path]);
  });

  it("R29: con el archivo ya guardado, un rechazo de negocio BAJO el candado (sin_deuda / excede) lo RETIRA", async () => {
    const sinDeuda = montar({
      saldos: [
        { creditos: "5000.00", debitos: "15000.00" }, // el pre-chequeo deja pasar
        { creditos: "15000.00", debitos: "15000.00" }, // bajo el candado ya no debe
      ],
    });
    const r1 = await sinDeuda.svc.registrar(entrada(), PDF, MAESTRO);
    expect(r1.status).toBe("sin_deuda");
    expect(sinDeuda.storage.remove).toHaveBeenCalledWith([vi.mocked(sinDeuda.storage.upload).mock.calls[0][0].path]);
    expect(sinDeuda.abonoRepo.crear).not.toHaveBeenCalled();

    const excede = montar({
      saldos: [
        { creditos: "5000.00", debitos: "15000.00" },
        { creditos: "14000.00", debitos: "15000.00" },
      ],
    });
    const r2 = await excede.svc.registrar(entrada(), PDF, MAESTRO);
    expect(r2).toEqual({ status: "excede", deuda: "1000.00" });
    expect(excede.storage.remove).toHaveBeenCalledWith([vi.mocked(excede.storage.upload).mock.calls[0][0].path]);
  });

  it("R25/R29: clave repetida -> ya_registrado con el ORIGINAL y el saldo de la tienda DEL ORIGINAL; el comprobante nuevo se retira", async () => {
    const m = montar({
      crear: async () => ({ status: "clave_repetida" as const }),
      original: registro({ id: "ab-original", tiendaId: "7f1c2d3e-0000-4000-8000-0000000000ff", monto: "2500.00" }),
    });
    const r = await m.svc.registrar(entrada({ monto: "9999.00" }), PDF, MAESTRO);
    expect(r.status).toBe("ya_registrado");
    if (r.status !== "ya_registrado") return;
    expect(r.abono.id).toBe("ab-original");
    expect(r.abono.monto).toBe("2500.00");
    expect(m.abonoRepo.obtenerPorClave).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    // El saldo que se devuelve es el de la tienda del documento ORIGINAL (la ultima lectura de saldo).
    expect(m.tiendaRepo.agregarSaldoPorTienda).toHaveBeenLastCalledWith("7f1c2d3e-0000-4000-8000-0000000000ff", {});
    const subida = vi.mocked(m.storage.upload).mock.calls[0][0];
    expect(m.storage.remove).toHaveBeenCalledWith([subida.path]);
    expect(m.tiendaRepo.crearMovimientos).not.toHaveBeenCalled();
    expect(m.caja.emitirIngresoDeAbono).not.toHaveBeenCalled();
  });

  it("R30: sin comprobante se registra igual, y con exito el comprobante NO se retira", async () => {
    const sin = montar();
    const r = await sin.svc.registrar(entrada(), null, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.abono.tieneComprobante).toBe(false);
    expect(sin.storage.upload).not.toHaveBeenCalled();
    const con = montar();
    await con.svc.registrar(entrada(), PDF, MAESTRO);
    expect(con.storage.remove).not.toHaveBeenCalled();
  });
});

describe("457 — R40: no hay forma de editar ni de deshacer una anulacion", () => {
  it("la superficie publica del servicio son TRES metodos", () => {
    const metodos = Object.getOwnPropertyNames(AbonoTiendaService.prototype)
      .filter((m) => m !== "constructor" && !m.startsWith("saldo"))
      .sort();
    expect(metodos).toEqual(["anular", "obtenerComprobante", "registrar"]);
  });
});
