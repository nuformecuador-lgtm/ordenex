# Feature 237 — Tareas

> Leer antes: `requirements.md` (R1-R50, D1-D8) y `design.md`.
>
> **Gate:** `./init.sh --rapido` para cerrar cada tanda; **`./init.sh` completo antes del PR, sin
> excepción**. El gate **no** se corre en paralelo con un subagente que muta el árbol: leería el árbol
> mutado y su veredicto no valdría.
>
> **Punto de despliegue.** Sólo **T1** es inerte (un `ADD VALUE` de enum sin usuarios; y va sola por
> obligación técnica: Postgres no deja usar un valor de enum en la misma transacción que lo añade,
> 55P04). **T2 a T7 van obligatoriamente en un solo PR**: si el servicio sale sin la pantalla no lo
> llama nadie, y si sale la pantalla sin el servicio la tienda pulsa botones que fallan.
>
> **Zona `fullstack` ⇒ se secuencia backend → frontend.** T1-T5 con el subagente de **backend**,
> T6-T7 con el de **frontend**, nunca a la vez sobre los mismos archivos.
>
> ⚠️ **Ficha con dinero.** Ningún monto pasa por `number` ni `parseFloat`: los importes de esta ficha
> no se calculan aquí —los derivan `derivarIngresoBodega`/`derivarPagos` en `Prisma.Decimal`— y esta
> ficha **no escribe ni un importe** (R11). Si alguna tanda necesita tocar uno, se ha equivocado de
> ficha.

---

## T0 — Puerta humana: MEDIR y FIRMAR (sin código)

> Cuatro consultas de **solo lectura** contra producción, por MCP. Las cuatro están escritas en
> `design.md` §16 y se copian tal cual. **Los números se pegan en `progress/impl_237.md` con su fecha
> y su denominador** — un cero sin denominador no dice nada.
>
> En esta pila **medir ya mató una decisión entera antes de llegar a firma** (la 236: los dos ceros
> borraron la pregunta del backfill). Aquí puede pasar lo mismo con D1 y D3.

- [ ] **T0.1 — [DELIBERADAMENTE ABIERTA hasta el despliegue] Re-medir la población en ayuda** (consulta M1). La foto del 2026-08-19 (`ayuda_tienda`
      = 0 sobre 141 vivas) **caduca** en cuanto la 235 lleve días en producción.
      **Hecho:** los números en `progress/impl_237.md`. **Bloquea el despliegue, no T1.**
- [x] **T0.2 — ⚠️ LA MEDICIÓN QUE DECIDE D1** (consulta M2): cuántos cierres viven en `vencido` y
      `rechazado`, y cuántos pasaron por `rechazado → solicitado`.
      **Hecho:** los dos números pegados, **y una frase que diga si la ruta exenta es un caso de borde
      o la normalidad.** Si es la normalidad, D1 deja de poder firmarse «se acepta y se prueba» sin
      hablar de mitigación. **Bloquea D1, y D1 bloquea T3.**
- [x] **T0.3 — Cuánto dinero mueve un rechazo** (consulta M3): rango de
      `tarifa_zona_mensajero.cobro_rechazado`.
      **Hecho:** min/max/media pegados. Es el importe que la tienda se cobra a sí misma con un click;
      va literalmente en la conversación de D3 y de D7. **Bloquea D3 y D7.**
- [x] **T0.4 — Cuánto se deshace hoy** (consulta M4): gestiones anuladas sobre el total, y gestiones
      sin cierre de más de 24 h.
      **Hecho:** los cuatro números. Dimensiona D3 (¿el deshacer se usa?) y da una cota real de cuánto
      tarda una gestión en caer en un cierre. **Bloquea D3.**
- [x] **T0.5 — Firmar las decisiones.** **D1** (la invariante), **D2** (evidencia al reprogramar),
      **D3** (¿puede el mensajero deshacer?), **D4** (el aviso de rechazo), **D5** (hasta dónde se
      extrae la subida), **D6** (qué ve el mensajero), **D7** (los textos), **D8** (el tope del motivo).
      **Hecho:** cada una respondida en `requirements.md` bajo «PUERTA HUMANA PASADA» y transcrita en
      `progress/impl_237.md`. Si alguna se aparta de la recomendación, **el spec se corrige antes de
      escribir código**. **Bloquea T1.**
      > **Las que no se pueden diferir:** **D2** (mueve el contrato zod y todos los tests del borde),
      > **D3** (toca `deshacerGestion`, que es de otra feature y tiene sus propias suites), **D6**
      > (toca el DTO del detalle del cierre) y **D7** (el copy atraviesa tres tandas).

---

## T1 — El valor de enum *(inerte: puede salir suelta, y va sola por obligación técnica)*

- [x] **T1.1 — La migración.** `db/migrations/<ts>_orden_historial_origen_gestion_tienda_ayuda/`
      con `migration.sql` (`ADD VALUE IF NOT EXISTS 'gestion_tienda_ayuda'`) y `down.sql` que
      **recrea el tipo con los 29 valores previos** — copia literal del molde de
      `db/migrations/20260819150000_orden_historial_origen_ayuda_tienda/down.sql`, incluida su
      precondición («si queda alguna fila con el valor, el `USING` falla ruidosamente y el rollback
      aborta: comportamiento correcto») y su nota de rollback encadenado.
      ⚠️ **Los `down.sql` de migraciones anteriores de este enum NO se tocan**: son fotos históricas.
      ⚠️ **La migración va SOLA, sin ningún uso del valor**: Postgres no permite usar un valor de enum
      en la misma transacción que lo añadió (55P04) y Prisma corre cada `migration.sql` en una.
      **Hecho:** `pnpm run db:migrate` aplica y `pnpm run db:rollback` revierte limpio; test de
      integración propio con el molde de `tests/integration/db/ayuda-tienda-migration.test.ts`.
      **Depende de:** T0.5. **Cubre:** R47.
