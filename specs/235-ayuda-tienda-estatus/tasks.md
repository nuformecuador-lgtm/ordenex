# Feature 235 — Tareas

> Leer antes: `requirements.md` (R1-R46) y `design.md`. `⟨AYUDA⟩` = value del estatus, pendiente de
> firma (P1); recomendación `ayuda_tienda`.
>
> **Gate:** `./init.sh --rapido` para cerrar cada tanda; **`./init.sh` completo antes del PR, sin
> excepción**. El gate **no** se corre en paralelo con un subagente que muta el árbol: el veredicto
> no valdría.
>
> **No hay punto de despliegue intermedio seguro** (design §12-D): **todo va en UN SOLO PR**. Las
> tandas son unidades de gate, no de despliegue. Dentro del PR el orden de commits importa: catálogo
> y enum primero, código después, **la retirada de la columna al final**.
>
> **Reutilizar, no reescribir** (auditoría §4): el botón de pedir ayuda, su modal con nota
> obligatoria, el rescate del mensajero, `SolicitudAyudaService` y sus tests **ya cumplen**. Se
> modifica su efecto, no su forma.
>
> `[P]` = paralelizable con las tareas de su misma tanda.

---

## T0 — Puerta humana: medir y firmar (sin código)

- [x] **T0.1 — Medir las órdenes en vuelo (P6/R43).** Vía MCP de Supabase, solo lectura, contra la
      base donde vaya a desplegarse: `count(*)` de `orden` con `ayuda = true`, **desglosado por
      `order_status.value`**; y si la columna no existe, decirlo con esas palabras.
      **Hecho:** el número y su desglose pegados en `progress/impl_235.md` con fecha y con el host
      medido (`prisma migrate status` dice el host sin exponer credencial). **La foto caduca: se
      re-mide el día del despliegue.** **Bloquea T6.4.**
      > ✅ **2026-08-19 — RE-MEDIDO POR EL LEADER contra producción (MCP, solo lectura): 0 órdenes
      > con `orden.ayuda = true`.** Confirma la medición de la puerta humana y cierra P6 como
      > *grandfather*: se retira la columna y **no hace falta script de datos** (T6.4-a).
      > El implementer NO pudo medirlo: el MCP de Supabase no está expuesto a un subagente, y
      > `prisma migrate status` apunta a `localhost:5432`. La foto **sigue caducando**: si el
      > despliegue se retrasa, se vuelve a medir.
- [x] **T0.2 — Firmar las decisiones abiertas.** P1 (value, etiqueta, color), P2 (familias de
      origen), P3 (hito público), P4 (webhook + repetición de `en_reparto`), P5 (retirar la columna
      en esta ficha), P6 (datos en vuelo), P7 (KPI del mensajero), P9 (quién puede pedir ayuda), P10
      («Habilitar» como rescate).
      **Hecho:** cada una respondida en `progress/impl_235.md`; el spec se actualiza si alguna
      respuesta se aparta de la recomendación. **Bloquea T1.**
- [x] **T0.3 — [P] Confirmar el orden de mergeo 235 → 236 → 240** con el leader.
      **Hecho:** anotado en `progress/current.md`. No bloquea código; bloquea la nota de cierre.
      > ✅ **CERRADA (2026-08-19).** El orden queda **235 → 236 → 237 → 240**, con la 241
      > independiente y la 238 sin dependencias. Escrito en `progress/current.md` §«ORDEN DE MERGEO
      > Y DE DESPLIEGUE». Con el aviso medido: **la 235 y la 236 salen juntas o seguidas**, porque
      > con la 235 sola la tienda ve la solicitud de ayuda y no puede abrir su motivo.

---

## T1 — El estatus, sus aristas y las superficies

- [x] **T1.1 — Alta del value en el catálogo (R1).** `ORDER_STATUS_SEED` + migración
      `<ts>_order_status_ayuda_tienda` (`INSERT … WHERE NOT EXISTS`) y su `down.sql` que borra
      **solo si nadie lo referencia**. Copia del par de la 239.
      **Hecho:** `pnpm run db:migrate` aplica y `pnpm run db:rollback` revierte en local; el catálogo
      queda en **22** values sin duplicados. **Tests:** `tests/unit/types/order-status.test.ts`
      («el catálogo tiene 22 values y `⟨AYUDA⟩` es el último, sin mover a nadie»);
      `tests/unit/scripts/seed-order-status.test.ts`. **Depende de:** T0.2.
