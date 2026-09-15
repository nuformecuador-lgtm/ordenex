# 424 — El `admin` puede eliminar órdenes · Requisitos

> **Pedido humano (2026-09-14, Carlos Restrepo):** tras preguntar si el `admin` podía borrar
> órdenes y medirse que **NO**, se pide abrirle esa capacidad, hoy reservada al `maestro`.
>
> Notación EARS. Cada `R<n>` está mapeado a un test concreto en `tasks.md`.

---

## Lo que esta ficha REVIERTE, dicho y no escondido

El **2026-08-27** el borrado de órdenes se **estrechó** de «`maestro` y `admin`» a «solo
`maestro`». El motivo está escrito hoy en `lib/services/EliminarOrdenService.ts` y en
`lib/services/alcance-borrado-orden.ts`:

> «con dos roles capaces de borrar, el rastro de quien lo hizo deja de ser una sola persona».

La ficha 358 (2026-09-02) abrió el borrado a la TIENDA acotado a lo suyo y **conservó
expresamente** aquel estrechamiento. Esta ficha lo **revierte**: el `admin` vuelve a poder
borrar, **a petición expresa del humano el 2026-09-14 y con esa consecuencia sobre la mesa**.
El debate no se reabre aquí.

**Lo que sostiene la reversión** es la contrapartida que se exige en R11–R16: el rastro deja de
ser «una sola persona» y pasa a ser **una persona nombrada por cada orden borrada**, con su rol
congelado en el instante del borrado y consultable. Esa capacidad existe desde la ficha 362
(`historial_accion`); esta ficha **la verifica con el rol nuevo** en vez de darla por hecha.

## Estado medido del sistema antes de tocar nada (2026-09-14)

| Hecho | Dónde está medido |
| --- | --- |
| El alcance del borrado NO lo decide `esAccesoTotal`; lo decide `resolverAlcanceBorradoOrden`, que devuelve `todas` / `propias` / `denegado` | `lib/services/alcance-borrado-orden.ts` |
| Esa misma función la consultan **tres** consumidores: el borrado por pantalla, el listado que decide si ofrece el botón, y el **canal por API key** | `EliminarOrdenService`, `OrdenService.marcarEliminable`, `ApiOrdenEliminacionService` |
| Hoy: `maestro` → `todas`; `adminTienda` y `apiKey` → `propias`; `admin`, `adminSatelite`, `mensajero` → `denegado` | `tests/unit/services/alcance-borrado-orden.test.ts` |
| Lo que impide que la tienda A borre una orden de la tienda B **no** es la autorización: es el `ownerId` dentro del `where` del `softDelete` | `tests/integration/db/eliminar-orden-pantalla-frontera-tienda.test.ts` |
| El borrado es **lógico** (`deleted_at`), nunca físico, y no escribe transición en el historial de estados | `OrdenRepository.softDelete` |
| El rastro del borrado ya congela `actor_usuario_id`, `actor_nombre` y `actor_rol` en `historial_accion`, una fila por orden **efectivamente** borrada y un `lote_id` por acto | `lib/repositories/registrar-accion.ts`, `tests/integration/db/historial-accion-atomicidad.test.ts` |
| `historial_accion.actor_rol` es el enum `rol_value`, que **ya contiene** `admin` | `db/schema.prisma` |
| El módulo de consulta del rastro (`/historico/acciones`) lo lee **solo el `maestro`** | `ROLES_HISTORIAL_ACCIONES` en `lib/auth/menu-visibility.ts` |
| **A cuánta gente alcanza la reversión: 4 usuarios con rol `admin` activos** en producción, más 2 `maestro` | Medido el **2026-09-14** por el humano |

---

## Requisitos

### Autorización del borrado

**R1.** MIENTRAS el actor autenticado tenga rol `admin`, el sistema DEBE autorizar la eliminación
de órdenes **sin frontera de tienda**: cualquier orden del sistema que cumpla el criterio de
eliminabilidad vigente, sea de la tienda que sea.

**R2.** CUANDO un actor con rol `admin` pida eliminar un lote de órdenes, el sistema DEBE aplicar
**el mismo criterio de eliminabilidad** (estado permitido **y** cero intentos de entrega) y el
mismo **todo-o-nada por lote** que aplica hoy al `maestro`: si una sola orden del lote no se puede
borrar, no se borra ninguna y se devuelve el motivo por orden.

**R3.** MIENTRAS el actor tenga rol `adminTienda` o `apiKey`, el sistema DEBE seguir limitando el
borrado a las órdenes cuya tienda sea la del propio actor.

**R4.** SI se ejecuta la escritura del borrado con el identificador de una orden que **no**
pertenece a la tienda indicada como dueña, ENTONCES el sistema DEBE dejar esa orden intacta
(cero filas afectadas), **aunque la comprobación previa de pertenencia no exista**.

**R5.** MIENTRAS el actor tenga rol `mensajero` o `adminSatelite`, el sistema DEBE responder
`forbidden` al borrado por pantalla y NO DEBE ejecutar ninguna lectura ni ninguna escritura de
órdenes.

**R6.** DONDE se incorpore un rol nuevo al catálogo de roles, el sistema NO DEBE permitirle
eliminar órdenes por ningún canal mientras no se le declare esa capacidad de forma explícita.

### La pantalla

**R7.** MIENTRAS la sesión sea de rol `admin`, el sistema DEBE ofrecer en `/ordenes` la casilla de
selección y la acción «Eliminar» **exactamente** sobre las filas que el servidor marca como
eliminables, y sobre ninguna otra.

