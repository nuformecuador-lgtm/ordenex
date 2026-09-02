# Feature 240 — Tareas

> Leer antes: `requirements.md` (R1-R47, D1-D10) y `design.md`.
>
> **Gate:** `./init.sh --rapido` para cerrar cada tanda; **`./init.sh` completo antes del PR, sin
> excepción**. El gate **no** se corre en paralelo con un subagente que muta el árbol: leería el
> árbol mutado y su veredicto no valdría.
>
> **Punto de despliegue.** **T1 es inerte** (un valor de enum y una arista declarada, sin productor
> que la use) y podría salir suelta. **T2, T3, T4, T5 y T6 van obligatoriamente en el mismo PR**: si
> la operación existe y la pantalla no la llama, la guardia de T6 se pone **roja a propósito**; y si
> la pantalla la llama y la operación no existe, no compila.
>
> **Zona `fullstack` ⇒ se secuencia backend → frontend.** T1-T4 con el subagente de **backend**,
> T5-T6 con el de **frontend**, nunca a la vez sobre los mismos archivos.
>
> ⚠️ **No se cita ni un test sin comprobar que existe.** Los marcados **(NUEVO)** son entregables de
> esta ficha; el resto se verificó en el árbol al escribir este spec.

---

## T0 — Puerta humana: medir y firmar *(sin código)*

- [x] **T0.1 — Medir contra producción**, vía MCP de Supabase, **solo lectura**, con las seis
      consultas de `design.md` §18:
      **M1** población viva por estatus (¿cuántas órdenes hay hoy en `devuelta`?) ·
      **M2** cuántas rechaza el cron por plazo vencido, por mes ·
      **M3** 💰 **cuántas órdenes ya pagaron el flete de devolución DOS VECES** (la que decide D2) ·
      **M4** 💰 cuánto cuesta un rechazo, por sus **dos** dueños distintos (bodega y tienda) ·
      **M5** cuántas gestiones sintéticas de la tienda se deshacen hoy (dimensiona D6) ·
      **M6** cuántas sintéticas ya cayeron en un cierre y pasaron por la ventana física (D7).
      **Hecho:** los seis números pegados en `progress/impl_240.md` con su fecha **y su
      denominador** — un cero sin denominador no dice nada. **Bloquea T0.2.**
      > ⏳ **La foto caduca**: M1 y M2 se mueven en cuanto la 239 lleve unos días con volumen.
      > **Re-medir justo antes de desplegar**, no antes de mergear.
- [x] **T0.2 — Firmar las decisiones.** **D1** (qué escribe el rechazo), **D2** (el flete que se
      cobra dos veces, **con M3 delante**), **D5** (motivo sí, evidencia no), **D6** (no se puede
      deshacer), **D7** (el escaneo del 238), **D9** (no hace falta que el plazo venza) y **D10**
      (los textos). D3, D4 y D8 las firma el leader con la recomendación del spec salvo objeción.
      **Hecho:** cada una respondida en `progress/impl_240.md`; si alguna se aparta de la
      recomendación, **el spec se corrige antes de escribir código**. **Bloquea T1.**
- [x] **T0.3 — [P] Decidir si se abren las dos fichas propuestas** (`design.md` §19): el cobro
      repetido del flete (D2/M3) y el deshacer de la reprogramación de escritorio (D6/M5).
      **Hecho:** decisión anotada; si es que sí, **el leader** las estampa en `feature_list.json`
      **mirando antes `origin/dev`** (ya hubo dos colisiones de id entre sesiones). **No bloquea T1.**

---

## T1 — La familia y la arista *(inerte: se puede desplegar suelta)*

- [x] **T1.1 — La migración del valor de enum, SOLA.**
      `db/migrations/<ts>_orden_historial_origen_rechazo_tienda/` con `<ts>` posterior a
      `20260820120000` **y al de la 246 si ésta entra antes** (§Paralelismo):
      `ALTER TYPE … ADD VALUE IF NOT EXISTS 'rechazo_tienda';` + `down.sql` que **recrea el tipo con
      los 30 valores previos**, molde literal del down de la 237, con su precondición y su nota de
      rollback encadenado. `schema.prisma` actualizado.
      **Hecho:** `pnpm run db:migrate` aplica y `pnpm run db:rollback` revierte en local; el test
      de integración de T1.2 verde. ⚠️ **Los `down.sql` anteriores de este enum NO se tocan.**
      **Depende de:** T0.2.
- [x] **T1.2 — [P] Test de integración de la migración (NUEVO).**
      `tests/integration/db/rechazo-tienda-migration.test.ts`, molde literal de
      `tests/integration/db/gestion-tienda-ayuda-migration.test.ts`: el valor existe en el enum,
      aplicar dos veces no rompe, y **el down falla ruidosamente si queda una fila usándolo** (R47).
      **Hecho:** verde contra Postgres real. **Depende de:** T1.1.
