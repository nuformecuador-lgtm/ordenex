# Feature 239 — Tareas

> Leer antes: `requirements.md` (R1-R35) y `design.md`. `⟨PRE⟩` = value del pre-estado, pendiente de
> firma (P1); recomendación `devolucion_por_confirmar`.
>
> **Gate:** `./init.sh --rapido` para cerrar cada tanda; **`./init.sh` completo antes de cada PR, sin
> excepción**. El gate **no** se corre en paralelo con un subagente que muta el árbol: el veredicto
> no valdría.
>
> **No hay punto de despliegue intermedio seguro** (design §10-D): **T1 y T2 van en un solo PR**. Si
> el productor sale sin el consumidor, `/novedades` queda vacía con el árbol verde.

---

## T0 — Puerta humana: medir y firmar (sin código)

- [x] **T0.1 — Re-medir contra producción.** Vía MCP de Supabase, solo lectura:
      (a) órdenes hoy en `devuelta`; (b) cierres por estado y antigüedad (consulta de
      `specs/215/design.md` §7bis); (c) retraso gestión→aprobación (mediana / p90 / máx) sobre los
      últimos 30 días; (d) órdenes con `gestion_aprobada = false` y estatus `devuelta` (las que hoy
      están recortadas de `/novedades`).
      **Hecho:** los cuatro números pegados en `progress/impl_239.md` con su fecha. La foto del
      2026-08-18 (0 en `devuelta`, 12/12 cierres aprobados, mediana 8,2 h · p90 22,1 h · máx 48,2 h)
      **caduca** y no se cita como vigente.
- [x] **T0.2 — Firmar las decisiones abiertas.** P1 (nombre y etiqueta), P2 (webhook), P3 (qué ve la
      tienda en el limbo), P4 (recuperación del adminSatélite), P9 (orden de mergeo con la 240),
      P10 (orden de mergeo con 235/236).
      **Hecho:** cada una respondida en `progress/impl_239.md`; el spec se actualiza si alguna
      respuesta se aparta de la recomendación. **Bloquea T1.**
- [ ] **T0.3 — [P] Avisar a los integradores del cambio de contrato** (R27): `devuelta` dejará de
      emitirse al gestionar y pasará a emitirse al aprobar, con el retraso medido.
      **Hecho:** aviso enviado y anotado con fecha. **Bloquea el despliegue, no T1.**

---

## T1 — El estado, el mapa y las seis superficies  *(mismo PR que T2)*

- [x] **T1.1 — Alta del value en el catálogo.** `ORDER_STATUS_SEED` + migración
      `<ts>_order_status_devolucion_por_confirmar` con `INSERT … WHERE NOT EXISTS` y su `down.sql`
      que borra **solo si nadie lo referencia**.
      **Hecho:** `pnpm run db:migrate` aplica y `pnpm run db:rollback` revierte en local; el catálogo
      queda en 21 values sin duplicados. **Depende de:** T0.2.
- [x] **T1.2 — Alta del `origen_tipo` `anclaje_devolucion`.** Migración de enum + `down.sql` que
      **recrea el tipo con la lista vigente**; `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` actualizado.
      **NO se tocan los `down.sql` de migraciones anteriores de este enum** (son fotos históricas):
      solo se comprueba si alguno recrea con lista cerrada y se anota la consecuencia del rollback
      encadenado.
      **Hecho:** `tests/integration/db/anclaje-devolucion-migration.test.ts` verde: aplica dos veces
      sin duplicar, el down revierte, y el value NO está en `ORIGEN_TIPOS_VISITA_REAL` ni en
      `ORIGEN_TIPOS_CON_GESTION`. **Depende de:** T1.1.
