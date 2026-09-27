import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { SINPE_OFICINA } from "@/components/shared/sinpe-textos";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarSinpeBodegas } from "@/lib/actions/sinpe-bodega";
import { puedeEditarAlgunSinpe } from "@/lib/types/sinpe-bodega";

import { SinpeBodegasModule } from "./_components/SinpeBodegasModule";

/**
 * ⭑ FICHA 429 (T21-B) — «SINPE por bodega», la pantalla de la OFICINA.
 *
 * ⚠️ EL GATE LEE `puedeEditarAlgunSinpe`, LA MISMA FUNCION QUE USA `SinpeBodegaService`. No se
 * copia aqui una lista de roles: dos listas escritas a mano divergen sin que nada se ponga rojo,
 * y el resultado es una pantalla que se abre y no enseña nada, o —peor— una que se niega a quien
 * el servicio si autoriza.
 *
 * QUE VE CADA ROL LO DECIDE EL SERVICIO, NO ESTA PAGINA: `maestro` y `admin` reciben las ocho
 * bodegas; un `adminSatelite` que llegue por URL recibe UNA, la suya, y con su `editable` ya
 * resuelto (R19/R20). Por eso el gate es «¿puede editar alguna?» y no «¿es de la oficina?»:
 * duplicar aqui el recorte por zona seria una segunda regla de permiso.
 *
 * ⚠️ ESTE `notFound()` CORTA POR ROL, no por revision pendiente (R28). La revision no decide
 * acceso en ningun punto del arbol.
 *
 * El `admin` no ve hoy el item de «Configuración» en su barra —ese menu es `maestro`-only desde
 * antes de esta ficha y ensancharlo le abriria Usuarios, Tarifas y API, que no es lo que nadie
 * pidio—, asi que llega aqui por URL o desde el aviso del primer ingreso. Queda dicho en vez de
 * resuelto a la brava.
 */
export default async function SinpePorBodegaPage() {
  const actor = await resolveActorFromSession();
  if (actor === null || !puedeEditarAlgunSinpe(actor.rol)) {
    notFound();
  }

  const res = await listarSinpeBodegas();

  return (
    <AppPage title={SINPE_OFICINA.titulo}>
      {res.status === "ok" ? (
        <SinpeBodegasModule bodegasIniciales={res.items} />
      ) : (
        // Mismo patrón que el resto de `/configuracion`: un `role="alert"` que dice qué falló.
        // `ErrorState` no sirve aquí — es la pantalla de una frontera de error de Next, y esto
        // es una lectura que devolvió un desenlace, no una excepción que reventó el subárbol.
        <p role="alert" className="text-sm text-muted-foreground">
          No se pudo cargar el SINPE de las bodegas.
        </p>
      )}
    </AppPage>
  );
}