- [x] **T1.2 — El SEED del tipo.** `gestion_tienda_ayuda` entra en
      `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` (`lib/types/orden-historial.ts`) con su comentario: qué
      transición produce, quién la dispara y **por qué sí entra en `ORIGEN_TIPOS_VISITA_REAL` cuando
      `reprogramacion_tienda` no** (el argumento de `design.md` §7.3, escrito ahí y en ningún otro
      sitio duplicado).
      **Hecho:** el `satisfies` y `_EnsureExhaustive` compilan; `tests/unit/types/orden-historial-types.test.ts`
      gana su caso «la familia está en el SEED y en el enum de la DB, sin drift en ninguna dirección».
      **Depende de:** T1.1. **Cubre:** R5.

**R cubiertos por T1:** R5, R47.

---

## T2 — La lista que cobra dinero *(mismo PR que T3-T7; backend)*

> ⚠️ **La tanda más delicada del PR en una sola línea de código.** Añadir un miembro a
> `ORIGEN_TIPOS_VISITA_REAL` hace que una gestión sume un intento de entrega, y un intento de más
> adelanta el escalado del cron de SLA (99) y dispara el `cobroRechazado` (56) antes de tiempo. Aquí
> lo que se busca es exactamente eso **para esta familia y sólo para esta familia**.

- [x] **T2.1 — `ORIGEN_TIPOS_VISITA_REAL` gana `gestion_tienda_ayuda`.**
      **Hecho:** los **dos** tests que la fijan por igualdad se actualizan **a mano y con nota
      fechada**: `tests/unit/types/orden-historial-types.test.ts:125` y
      `tests/unit/types/criterio-intento-entrega.test.ts:90`.
      ⚠️ **Ese literal ES el contrato**, no un polizón: es el censo cerrado que impide que una familia
      futura entre de rebote. Se **actualiza a `["gestion","gestion_tienda_ayuda"]`**; **jamás** se
      sustituye por una derivación de su propia fuente — quedaría verde para siempre y el candado
      desaparecería sin que nadie lo notara.
      **Hecho también:** el caso R34-c de `criterio-intento-entrega.test.ts:98-107` **sigue verde sin
      tocarse** (deriva `fuera` de la lista) y sigue afirmando que `escalado_devuelta_sla` y
      `reprogramacion_tienda` quedan **fuera**. **Depende de:** T1.2. **Cubre:** R6.
- [x] **T2.2 — El intento se cuenta UNA vez.** Caso nuevo: una orden que pasó por ayuda y fue resuelta
      por la tienda, con su cierre aprobado, cuenta **1** intento; con dos gestiones vigentes en el
      **mismo** cierre aprobado sigue contando **1** (el grano es el cierre, `groupBy(["cierreId"])`).
      **Hecho:** el caso vive junto a los del criterio único y nombra la familia nueva.
      **Depende de:** T2.1. **Cubre:** R7.
- [x] **T2.3 — [P] Lo que NO entra, afirmado.** `ORIGEN_TIPOS_CON_GESTION` **no cambia** (nuestras
      filas nacen con `gestion_orden_id` poblado, mismo caso que `escalado_devuelta_sla` y
      `anclaje_devolucion`) y `ORIGENES_SIN_EVENTO_PUBLICO` **no cambia** (la familia nueva **sí**
      emite evento público).
      **Hecho:** los dos tests que las fijan por igualdad —el de `orden-historial-types.test.ts` para
      la primera y `tests/unit/types/webhook-eventos.test.ts` para la segunda— **verdes sin tocarse**;
      se deja constancia en `progress/impl_237.md` de que se corrieron y no se modificaron.
      **Depende de:** T1.2. **Cubre:** R43, R46.

**R cubiertos por T2:** R6, R7, R43, R46.

---

## T3 — Las dos aristas y su inventario *(mismo PR; backend)*

- [x] **T3.1 — Las aristas `#65` y `#66`** en `lib/types/order-status-transiciones.ts`, dentro de
      `ayuda_tienda`, con `via: "gestion_tienda_ayuda"`. **Y ninguna más** (R1): `entregada`,
      `devolucion_por_confirmar` e `incidente` **no se declaran**.
      **Hecho:** el bloque «LO QUE **NO** SE DECLARA» (`:283-291`) se **reescribe**, no se borra:
      deja de ser cierto para dos de las cinco, y hay que dejar dicho por qué las otras tres siguen
      fuera. **Depende de:** T1.2, T0.5 (D1). **Cubre:** R1, R45 (mitad).
- [x] **T3.2 — El inventario.** `tests/fixtures/inventario-transiciones-140.ts`: dos filas nuevas con
      su `callSite` real (`GestionDesdeAyudaService.gestionar → GestionOrdenRepository.crearGestionDesdeAyuda`),
      y `aristasFlujo: 59 → 61`, `paresUnicos: 57 → 59` (las dos altas son pares nuevos).
      **Hecho:** `tests/unit/domain/order-status-transiciones.guardia.test.ts` y
      `.connectividad.test.ts` verdes; las cifras **se re-derivan del censo**, no se copian del
      comentario. **Depende de:** T3.1. **Cubre:** R45.

**R cubiertos por T3:** R1, R45.

---

## T4 — La maquinaria de evidencias, extraída *(mismo PR; backend)*