- [x] **T1.3 — [P] El mapa `resultado → estatus`.** Nuevo módulo puro `lib/types/gestion-destino.ts`
      con `ESTATUS_POR_RESULTADO` y sus dos `satisfies`. `MisAsignacionesService:388` deja de usar
      `findEstatusIdByValue(input.resultado)`.
      **Hecho:** `tests/unit/types/gestion-destino.test.ts` cubre los 5 resultados y afirma que
      `devuelta → ⟨PRE⟩` es el único que rompe la identidad; `mis-asignaciones-service.test.ts`
      afirma que gestionar `devuelta` deja la orden en `⟨PRE⟩`. **Depende de:** T1.1.
- [x] **T1.4 — Aristas de transición.** Altas `en_reparto → ⟨PRE⟩`, `⟨PRE⟩ → devuelta`,
      `⟨PRE⟩ → en_reparto` (+ las dos de recuperación **solo si P4 = sí**); **baja** de
      `en_reparto → devuelta` en el mismo commit que su último productor.
      **Hecho:** typecheck verde (la exhaustividad rompe el build hasta declararlas);
      `order-status-transiciones.guardia.test.ts`, `.connectividad.test.ts` y
      `tests/fixtures/inventario-transiciones-140.ts` actualizados con nota fechada; un caso afirma
      que `en_reparto → devuelta` **ya es ilegal**. **Depende de:** T1.3.
- [x] **T1.5 — `ESTADOS_ESPERADOS` (regresión, no aserción a actualizar).** `CierreDiaService.ts:86`,
      entrada `devuelta` gana `⟨PRE⟩` en primera posición.
      **Hecho:** `cierre-dia-service.test.ts` tiene un caso **nuevo** «el mensajero deshace su
      devolución del día mientras la orden está en el pre-estado», verde. **Depende de:** T1.1.
- [x] **T1.6 — [P] Superficies que rompen el build.** Etiqueta + variante en `EstatusBadge.tsx`; hito
      público en `rastreo-publico.ts` (mismo hito que `devuelta`, R28).
      **Hecho:** typecheck verde; `EstatusBadgeCatalogoV2.test.tsx`,
      `rastreo-hitos-exhaustivo.guardia.test.ts` y `rastreo-sin-estatus-crudo.guardia.test.ts`
      actualizados a 21 values con nota fechada. **Depende de:** T1.1.
- [x] **T1.7 — [P] Los cuatro mapas parciales que NO rompen el build.** Revisión **a mano** de
      `exclude-por-rol.ts` (excluir para `adminTienda`), `webhook-eventos.ts` (**no** añadir, P2),
      `estados-bodega-satelite.ts` (añadir en la posición previa a `devuelta` **si P4 = sí**),
      `tablero-dia.ts` (**no** añadir: default `otros` es correcto).
      **Hecho:** un test por archivo afirma la decisión **y su razón**, incluido el caso negativo
      («`⟨PRE⟩` NO es evento público», «`⟨PRE⟩` NO tiene bucket explícito»);
      `buckets-estatus.guardia.test.ts` actualizado a 21. **Depende de:** T1.1, T0.2.
- [x] **T1.8 — [P] Inventarios congelados restantes.** Barrido de las cuentas literales del catálogo
      (`toBe(20)`, «los 20 values», `CATALOGO_CONGELADO`).
      **Hecho:** `pnpm run typecheck && pnpm test` sin rojos de conteo; cada actualización lleva
      comentario con fecha y motivo. **Depende de:** T1.6, T1.7.

**R cubiertos por T1:** R1, R2, R3, R24, R25, R26, R28, R29.

---

## T2 — El tercer bloque de `resolverCierre`  *(mismo PR que T1)*

- [x] **T2.1 — `ResolverCierreInput.anclajeDevolucion` OBLIGATORIO** + resolución de los dos ids en
      `CierresAdminService`, con **fallo cerrado** si alguno es `null` (R9).
      **Hecho:** typecheck rompe en todo doble de test que no lo pase (esa es la señal buscada); un
      caso afirma que con catálogo incompleto la aprobación **no ocurre** y no hay efectos parciales.
      **Depende de:** T1.1.
