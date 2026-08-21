import { getPrismaClient } from "@/lib/db/prisma-client";
import { VehiculoRepository } from "@/lib/repositories/VehiculoRepository";
import type { SelectOption } from "@/components/ui/select";
import type { VehiculoValue } from "@prisma/client";
import { Logo } from "@/components/shared/Logo";
import { VolverAlInicioLink } from "@/components/shared/VolverAlInicioLink";
import { PostulacionForm } from "./_components/PostulacionForm";

// Opt-out del prerender estatico: esta pagina publica consulta catalogos de DB
// (tipos de identificacion y vehiculos) en request time y NO lee cookies()/headers(),
// asi que Next intentaria prerenderizarla en build; sin DB eso rompe el build
// (Prisma P2021). Forzarla dinamica difiere la consulta al request real.
export const dynamic = "force-dynamic";

// Feature 21 — pagina PUBLICA de postulacion de mensajero (R1). Es la unica via
// de auto-registro. Acceso sin sesion ni cookie (R22): no se verifica ni concede
// sesion aqui, a diferencia de app/login/page.tsx. Server Component minimo: solo
// carga los catalogos publicos (tipos de identificacion y vehiculos) para
// poblar los selects; los datos NO son sensibles.

// Etiquetas de presentacion de los catalogos. Se mantienen aqui (capa de
// presentacion) y no en el enum/DB, listas para i18n futura. Con fallback a
// capitalizar el valor crudo por si el catalogo crece.
const VEHICULO_LABELS: Partial<Record<VehiculoValue, string>> = {
  moto: "Moto",
  carro: "Carro",
  camion: "Camión",
};

const TIPO_IDENTIFICACION_LABELS: Record<string, string> = {
  cedula: "Cédula",
  ruc: "RUC",
  pasaporte: "Pasaporte",
};

function capitalizar(valor: string): string {
  return valor.length > 0 ? valor[0].toUpperCase() + valor.slice(1) : valor;
}

export default async function PostulacionPage() {
  const prisma = getPrismaClient();
  const vehiculoRepo = new VehiculoRepository(prisma);

  const [vehiculos, tipos] = await Promise.all([
    vehiculoRepo.findMany(),
    prisma.tipoIdentificacion.findMany({ orderBy: { value: "asc" } }),
  ]);

  const vehiculoOptions: SelectOption[] = vehiculos.map((v) => ({
    value: v.id,
    label: VEHICULO_LABELS[v.name] ?? capitalizar(v.name),
  }));

  const tipoOptions: SelectOption[] = tipos.map((t) => ({
    value: t.id,
    label: TIPO_IDENTIFICACION_LABELS[t.value] ?? capitalizar(t.value),
  }));

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* Panel de marca: visible desde md, oculto en movil para no forzar scroll */}
      <div className="relative hidden overflow-hidden bg-navy px-12 py-16 text-white md:flex md:w-1/2 md:flex-col md:justify-between lg:w-[45%]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(242,100,25,0.16),transparent_55%)]"
        />
        <div className="relative">
          <Logo />
          <div className="mt-3 h-1 w-10 rounded-full bg-brand" />
        </div>
        <p className="relative max-w-sm text-sm leading-relaxed text-white/70">
          Postúlate como mensajero y forma parte de la operación. Tu solicitud
          quedará pendiente de aprobación.
        </p>
      </div>

      {/* Panel de formulario. `relative` ancla la salida a la landing en la
        esquina superior SIN meterla en el flujo del flex: como un hijo más del
        panel empujaría hacia abajo el formulario, que se centra con
        `justify-center`. Va en ESTE panel y no en el de marca (`hidden ...
        md:flex`), porque en móvil el de marca no existe y es justo ahí donde
        esta es la única salida de la pantalla. */}
      <div className="relative flex flex-1 flex-col items-center justify-center gap-8 bg-background px-6 py-12">
        <VolverAlInicioLink className="absolute left-3 top-3" />
        {/* Wordmark compacto, solo visible en movil */}
        <div className="md:hidden">
          {/* Feature 208: el wordmark de móvil vive sobre `bg-background`, que gira
            con el tema; en `navy` fijo medía 1.06:1 en oscuro. (El panel de marca de
            escritorio, `bg-navy` con texto blanco, es superficie FIJA y se conserva.) */}
          <Logo className="text-xl text-foreground" />
        </div>
        <PostulacionForm
          tiposIdentificacion={tipoOptions}
          vehiculos={vehiculoOptions}
        />
      </div>
    </div>
  );
}
