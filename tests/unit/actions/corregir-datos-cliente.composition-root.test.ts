import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";

import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// FICHA 327 / D1 — EL COMPOSITION ROOT, EJERCITADO DE VERDAD.
//
// ⚠️ QUE FALLO CONCRETO CIERRA ESTE ARCHIVO. `CorregirDatosClienteService` gano un SEGUNDO
// constructor —el resolver de tarifas—, y el unico sitio del sistema que lo pasa es el
// `buildService()` de la Server Action. Un `buildService()` que se quedara con un solo argumento
// COMPILA IGUAL en cuanto alguien marque el parametro como opcional, pasa todos los tests de
// servicio (que inyectan sus propios dobles) y revienta EN PRODUCCION, en la primera correccion
// que cambie de distrito. Este repo ya midio esa familia: «2 de 7 notificadores muertos con la
// suite verde». Comprobar que el modulo IMPORTA el repositorio no basta: hay que comprobar que
// alguien lo PASA.
//
// COMO SE COMPRUEBA. Se mockea `getPrismaClient` con un cliente falso que responde las TRES
// consultas del camino completo (la orden, el distrito y las tarifas), se llama a la accion REAL
// sin `deps.service` —de modo que se construye por el root de verdad— y se exige un aviso con
// importes. Si el resolver de tarifas llegara `undefined`, esta llamada lanzaria.

const ORDEN_ID = "8b1a2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";
const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

const filaOrden = {
  id: ORDEN_ID,
  tiendaId: "tienda-1",
  numGuia: 8123,
  destinatario: "Ana Perez",
  telefonoDest: "8888-7777",
  producto: "caja",
  notas: null,
  direccion: "avenida siempre viva 742",
  peso: new Prisma.Decimal("1.500"),
  montoCobrar: new Prisma.Decimal("15000.00"),
  cobraComision: true,
  provinciaId: "p-1",
  cantonId: "c-1",
  distritoId: "d-1",
  estatus: { value: "en_reparto" },
  zona: { id: "z-1", nombre: "Zona Uno", esCentral: false },
  distrito: { nombre: "Distrito Uno", zonaEspecial: false },
  cierreDetalles: [] as { id: string }[],
};

const filaDistrito = {
  id: "d-2",
  nombre: "Distrito Dos",
  cantonId: "c-1",
  zonaEspecial: false,
  canton: { provinciaId: "p-1" },
  zonas: [{ zonaId: "z-2", zona: { nombre: "Zona Dos", esCentral: false } }],
};

const filaTarifa = {
  id: "tar-1",
  tiendaId: "tienda-1",
  zonaId: null,
  fulfillment: new Prisma.Decimal("0.00"),
  valorFlete: new Prisma.Decimal("2000.00"),
  valorFleteGam: new Prisma.Decimal("1500.00"),
  valorFleteDevuelto: new Prisma.Decimal("1000.00"),
  valorFleteDevueltoGam: new Prisma.Decimal("800.00"),
  comisionCod: new Prisma.Decimal("5.00"),
  ivaFlete: new Prisma.Decimal("13.00"),
  ivaComisionCod: new Prisma.Decimal("13.00"),
  tarifaEspecial: null,
  tarifaEspecialDevuelta: null,
};

const tarifaFindMany = vi.fn(async () => [filaTarifa]);

vi.mock("@/lib/db/prisma-client", () => ({
  getPrismaClient: () => ({
    orden: { findFirst: vi.fn(async () => filaOrden) },
    distrito: { findFirst: vi.fn(async () => filaDistrito) },
    tarifa: { findMany: tarifaFindMany },
  }),
  // `PRISMA_OMIT` lo importa `_postgres-real`, no este camino; se declara por si el modulo
  // completo se resuelve.
  PRISMA_OMIT: {},
}));

const { corregirDatosCliente } = await import("@/lib/actions/corregir-datos-cliente");

describe("327/D1 — el composition root PASA el repositorio de tarifas, no solo lo importa", () => {
  it("la accion real, sin `deps.service`, produce el aviso con sus importes", async () => {
    const r = await corregirDatosCliente(
      { ordenId: ORDEN_ID, provinciaId: "p-1", cantonId: "c-1", distritoId: "d-2" },
      { getActor: async () => MAESTRO },
    );

    expect(r.status).toBe("confirmacion_requerida");
    if (r.status !== "confirmacion_requerida") return;
    // Anti-vacuidad: el resolver de tarifas se USO de verdad (no salio por la rama `sin_tarifa`
    // de un doble que devolviera `null` sin consultar nada).
    expect(tarifaFindMany).toHaveBeenCalled();
    expect(r.aviso.propuesta.tarifa).toBe("resuelta");
    expect(r.aviso.propuesta.zonaId).toBe("z-2");
    // flete 2000.00 + IVA 260.00 (la zona propuesta no es central).
    expect(r.aviso.propuesta.fleteConIva).toBe("2260.00");
  });
});