- [x] **T1.3 — El valor en `lib/types/orden-historial.ts`**, con su comentario y —lo importante—
      **su razón de NO entrar en `ORIGEN_TIPOS_VISITA_REAL`** (`design.md` §7.3: la orden ya tiene
      contada su `devuelta` real; es el caso de `reprogramacion_tienda`, no el de
      `gestion_tienda_ayuda`). `ORIGEN_TIPOS_CON_GESTION` **no cambia**.
      **Hecho:** `tests/unit/types/orden-historial-types.test.ts` verde con el SEED ampliado **y su
      literal de `ORIGEN_TIPOS_VISITA_REAL` INTACTO**; `tests/unit/types/criterio-intento-entrega.test.ts`
      verde **sin tocarse**. **Depende de:** T1.1.
- [x] **T1.4 — La arista #67** en `lib/types/order-status-transiciones.ts`, dentro de `devuelta`, y
      **reescritura** del comentario «las SIETE salidas… se conservan INTACTAS» (`:321-325`).
      **Hecho:** `tests/unit/domain/order-status-transiciones.guardia.test.ts` y
      `.connectividad.test.ts` verdes. **Depende de:** T1.3.
- [x] **T1.5 — El inventario de transiciones.** `tests/fixtures/inventario-transiciones-140.ts`:
      `aristasFlujo` **61 → 62**, `paresUnicos` **se queda en 59**, y el comentario del recuento gana
      el **tercer duplicado** (#21/#67, hermano de #19/#23 y #20/#24). Fila `#67` con su `callSite`.
      **Hecho:** las cifras **re-derivadas**, no copiadas; el archivo explica por qué los pares no
      suben. **Depende de:** T1.4.

**R cubiertos por T1:** R6, R7, R19 (mitad), R44, R47.

---

## T2 — La escritura: helper compartido y `rechazarDesdeDevuelta` *(mismo PR que T3-T6)*

- [x] **T2.1 — Extraer el helper privado `transicionarDesdeDevuelta`** en
      `lib/repositories/GestionOrdenRepository.ts`, con los pasos 1, 2 y 4 de
      `reprogramarDesdeDevuelta` (`:580-639`), y hacer que **aquel método lo use sin cambiar su firma
      ni su conducta**.
      **Hecho:** `tests/unit/repositories/gestion-orden-reprogramar.test.ts` e
      `tests/integration/db/resolver-novedad-reprograma-dinero.test.ts` **verdes sin cambiar una
      aserción**. Si alguna mira la *estructura* de las llamadas y no la conducta, se re-apunta y se
      dice en el commit. **Depende de:** T0.2.
- [x] **T2.2 — `rechazarDesdeDevuelta`** + `RechazarDesdeDevueltaInput` en la interfaz. `data` del
      `updateMany` con **exactamente** `estatusId`; gestión con `resultado: "rechazada"`,
      `cierreId: null`, `motivo`, mensajero **derivado**; append con actor = la tienda y familia
      `rechazo_tienda`.
      **Hecho:** `tests/unit/repositories/gestion-orden-rechazar.test.ts` **(NUEVO)** con un doble
      que **honra el `where`** —nunca un `vi.fn()` que devuelve `{count:1}` a ciegas: un doble mudo
      deja la guarda sin nadie que la mire—. Casos: aplica y crea **una** gestión + **una** fila de
      historial; **una orden que ya salió de `devuelta` no deja NI UN efecto** (R3); segundo envío →
      `false` sin duplicar (R5); sin gestión `devuelta` vigente → **aborta la tx** (R10); el `data`
      lleva una sola clave (R14/R20); **no** se tocan `mensajeroAsignadoId`, `prioridad`,
      `causaDevolucion` ni ubicación (R14/R16). **Depende de:** T2.1.
- [x] **T2.3 — [P] El testigo del choke point.** El inventario de escrituras de estado:
      `tests/unit/repositories/orden-historial-cobertura.test.ts` pasa de **30 a 31** puntos, con la
      entrada `GestionOrdenRepository.rechazarDesdeDevuelta / rechazo_tienda`, y la **igualdad exacta
      contra el SEED** sigue cumpliéndose.
      **Hecho:** verde, sin debilitar la igualdad. **Depende de:** T2.2.
- [x] **T2.4 — [P] El aviso interno que NO se emite (R45).** Un caso que afirma que una transición a
      `rechazada` con la familia nueva **no** produce el aviso «rechazada por el destinatario», y el
      **control positivo** de que con familia `gestion` sí. Se añade el párrafo de esta ficha en
      `lib/notificaciones/emitir.ts:134-150`, junto al de la 237.
      **Hecho:** el caso vive en `tests/unit/repositories/notificacion-orden-rechazada.test.ts`,
      junto a los de la 237; la ausencia es una afirmación, no un hueco. **Depende de:** T2.2.

**R cubiertos por T2:** R3, R4, R5, R8, R9, R10, R11, R12 (mitad), R14, R15, R16, R20, R21, R45.

---

## T3 — El servicio y el borde *(mismo PR)*

- [x] **T3.1 — `RechazoTiendaService`** (`lib/services/`, + su interfaz), espejo de
      `ReprogramacionTiendaService`: las cinco puertas de `design.md` §5, en ese orden.
      **Hecho:** `tests/unit/services/rechazo-tienda-service.test.ts` **(NUEVO)**, molde de
      `tests/unit/services/reprogramacion-tienda-service.test.ts`. Casos: `not_found`; **otro rol** y
      **otra tienda** → `forbidden` **sin revelar el estado** (R2); orden fuera de `devuelta` →
      `conflict` **sin llamar al repo** (R3); catálogo incompleto → `config_error` sin efectos; el
      repo devuelve `false` → `conflict`; camino feliz. **Y dos ausencias afirmadas:** no se consulta
      el bloqueo del mensajero, y **no se exige que el plazo haya vencido** (R25). **Depende de:** T2.2.
- [x] **T3.2 — La Server Action `rechazarNovedad`** en `lib/actions/resolver-novedad.ts`, junto a sus
      dos hermanas, con `rechazarSchema` (**`motivo` obligatorio**, tope reutilizado de
      `gestion-orden.ts`) y el mismo `withErrorHandler`/`toResolverNovedadActionError`.
      **Hecho:** casos añadidos a `tests/unit/actions/resolver-novedad.test.ts`: `ordenId` no-uuid y
      **motivo vacío** → `validation_error` **sin tocar el servicio** (R12); sin sesión →
      `unauthenticated`; el resultado del servicio se propaga tal cual. **Depende de:** T3.1.

**R cubiertos por T3:** R1, R2, R12, R25, R31 (mitad).

---

## T4 — La guarda del deshacer, y el rótulo que dejó de ser cierto *(mismo PR)*

- [x] **T4.1 — Generalizar el predicado de «lo registró la tienda».**
      `lib/utils/gestion-tienda-ayuda-flag.ts` → `gestion-de-la-tienda-flag.ts`:
      `ORIGENES_GESTION_DE_LA_TIENDA` (lista) y `esGestionDeLaTienda`. Los dos consumidores
      (`CierreDiaRepository.ts:342-349`, `CierresAdminRepository.ts:155-158`) pasan de un igual a un
      `in`. El campo del DTO `desdeAyudaTienda` → **`registradaPorLaTienda`**, guiado por el
      typecheck. ⚠️ **`reprogramacion_tienda` NO entra en la lista** (D6), y la razón queda escrita.
      **Hecho:** el rename completo, con `tests/unit/repositories/cierres-admin-repository.test.ts`,
      `tests/unit/repositories/cierre-dia-repository.test.ts` y
      `tests/unit/services/gestion-desde-ayuda-rotulo-cierre.test.ts` verdes. **Depende de:** T1.3.
- [x] **T4.2 — El deshacer bloqueado para la familia nueva (R43).** `CierreDiaService` **no cambia
      una línea** de su guarda 3-bis; lo que cambia es de dónde sale el booleano. El mensaje deja de
      nombrar «su pantalla de ayuda» (D10).
      **Hecho:** en `tests/unit/services/cierre-dia-service.test.ts`, junto a los casos de la 237
      (`:1083-1111`): un caso con la **familia nueva** → `conflict` con el mensaje nuevo, y el
      **control positivo** de que una gestión del mensajero se sigue deshaciendo. **Depende de:** T4.1.
> ⚠️ **T4.3 — EL SPEC CITA UN ARCHIVO EQUIVOCADO, comprobado (2026-08-20).**
> Nombra `RepartoAyudaResueltaPorLaTienda.test.tsx`, que es sobre el **portal del mensajero**
> (237/R40), no sobre el badge del cierre — ése vive en `CierreDiaModule.tsx` y está en la
> superficie de la **246**. Lo verificaron el frontend y la revisión por separado. **Queda abierta
> a propósito**: no es trabajo pendiente, es una cita que corregir en el spec.
- [ ] **T4.3 — [P] El badge del cierre.** La fila de la gestión en el cierre del mensajero y en el
      detalle de admin sigue diciendo **«La tienda»** para el rechazo manual, por el mismo predicado.
      **Hecho:** un caso en `tests/components/RepartoAyudaResueltaPorLaTienda.test.tsx` —el archivo
      que la 237 dejó para exactamente esto— con una gestión de la **familia nueva**, y el rótulo
      leído por su texto. **Depende de:** T4.1.

**R cubiertos por T4:** R43.

---

## T5 — La pantalla *(mismo PR; subagente de FRONTEND, después de T2-T4)*

- [x] **T5.1 — La celda que se borra (R33/R34).** `ACCIONES_POR_GRUPO.devolucion` pierde
      `"habilitar"`; el comentario `:63-68` que declaraba la deuda **con dueño** se sustituye por lo
      que pasó; el JSDoc de `rechazar` deja de decir «MAQUETA hasta la ficha 240».
      **Hecho:** `tests/unit/types/novedad-acciones-catalogo.test.ts` con `JUEGO_ESPERADO.devolucion`
      **actualizado a mano** (⚠️ **ese literal ES el contrato**: jamás se sustituye por una
      derivación de su propia fuente) + dos casos nuevos: «la devolución no ofrece habilitar» y su
      **control positivo** «la ayuda sí». **Depende de:** T0.2.
- [x] **T5.2 — [P] El botón «Notas» que no vuelve (R36).** Caso explícito: el grupo de devolución
      **no** ofrece `conversacion`, con su control positivo en ayuda. Es lo que la auditoría §3
      echaba en falta —«nada falla si alguien repone el botón»— y hoy sólo está como una línea suelta
      del test del catálogo (`:117-118`).
      **Hecho:** el caso nombra la auditoría y el motivo. **Depende de:** T5.1.
- [x] **T5.3 — Cablear «Rechazar» (R27/R28/R29/R30/R31/R32).** `onDevolver` → **`onRechazar`** en
      `NovedadAcciones`; `avisarNoDisponible` **desaparece** de `NovedadesModule`; entra
      `ordenARechazar` con montaje condicional y `key={orden.id}`; `RechazarNovedadModal.tsx`
      **(NUEVO)**, molde de `ReprogramarNovedadModal`, con el aviso fijo de D10 arriba y siempre
      visible, motivo obligatorio y **sin selector de fotos**.
      **Hecho:** `tests/components/RechazarNovedad.test.tsx` **(NUEVO)**: se abre desde la fila de
      devolución; **el bloqueo se lee por su TEXTO, no por el `disabled`** (R29); confirma → llama a
      la acción con `{ordenId, motivo}` y la fila sale con su total (R30); `conflict` → dice qué pasó
      y **no** afirma que rechazó (R31); cerrar sin confirmar **no** llama a la acción; y **el aviso
      del precio y del «no se puede deshacer» está en el árbol antes de confirmar** (R28).
      **Depende de:** T3.2, T5.1.
- [x] **T5.4 — [P] Los comentarios que dejaron de ser ciertos.** El fixture del canal `info` de
      `tests/components/NovedadesModule.test.tsx:79-81` («los dos botones de MAQUETA avisan por él»),
      el JSDoc de `onDevolver` (`NovedadAcciones.tsx:87-88`) y la nota de `:141-143` («el prop
      conserva su nombre porque nombra la transición que falta decidir»).
      **Hecho:** reescritos contando **qué decían y qué cambió**; ninguno borrado en silencio.
      **Depende de:** T5.3.
- [x] **T5.5 — [P] El censo de la card, en sus dos sitios.**
      `tests/components/NovedadAcciones.test.tsx:125-131` (la fila de devolución pasa de cinco
      controles a cuatro) y `tests/components/NovedadesModule.test.tsx:877-882`.
      **Hecho:** los dos censos actualizados a mano, con nota fechada. **Depende de:** T5.3.

**R cubiertos por T5:** R27, R28, R29, R30, R31, R32, R33, R34, R35, R36.

---

## T6 — La guardia contra la maqueta *(mismo PR; frontend)*

- [x] **T6.1 — `PRODUCTOR_POR_ACCION`** en el catálogo, con `satisfies Record<AccionNovedad, …>`
      (R37) y las ocho entradas de `design.md` §11.1.
      **Hecho:** el typecheck **rompe** al añadir una acción a la unión sin su productor — esa es la
      señal buscada, y se comprueba a mano una vez. **Depende de:** T3.2, T5.1.
- [x] **T6.2 — La guardia (NUEVO).** `tests/unit/guards/novedad-acciones-sin-maqueta.guardia.test.ts`,
      hermana de `novedad-acciones-una-tabla.guardia.test.ts` y con su misma forma: los tres frentes
      de §11.2 (el productor **existe**, el productor **está importado por algún archivo de la
      pantalla**, la excusa **es legible y caduca**), leyendo el fuente **sin comentarios** con
      `tests/fixtures/sin-comentarios`.
      **Hecho:** verde sobre el árbol real; **anti-vacuidad** (≥ 8 archivos, ninguno vacío, las ocho
      entradas encontradas); y **autocomprobación dentro del propio archivo** (R40) en las cuatro
      direcciones: productor inventado → roja; productor real sin importador → roja; `sinOperacion`
      con «TODO» → roja; tabla real → limpia.
      ⚠️ **El censo se escribe en un archivo de test, nunca por `node -e`**: ahí `\b` llega como
      backspace y el censo miente en verde. **Depende de:** T6.1.
- [x] **T6.3 — La prueba de fuego de la guardia: replantar la maqueta.** Volver a poner
      `rechazar: { sinOperacion: "…" }` con un motivo cualquiera **y** el handler de toast, y
      comprobar que la guardia **se pone roja** y por qué.
      **Hecho:** salida real pegada en `progress/impl_240.md`. Sin esa salida no cuenta: este repo ya
      tuvo un arnés de mutaciones que reportó 9/9 supervivientes **dos veces sin haber ejecutado un
      test**. **Depende de:** T6.2.

**R cubiertos por T6:** R37, R38, R39, R40.

---

## T7 — Mutaciones, dinero y guardias completas

- [x] **T7.1 — 💰 Mutación: la guarda del `updateMany`.** Quitar `estatusId: estatusDevueltaId` del
      `where` y comprobar que **cae** el caso testigo de T2.2 («una orden que ya salió de `devuelta`
      no deja ni un efecto»).
      **Hecho:** salida real con el nombre del test que cae. **Depende de:** T2.2.
      > ⚠️ Un test de servicio **no ve el `WHERE`**: esta mutación la mata el test del **repositorio**
      > y sólo él. Está medido cuatro veces en este repo; no se cita otro archivo.
- [x] **T7.2 — [P] 💰 Mutación: el mensajero atribuido.** Sustituir el mensajero derivado por
      `input.actorUsuarioId` (la tienda) y comprobar que cae el caso que afirma a quién se atribuye
      la gestión. Es la mutación que protege R9: con la tienda ahí, `crearCierre` **no vincularía la
      fila a ningún cierre nunca** y el rechazo sería invisible y gratis.
      **Hecho:** salida real. **Depende de:** T2.2.
- [x] **T7.3 — [P] 💰 Mutación: la familia y el intento.** Meter `rechazo_tienda` en
      `ORIGEN_TIPOS_VISITA_REAL` y comprobar que **cae** el literal de
      `tests/unit/types/orden-historial-types.test.ts` y el de
      `tests/unit/types/criterio-intento-entrega.test.ts`. Es la mutación que protege R19: contar de
      más adelanta el escalado de otras órdenes y cobra antes de tiempo.
      **Hecho:** salida real con los dos archivos. **Depende de:** T1.3.
- [x] **T7.4 — [P] Mutación: la celda borrada.** Reponer `"habilitar"` en
      `ACCIONES_POR_GRUPO.devolucion` y comprobar que caen los casos de T5.1 y T5.5. **Es la mutación
      que protege el punto 12** — el defecto que esta ficha viene a cerrar.
      **Hecho:** salida real. **Depende de:** T5.5.
- [x] **T7.5 — Guardias completas.** `pnpm run test:guardias` entero. Verdes obligatorias:
      `superficie-de-uso`, `novedad-acciones-una-tabla`, `novedad-acciones-sin-maqueta` (la nueva),
      `hilo-ventana-alcanzable`, `orden-nota-frontera`, `ordenes-columnas-money-safe`,
      `dinero-sin-centimos`, `anclaje-vs-intentos`, `deriva-primer-intento`,
      `aprobacion-escrituras-cubiertas` y las transiciones exhaustivas.
      **Hecho:** todas verdes. Un rojo en los criterios de intento o en el anclaje significa que
      alguien fusionó dos derivaciones que la pila mantiene separadas a propósito: **es regresión, no
      una aserción a cambiar.** **Depende de:** T6, T7.1-T7.4.
- [x] **T7.6 — [P] Los rojos que serían regresión, comprobados uno a uno.** La lista de
      `design.md` §15, en particular `cierres-admin-caja-cod`, los cuatro de idempotencia de wallet,
      `devolucion-sla-*` y `webhook-eventos`.
      **Hecho:** anotado en `progress/impl_240.md` **qué suites se corrieron y con qué resultado**,
      no «verdes» a bulto. **Depende de:** T7.5.

**R cubiertos por T7:** R17, R18, R19, R21, R22, R41, R42, R44, R46 (+ verificación cruzada).

---

## T8 — Ver la app, no sólo la suite

> En esta pila un recorrido de minutos encontró **un cierre imposible de aprobar**, **dos defectos de
> card** y **un botón que siempre fallaba** que doce mil tests daban por buenos. No es opcional.

- [x] **T8.1 — El recorrido, como `adminTienda`.** Entrar a `/novedades` → pestaña «En devolución» →
      comprobar que la card **ya no tiene «Habilitar»** ni «Conversación» → pulsar **«Rechazar»** →
      **leer el aviso del precio y del “no se puede deshacer”** → intentar confirmar sin motivo y
      **leer el texto del bloqueo** → escribir el motivo → confirmar → ver la fila salir y **el total
      bajar** → comprobar que **no** aparece en «Rechazadas por plazo vencido» → y que la pestaña
      «Ayuda solicitada» **sigue teniendo «Habilitar»**.
      **Hecho:** recorrido anotado paso a paso en `progress/recorrido_240.md` (archivo propio, para
      no mezclarlo con la bitácora del implementer), **con los textos leídos tal cual**.
      ⚠️ **`/novedades` como `adminTienda` exige OTP**, y el código **se lee del log del dev server**:
      hay que lanzarlo con la salida redirigida a un **archivo** (`... > dev.log 2>&1 &`) y leer el
      archivo. **Canalizar por `tail` un proceso en segundo plano trunca el fichero en origen** y el
      código se pierde. **Depende de:** T7.5.
> ⏳ **T8.2 — NO HECHA, y se dice.** La mitad del mensajero y de la bodega no se recorrió. **T8.1 y
> T8.3 SÍ**: el rechazo se ejecutó de verdad contra Postgres —1 fila de historial con
> `rechazo_tienda`, actor = la tienda, y la **gestión sintética con `mensajero_id` puesto y
> `cierre_id` NULL**, que es la paridad firmada—. Lo que falta es ver esa orden **desde el
> mensajero y desde bodega**. En esta pila, lo que no se mira no está verificado.
- [ ] **T8.2 — La mitad del mensajero y de la bodega (D6/D7).** Con la orden ya rechazada: entrar
      como **mensajero** y comprobar que la gestión aparece en su cierre con el badge **«La tienda»**
      y que **«Deshacer» está bloqueado con el mensaje nuevo** (sin nombrar la pantalla de ayuda).
      Después, como **admin**: aprobar ese cierre y **ver qué pide la ventana de confirmación física
      de la 238** — si pide escanear el paquete ya devuelto, **anotarlo con captura**: es D7 y es la
      diferencia entre fricción y bloqueo.
      **Hecho:** anotado en `progress/recorrido_240.md`, con lo que la ventana pidió **y si se pudo
      aprobar**. **Depende de:** T8.1.
- [x] **T8.3 — [P] Contra Postgres, no contra la pantalla.** Comprobar por MCP (solo lectura) que
      quedó **una** fila de `gestion_orden` (`rechazada`, `cierre_id NULL`, mensajero derivado) y
      **una** de `orden_historial_estado` (familia nueva, `actor_usuario_id` = la tienda,
      `gestion_orden_id` poblado); y que **el ancla de la devolución sigue ahí, intacta** (R24).
      **Hecho:** las filas pegadas en el recorrido. La pantalla puede enseñar lo correcto con la base
      mal escrita. **Depende de:** T8.1.

**R cubiertos por T8:** R23, R24, R26, R28, R29, R30, R33, R34, R36, R43 (verificación en vivo).

---

## T9 — Cierre documental

- [x] **T9.1 — [P] Anotar la auditoría.** `progress/auditoria_ayuda_tienda.md`: **cae «Hace lo
      contrario (1): el punto 12»** —la última línea de §4 con dueño— y §3 gana la nota de que la
      guardia que faltaba ya existe, con su nombre. De §4 queda **sólo el desenlace de las no
      gestionadas**. **Depende de:** T8.
- [x] **T9.2 — [P] Anotar el diseño de la pila.** `progress/design_pila_ayuda_tienda.md` §F6: fecha,
      PR y respuestas a D1-D10. ⚠️ **Corregir su tercera viñeta**: la 228 ya la declaró superada la
      **236**; aquí no queda nada que cerrar. **Depende de:** T8.
- [ ] **T9.3 — Cerrar la ficha.** `feature_list.json` (lo estampa **el leader**): estado,
      `status_note` de **3-6 líneas técnicas** —el detalle vive en `progress/`, no duplicado en el
      JSON— y el mapa `R<n> → test` en `progress/impl_240.md`.
      **Hecho:** `./init.sh` completo verde **con el árbol quieto**, y el SHA medido comparado contra
      `origin/dev` **justo antes** de abrir el PR (`dev` se mueve). ⚠️ **Verificar el blob
      commiteado**, no el árbol: otra sesión puede haber reseteado la rama.
      **Depende de:** T7, T8, T9.1, T9.2.

---

## Mapa `R<n> → tanda`

| Tanda | R cubiertos |
| --- | --- |
| T1 | R6, R7, R19 (mitad), R44, R47 |
| T2 | R3, R4, R5, R8, R9, R10, R11, R12 (mitad), R14, R15, R16, R20, R21, R45 |
| T3 | R1, R2, R12, R25, R31 (mitad) |
| T4 | R43 |
| T5 | R27-R36 |
| T6 | R37, R38, R39, R40 |
| T7 | R17, R18, R19, R21, R22, R41, R42, R44, R46 |
| T8 | R23, R24, R26 (+ verificación en vivo de R28-R30, R33, R34, R36, R43) |
| T9 | — (documental) |

---

## Mapa `R<n> → test`

> ⚠️ Los **(NUEVO)** son entregables de esta ficha. Los demás **existen hoy en el árbol**,
> verificados al escribir este spec. En cinco fichas anteriores este mapa citó tests que no existían
> y en dos costó un rechazo.

| Req | Test |
| --- | --- |
| R1 | `tests/unit/services/rechazo-tienda-service.test.ts` **(NUEVO)** — «el adminTienda dueño rechaza una orden en `devuelta`» |
| R2 | ídem — «otro rol → forbidden» y «otra tienda → forbidden, sin revelar el estado» |
| R3 | `tests/unit/repositories/gestion-orden-rechazar.test.ts` **(NUEVO)** — «una orden que ya salió de `devuelta` no deja ni un efecto» (**mutación T7.1**) · `rechazo-tienda-service.test.ts` — «fuera de `devuelta` → conflict sin llamar al repo» |
| R4 | `gestion-orden-rechazar.test.ts` **(NUEVO)** — el `where` del `updateMany` lleva el estatus de origen (doble que **honra el where**) |
| R5 | ídem — «segundo envío: `false`, sin segunda gestión ni segundo historial» |
| R6 | `tests/unit/domain/order-status-transiciones.guardia.test.ts` · `.connectividad.test.ts` · `tests/unit/types/orden-historial-types.test.ts` |
| R7 | `tests/fixtures/inventario-transiciones-140.ts` — `aristasFlujo: 62`, `paresUnicos: 59` |
| R8 | `gestion-orden-rechazar.test.ts` **(NUEVO)** — «crea una gestión `rechazada` con `cierre_id` nulo» |
| R9 | ídem — «se atribuye al mensajero de la última `devuelta` vigente» (**mutación T7.2**) |
| R10 | ídem — «sin gestión `devuelta` vigente aborta la transacción y no deja el estado cambiado» |
| R11 | ídem — «la fila de historial lleva a la tienda como actor y enlaza la gestión» |
| R12 | `tests/unit/actions/resolver-novedad.test.ts` — «motivo vacío → `validation_error` sin tocar el servicio» · `gestion-orden-rechazar.test.ts` **(NUEVO)** — «el motivo queda en la gestión y en el historial» |
| R13 | `tests/unit/actions/resolver-novedad.test.ts` — «el borde del rechazo acepta `{ordenId, motivo}` y **no** exige ni admite evidencias»; y `tests/components/RechazarNovedad.test.tsx` **(NUEVO)** — «la ventana no monta ningún selector de fotos» |
| R14 | `gestion-orden-rechazar.test.ts` **(NUEVO)** — «el `data` lleva exactamente `estatusId`» + «no se tocan mensajero asignado ni prioridad» |
| R15 | ídem — las tres escrituras dentro del mismo `$transaction` (el doble lo afirma) |
| R16 | ídem — «la gestión nace sin causa de devolución y sin ubicación»; `tests/unit/repositories/gestion-ubicacion-solo-escritura.guardia.test.ts` verde **sin tocarse** |
| R17 | `tests/unit/services/devolucion-sla-dinero.test.ts` verde **sin tocarse** (la aritmética es la misma función) + T7.6 |
| R18 | `gestion-orden-rechazar.test.ts` **(NUEVO)** — «la gestión nace con `cierre_id` nulo: ningún movimiento en el instante del rechazo» |
| R19 | `tests/unit/types/orden-historial-types.test.ts` y `tests/unit/types/criterio-intento-entrega.test.ts` — el literal de `ORIGEN_TIPOS_VISITA_REAL` **sigue intacto** (**mutación T7.3**) |
| R20 | `tests/unit/guards/ordenes-columnas-money-safe.guardia.test.ts` · `tests/unit/guards/dinero-centimos-cuando-existen.guardia.test.ts`, verdes sin tocarse |
| R21 | `gestion-orden-rechazar.test.ts` **(NUEVO)** — «segundo envío» + `tests/unit/repositories/devolucion-sla-repository.test.ts` verde (la carrera con el cron, por la misma guarda) |
| R22 | `tests/unit/utils/ingreso-ordenex.test.ts` — cubre `derivarIngresoOrden`, y esta ficha **no toca esa función**: verde **sin tocarse**. ⚠️ Su verde es *coherencia*, no evidencia de que el rechazo manual facture bien; la evidencia es T7.6 (los cinco feeds) y **M3** de T0.1, que mide el cobro repetido que esa misma función produce hoy (D2) |
| R23 | `tests/unit/repositories/devolucion-sla-repository.test.ts` verde **sin tocarse** (el predicado del cron es `estatus = devuelta`) + T8.3 contra Postgres |
| R24 | T8.3 — el ancla sigue en `orden_historial_estado` tras el rechazo |
| R25 | `rechazo-tienda-service.test.ts` **(NUEVO)** — «se rechaza una orden cuyo plazo NO venció» |
| R26 | `tests/unit/repositories/orden-repository.rechazos-sla.test.ts` — el predicado de la tercera pestaña es la familia del cron, verde **sin tocarse**; + un caso que afirma que una orden con la familia nueva **no** entra |
| R27 | `tests/components/RechazarNovedad.test.tsx` **(NUEVO)** — «la fila de devolución ofrece «Rechazar»» |
| R28 | ídem — «el aviso del precio y del “no se puede deshacer” está antes de confirmar» |
| R29 | ídem — «sin motivo no se puede confirmar, **y lo dice con texto**» (se lee el texto, no el `disabled`) |
| R30 | ídem — «tras rechazar, la fila sale y el total baja» |
| R31 | ídem — «`conflict`: no afirma que rechazó y dice qué pasó» |
| R32 | `tests/unit/guards/novedad-acciones-sin-maqueta.guardia.test.ts` **(NUEVO)** |
| R33 | `tests/unit/types/novedad-acciones-catalogo.test.ts` — `JUEGO_ESPERADO.devolucion` sin `habilitar` (**mutación T7.4**) · `tests/components/NovedadAcciones.test.tsx` — el censo de la fila de devolución |
| R34 | `novedad-acciones-catalogo.test.ts` — control positivo: la ayuda **sí** lo tiene · `tests/components/NovedadesModule.test.tsx` |
| R35 | `tests/unit/services/habilitar-novedad-service.test.ts` verde **sin tocarse** + el typecheck (`HabilitarNovedadResult` no cambia) |
| R36 | `novedad-acciones-catalogo.test.ts` — «la devolución no ofrece `conversacion`», con su control positivo |
| R37 | typecheck (el `satisfies Record<AccionNovedad, ProductorAccion>`), comprobado a mano en T6.1 |
| R38 | `novedad-acciones-sin-maqueta.guardia.test.ts` **(NUEVO)** — frentes 1 y 2, con autocomprobación |
| R39 | ídem — frente 3 (motivo ausente, corto o de relleno) |
| R40 | ídem — el bloque 0 del propio archivo + T6.3 (la maqueta replantada, con salida real) |
| R41 | `tests/unit/services/devolucion-sla-service.test.ts` · `tests/unit/repositories/devolucion-sla-repository.test.ts` · `tests/unit/services/devolucion-sla-dinero.test.ts`, verdes **sin tocarse** |
| R42 | `tests/components/RepartoModule.test.tsx` · `tests/components/RepartoAyuda.test.tsx`, verdes **sin tocarse** |
| R43 | `tests/unit/services/cierre-dia-service.test.ts` — «una gestión de la familia nueva no se deshace, y el mensaje no nombra la pantalla de ayuda», con su control positivo |
| R44 | `tests/unit/types/webhook-eventos.test.ts` verde **sin tocarse** · las guardias de transiciones exhaustivas |
| R45 | `tests/unit/repositories/notificacion-orden-rechazada.test.ts` — «una transición a `rechazada` con la familia nueva **no** emite el aviso», con el control positivo de la familia `gestion` |
| R46 | **Por construcción, y comprobado por censo en el PR:** esta ficha no añade ningún `console.*` ni ningún registro nuevo. Se afirma en la revisión de T7.6 con el censo pegado, no con un test propio — un requisito de ausencia sobre código que no se escribe no tiene dónde vivir mejor |
| R47 | `tests/integration/db/rechazo-tienda-migration.test.ts` **(NUEVO)** — «aplica, re-aplica y el down falla si queda una fila usándolo» |

---

## Paralelismo y conflictos de archivo

**Dentro de la feature**

- T1.1 bloquea T1.2/T1.3; T1.3 → T1.4 → T1.5. T2.1 bloquea T2.2; T2.2 bloquea T2.3/T2.4 y T3.1.
  T3.1 → T3.2. T4.1 → T4.2/T4.3. T5.1 → T5.2 y (con T3.2) T5.3 → T5.4/T5.5. T6.1 → T6.2 → T6.3.
- **T2 y T4 no son paralelas:** las dos tocan predicados derivados de la misma familia de historial.
- **Backend antes que frontend:** T5 y T6 leen contratos que T2/T3 todavía están moviendo.
- **T6.1 depende de T3.2**, y no es burocracia: el productor que la tabla declara (`rechazarNovedad`)
  **tiene que existir** o la guardia nace roja.

**Con otras fichas en vuelo**

| Ficha | Estado | ¿Choca? |
| --- | --- | --- |
| **246** — elegir para qué día es la asignación | `spec_ready`, **en vuelo** | **Sí, en dos archivos, y los dos son de baja fricción.** (1) **`db/schema.prisma`**: la 246 añade una columna a `orden`, ésta añade un valor al enum `OrdenHistorialOrigenTipo` (`:1588-1621`) — **regiones distintas del mismo archivo**. (2) **`db/migrations/`**: las dos crean carpeta nueva; **los `<ts>` tienen que ser distintos y el orden importa**, así que la segunda en aterrizar re-numera. **NO chocan** en `lib/repositories/GestionOrdenRepository.ts`, `lib/services/*`, `lib/actions/resolver-novedad.ts`, `lib/types/orden-historial.ts`, `lib/types/order-status-transiciones.ts` ni en **nada** de `app/(app)/novedades/`. ⚠️ La 246 **sí** toca `lib/repositories/DevolucionSlaRepository.ts` y `lib/repositories/OrdenRepository.ts`; **esta ficha no toca ninguno de los dos** (R41), así que la confirmación del spec de la 246 —«la 240 no choca»— **se sostiene**, con la salvedad de los dos archivos de arriba. |
| **237** — la gestión de la tienda cuenta como del mensajero | `done`, **mergeada el 2026-08-20** | **No hay conflicto de escritura**, pero sí de **contrato**: esta ficha generaliza su `desdeAyudaTienda` y su mensaje de deshacer (T4.1/T4.2). Es continuidad, no colisión — la 237 ya no escribe. |
| **236** — la pestaña propia y su card | `done` | **`HabilitarNovedadResult` NO se toca** (D4). Era el punto de coordinación que su D8 dejó firmado; queda cerrado por construcción. |
| **241** — las guardas de bloqueo retiradas | `done` | No. |

**Archivos que esta ficha toca (para que otra sesión lo compruebe de un vistazo)**

`db/schema.prisma` (sólo el enum) · `db/migrations/<ts>_orden_historial_origen_rechazo_tienda/` ·
`lib/types/orden-historial.ts` · `lib/types/order-status-transiciones.ts` ·
`lib/types/rechazo-tienda.ts` (NUEVO) ·
`lib/utils/gestion-tienda-ayuda-flag.ts` → `gestion-de-la-tienda-flag.ts` ·
`lib/repositories/GestionOrdenRepository.ts` · `lib/repositories/CierreDiaRepository.ts` ·
`lib/repositories/CierresAdminRepository.ts` · `lib/interfaces/repositories/IGestionOrdenRepository.ts` ·
`lib/interfaces/services/IRechazoTiendaService.ts` (NUEVO) ·
`lib/services/RechazoTiendaService.ts` (NUEVO) · `lib/services/CierreDiaService.ts` (sólo el mensaje) ·
`lib/actions/resolver-novedad.ts` · `lib/notificaciones/emitir.ts` (sólo el comentario) ·
`app/(app)/novedades/_components/novedad-acciones-catalogo.ts` ·
`app/(app)/novedades/_components/NovedadAcciones.tsx` ·
`app/(app)/novedades/_components/NovedadesModule.tsx` ·
`app/(app)/novedades/_components/RechazarNovedadModal.tsx` (NUEVO) ·
`tests/fixtures/inventario-transiciones-140.ts` · las suites nombradas en el mapa.

**Antes de registrar cualquier id o rama nuevos**, mirar `origin/dev`: ya hubo **dos** colisiones de
id entre sesiones.