- [x] **T4.1 — `lib/services/evidencias-compensadas.ts`** (módulo nuevo, sin Prisma y sin `next/*`):
      `subirEvidenciasCompensadas(storage, { ordenId, prefijo, evidencias })` y
      `compensarEvidencias(storage, paths)`. Bucle **secuencial** y acumulación en `subidos`, tal cual
      está hoy: `Promise.all` haría imposible saber qué se subió antes del fallo.
      **Hecho:** tests propios: falla la subida #k → se retiran las k-1 y **no se devuelve nada**;
      subida completa → N paths e índices 0..N-1 **en orden**. **Depende de:** T0.5 (D5).
      **Cubre:** R17.
- [x] **T4.2 — Cablear `MisAsignacionesService.gestionar`** al módulo, **sin cambiar su conducta
      observable**: sigue subiendo antes de la transacción, sigue compensando en los dos fallos
      (subida y transacción) y sigue firmando las URLs igual.
      **Hecho:** `tests/unit/services/mis-asignaciones-evidencias.test.ts` **verde**; si algún caso
      miraba la estructura en vez de la conducta, se re-apunta al módulo con nota. **Ni un caso se
      borra.** **Depende de:** T4.1. **Cubre:** R17.
      > `IncidenteAdminService` (la segunda copia, feature 158) **queda fuera** por D5(a): se anota
      > como deuda declarada con dueño en `progress/impl_237.md`. Que quede escrito por qué, no como
      > omisión.

**R cubiertos por T4:** R17.

---

## T5 — El servicio, el repositorio y el borde *(mismo PR; backend)*

- [x] **T5.1 — `GestionOrdenRepository.crearGestionDesdeAyuda`** (`design.md` §4.4): `updateMany`
      **guardado por `estatusId = ayuda_tienda`** → `count === 0` ⇒ `null` sin efectos; gestión con
      `mensajeroId` = el mensajero y `cierreId: null`; N filas de evidencia en la **misma**
      transacción; append por el choke point con `actorUsuarioId` = **la tienda** y
      `origenTipo: "gestion_tienda_ayuda"`.
      **NO** toca `usuario.ordenEnGestionId` (reutilizar el bloque de `crearGestionYTransicionar:460`
      **le arrancaría al mensajero otra orden que estuviera gestionando**), **NO** toca
      `mensajeroAsignadoId` ni `prioridad`, **NO** escribe ubicación y **NO** encola reoptimización.
      El INSERT de gestión + evidencias se **extrae a un helper privado** compartido con
      `crearGestionYTransicionar`.
      **Hecho:** tests de repositorio con: (a) el `where` del `updateMany` lleva el estatus de origen y
      `deletedAt: null` y **nada más**; (b) `count = 0` ⇒ ni `create`, ni `createMany`, ni append;
      (c) la fila nace con `cierre_id NULL` y el `mensajero_id` del **mensajero**; (d) el append lleva
      actor = **tienda** y la familia nueva; (e) un caso testigo afirma que **`usuario.update` no se
      llama**. **Depende de:** T3.1. **Cubre:** R2, R3, R4, R5, R9, R10, R24, R25, R28.
- [x] **T5.2 — `lib/types/gestion-desde-ayuda.ts`** (borde zod, `design.md` §11).
      `RESULTADOS_DESDE_AYUDA` con **dos** literales; unión discriminada; `evidenciasSchema`,
      `motivoSchema` y `fechaFuturaSchema` **reutilizados** — los dos últimos hay que **exportarlos**
      desde `lib/types/gestion-orden.ts`, **no copiarlos**: una segunda copia de «mañana o posterior en
      el calendario de CR» es una segunda verdad sobre una fecha, y ese archivo ya explica el
      off-by-one que costó.
      **Hecho:** tests del schema: un `resultado` fuera de los dos **no parsea**; sin motivo, sin foto
      o con foto de MIME/ tamaño inválido **no parsea**; fecha de hoy o pasada **no parsea**; y un caso
      afirma que **`entregada`, `devuelta` e `incidente` no son valores posibles** (R1).
      **Depende de:** T0.5 (D2, D8). **Cubre:** R1, R12, R13, R14.
- [x] **T5.3 — `GestionDesdeAyudaService`** con las ocho comprobaciones de `design.md` §6, en ese
      orden. La autorización sale de `autorizarSobreHilo` + `estaEnVentanaDeEscritura` —**la misma
      puerta del hilo, estrechada a `adminTienda`**, no una segunda tabla de permisos—.
      **Hecho:** tests de servicio con un caso por puerta: rol ajeno ⇒ `forbidden`; **mensajero
      asignado ⇒ `forbidden`** (R20: es el bypass de `estaBloqueado` y se ataca de frente); tienda que
      no es la dueña ⇒ `forbidden` **sin revelar nada** de la orden; orden fuera de `ayuda_tienda` ⇒
      `conflict`; orden sin mensajero asignado ⇒ `conflict` **sin crear gestión**; catálogo incompleto
      ⇒ fallo cerrado; y el repo devolviendo `null` ⇒ `conflict` **y las evidencias compensadas**.
      **Depende de:** T5.1, T5.2, T4.1. **Cubre:** R8, R15, R16, R18, R19, R20, R21, R22, R23, R26.
- [x] **T5.4 — [P] La Server Action** `lib/actions/gestion-desde-ayuda.ts`: `FormData` con
      `getAll("evidencia")`, `withErrorHandler`, `unauthenticated` **antes** de tocar el servicio.
      **Hecho:** `sin sesión ⇒ unauthenticated` sin ni una llamada al servicio; `resultado` inválido ⇒
      `validation_error`; N archivos ⇒ N evidencias con índices 0..N-1 en orden.
      **Depende de:** T5.3. **Cubre:** R13.
