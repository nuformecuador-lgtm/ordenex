import { describe, it, expect } from "vitest";
import type { OrdenListItemDTO, ListarOrdenesResult } from "@/lib/types/orden";

// Feature 30/R14/R19 — la adicion de `zonaNombre`/`zonaEsCentral` al DTO del listado
// es ADITIVA: los consumidores del CRUD (features 6/7) que construyen
// OrdenListItemDTO SIN esos campos deben seguir compilando y funcionando. Los
// campos son opcionales en el tipo (`?`) por ese motivo; el repositorio SIEMPRE
// los envia. Este test es "de tipos" (compila) + una comprobacion en runtime.

// Consumidor "legacy" (feature 6/7): construye un item de listado sin zona.
const itemLegacy: OrdenListItemDTO = {
  id: "o1",
  numGuia: 1,
  numRemision: "REM-1",
  estatusId: "os-1",
  destinatario: "Cliente",
  telefonoDest: "88880000",
  tiendaId: "t1",
  zonaId: "z1",
  provinciaId: "p1",
  cantonId: "c1",
  distritoId: null,
  producto: "Caja",
  peso: 1,
  notas: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  tiendaNombre: "Tienda Uno",
  // Sin zonaNombre / zonaEsCentral: sigue siendo un OrdenListItemDTO valido (R19).
};

// Consumidor nuevo (feature 30): agrega la zona del listado.
const itemConZona: OrdenListItemDTO = {
  ...itemLegacy,
  zonaNombre: "GAM",
  zonaEsCentral: true,
};

describe("OrdenListItemDTO — zonaNombre/zonaEsCentral aditivos (R19)", () => {
  it("un item legacy sin zona sigue siendo un OrdenListItemDTO valido", () => {
    expect(itemLegacy.zonaNombre).toBeUndefined();
    expect(itemLegacy.tiendaNombre).toBe("Tienda Uno");
  });

  it("un item con zona expone zonaNombre/zonaEsCentral", () => {
    expect(itemConZona.zonaNombre).toBe("GAM");
    expect(itemConZona.zonaEsCentral).toBe(true);
  });

  it("el resultado del listado admite ambos (contrato 6/7 intacto)", () => {
    const res: ListarOrdenesResult = {
      status: "ok",
      items: [itemLegacy, itemConZona],
      page: 1,
      pageSize: 20,
      total: 2,
    };
    expect(res.status).toBe("ok");
    if (res.status !== "ok") throw new Error("unreachable");
    expect(res.items).toHaveLength(2);
  });
});