- [x] **T2.2 — El bloque.** Al final de la rama `aprobado`, después del de `devolucionRechazadas`:
      lectura de las gestiones `devuelta` del cierre → lectura de las vigentes más recientes de esas
      órdenes (**una** consulta, no N) → `updateMany` guardado por `⟨PRE⟩` → `appendCambioEstado` solo
      si `count > 0`, con `origenTipo: 'anclaje_devolucion'`, `actorUsuarioId = resueltoPor` y
      `gestionOrdenId` enlazado.
      **Hecho:** `tests/unit/repositories/cierres-admin-anclaje-devolucion.test.ts` **nuevo** —
      es literalmente «el archivo que el comentario de `cierres-admin-repository.test.ts:138-141`
      prometía y que no existía»— con los casos: ancla, no ancla al rechazar, no ancla la gestión que
      no es la vigente más reciente, idempotencia en segunda pasada, cierre sin devoluciones =
      cero consultas extra. **Depende de:** T2.1.
- [x] **T2.3 — Retirar el encendedor viejo.** Se borra el `updateMany` de `gestionAprobada: true`
      (`CierresAdminRepository:1018-1021`).
      **Hecho:** `grep` sin resultados de `gestionAprobada` en `lib/repositories/CierresAdminRepository.ts`.
      **Depende de:** T2.2.
- [x] **T2.4 — Verificar que ningún feed de dinero lee `orden.estatus_id`.** Revisión de los cinco
      feeds + la caja COD.
      **Hecho:** anotado en `progress/impl_239.md` con los archivos revisados;
      `cierres-admin-caja-cod.test.ts` verde **sin tocar**, y sus suites de idempotencia también.
      **Depende de:** T2.2.
- [x] **T2.5 — Restaurar las dos aserciones que se enseñaron a ignorar.**
      `CierresAdminRepository.resolverCierre.devolucion.test.ts:115-120` y
      `cierres-admin-repository.test.ts:1143-1146`: se retira el
      `.filter(c => c.where.id !== undefined)` que excluía precisamente la escritura nueva, y las
      aserciones que contaban sobre la lista filtrada pasan a contar sobre la lista completa.
      **Hecho:** las dos suites verdes **con el filtro retirado** y con un caso que nombra la
      escritura del anclaje. **Depende de:** T2.2.
- [x] **T2.6 — Guardia de cobertura de escrituras (R33).**
      `tests/unit/guards/aprobacion-escrituras-cubiertas.guardia.test.ts`: censa la transacción de
      `resolverCierre` y falla si alguna escritura no está nombrada por al menos una aserción, o si
      un test filtra escrituras por la forma de su `where`.
      **Hecho:** la guardia se pone **roja** al reponer el `.filter(...)` retirado en T2.5
      (autocomprobación obligatoria, incluida en el propio archivo). **Depende de:** T2.5.

**R cubiertos por T2:** R4, R5, R6, R7, R8, R9, R10, R33.

---

## T3 — El reloj y la visibilidad

- [x] **T3.1 — Retirar la columna.** Migración `<ts>_orden_retiro_gestion_aprobada` (`DROP COLUMN` +
      `down.sql` que la repone con `DEFAULT false`, **pérdida de valores declarada**), `schema.prisma`,
      `novedadWhere` vuelve a `{ estatus: { value: "devuelta" } }`, `liberarDevueltaSla` pierde la
      línea del apagado, `habilitarNovedad` pasa a `{ ayuda: false }`.
      **Hecho:** `orden-repository.novedades.test.ts` afirma que `count` y `find` comparten predicado
      (R21) y que una `devuelta` **anterior** a la columna se lista (R30);
      `devolucion-sla-repository.test.ts` verde. **Depende de:** T2.