**R8.** El sistema DEBE responder lo mismo a «¿ofrezco el botón Eliminar?» y a «¿autorizo este
borrado?» para el rol `admin`, **estado por estado** del catálogo de estados de orden.

**R20.** CUANDO cambie el conjunto de roles autorizados a eliminar órdenes, el sistema DEBE
cambiar con él, **en el mismo acto y sin editar ninguna segunda lista de roles**, el conjunto de
roles a los que la pantalla ofrece la selección y la acción «Eliminar».

### El canal por API key

**R9.** MIENTRAS la petición llegue autenticada por API key, el sistema DEBE seguir limitando el
borrado a las órdenes de la tienda dueña de esa credencial.

**R10.** SI el servicio de borrado del canal por API key recibe un actor cuyo alcance es «todas»
(sin frontera de tienda), ENTONCES el sistema DEBE responder `not_found` y NO DEBE escribir nada.

### El rastro — la contrapartida que sostiene la reversión

**R11.** CUANDO una orden se elimine **efectivamente**, el sistema DEBE registrar una fila de
auditoría por esa orden que identifique la orden borrada y que lleve **congelados** el
identificador, el **nombre** y el **rol** de quien la borró, tal como eran en el instante del
borrado.

**R12.** CUANDO quien borra tenga rol `admin`, el rol registrado en esa fila DEBE ser `admin`, y
DEBE seguir siendo `admin` aunque después se cambie el rol vivo de esa persona.

**R13.** CUANDO un mismo acto de borrado alcance varias órdenes, el sistema DEBE registrar todas
sus filas bajo **un mismo identificador de lote**, distinto del de cualquier otro acto.

**R14.** SI el registro de auditoría de un borrado no se puede escribir, ENTONCES el sistema NO
DEBE dejar la orden borrada; y SI el borrado no alcanza una orden, ENTONCES el sistema NO DEBE
dejar fila de auditoría de esa orden.

**R15.** El sistema DEBE permitir consultar **quién** eliminó una orden filtrando el registro por
el tipo de acción «orden eliminada» y por actor, y DEBE mostrar en esa consulta el **nombre** y el
**rol** de quien la ejecutó.

**R16.** MIENTRAS el actor tenga rol `admin`, el sistema NO DEBE darle acceso al módulo de consulta
del registro de acciones (ni en pantalla, ni en la descarga, ni en el menú).

### Lo que esta ficha NO cambia

**R17.** MIENTRAS el actor tenga rol `admin`, el sistema DEBE seguir respondiendo `forbidden` a la
**recuperación** de una orden eliminada.

**R18.** MIENTRAS el actor tenga rol `admin`, el sistema DEBE seguir respondiendo `forbidden` al
listado pedido con el filtro de **órdenes eliminadas**, y NO DEBE ofrecerle ese interruptor en
pantalla.

**R19.** El sistema DEBE seguir eliminando órdenes mediante **borrado lógico**: la fila de la orden
no se borra físicamente y su historial de estados no se altera ni gana una transición por el hecho
de borrarla.

---

## Decisiones cerradas por el humano (2026-09-14)

**No queda ninguna pregunta abierta.** Las tres que este spec planteó están resueltas, y aquí
quedan escritas con su consecuencia para que nadie las reabra por olvido.

**D1 — «Que borre, pero que quede registro en el historial que ya tenemos».** Es la frase del
humano, y decide las dos mitades de la ficha:

- El `admin` **borra**. **No** se le abre la papelera ni la recuperación (R17, R18). Si se
  equivoca, se lo pide al `maestro`. Aceptado con esa consecuencia sobre la mesa.
- El **registro de quién borró es REQUISITO de esta ficha, no un extra** (R11–R15), y se resuelve
  con el historial que **ya existe** — la ficha 362, que congela nombre y rol del actor. **No se
  estrena ningún mecanismo nuevo.** Lo que esta ficha añade es la **medición** de que ese rastro
  sigue en pie con el rol nuevo y es consultable por el `maestro`.
- ⚠️ **Y es bloqueante:** si al medirlo se descubre que el rastro **no** queda o **no** es
  consultable con el rol `admin`, se dice y se para — no se tapa ni se degrada a «mejora
  posterior». Es lo único que sostiene la reversión.

**D2 — El `admin` no puede leer `/historico/acciones`: límite conocido y aceptado.** No se resuelve
en esta ficha. El motivo es una decisión explícita de la ficha 362: «el registro guarda las
decisiones de dinero del `admin` y no puede ser el `admin` quien revise su propio registro». La
consecuencia, dicha y no escondida: a partir de aquí el `admin` **genera** filas en ese registro y
**no puede leerlas**; quien audita es el `maestro` (R16).

**D3 — Alcance medido: 4 usuarios con rol `admin` activos en producción, más 2 `maestro`**
(2026-09-14). No cambia el diseño; queda escrito porque es de cuántas personas pasa a depender el
borrado de una orden: de 2 a 6.

**D4 — La pregunta «¿quién puede borrar?» se contesta en un solo sitio** para el servidor y para la
pantalla (R20). Confirmado por el humano: nada de añadir `admin` a una segunda lista de roles en la
página. Dos listas que contestan la misma pregunta es exactamente el defecto que reportó la ficha
358 («Nuform quiere eliminar NA-495 y no le aparece el checkbox»).