- [x] **T5.5 — El deshacer (D3).** **Sólo si D3 se firma como (b):** `deshacerGestion` rechaza con
      `conflict` y mensaje accionable las gestiones cuya transición lleva la familia nueva. La lectura
      usa **el mismo patrón** que `whereIntentosVigentes` (repetir `ordenId` dentro del `some` para
      entrar por `@@index([ordenId, createdAt])`), no un índice nuevo.
      **Hecho:** un caso por sentido: gestión de la tienda ⇒ `conflict` con su mensaje; gestión propia
      del mensajero sobre la misma orden ⇒ **sigue deshaciéndose** (no se rompe el deshacer de nadie).
      Si D3 se firma como (a), esta task se sustituye por un test que **afirma** que el mensajero puede
      deshacerla y que con ello **desaparecen el intento y el aporte al cierre** (R39).
      **Depende de:** T5.1, T0.5 (D3). **Cubre:** R38, R39.

**R cubiertos por T5:** R1, R2, R3, R4, R8, R9, R10, R12, R13, R14, R15, R16, R18, R19, R20, R21, R22,
R23, R24, R25, R26, R28, R38, R39.

---

## T6 — El dinero y el cierre, afirmados *(mismo PR; backend)*

> Sin código de producción nuevo: esta tanda **demuestra** lo que §7 y §8 del diseño afirman. Es la
> tanda que la revisión va a leer primero.

- [x] **T6.1 — La gestión cae en el cierre del mensajero.** Un caso end-to-end de repositorio: la
      tienda gestiona → `crearCierre` del mensajero la **vincula** (`{ mensajeroId, cierreId: null,
      anuladaAt: null }`) → aparece en `findGestionesPendientes` y en el snapshot con su fila de
      `cierre_detail`.
      **Hecho:** verde, **y con la mutación de T8.1 detrás**. **Depende de:** T5.1. **Cubre:** R29.
- [x] **T6.2 — El dinero es el mismo.** Comparación explícita: para el mismo resultado sobre la misma
      orden, los movimientos que producen los cinco feeds al aprobar el cierre son **iguales** venga
      la gestión del mensajero o de la tienda. En particular `rechazada` ⇒ `cobroRechazado` de la
      tarifa **del mensajero**, y `reprogramada` ⇒ `0.00` en pago e ingreso.
      **Hecho:** un caso por resultado, con los importes como **string** (nunca `number`).
      **Depende de:** T6.1. **Cubre:** R30.
- [x] **T6.3 — ⚠️ LA INVARIANTE (R32, D1).** El caso que la ficha daba por sentado y que hay que
      **ejercer**: mensajero con cierre `rechazado` → pide ayuda → re-solicita por la ruta exenta
      (`CierreDiaService.ts:447`, que **no** consulta pendientes) → la tienda gestiona → la gestión
      nace con `cierre_id NULL`, **NO** está en el cierre en curso, y el **siguiente** `crearCierre` la
      vincula. Y el espejo con `vencido` (`:432`).
      **Hecho:** dos casos, uno por ruta, que afirman las tres cosas: (a) el cierre en curso **no** la
      contiene; (b) sus totales **no cambian** (R31); (c) el siguiente cierre **sí** la contiene, y
      **sólo** el siguiente. **Depende de:** T6.1, T0.5 (D1). **Cubre:** R31, R32.
- [x] **T6.4 — [P] El bloqueo y sus dos exenciones siguen como estaban.**
      **Hecho:** `ayuda_tienda` sigue en `ESTADOS_PENDIENTES` y bloquea la **creación**; las dos rutas
      de re-solicitud **siguen exentas**. Los casos de la 235 que lo afirman quedan **verdes sin
      tocarse** y se deja constancia. **Depende de:** T5.1. **Cubre:** R33, R34.
- [x] **T6.5 — [P] El paquete entra en la confirmación física.** Una gestión de la tienda
      (`reprogramada` o `rechazada`) vinculada a un cierre aparece en
      `findGestionesRetornablesDelCierre` y **bloquea la aprobación** hasta que se confirme.
      **Hecho:** un caso por resultado. **Depende de:** T6.1. **Cubre:** R35.
- [x] **T6.6 — [P] Los KPI del mensajero no se mueven.** Antes y después de la gestión de la tienda, el
      «Total a cobrar del día» es **el mismo**: la orden sale de `conAyuda` y entra en
      `sumMontoCobrarGestionadas`. Y los dos sumandos siguen **disjuntos**.
      **Hecho:** un caso que compara el total antes/después y otro que afirma la disjunción.
      **Depende de:** T5.1. **Cubre:** R36.
- [x] **T6.7 — [P] Nada nuevo en la transacción de aprobación.**
      **Hecho:** `tests/unit/repositories/cierres-admin-caja-cod.test.ts`,
      `cierres-admin-confirmacion-fisica.test.ts`, `cierres-admin-anclaje-devolucion.test.ts` e
      `cierres-admin-indemnizacion.test.ts` **verdes sin modificarse**, con su resultado pegado. Un
      rojo ahí **no es una aserción a actualizar**: es que aterrizó trabajo que no es de esta ficha.
      Y un caso afirma que el bloque de **anclaje (239) nunca alcanza** una gestión de esta familia
      (sólo mira `resultado: "devuelta"`, y desde ayuda no se puede devolver).
      **Depende de:** T6.1. **Cubre:** R37.
- [x] **T6.8 — [P] El aviso de rechazo (D4).** Según la firma: con (a), un caso afirma que el rechazo
      de la tienda **no** emite «orden rechazada por el destinatario» —y el comentario de
      `lib/notificaciones/emitir.ts:130-137` deja escrito que la ausencia es **decisión**—; con (c), el
      aviso se emite con **texto propio** y su caso.
      **Hecho:** el caso, y la anotación en el código. **Depende de:** T5.1, T0.5 (D4). **Cubre:** R44.

**R cubiertos por T6:** R29, R30, R31, R32, R33, R34, R35, R36, R37, R44.