- [x] **T3.2 — Guardia de retirada (R20).** `tests/unit/guards/gestion-aprobada-retirada.guardia.test.ts`:
      censo del árbol; ninguna referencia a `gestion_aprobada` / `gestionAprobada` fuera de
      `db/migrations/` y de los documentos históricos.
      **Hecho:** verde, y **roja** al reintroducir la columna en `schema.prisma` (autocomprobación en
      el archivo). El censo se escribe **en un archivo**, nunca por `node -e`: ahí `\b` llega como
      backspace y el censo miente en verde. **Depende de:** T3.1.
- [x] **T3.3 — El ancla del cron.** `findDevueltasSla` proyecta también la última fila de historial
      con `origen_tipo = anclaje_devolucion`; `DevueltaSlaRow` gana `origenAncla`; rama legada
      nombrada para las filas viejas.
      **Hecho:** `devolucion-sla-repository.test.ts` cubre las dos ramas y afirma que una orden en
      `⟨PRE⟩` **no** es candidata (R13); `devolucion-sla-service.test.ts` afirma que la ventana se
      mide desde la aprobación y que el contador `legadas` sale en el resultado. **Depende de:** T3.1.
- [x] **T3.4 — [P] Re-anclaje en la vuelta completa (R15).**
      **Hecho:** un caso que recorre devolución → aprobación → liberación → reasignación → nueva
      devolución → nueva aprobación, y afirma que gana el anclaje **más reciente**. **Depende de:** T3.3.
- [x] **T3.5 — [P] Prosa caducada.** Reescribir el bloque de `DevolucionSlaService.ts:122` que aún
      dice «Q5, **ABIERTA**» (está **CERRADA con riesgo ACEPTADO** desde 2026-08-13, D14) y anotar el
      cambio de forma de Q5.
      **Hecho:** el texto nuevo cita la decisión con fecha y no afirma nada que el código no haga.
      **Depende de:** T3.3.
- [x] **T3.6 — La fuga de la bandera de ayuda (R22) y «Habilitar» (R23).** Alcance según la respuesta
      a P9/P10.
      **Hecho:** un test afirma que una orden que salió de reparto **no** sigue listada por una
      solicitud de ayuda anterior, y otro que ninguna orden puede quedar fuera del listado con una
      ventana de SLA capaz de escalarla. Si la 240 ya cubre el segundo, se referencia en vez de
      duplicarlo. **Depende de:** T0.2, T3.1.

**R cubiertos por T3:** R12, R13, R14, R15, R18, R19, R20, R21, R22, R23, R30.

---

## T4 — Los tests legítimamente invertidos  *(la tanda más cara y la más subestimada)*

- [x] **T4.1 — Los tres emuladores de integración.**
      `tests/integration/db/resolver-novedad-recupera-sla.test.ts`,
      `resolver-novedad-reprograma-sla.test.ts`, `resolver-novedad-reprograma-dinero.test.ts`:
      su semilla deja la orden en `devuelta` justo después de gestionar, que ya no ocurre.
      **Hecho:** las tres semillas pasan por la aprobación del cierre; cada archivo lleva una nota
      fechada de por qué se invirtió. **Ninguno queda verde por ausencia de datos** — se comprueba
      matando cada uno con una mutación antes de darlo por bueno. **Depende de:** T3.
- [x] **T4.2 — [P] E2E de escalado por SLA.**
      **Hecho:** el flujo pasa por aprobar el cierre antes de que el reloj corra, y el test falla si
      se salta ese paso. **Depende de:** T3.
- [x] **T4.3 — [P] El test que vive dentro de lo que se borra.** Antes de retirar cualquier archivo o
      componente, comprobar qué tests mueren con él.
      **Hecho:** lista en `progress/impl_239.md` de tests retirados y de la guardia que los sustituye;
      cero cobertura perdida sin reemplazo nombrado. **Depende de:** T3.