- [x] **T1.2 — Alta de las DOS familias de origen (R10/R11).** Migración de enum
      `<ts>_orden_historial_origen_ayuda_tienda` con dos `ADD VALUE IF NOT EXISTS` + `down.sql` que
      **recrea el tipo con los 27 valores vigentes**. `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` actualizado.
      **NO se tocan los `down.sql` anteriores de este enum** (son fotos históricas): solo se comprueba
      si alguno recrea con lista cerrada y se anota la consecuencia del rollback encadenado.
      **Re-verificar los índices**, no citar la verificación de la 239: barrer
      `db/migrations/*/migration.sql` para confirmar que la única columna del enum es
      `orden_historial_estado.origen_tipo`, que su único índice es btree pleno y que **ningún índice
      parcial menciona el enum** → el `ALTER COLUMN … TYPE` los reconstruye solo.
      **Hecho:** **nuevo** `tests/integration/db/ayuda-tienda-migration.test.ts` verde: aplica dos
      veces sin duplicar, el `down` revierte, el `down` **falla ruidosamente** si hay filas con esos
      `origen_tipo`, y el índice existe después del down.
      **Tests:** `tests/unit/types/orden-historial-types.test.ts` («las dos familias están en el SEED
      y **NINGUNA** en `ORIGEN_TIPOS_VISITA_REAL` ni en `ORIGEN_TIPOS_CON_GESTION`»).
      **Depende de:** T1.1.