---

## T7 — La pantalla *(mismo PR; subagente de FRONTEND)*

- [x] **T7.1 — Dos celdas en `ACCIONES_POR_GRUPO`**: `reprogramarDesdeAyuda` y `rechazarDesdeAyuda` en
      el grupo `ayuda`, con **claves propias** (no las de `devolucion`: `design.md` §12.1). El
      comentario que dice «`reprogramar` y `rechazar` NO están en `ayuda`… es la ficha 237»
      (`novedad-acciones-catalogo.ts:58-61`) se **reescribe**, no se borra.
      **Hecho:** `tests/unit/types/novedad-acciones-catalogo.test.ts` fija el juego exacto del grupo
      `ayuda` (seis acciones) y sigue afirmando que ninguna acción declarada queda sin grupo.
      **Depende de:** T5.4, T0.5 (D7). **Cubre:** R1 (mitad).
- [x] **T7.2 — La ventana `GestionarDesdeAyudaModal`**, molde de `ReportarIncidenteModal`: un
      componente con `modo`, motivo + 1..N fotos (con compresión y tope), fecha sólo en reprogramar, y
      **el aviso fijo de D7 arriba y siempre visible**.
      **Hecho:** tests de componente: el envío está **bloqueado** sin motivo, sin foto o sin fecha **y
      el motivo del bloqueo se lee con palabras**; el aviso del precio se lee tal cual; N fotos viajan
      como N valores de la clave `evidencia`; un `validation_error` del servidor se pinta **sin perder
      lo capturado**. **Depende de:** T7.1. **Cubre:** R12 (superficie), R13 (superficie).
- [x] **T7.3 — [P] Cablear en `NovedadesModule`**: estado `ordenAGestionarDesdeAyuda` con montaje
      condicional y `key={orden.id}`, mismo patrón que los tres modales que ya viven ahí.
      **Hecho:** con el modal cerrado, la ventana **no está en el árbol**; tras el éxito la fila sale de
      la pestaña y **el total baja**. **Depende de:** T7.2. **Cubre:** R27.
- [x] **T7.4 — [P] La carrera, dicha en pantalla (R25).** Si el servicio responde `conflict`, la
      pantalla **no afirma** que gestionó: usa el texto de D7 y **recarga la página** para que la fila
      desaparezca por el dato y no por optimismo.
      **Hecho:** un caso para el camino feliz y otro para el `conflict`. Es literalmente la lección de
      236/D8 sobre esta misma card. **Depende de:** T7.3. **Cubre:** R25 (superficie).
- [x] **T7.5 — [P] El portal del mensajero (R40/R41, D6).** La orden desaparece de su apartado de
      ayuda (sale gratis: el portal lee tres estatus) **y** la fila del detalle de su cierre del día
      dice que la gestionó **la tienda**.
      **Hecho:** un caso lee el rótulo en la fila del cierre; y un caso afirma que el apartado de ayuda
      ya no la lista. **Depende de:** T6.1, T0.5 (D6). **Cubre:** R40, R41.

**R cubiertos por T7:** R1 (mitad), R25, R27, R40, R41.

---

## T8 — Mutación: matar lo que este PR promete

> Este repo ya tuvo un arnés de mutaciones que reportó 9/9 supervivientes **dos veces sin haber
> ejecutado un test**. **Sin salida real pegada, la task no cuenta.** Y el log largo **no se canaliza
> por `tail`**: se escribe a archivo y se lee después.

- [x] **T8.1 — 💰 El `mensajero_id` de la fila.** Cambiar `mensajeroId` por el de la tienda en
      `crearGestionDesdeAyuda` y comprobar que **T6.1 y T6.2 caen**. Es la mutación que protege el
      dinero: con la tienda ahí, la gestión no se vincula a ningún cierre **nunca** y desaparece de los
      cinco feeds sin que nada falle.
      **Hecho:** salida real pegada en `progress/impl_237.md`, con los nombres de los tests que caen.
      **Depende de:** T6.
- [x] **T8.2 — 💰 La visita real.** Quitar `gestion_tienda_ayuda` de `ORIGEN_TIPOS_VISITA_REAL` y
      comprobar que **T2.1 y T2.2 caen**. Sin esto, la gestión de la tienda **no contaría como
      intento** y la ficha incumpliría su promesa central en silencio.
      **Hecho:** ídem, con salida real. **Depende de:** T2.
- [x] **T8.3 — La guarda de la carrera.** Quitar `estatusId` del `where` del `updateMany` y comprobar
      que caen los casos de T5.1(a)/(b) y T7.4. Es la mutación que protege contra que la tienda
      gestione una orden que el mensajero ya recuperó.
      **Hecho:** ídem. **Depende de:** T5, T7.
- [x] **T8.4 — [P] La compensación.** Hacer que `compensarEvidencias` no borre nada y comprobar que
      caen los casos de T4.1 y el de T5.3 («el repo devuelve `null` ⇒ evidencias compensadas»).
      **Hecho:** ídem. **Depende de:** T4, T5.
- [x] **T8.5 — Guardias completas.** `pnpm run test:guardias` entero, con **atención especial** a
      `anclaje-vs-intentos`, `deriva-primer-intento`, `novedad-acciones-una-tabla`,
      `gestion-ubicacion-solo-escritura`, `hilo-ventana-alcanzable`, `orden-nota-frontera`,
      `ordenes-columnas-money-safe`, `dinero-sin-centimos` y `aprobacion-escrituras-cubiertas`.
      **Hecho:** todas verdes, **y la lista con su resultado pegada**. Un rojo en las dos primeras
      significa que alguien **fusionó el criterio de intento con el anclaje**: es la trampa que el
      diseño de la pila nombra, y es regresión. **Depende de:** T8.1-T8.4.