- [x] **T4.4 — Guardia de no fusión de criterios (R16).**
      `tests/unit/guards/anclaje-vs-intentos.guardia.test.ts`: falla si el anclaje y el conteo de
      intentos comparten punto de definición o si uno importa el predicado del otro.
      **Hecho:** verde; **roja** al hacer que el anclaje reutilice `whereIntentosVigentes`
      (autocomprobación en el archivo). `intentos-entrega-criterio-unico.test.ts` y
      `criterio-intento-entrega.test.ts` **verdes sin tocarse** (R17). **Depende de:** T3.

**R cubiertos por T4:** R16, R17, R31, R32.

---

## T5 — Mutación, medición y el resto de las guardias

- [x] **T5.1 — Mutación: el reloj arranca en la aprobación.** Revertir el ancla a
      `gestion.createdAt` y comprobar que la suite se pone **roja**.
      **Hecho:** salida real pegada en `progress/impl_239.md`, con el nombre del test que cae. Sin
      esa salida no cuenta: un arnés de mutaciones ya reportó 9/9 supervivientes dos veces **sin
      haber ejecutado un test**. **Depende de:** T3, T4.
- [x] **T5.2 — [P] Mutación: la carrera de los dos cierres.** Quitar la comprobación de «gestión
      vigente más reciente» del bloque y comprobar que cae el caso de T2.2.
      **Hecho:** ídem, con salida real. **Depende de:** T2, T4.
- [x] **T5.3 — [P] Mutación: el predicado de novedades.** Cambiar la igualdad de estado por `⟨PRE⟩` y
      comprobar que caen los casos de T3.1.
      **Hecho:** ídem. **Depende de:** T3.
- [x] **T5.4 — [P] Consulta de población atascada (R34).** Dejar la consulta de `design.md` §12
      ejecutada contra producción y pegada con su resultado.
      **Hecho:** resultado con fecha en `progress/impl_239.md`. **Depende de:** T3.
- [x] **T5.5 — Guardias completas.** `pnpm run test:guardias` entero: transiciones exhaustivas,
      `hilo-ventana-alcanzable`, frontera de `orden_nota`, money-safe, `dinero-sin-centimos`, los dos
      criterios de intento, y las tres guardias nuevas de esta feature.
      **Hecho:** todas verdes. Un rojo en los criterios de intento significa que alguien los unificó:
      **es regresión, no aserción a cambiar.** **Depende de:** T4.
> ✅ **T5.6 — HECHA el 2026-08-20**, con los tres roles y Playwright, y **cada propiedad comprobada
> contra Postgres**. Recorrido completo en `progress/recorrido_239.md`. Los seis pasos que pedía la
> tarea se ejecutaron: la gestión deja la orden en `devolucion_por_confirmar` y no en `devuelta`; la
> tienda **no** la ve; el rastreo público pinta **el mismo hito** («No fue posible entregarlo») en el
> pre-estado y ya anclada, **con la misma hora**; al aprobar el cierre **tres órdenes anclaron en el
> mismo milisegundo** (`23:41:07.191Z` — la misma transacción, que es lo que R4 exige); la tienda
> pasa a verlas; y **deshacer desde el pre-estado devuelve la orden a `en_reparto`**, cumpliendo lo
> que su modal promete.
>
> 🔴 **Y encontró un defecto que la suite no ve:** el aviso al mensajero dice «Devuelta» cuando la
> orden está en «Devolución por confirmar». Es la coincidencia resultado↔estado que esta misma ficha
> vino a romper, viva en un retorno al que no llegó. **Ficha 250.**
- [x] **T5.6 — Ver la app, no solo la suite.** Gestionar una devolución → comprobar que la tienda
      **no** la ve → aprobar el cierre → verla aparecer en `/novedades` → comprobar que el rastreo
      público muestra el mismo hito en los dos momentos → deshacer una gestión del día desde el
      pre-estado.
      **Hecho:** recorrido anotado, con lo que se vio en cada paso. Ningún texto roto, ningún estado
      crudo en pantalla. **Depende de:** T5.5.