- [x] **T1.3 — Las tres aristas (R12).** `TRANSICIONES` gana `en_reparto → ⟨AYUDA⟩` (#62),
      `⟨AYUDA⟩ → en_reparto` (#63) y `⟨AYUDA⟩ → sin_gestionar` (#64). **Ninguna baja.** Ninguna
      arista de gestión desde `⟨AYUDA⟩` (son de la 237, con su productor).
      **Hecho:** typecheck verde (la exhaustividad rompe el build hasta declararlas).
      **Tests:** `tests/unit/domain/order-status-transiciones.guardia.test.ts` (las tres son legales;
      **un caso enumera las salidas de `⟨AYUDA⟩` ENTERAS** y otro afirma que
      `⟨AYUDA⟩ → devolucion_por_confirmar` / `→ en_bodega_*` son **ilegales**);
      `.connectividad.test.ts` (no terminal, no vestigial, entrada y salida > 0; cuentas 59/57
      **re-derivadas**, no copiadas del spec); `tests/fixtures/inventario-transiciones-140.ts`.
      **Depende de:** T1.1, T1.2.
- [x] **T1.4 — [P] Superficies que ROMPEN el build (R37/R38).** Etiqueta + variante en
      `EstatusBadge.tsx`; hito público en `rastreo-publico.ts` (**el mismo que `en_reparto`**, P3).
      **Hecho:** typecheck verde. **Tests:** `tests/components/EstatusBadgeCatalogoV2.test.tsx`
      (etiqueta y variante exactas); `tests/unit/guards/rastreo-hitos-exhaustivo.guardia.test.ts` y
      `rastreo-sin-estatus-crudo.guardia.test.ts` (22 values, con nota fechada);
      **caso nuevo** en `tests/unit/services/rastreo-publico-service.test.ts`: «`en_reparto → ⟨AYUDA⟩
      → en_reparto` produce **UNA sola** entrada `En reparto` en la línea pública» (R38, colapso de
      rachas). **Depende de:** T1.1.
- [x] **T1.5 — [P] Los cuatro mapas parciales que NO rompen el build (R37/R39/R45).** Revisión **a
      mano**: `exclude-por-rol.ts` (**no** excluir para nadie), `webhook-eventos.ts` (**no** añadir,
      P4), `estados-bodega-satelite.ts` (**no** añadir), `tablero-dia.ts` (**no** añadir → `otros`).
      Cada decisión con su **razón escrita** en el archivo.
      **Hecho:** un test por archivo afirma la decisión **incluido el caso negativo**:
      `tests/components/OrdenesExcludePorRol.test.ts` («el `adminTienda` SÍ ve `⟨AYUDA⟩` en su
      filtro, a diferencia de `devuelta`»); `tests/unit/types/webhook-eventos.test.ts` («`⟨AYUDA⟩`
      NO es evento público»); **caso nuevo** en `tests/unit/services/webhook-estado-encolado.test.ts`
      («el rescate encola `en_reparto` **otra vez**, con clave de idempotencia distinta» — R39, el
      efecto colateral firmado, afirmado en vez de descubierto);
      `tests/unit/utils/estados-bodega-satelite.test.ts`; `tests/unit/tablero-dia/buckets-estatus.test.ts`
      («no tiene bucket explícito → `otros`»). **Depende de:** T1.1, T0.2.
- [x] **T1.6 — Inventarios congelados (R44).** Barrido de las cuentas literales del catálogo (21 → 22)
      en `buckets-estatus.guardia.test.ts` (`CATALOGO_CONGELADO`),
      `analytics/definiciones-catalogo.guardia.test.ts`, `order-status-v2-migration.test.ts`.
      **Hecho:** `pnpm run typecheck && pnpm test` sin rojos de conteo; **cada** actualización lleva
      comentario con fecha y motivo. **Depende de:** T1.4, T1.5.

**R cubiertos por T1:** R1, R10 (parcial), R11, R12, R37, R38, R39, R44, R45.

---

## T2 — Los dos servicios: solicitar y el rescate ÚNICO

- [x] **T2.1 — `SolicitudAyudaService.solicitar` cambia de efecto (R2-R7).** El paso 2 pasa de
      `marcarAyuda` a una **transición guardada por el estado** (`updateMany` con
      `estatusId = enRepartoId` en el WHERE + `appendCambioEstado` con
      `origen_tipo = solicitud_ayuda_tienda` y el actor real). Los pasos 1 (publicar) y 3 (liberar el
      puntero) **no se tocan**. Fallo cerrado si el catálogo no resuelve (design §3.3).
      **Hecho:** `tests/unit/services/solicitud-ayuda-service.test.ts` con casos **nombrados**:
      «deja la orden en `⟨AYUDA⟩`» (R2) · «publica la nota ANTES de transicionar» (R3) ·
      «si la nota se rechaza, la orden NO se mueve y no hay append» (R4) ·
      «no toca `mensajeroAsignadoId`» (R6) · «libera el puntero del actor y solo si apunta a esta
      orden» (R7, ya existe: se conserva) · «si la orden ya salió de reparto, 0 filas y ningún
      append». **Depende de:** T1.3.
- [x] **T2.2 — El punto ÚNICO de rescate (R8/R9).** `rescatarOrdenAyuda` con su guarda de estado, y
      los **dos** llamadores delegando: `SolicitudAyudaService.recuperar` («Recuperar») y
      `HabilitarNovedadService.habilitar` («Habilitar», después de publicar su nota). Se retiran
      `desmarcarAyuda` y `habilitarNovedad` del repo y de `IOrdenRepository`.
      **Hecho:** **nuevo** `tests/unit/services/rescate-ayuda-service.test.ts`: «rescatar una orden
      que NO está en `⟨AYUDA⟩` devuelve forbidden y **no escribe ni una fila de historial**» (R9) ·
      «un segundo rescate no produce una segunda transición» (R9) · «los dos llamadores acaban en la
      MISMA escritura» (doble compartido, R8).
      `tests/unit/services/habilitar-novedad-service.test.ts` actualizado: la nota sigue siendo la
      puerta y el efecto pasa a ser el rescate. **Depende de:** T2.1.
- [x] **T2.3 — [P] Money-safe de las dos transiciones (R13).** Confirmar que el `data` de las dos
      escrituras toca **solo** `estatusId`.
      **Hecho:** un caso en cada suite de T2.1/T2.2 afirma el `data` **exacto** del `updateMany`
      (igualdad, no `toMatchObject`); las guardias money-safe verdes sin tocarse.
      **Depende de:** T2.2.
- [x] **T2.4 — [P] El borde revalida el tope del motivo (R5).** El schema ya lo hace
      (`solicitarAyudaSchema`, `min(1).max(MOTIVO_AYUDA_MAX)`); lo que falta es la **aserción**.
      **Hecho:** **nuevo** `tests/unit/types/orden-ayuda-borde.test.ts`: motivo vacío, motivo de
      `MOTIVO_AYUDA_MAX + 1` y `ordenId` no-uuid son rechazados **en el borde**, sin llegar al
      servicio. **Depende de:** ninguna.

**R cubiertos por T2:** R2, R3, R4, R5, R6, R7, R8, R9, R10, R13.

---

## T3 — El portal del mensajero: el corte sube al servidor

- [x] **T3.1 — Tres estados y tres grupos (R16/R18).** `listarMisAsignaciones` lee
      `[por_recoger, en_reparto, ⟨AYUDA⟩]` y devuelve `conAyuda` como tercer grupo.
      **Hecho:** `tests/unit/services/mis-asignaciones-service.test.ts`: «devuelve las de ayuda en
      `conAyuda` y **no** en `porGestionar`» (R18) · «`escogerParaGestion` sobre una orden en
      `⟨AYUDA⟩` devuelve `conflict`» y «`gestionar` sobre una orden en `⟨AYUDA⟩` devuelve `conflict`»
      (R16). **Depende de:** T1.3.
- [x] **T3.2 — [P] El optimizador de ruta (R14).** Verificar —sin tocar código— que
      `findParadasEnReparto` deja fuera las de ayuda por el filtro de estatus que ya tiene.
      **Hecho:** caso nuevo en `tests/unit/repositories/orden-repository.*` (o el archivo donde vive
      hoy la cobertura de `findParadasEnReparto`): «una orden del mensajero en `⟨AYUDA⟩` NO sale como
      parada». **Matarlo con mutación**: cambiar el `where` a `in [en_reparto, ⟨AYUDA⟩]` tiene que
      poner el caso rojo. **Depende de:** T1.1.
- [x] **T3.3 — [P] Mapa, chat y trayecto vivo (R15/P8).** `RepartoModule` deja de partir la lista en
      cliente (se borran los dos `useMemo`, `:253-262` y `:312`) y recibe `conAyuda` por props. El
      mapa y `TrayectoVivoButton` se alimentan de `porGestionar`; **`ChatFlotante` pasa a recibir
      `[...porGestionar, ...conAyuda]`** (P8).
      **Hecho:** `tests/components/RepartoAyuda.test.tsx`: «las de ayuda no aparecen entre las
      paradas del mapa ni en el contador de paradas sin optimizar» (R15) · «sí aparecen entre los
      contactos del chat» (P8) · «el módulo ya no decide el corte: pinta lo que llega». **Depende
      de:** T3.1.
- [x] **T3.4 — [P] Asignación, ruteo y recolección (R17).** Barrido de los listados que ofrecen
      órdenes para asignar/rutear/recolectar: ninguno debe incluir `⟨AYUDA⟩`.
      **Hecho:** un caso por listado afirmando la ausencia, con el nombre del estado en el mensaje.
      **Depende de:** T1.1.
      > ⚠️ **Este barrido se quedó CORTO y la revisión lo cazó (bloqueante B2, 2026-08-19).** Miró
      > los listados que **ofrecen órdenes** y se dejó **otra familia**: las listas que describen la
      > **ocupación del mensajero**. `GuiaAsignacionService.ESTADOS_REPARTO_PENDIENTE` y su gemelo
      > de interfaz (`lib/actions/ordenes-guia.ts`, `conRepartoIds`) seguían leyendo
      > `["por_recoger", "en_reparto"]`, así que un mensajero con el paquete encima se leía como
      > **«sin carga»** y se le podía mandar a recolectar a una tienda —contra la regla de
      > dedicación de la 157—. **Corregido**, con su caso y su caso negativo, y con la guardia
      > `tests/unit/guards/carga-del-mensajero.guardia.test.ts`, que censa la familia entera para
      > que la próxima vez la cace un test y no una revisión.
- [x] **T3.5 — La sección propia sigue en pie (R19).** La card de ayuda conserva «Recuperar»,
      **pierde «Gestionar»** (llamaría a `escogerParaGestion`, que ahora es `conflict`) y **gana
      «Conversación»** (T5.2).
      **Hecho:** `tests/components/RepartoAyuda.test.tsx`: «la sección aparece con sus cards» ·
      «no hay botón que lleve a gestionar» · «Recuperar sigue disponible». **Depende de:** T3.3.
- [x] **T3.6 — Los KPI del día no bajan (R20/R21).** `pendientes`, `porCobrar` y `totalACobrar` se
      calculan sobre `porGestionar ∪ conAyuda`.
      **Hecho:** `tests/unit/services/mis-asignaciones-service.test.ts`: «una orden que pasa a
      `⟨AYUDA⟩` **no cambia** ninguno de los tres KPI» (R20) · «el COD de una orden gestionada hoy y
      el de una en ayuda **no se suman dos veces**» (R21). **Matar con mutación**: derivar los KPI
      solo de `porGestionar` tiene que poner el primero rojo. **Depende de:** T3.1.

**R cubiertos por T3:** R14, R15, R16, R17, R18, R19, R20, R21.

---

## T4 — El bloqueo del cierre y el corte de la noche

- [x] **T4.1 — El bloqueo, explícito (R22/R23).** `ESTADOS_PENDIENTES` gana `⟨AYUDA⟩`, con el
      comentario que dice **por qué** (hasta hoy funcionaba por accidente).
      **Hecho:** `tests/unit/services/cierre-dia-service.test.ts`: «con una orden en `⟨AYUDA⟩`,
      `solicitarCierre` devuelve `conflict` con el motivo accionable» (R22) · «el gate de
      `listarCierreDia` marca `puedesSolicitar = false`» · «la lista de estados pendientes nombra
      `⟨AYUDA⟩`» (R23). **Depende de:** T1.1.
- [x] **T4.2 — Las dos rutas exentas SIGUEN exentas (R24).** No se cambia código: se **afirma** la
      exención para que nadie la «arregle».
      **Hecho:** `tests/unit/services/cierre-dia-service.test.ts`: «con un cierre `vencido` y una
      orden en `⟨AYUDA⟩`, `solicitarCierre` transiciona a `solicitado`» y el gemelo para
      `rechazado`, cada uno con el comentario del deadlock que la 111/R9 cerró. **Y** anotar en
      `progress/impl_235.md` la consecuencia para la ficha 237 (design §8): su invariante es cierta
      para la creación de un cierre y **falsa** para estas dos rutas. **Depende de:** T4.1.
- [x] **T4.3 — [P] Un mensajero bloqueado puede pedir ayuda y rescatar (R25).** No se añade guarda de
      bloqueo: añadirla crea un deadlock con R22.
      **Hecho:** casos en `solicitud-ayuda-service.test.ts` y `rescate-ayuda-service.test.ts`, con el
      motivo escrito. **Depende de:** T2.2.
- [x] **T4.4 — El corte de la noche barre el estatus (R26/R27/R28/R29).** `crearCierre` pasa a
      recorrer **dos bloques guardados** —uno por estado de origen—, cada uno con su `updateMany`
      guardado y su `appendCambioEstado` con el origen **real**. `CorteSinGestionarInput` gana
      `ayudaEstatusId` **obligatorio**.
      **Hecho:** `tests/unit/repositories/cierre-dia-repository.test.ts`: «barre las de `en_reparto`
      y las de `⟨AYUDA⟩` en la misma transacción» (R26) · «cada append lleva el `estatusOrigenId` de
      SU bloque» (R27) · «el `data` toca solo `estatusId`: ni prioridad, ni mensajero, ni totales»
      (R28) · «un mensajero cuyo día entero acabó en ayuda **sí** genera su cierre `vencido`» (la
      guarda "algo pasó"). **Matar con mutación**: unificar los dos bloques en un `in` tiene que
      poner rojo el caso de R27. **Depende de:** T1.3.
      > ⚠️ **Faltaba la otra mitad, y era una REGRESIÓN (bloqueante B1, 2026-08-19).** Esta tanda
      > arregló la **escritura** (`CierreDiaRepository.crearCierre`) y dejó sin migrar la
      > **selección**: `CorteDiarioRepository.findMensajerosConActividadSinCierre` seguía buscando
      > solo `en_reparto`, así que al mensajero que acababa el día con todo en ayuda **nunca se le
      > llamaba a `crearCierre`** —pedir ayuda no crea `gestion_orden`, así que la otra rama tampoco
      > lo pescaba—: ni cierre `vencido`, ni barrido, nunca. Antes de la 235 funcionaba, porque el
      > booleano dejaba la orden en `en_reparto`.
      > El caso de esta tanda que sonaba a que lo cubría llamaba a `crearCierre` **a mano**, un
      > nivel por debajo de donde fallaba. **Corregido** con `ESTADOS_A_BARRER` (unión, no
      > sustitución) y medido **desde `ejecutarCorte`** con el repositorio REAL sobre un doble de
      > Prisma con semántica: `tests/unit/services/corte-diario-seleccion.test.ts`.

**R cubiertos por T4:** R22, R23, R24, R25, R26, R27, R28, R29 (parcial; se cierra en T6.1).

---

## T5 — La ventana del hilo y sus dos superficies

- [x] **T5.1 — La ventana pasa a lista por rol (R34/R36).** `VENTANA_ESCRITURA` de
      `Record<RolConHilo, OrderStatusValue>` a `Record<RolConHilo, readonly OrderStatusValue[]>`, con
      `⟨AYUDA⟩` **para los dos roles**. `estaEnVentanaDeEscritura` pierde el tercer parámetro; sus
      cuatro call-sites se actualizan. **Reescribir** el JSDoc de la «segunda puerta» (describe una
      puerta que deja de existir).
      **Hecho:** `tests/unit/services/orden-nota-service.test.ts`: «el mensajero asignado publica en
      una orden en `⟨AYUDA⟩`» y «la tienda dueña publica en una orden en `⟨AYUDA⟩`» (R34) ·
      «la ventana ya no admite ninguna bandera: la firma no la acepta» (R36). **Depende de:** T1.1.
- [x] **T5.2 — La superficie del mensajero (R35).** La card de ayuda gana «Conversación», que monta
      `components/shared/HiloNotasOrden` dentro de un `Modal` — el mismo montaje que hace
      `HiloNotasNovedadModal` del lado tienda. **No** se escribe un hilo nuevo; `puedeEscribir` sigue
      llegando del servidor.
      **Hecho:** `tests/components/RepartoAyuda.test.tsx`: «desde la card de ayuda se abre el hilo y
      el campo de escritura está habilitado». Y
      `tests/unit/guards/hilo-ventana-alcanzable.guardia.test.ts` **actualizada conservando sus tres
      propiedades**: (a) la extracción **revienta** si el patrón deja de casar; (b) el censo del panel
      del mensajero sigue **cerrado** (pasa de 2 a 3, con nota fechada, y `recolectando` **sigue
      fuera**); (c) la intersección ventana × pantalla es no vacía **para los dos roles**, ahora
      intersecando listas. **Depende de:** T5.1, T3.5.
- [x] **T5.3 — `/novedades` sin bandera (R30/R31/R32/R33).** `novedadWhere` pasa a dos igualdades de
      estado dentro del `OR` (**no** se colapsa a `in`: la guardia lo lee del fuente, design §4).
      Aquí muere el tapón que la 239 declaró con dueño.
      **Hecho:** `tests/unit/repositories/orden-repository.novedades.test.ts`: «lista las `⟨AYUDA⟩`»
      (R30) · «`count` y `find` usan el MISMO predicado» (R31) · «una orden que salió de `⟨AYUDA⟩`
      **no** se lista» (R32) · «el predicado no menciona ninguna columna distinta del estado» (R33).
      **Depende de:** T1.1.
- [x] **T5.4 — [P] Los tres call-sites de `/novedades` que dejan de compilar.** Traducción **literal**
      por `estatusValue` en `NovedadAcciones.tsx:116/176` y `NovedadesModule.tsx:140`. **No** se
      rediseña la card (es de la 236) ni se corrige el punto 12 invertido (es de la 240).
      **Hecho:** `tests/components/NovedadesModule.test.tsx` verde con el mismo comportamiento
      visible que hoy; un comentario en `NovedadAcciones.tsx` remite a la 240. **Depende de:** T5.3.

**R cubiertos por T5:** R30, R31, R32, R33, R34, R35, R36.

---

## T6 — La retirada de la columna y los datos en vuelo

> **Va al final del PR**, después de que todos los lectores hayan cambiado de fuente.

- [x] **T6.1 — Retirar `orden.ayuda` (R40).** Migración `<ts>_orden_retiro_ayuda` (`DROP COLUMN`) con
      su `down.sql` que la repone `boolean NOT NULL DEFAULT false` y **declara la pérdida de dato**.
      Se retiran los campos de los cuatro contratos (`MiAsignacionDTO`, `MiAsignacionRow`,
      `NovedadOrdenRow`, `OrdenParaHiloRow`), sus `select`/mapeos y el modelo de `schema.prisma`.
      **Hecho:** typecheck verde y **nueva guardia**
      `tests/unit/guards/ayuda-columna-retirada.guardia.test.ts`, calcada de
      `gestion-aprobada-retirada.guardia.test.ts`: barre `lib/`, `app/`, `components/` y
      `db/schema.prisma` y **falla** si aparece cualquier lectura o escritura de la columna. Con su
      **autocomprobación**: sobre un fuente sintético que la contiene, la guardia detecta.
      **Depende de:** T2.2, T3.3, T5.1, T5.3, T5.4.
- [x] **T6.2 — [P] Ninguna migración mueve estado (R41).** Comprobación sobre los tres
      `migration.sql`/`down.sql` de esta feature.
      **Hecho:** caso en `tests/integration/db/ayuda-tienda-migration.test.ts`: «ningún SQL de esta
      feature contiene `UPDATE "orden"` ni escribe `estatus_id`». **Depende de:** T6.1.
- [x] **T6.3 — [P] Reversibilidad (R42).** Las tres migraciones aplican y revierten en local, en
      orden y en orden inverso.
      **Hecho:** `pnpm run db:migrate` + `pnpm run db:rollback` ×3 sin residuos; el caso del
      `down.sql` del enum que **debe fallar** con filas presentes, verde.
      **Depende de:** T6.1.
- [x] **T6.4 — Los datos en vuelo (R29/R43).** Según T0.1:
      **(a)** conjunto vacío → nada más que hacer, se anota;
      **(b)** conjunto no vacío → `scripts/migrar-ayuda-a-estatus.ts`, idempotente, **por el choke
      point**: `ayuda = true` + `en_reparto` → transición a `⟨AYUDA⟩` con
      `origen_tipo = solicitud_ayuda_tienda` y actor `null`; `ayuda = true` en cualquier otro estatus
      → **no se toca** (es la fuga de la auditoría §2.1; la marca muere con la columna). Corre
      **antes** de T6.1.
      **Hecho:** el script con su test unitario («no mueve nada fuera de `en_reparto`», «correrlo dos
      veces no duplica historial»), o la nota fechada de que el conjunto era vacío.
      **Depende de:** T0.1, T6.1.

**R cubiertos por T6:** R29, R40, R41, R42, R43.

---

## T7 — Barrido, guardias y mutación

- [x] **T7.1 — Exhaustividad (R44).** Comprobar que las tres superficies exhaustivas de design §11
      rompen el build ante un value sin clasificar.
      **Hecho:** una prueba manual documentada (añadir un value falso al SEED → typecheck rojo en los
      tres sitios, con el nombre de cada uno anotado en `progress/impl_235.md`) y revertida.
      **Depende de:** T1.6.
- [x] **T7.2 — Guardias que deben quedar verdes SIN TOCARSE.** `intentos-entrega-criterio-unico`,
      `criterio-intento-entrega`, money-safe, `orden-nota-frontera`, `superficie-de-uso`,
      `dinero-sin-centimos`. **Si alguna se pone roja es REGRESIÓN** (design §13): se arregla el
      código, no el test.
      **Hecho:** `./init.sh --rapido` con las 100+ guardias verdes; cualquier rojo, diagnosticado por
      nombre en `progress/impl_235.md`. **Depende de:** T6.1.
- [x] **T7.3 — [P] Mutación obligatoria en TRES puntos.** (i) que el optimizador de ruta **de verdad**
      excluye (T3.2); (ii) que el corte escribe el **origen real** por bloque (T4.4); (iii) que los
      KPI **de verdad** incluyen las de ayuda (T3.6).
      **Hecho:** las tres mutaciones aplicadas una a una, cada una con el test que muere nombrado, y
      revertidas. **Autocomprobación obligatoria**: si el arnés reporta supervivientes sin haber
      ejecutado un test, no vale. **Depende de:** T3.6, T4.4.
- [x] **T7.4 — [P] Sin PII (R46).** Ningún mensaje de error, log ni payload nuevo lleva guía,
      destinatario, teléfono ni identificadores de cliente.
      **Hecho:** los mensajes de las dos operaciones y el `forbidden` opaco revisados uno a uno; la
      guardia de PII verde. **Depende de:** T2.2.
- [x] **T7.5 — Trazabilidad 46/46.** Tabla `R<n> → archivo::caso` en `progress/impl_235.md`, con el
      nombre del caso tal cual sale del runner.
      **Hecho:** los 46 con test **nombrado y ejecutado**; ninguno «cubierto por typecheck» a secas.
      **Depende de:** todas las anteriores.

---

## T8 — Ver la app, y el cierre

- [x] **T8.1 — Ver la app, no solo la suite.** Recorrido completo: mensajero pide ayuda desde el panel
      → la orden **sale** del listado principal, del mapa y de la ruta → aparece abajo en su sección
      → la tienda la ve en `/novedades` → los dos escriben en el hilo → «Recuperar» la devuelve
      arriba → volver a pedirla → dejarla sin gestionar y comprobar que el corte la barre → intentar
      solicitar cierre y ver el motivo del bloqueo.
      **Hecho:** el recorrido anotado con lo que se vio, no con lo que se esperaba. Ojo: la mitad de
      `/novedades` exige OTP de `adminTienda`.
      > ✅ **HECHA (2026-08-19) por el leader**, con Playwright y los DOS roles. Recorrido
      > completo, anotado con el texto leído del navegador en `progress/recorrido_235.md`: pedir
      > ayuda → la orden sale del listado y del mapa → baja a su sección con **los KPI quietos**
      > (P7/R20, visto y no solo afirmado) → hilo con el motivo dentro → «Recuperar»; y del lado
      > tienda, `/novedades` con el chip «Ayuda solicitada» y el rescate por «Habilitar».
      > **Encontró dos defectos que la suite no veía** —el chip de la card decía «En reparto» y la
      > card llevaba «Pendiente de optimizar» contra R15—, arreglados en la misma tanda
      > (`progress/impl_235_t81.md`). Confirmado también, en pantalla, que la tienda **no puede
      > leer el motivo**: es lo diferido a la 236.
- [x] **T8.2 — [P] Documentación al día (design §15).** Anotar con fecha en
      `progress/auditoria_ayuda_tienda.md` (§2.1 cerrada por construcción; qué puntos de §4 caen
      aquí) y marcar como **CERRADAS** la «RECONCILIACIÓN DE R19» y el «tapón con dueño» de
      `specs/239-devolucion-espera-cierre/`.
      **Hecho:** los tres documentos editados con fecha y con el número de PR.
- [ ] **T8.3 — Gate completo y PR.** `./init.sh` entero, con el árbol quieto, **antes** de abrir el
      PR. Comparar el SHA medido contra `origin/dev` justo antes (el pre-vuelo caduca).
      **Hecho:** cifras del gate (typecheck, lint, archivos/tests, guardias) pegadas en
      `progress/impl_235.md`; PR abierto contra `dev` desde `feature/235-ayuda-tienda-estatus`.
      **Depende de:** T7.5, T8.1.
      > ⏳ **ABIERTA (2026-08-19).** El gate completo y el PR los corre **el leader, con el árbol
      > quieto**: un gate lanzado en paralelo con un subagente que muta el árbol no vale su
      > veredicto. El implementer corrió `tsc`, `eslint` y la suite entera por su cuenta (cifras en
      > `progress/impl_235.md` §5) y **no** ejecutó `./init.sh`. Depende además de T8.1, que sigue
      > abierta.

---

## Trazabilidad R → tanda

| R | Tanda | R | Tanda | R | Tanda |
| --- | --- | --- | --- | --- | --- |
| R1 | T1.1 | R17 | T3.4 | R33 | T5.3 |
| R2 | T2.1 | R18 | T3.1 | R34 | T5.1 |
| R3 | T2.1 | R19 | T3.5 | R35 | T5.2 |
| R4 | T2.1 | R20 | T3.6 | R36 | T5.1 |
| R5 | T2.4 | R21 | T3.6 | R37 | T1.4, T1.5 |
| R6 | T2.1 | R22 | T4.1 | R38 | T1.4 |
| R7 | T2.1 | R23 | T4.1 | R39 | T1.5 |
| R8 | T2.2 | R24 | T4.2 | R40 | T6.1 |
| R9 | T2.2 | R25 | T4.3 | R41 | T6.2 |
| R10 | T1.2, T2.1, T2.2 | R26 | T4.4 | R42 | T6.3 |
| R11 | T1.2 | R27 | T4.4 | R43 | T6.4 |
| R12 | T1.3 | R28 | T4.4 | R44 | T7.1 |
| R13 | T2.3 | R29 | T4.4, T6.1 | R45 | T1.5 |
| R14 | T3.2 | R30 | T5.3 | R46 | T7.4 |
| R15 | T3.3 | R31 | T5.3 | | |
| R16 | T3.1 | R32 | T5.3 | | |