---

## T9 — VER LA APP, no sólo la suite

- [x] **T9.1 — El recorrido.** En esta pila un recorrido de minutos encontró **un cierre que no se
      podía aprobar nunca** (238/T5.6) y **dos defectos de card** (235). Recorrido completo:
      1. como **mensajero**: pedir ayuda sobre una orden con monto a cobrar → anotar su «Total a
         cobrar del día»;
      2. como **`adminTienda`**: entrar a `/novedades`, pestaña «Ayuda solicitada», **leer el motivo**
         en la conversación;
      3. **rechazar** desde la card: comprobar que sin foto y sin motivo **no deja enviar y dice por
         qué**, y **leer el aviso del precio** tal cual sale en pantalla;
      4. enviar → la fila sale de la pestaña y el total baja;
      5. como **mensajero**: la orden **ya no está** en su apartado de ayuda, **está** en su «Cierre
         del día» **rotulada como hecha por la tienda**, y su «Total a cobrar del día» **no cambió**;
      6. intentar **deshacerla** y comprobar lo que D3 diga, **leyendo el mensaje**;
      7. solicitar cierre → como **admin**: aprobarlo, y comprobar que la ventana de confirmación
         física **pide ese paquete**;
      8. aprobar → comprobar el `cobroRechazado` **en el ingreso de bodega del cierre** y el intento
         sumado. ⚠️ **Corregido el 2026-08-20:** este paso decía «en la billetera de la tienda» y
         **ahí no aparece** — `cobroRechazado` es ingreso de **bodega**. Lo que sí debita a la tienda
         por un rechazo es `ingreso_flete_devolucion` + IVA, que es **otro** importe y sale de **otra**
         tarifa;
      9. repetir el paso 3 con **reprogramar** y una fecha, y comprobar que la fecha de hoy se rechaza.
      **Hecho:** recorrido anotado paso a paso en `progress/recorrido_237.md` (archivo propio, no
      mezclado con la bitácora), **con los textos leídos tal cual del navegador**.
      **Depende de:** T8.5.
      > 🔑 **Tres muros conocidos — no se redescubren:**
      > 1. **`/novedades` como `adminTienda` exige OTP.** El código se lee del log del servidor de dev
      >    **sólo si su salida va a un ARCHIVO**, no por una tubería: con `pnpm dev > dev.log 2>&1` la
      >    línea `Codigo OTP generado: NNNNNN` aparece en menos de un segundo. (También queda en
      >    `.next/dev/logs/next-development.log`.)
      > 2. **Un 404 en una ruta que existe puede ser un cliente Prisma rancio.** `prisma generate` no
      >    basta: hay que **reiniciar** el servidor. Mirar el log antes que el código.
      > 3. **La base local necesita la migración de T1** (`prisma migrate deploy`) o el valor de enum
      >    no existe y el append falla en runtime, no en compilación.
- [x] **T9.2 — [P] Nada de PII en registros (R50).** Censo: ningún `console.*` ni registro de
      diagnóstico de los archivos tocados emite el cuerpo del motivo, teléfono, dirección, nombre ni
      número de guía.
      **Hecho:** verde, con la lista de archivos barridos. **Depende de:** T8. **Cubre:** R50.
- [x] **T9.3 — [P] Lo que esta ficha NO toca (R48/R49).** Se corren y se deja constancia de que siguen
      verdes **sin modificarse**: `tests/unit/services/habilitar-novedad-service.test.ts`,
      `tests/components/RepartoAyuda.test.tsx`, `tests/unit/repositories/orden-repository.novedades.test.ts`,
      `tests/unit/guards/hilo-ventana-alcanzable.guardia.test.ts` y las suites del corte diario y del
      plazo de devolución.
      **Hecho:** la lista de suites y su resultado en `progress/impl_237.md`. **Depende de:** T8.
      **Cubre:** R48, R49.

---

## T10 — Cierre documental

- [x] **T10.1 — [P] Corregir la invariante en el diseño de la pila.**
      `progress/design_pila_ayuda_tienda.md` §F3: la frase «`deshacerGestion` sigue funcionando sin
      tocarlo, porque una orden en ayuda bloquea el cierre» **son dos hechos distintos y uno tiene dos
      excepciones**. Se anota con fecha, con lo medido en T0.2 y con la respuesta a D1/D3. La
      «ADVERTENCIA HEREDADA PARA LA FICHA 237» pasa a **resuelta**, citando R32 y su test.
      **Hecho:** ninguna de las dos secciones contradice al código.
- [x] **T10.2 — [P] Anotar el aterrizaje** en `progress/auditoria_ayuda_tienda.md` §4: cae «la gestión
      de la tienda que cuenta como del mensajero».
      **Hecho:** la lista de ausencias queda con una menos, con fecha.
- [x] **T10.3 — [P] Los comentarios que dejan de ser ciertos**, reescritos y no borrados (con qué
      decían y por qué cambió): `lib/types/order-status-transiciones.ts:283-291`,
      `lib/types/orden-historial.ts:76-78` y
      `app/(app)/novedades/_components/novedad-acciones-catalogo.ts:58-61`.
      **Hecho:** ninguno describe un mundo que ya no existe. **Depende de:** T3, T7.
- [x] **T10.4 — Cerrar la ficha.** `feature_list.json` **lo estampa el leader**: estado y `status_note`
      de 3-6 líneas técnicas (el detalle vive en `progress/`, no duplicado en el JSON).
      **Hecho:** `./init.sh` completo verde **con el árbol quieto**, el mapa `R<n> → test` en
      `progress/impl_237.md`, y el SHA medido comparado contra `origin/dev` **justo antes** de abrir el
      PR (`dev` se mueve). **Depende de:** T9, T10.1-T10.3.