**R cubiertos por T5:** R11, R34, R35 (+ verificación cruzada de todos los anteriores).

---

## T6 — Cierre documental

- [x] **T6.1 — [P] Marcar SUPERADAS con fecha** las decisiones §1.1 y §3.5 de
      `specs/99-devolucion-diferida-sla/design.md`.
      **Hecho:** las dos secciones llevan la nota, sin borrar el texto original.
- [x] **T6.2 — [P] Actualizar §7bis de `specs/215-reintento-en-cierre/design.md`** con el cambio de
      forma de Q5 (mejor: se acaba el bucle y la población es contable; peor: la mercadería se
      congela).
      **Hecho:** la sección lo dice y no contradice al código.
- [x] **T6.3 — [P] Anotar el cierre del fallo** en `progress/auditoria_ayuda_tienda.md` §1, con fecha
      y con el PR.
      **Hecho:** el §1 deja de leerse como un fallo vivo.
- [ ] **T6.4 — Cerrar la ficha.** `feature_list.json`: estado, `status_note` de 3-6 líneas técnicas
      (el detalle vive en `progress/`, no duplicado en el JSON) y el mapa `R<n> → test` en
      `progress/impl_239.md`.
      **Hecho:** `./init.sh` completo verde con el árbol quieto, y el SHA medido comparado contra
      `origin/dev` **justo antes** de abrir el PR (`dev` se mueve). **Depende de:** T5, T6.1-T6.3.

---

## Mapa `R<n> → test`

| Req | Test |
| --- | --- |
| R1 | `tests/unit/types/order-status.test.ts` (el value existe y es único) · `order-status-transiciones.connectividad.test.ts` (tiene entrada y salida) |
| R2 | `tests/unit/services/mis-asignaciones-service.test.ts` — «gestionar `devuelta` deja la orden en el pre-estado, no en `devuelta`» |
| R3 | `tests/unit/types/gestion-destino.test.ts` — los 5 resultados; el destino NO se deriva del nombre |
| R4 | `tests/unit/repositories/cierres-admin-anclaje-devolucion.test.ts` — «al aprobar, la devolución de ESE cierre pasa a `devuelta` en la misma tx» |
| R5 | ídem — «la gestión que ya no es la vigente más reciente NO se ancla» (**mutación T5.2**) |
| R6 | ídem — «rechazar un cierre no mueve ninguna orden del pre-estado» |
| R7 | ídem — «el append lleva actor = el admin, `origen_tipo = anclaje_devolucion` y enlaza la gestión ancla» · `registrar-cambio-estado.guardia.test.ts` |
| R8 | ídem — «segunda aprobación: `count = 0`, sin append» |
| R9 | `tests/unit/services/cierres-admin-service.test.ts` — «catálogo incompleto: la aprobación no ocurre y no hay efectos parciales» |
| R10 | `cierres-admin-anclaje-devolucion.test.ts` (el `data` del updateMany solo lleva `estatusId`) · los cinco feeds y sus suites de idempotencia **verdes sin tocar** |
| R11 | `tests/unit/guards/ordenes-columnas-money-safe.guardia.test.ts` y `dinero-sin-centimos.guardia.test.ts` verdes sin tocar |
| R12 | `tests/unit/services/devolucion-sla-service.test.ts` — «la ventana se mide desde la aprobación» (**mutación T5.1**) |
| R13 | `tests/unit/repositories/devolucion-sla-repository.test.ts` — «una orden en el pre-estado no es candidata» |
| R14 | ídem — «rama legada: sin fila de anclaje, ancla en la gestión, y sale marcada como legada» |
| R15 | `devolucion-sla-repository.test.ts` — «tras la vuelta completa gana el anclaje más reciente» (T3.4) |
| R16 | `tests/unit/guards/anclaje-vs-intentos.guardia.test.ts` (con autocomprobación) |
| R17 | `tests/unit/services/intentos-entrega-criterio-unico.test.ts` y `tests/unit/types/criterio-intento-entrega.test.ts` **verdes sin tocarse** |
| R18 | `tests/unit/repositories/orden-repository.novedades.test.ts` — «una orden en `devuelta` se lista» |
| R19 | ídem («una orden en el pre-estado NO se lista») · `reprogramacion-tienda-service.test.ts` y `recuperacion-bodega-service.test.ts` (guarda `= devuelta`, verdes sin tocar) · `hilo-ventana-alcanzable.guardia.test.ts` |
| R20 | `tests/unit/guards/gestion-aprobada-retirada.guardia.test.ts` (censo, con autocomprobación) |
| R21 | `orden-repository.novedades.test.ts` — «`count` y `find` comparten predicado» (**mutación T5.3**) |
| R22 | `orden-repository.novedades.test.ts` — «la bandera de ayuda no sostiene la fila fuera de reparto» (alcance según P10) |
| R23 | `tests/unit/services/habilitar-novedad-service.test.ts` — «no queda oculta con el reloj corriendo» (o referencia al test de la ficha 240 según P9) |
| R24 | `tests/unit/services/cierre-dia-service.test.ts` — «el mensajero deshace su devolución del día desde el pre-estado» |
| R25 | `tests/unit/repositories/orden-repository.test.ts` — el pre-estado no aparece en asignables, ruteables ni recolectables |
| R26 | typecheck (los tres `Record` totales) + un test por mapa parcial: `exclude-por-rol.test.ts`, `webhook-eventos.test.ts`, `estados-bodega-satelite.test.ts`, `buckets-estatus.test.ts` |
| R27 | `tests/unit/types/webhook-eventos.test.ts` — «el pre-estado NO es evento público» + `emision` en la aprobación |
| R28 | `tests/unit/guards/rastreo-hitos-exhaustivo.guardia.test.ts` — el pre-estado comparte hito con `devuelta` |
| R29 | `tests/unit/domain/order-status-transiciones.guardia.test.ts` — las altas son legales y `en_reparto → devuelta` **lanza** |
| R30 | `orden-repository.novedades.test.ts` — «una `devuelta` anterior al despliegue se lista» · `devolucion-sla-repository.test.ts` (rama legada) |
| R31 | `git diff` de `db/migrations/`: ningún `UPDATE … SET estatus_id` (revisión en T4, anotada) |
| R32 | `tests/integration/db/anclaje-devolucion-migration.test.ts` — aplica, re-aplica y revierte las tres migraciones |
| R33 | `tests/unit/guards/aprobacion-escrituras-cubiertas.guardia.test.ts` (con autocomprobación) + las dos suites de T2.5 con el filtro retirado |
| R34 | Consulta de `design.md` §12 ejecutada, con resultado pegado (T5.4) |
| R35 | `devolucion-sla-service.test.ts` — el logger solo emite conteos agregados |

---

## Paralelismo y conflictos de archivo

- **Dentro de la feature:** las `[P]` de T1 (1.3/1.6/1.7/1.8) tocan archivos distintos y pueden ir a
  la vez; T1.4 y T1.5 **no** son paralelas entre sí ni con T1.3 (dependen del mapa).
- **Con otras fichas:** esta feature toca `OrdenRepository.novedadWhere`, `CierresAdminRepository`,
  `DevolucionSla*`, `CierreDiaService` y `order-status*`. Las fichas **235/236/237** tocan
  `/novedades` y `MisAsignacionesService`; la **238** toca `resolverCierre` y `aprobarCierre`. **No
  se trabajan en paralelo con esta**: el conflicto de archivos es directo y la 239 depende de la 238.
- **Antes de registrar cualquier id o rama nuevos**, mirar `origin/dev`: ya hubo dos colisiones de id
  entre sesiones.