---

## Mapa `R<n>` → tanda

| Tanda | R |
| --- | --- |
| T1 | R5, R47 |
| T2 | R6, R7, R43, R46 |
| T3 | R1, R45 |
| T4 | R17 |
| T5 | R2, R3, R4, R8, R9, R10, R12, R13, R14, R15, R16, R18, R19, R20, R21, R22, R23, R24, R25, R26, R28, R38, R39 |
| T6 | R29, R30, R31, R32, R33, R34, R35, R36, R37, R44 |
| T7 | R27, R40, R41 |
| T8 | (mutación: R3, R6, R24, R16) |
| T9 | R48, R49, R50 |
| — | **R11 y R42 son transversales**: ver el mapa de abajo |

---

## Mapa `R<n>` → cómo se prueba

> ⚠️ Los archivos marcados **(NUEVO)** son entregables de esta ficha y **no existen todavía**. Los
> demás **se comprobó que existen hoy en el árbol**. En cuatro fichas anteriores este mapa citó tests
> que no existían; aquí no.

| Req | Cómo se prueba |
| --- | --- |
| R1 | `tests/unit/types/novedad-acciones-catalogo.test.ts` (el grupo `ayuda`) + test del schema **(NUEVO)** «`entregada`/`devuelta`/`incidente` no parsean» + `tests/unit/domain/order-status-transiciones.guardia.test.ts` (sólo dos aristas nuevas) |
| R2 | Test de repositorio **(NUEVO)** — «la fila creada tiene la misma forma que la del mensajero para ese resultado» |
| R3 | ídem — «`mensajero_id` es el de la orden, no el actor» (**mutación T8.1**) |
| R4 | ídem — «el append lleva `actor_usuario_id` = la tienda» |
| R5 | `tests/unit/types/orden-historial-types.test.ts` — «la familia está en el SEED y en el enum de la DB» + test de repositorio **(NUEVO)** «el append lleva `origen_tipo = gestion_tienda_ayuda`» |
| R6 | `tests/unit/types/criterio-intento-entrega.test.ts` y `tests/unit/types/orden-historial-types.test.ts` — la lista pasa a `["gestion","gestion_tienda_ayuda"]` (**mutación T8.2**) |
| R7 | Test del criterio **(NUEVO, junto a `tests/unit/services/intentos-entrega-criterio-unico.test.ts`)** — «una orden resuelta por la tienda suma 1, y dos gestiones en el mismo cierre siguen sumando 1» |
| R8 | Test de servicio **(NUEVO)** — «orden sin mensajero asignado ⇒ `conflict` y el repo no se llama» |
| R9 | Test de repositorio **(NUEVO)** — «la fila nace con `cierre_id NULL`» |
| R10 | ídem — «`usuario.update` **no** se llama» + «el `data` del `updateMany` lleva sólo `estatusId`» |
| R11 | `tests/unit/guards/ordenes-columnas-money-safe.guardia.test.ts` y `tests/unit/guards/dinero-centimos-cuando-existen.guardia.test.ts` **verdes sin tocarse** (T8.5) + T6.2 con importes como string |
| R12 | Test del schema **(NUEVO)** «sin motivo o sin foto no parsea» + `tests/components/…` de la ventana **(NUEVO)** «el envío está bloqueado y dice por qué» |
| R13 | Test del schema **(NUEVO)** (MIME, tamaño, tope de lista) + test de la action **(NUEVO)** «el borde revalida aunque la UI no» |
| R14 | Test del schema **(NUEVO)** — «hoy y ayer no parsean; mañana sí» |
| R15 | Tests de `evidencias-compensadas` **(NUEVO)** — «falla la #k ⇒ se retiran las k-1 y no se persiste nada» |
| R16 | ídem + test de servicio **(NUEVO)** «el repo devuelve `null` ⇒ se compensa» (**mutación T8.4**) |
| R17 | `tests/unit/services/mis-asignaciones-evidencias.test.ts` **verde tras el cableado** + censo **(NUEVO)** «no hay una tercera copia del bucle de subida» |
| R18 | `tests/unit/repositories/gestion-ubicacion-solo-escritura.guardia.test.ts` **verde sin tocarse**: los archivos nuevos no nombran las columnas |
| R19 | Test de servicio **(NUEVO)** — «rol ajeno ⇒ `forbidden`» |
| R20 | ídem — «**mensajero asignado ⇒ `forbidden`**»: es el bypass de `estaBloqueado` y se ataca de frente |
| R21 | ídem — «la puerta es `autorizarSobreHilo` + la ventana; con la ventana cerrada ⇒ `forbidden`» |
| R22 | ídem — «tienda ajena y orden inexistente devuelven **lo mismo**» |
| R23 | ídem — «orden fuera de `ayuda_tienda` ⇒ `conflict`, sin tocar el repo» |
| R24 | Test de repositorio **(NUEVO)** — «el `where` del `updateMany` lleva el estatus de origen» (**mutación T8.3**) |
| R25 | ídem «`count = 0` ⇒ ni gestión ni append» + test de la ventana **(NUEVO)** «con `conflict` la pantalla no afirma que gestionó» |
| R26 | Test de servicio **(NUEVO)** — «el destino sale de `ESTATUS_POR_RESULTADO`, no de `findEstatusIdByValue(resultado)`» |
| R27 | Test de `NovedadesModule` **(NUEVO)** — «tras el éxito la fila sale y el total baja» |
| R28 | Test de repositorio **(NUEVO)** — «dos envíos ⇒ una sola gestión» |
| R29 | T6.1 **(NUEVO)** — «`crearCierre` la vincula y tiene su fila de `cierre_detail`» (**mutación T8.1**) |
| R30 | T6.2 **(NUEVO)** — «mismos movimientos que la del mensajero, por resultado» |
| R31 | T6.3 **(NUEVO)** — «los totales del cierre en curso no cambian» |
| R32 | **T6.3 (NUEVO) — el caso de la invariante**, uno por ruta exenta |
| R33 | Los casos de la 235 sobre `ESTADOS_PENDIENTES` **verdes sin tocarse** (T6.4) |
| R34 | Los casos de la 235 sobre las dos rutas exentas **verdes sin tocarse** (T6.4) |
| R35 | T6.5 **(NUEVO)** — «la gestión de la tienda entra en `findGestionesRetornablesDelCierre` y bloquea la aprobación» |
| R36 | T6.6 **(NUEVO)** — «el total del día no cambia; los dos sumandos siguen disjuntos» |
| R37 | `tests/unit/repositories/cierres-admin-caja-cod.test.ts`, `cierres-admin-confirmacion-fisica.test.ts`, `cierres-admin-anclaje-devolucion.test.ts` e `cierres-admin-indemnizacion.test.ts` **verdes sin modificarse** (T6.7) + caso «el anclaje nunca alcanza esta familia» |
| R38 | T5.5 **(NUEVO)** — según D3: «gestión de la tienda ⇒ `conflict` con su mensaje» **o** «se deshace y con ella se va el intento» |
| R39 | T5.5/T2.2 **(NUEVO)** — «anulada ⇒ deja de contar como intento y de aportar al cierre» |
| R40 | T7.5 **(NUEVO)** — «el apartado de ayuda del portal ya no la lista» |
| R41 | T7.5 **(NUEVO)** — «la fila del cierre del día dice que la gestionó la tienda» |
| R42 | `tests/unit/guards/rastreo-hitos-exhaustivo.guardia.test.ts` **verde sin tocarse** (T8.5): esta ficha no añade ningún estado |
| R43 | `tests/unit/types/webhook-eventos.test.ts` **verde sin tocarse** (T2.3) + caso «el rechazo de la tienda emite el mismo evento que el del mensajero» **(NUEVO)** |
| R44 | T6.8 **(NUEVO)** — según D4 |
| R45 | `tests/unit/domain/order-status-transiciones.guardia.test.ts` y `.connectividad.test.ts` con el inventario actualizado (T3.2) |
| R46 | `tests/unit/types/webhook-eventos.test.ts` **verde sin tocarse** (T2.3) |
| R47 | Test de integración de la migración **(NUEVO)**, molde `tests/integration/db/ayuda-tienda-migration.test.ts`, con `db:rollback` probado |
| R48 | Las dos guardias del criterio de intento y `tests/unit/guards/anclaje-vs-intentos.guardia.test.ts` **verdes sin tocarse** (T8.5) + T2.2 |
| R49 | T9.3 — la lista de suites verdes sin modificarse |
| R50 | Censo de T9.2 |

---

## Paralelismo y conflictos de archivo

- **Dentro de la feature:** las `[P]` de cada tanda tocan archivos distintos. **T0.5 bloquea todo.**
  T1.2 bloquea T2 y T3; T3.1 bloquea T3.2 y T5.1; T5.1 bloquea T5.3-T5.5 y toda la T6; T7.1 bloquea
  T7.2-T7.5. **T2.1 y T2.3 no son paralelas entre sí**: las dos escriben en
  `tests/unit/types/orden-historial-types.test.ts`.
- **Backend antes que frontend.** T1-T6 y T7 **no** se trabajan a la vez: T7 lee contratos que T5
  todavía está moviendo (la Server Action y su tipo de resultado).
- **El gate NUNCA en paralelo con un subagente que muta el árbol**: leería el árbol mutado y su
  veredicto no valdría.
- ⚠️ **CON LA 240 — esta ficha comparte tres archivos y un tipo, y NO VAN EN PARALELO:**
  - **`app/(app)/novedades/_components/novedad-acciones-catalogo.ts`** (`ACCIONES_POR_GRUPO`): la 237
    añade dos celdas al grupo `ayuda`; la 240 **retira** `habilitar` del grupo `devolucion` y cablea
    `rechazar`. Es la **misma tabla** y el **mismo archivo**.
  - **`app/(app)/novedades/_components/NovedadAcciones.tsx`**: las dos añaden entradas a
    `ICONO_POR_ACCION` y props nuevas.
  - **`app/(app)/novedades/_components/NovedadesModule.tsx`**: las dos añaden estado de modal y
    handlers.
  - **`HabilitarNovedadResult`** (`lib/types/novedad-habilitar.ts` / `IHabilitarNovedadService`): la
    236 lo tocó al firmar su D8 y **la 240 lo va a volver a tocar**. Esta ficha **no lo toca** — si
    alguien lo toca aquí, está haciendo trabajo de la 240.
  **Se secuencian: primero una, se mergea, y después la otra.** Si se solaparan, una sobrescribiría a
  la otra **en silencio** — el modo de fallo que la 236 ya nombró en su §13.4.
- **Con la 238 y la 239:** esta ficha **no toca** `resolverCierre` ni `CierresAdminService` (R37). Si
  el diff los toca, se ha equivocado de ficha.
- **Con la 241:** investiga las guardas retiradas en `6a0e6d36`, entre ellas la de mensajero bloqueado.
  **Si la 241 cambia `estaBloqueado` o su alcance, R20 de esta ficha hay que releerlo** — su argumento
  se apoya en que esa guarda existe y bloquea al mensajero.
- **Antes de registrar cualquier id o rama nuevos**, mirar `origin/dev`: ya hubo dos colisiones de id
  entre sesiones.
- **`dev` se mueve:** el pre-vuelo caduca. Comparar el SHA medido contra `origin/dev` **justo antes**
  de abrir el PR.
