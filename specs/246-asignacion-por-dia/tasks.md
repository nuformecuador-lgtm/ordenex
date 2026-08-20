# Feature 246 — Tareas

> Leer antes: `requirements.md` (R1-R35, D1-D9) y `design.md`.
>
> **Gate:** `./init.sh --rapido` para cerrar cada tanda; **`./init.sh` completo antes de cada PR, sin
> excepción**. El gate **no** se corre en paralelo con un subagente que muta el árbol: leería el árbol
> mutado y su veredicto no valdría.
>
> **PUNTO DE DESPLIEGUE — la parte que se puede hacer mal.** T1 y T2 son **inertes**: con la columna
> recién creada todas las filas están en `NULL` y el corte se comporta **byte a byte como hoy** (R19).
> **T3/T4 (que escriben la reserva) NO pueden desplegarse antes que T2** (que la respeta): si el
> selector llega primero, las órdenes reservadas se barren igual y la feature se lee como rota. El
> orden seguro es **T1 → T2 → T3 → T4/T5**, en uno o dos PRs, nunca al revés.
>
> **Zona `fullstack` ⇒ se secuencia backend → frontend.** T1-T3 y T5 (servicio) con el subagente de
> **backend**; T4 y la parte de card de T5 con el de **frontend**. Nunca a la vez sobre los mismos
> archivos.
>
> **El comentario explica el porqué, no el qué.** Cada `where` nuevo del corte lleva escrito **por qué**
> ese ancla y no otra; cada `null` que se limpia, **por qué** acompaña a `asignado_at`.

---

## T0 — Puerta humana: medir y firmar (sin código)

- [ ] **T0.1 — Medir contra producción**, vía MCP de Supabase, **solo lectura**, con las cuatro
      consultas de `design.md` §9: **M1** (distribución horaria de `asignado_at` en hora CR), **M2**
      (órdenes barridas por el corte asignadas en las 6 h previas), **M3** (transiciones
      `por_recoger → en_reparto` por hora), **M4** (`vencido` por noche y cuántos con asignación
      reciente).
      **Hecho:** los cuatro números en `progress/impl_246.md` con su fecha **y su autocomprobación**
      (cada agregado cuadrado contra su denominador). Un cero sin denominador es «no hay datos», no
      «no pasa». **Bloquea T0.2.**
      ⏳ **Caduca**: se re-mide justo antes de desplegar, no antes de mergear.
- [ ] **T0.2 — Firmar las decisiones.** **D1** (columna vs tabla lateral), **D2** (fecha absoluta vs
      marca), **D4** (¿las dos superficies?), **D5** (¿candado al mensajero?, con **M3** delante),
      **D7** (el ranking no se toca).
      **Hecho:** cada una respondida en `progress/impl_246.md`; si alguna se aparta de la
      recomendación, **el spec se corrige antes** de escribir código. **Bloquea T1.**
- [ ] **T0.3 — [P] Confirmar el timestamp de la migración contra `origin/dev`.** Hay fichas en vuelo
      (237) que también añaden migración; y ya hubo **dos colisiones de id entre sesiones**.
      **Hecho:** `<ts>` elegido tras mirar `origin/dev`, anotado. **Bloquea T1.1.**
- [ ] **T0.4 — [P] Aviso operativo a bodega** (no es código): a partir del despliegue hay que
      **elegir** el día al asignar, y «Hoy» viene preseleccionado. Incluye la consecuencia de §5.3:
      un mensajero puede acabar bloqueado por su cierre **con los paquetes de mañana en la mano**.
      **Hecho:** aviso enviado y anotado con fecha. **Bloquea el despliegue, no T1.**

---

## T1 — La columna y el helper *(inerte: se puede desplegar suelto)*

- [ ] **T1.1 — Migración `<ts>_orden_fecha_reparto`** (`design.md` §2.2/§2.3):
      `ALTER TABLE "orden" ADD COLUMN "fecha_reparto" DATE;` + `down.sql` con `DROP COLUMN IF EXISTS`
      y **la pérdida de dato declarada, incluida la consecuencia operativa** (revertir hace que el
      primer corte barra lo reservado). El `migration.sql` lleva su razonamiento entero arriba, al
      nivel de `20260819170000_gestion_orden_confirmacion_fisica`. `schema.prisma` actualizado con
      `fechaReparto DateTime? @map("fecha_reparto") @db.Date`. **Sin índice, sin CHECK, sin tocar RLS,
      sin tocar ningún enum.**
      **Hecho:** `pnpm run db:migrate` aplica y `pnpm run db:rollback` revierte en local;
      `tests/integration/db/orden-fecha-reparto-migration.test.ts` **(NUEVO)** —molde de
      `tests/integration/db/orden-prioridad-migration.test.ts`— afirma que la columna es **nullable,
      sin default**, que las filas previas quedan en `NULL` (R19) y que aplicar dos veces no rompe.
      **Depende de:** T0.2, T0.3.
- [ ] **T1.2 — [P] `lib/types/dia-reparto.ts` (NUEVO)**: `DIA_REPARTO`, `DiaReparto`,
      `diaRepartoSchema`. Un único punto para las dos superficies.
      **Hecho:** `tests/unit/types/dia-reparto-schema.test.ts` **(NUEVO)** cubre: valor válido,
      valor desconocido rechazado, **ausencia ⇒ `"hoy"`** (R4) y que **una fecha no es un valor
      aceptable** (R6). **Depende de:** T0.2.
- [ ] **T1.3 — `lib/utils/dia-reparto.ts` (NUEVO)**: `resolverFechaReparto(dia, now)` sobre
      `startOfDayCR`. **Con reloj inyectable**, jamás `new Date()` interno.
      **Hecho:** `tests/unit/utils/dia-reparto.test.ts` **(NUEVO)** con casos a ambos lados de las
      dos fronteras que este repo confunde: **00:00 CR** y **06:00 UTC**. Al menos: `23:59 CR`,
      `00:01 CR`, `05:59Z`, `06:01Z`. Un caso afirma explícitamente que **no** se usa
      `inicioDelDiaCREnUtc` (riesgo 3). **Depende de:** T1.2.

**R cubiertos por T1:** R4 (mitad), R5, R6 (mitad), R19, R21.

---

## T2 — El corte *(inerte con la columna en `NULL`; se despliega ANTES que T3/T4)*

- [ ] **T2.1 — `CorteDiarioService.ejecutarCorte` calcula `diaCerrado` UNA vez** por corrida
      (`startOfDayCR(now) − 1 día`) y lo pasa a las dos capas. Reloj **inyectable** (patrón de las
      dependencias opcionales del propio service).
      **Hecho:** `tests/unit/services/corte-diario-service.test.ts` gana un caso que afirma que **el
      mismo valor** llega a la selección y a `crearCierre` (R16/R17). **Depende de:** T1.1.
- [ ] **T2.2 — `findMensajerosConActividadSinCierre(diaCerrado)`**: el `where` de la rama (b) gana
      `OR: [{ fechaReparto: null }, { fechaReparto: { lte: diaCerrado } }]`. **El parámetro es
      obligatorio**, no opcional: así olvidar cablearlo rompe el typecheck en vez de dejar el corte
      con un criterio silencioso.
      **Hecho:** `tests/unit/repositories/corte-diario-repository.test.ts` afirma, con un doble que
      **honra el `where`** (nunca un `vi.fn()` mudo): un mensajero cuyas únicas órdenes están
      reservadas para mañana **no sale** (R14); uno con órdenes sin fecha **sí** sale (R19/R20); uno
      con órdenes de ayer **sí** sale (R12); la rama de gestiones sin cerrar **no cambia** (R18).
      **Depende de:** T2.1.
- [ ] **T2.3 — `CorteSinGestionarInput` gana `diaCerrado`** y el bloque de `crearCierre` aplica el
      **mismo** `OR` en el pre-`SELECT` **y** en el `where` del `updateMany` guardado.
      **Hecho:** `tests/unit/repositories/cierre-dia-repository.test.ts` afirma: se barren las de
      ayer y las sin fecha; **no** se barre la reservada para mañana; el `updateMany` lleva el filtro
      **en el `where`** y no se filtra en memoria. El typecheck **rompe** en todo doble que no pase el
      campo — **esa es la señal buscada**. **Depende de:** T2.2.
- [ ] **T2.4 — El caso que impide el «nunca se barre» (R13).** Dos corridas consecutivas con reloj
      inyectado: la primera respeta la orden reservada para mañana; **la segunda la barre**.
      **Hecho:** un caso en `tests/unit/services/corte-diario-seleccion.test.ts` que corre el corte
      dos veces con `now` distinto y afirma los dos desenlaces. Es **el** caso de esta ficha.
      **Depende de:** T2.3.
- [ ] **T2.5 — [P] El caso mixto (R15).** Mensajero con órdenes reservadas **y** gestiones sin
      cerrar: recibe su `vencido` y se barren **sólo** las no protegidas.
      **Hecho:** un caso que afirma las dos mitades a la vez (el cierre existe **y** la reservada
      sigue en `en_reparto`). **Depende de:** T2.3.
- [ ] **T2.6 — [P] El corte no cambia en nada más (R18).**
      `tests/integration/actions/corte-diario-route.test.ts` verde **sin tocar**; la exclusión por
      cierre abierto, el snapshot de totales y la idempotencia, verdes sin tocar.
      **Hecho:** anotado en `progress/impl_246.md` con los archivos comprobados. **Depende de:** T2.3.

**R cubiertos por T2:** R11, R12, R13, R14, R15, R16, R17, R18, R20.

---

## T3 — La asignación escribe el día *(backend; NO se despliega antes que T2)*

- [ ] **T3.1 — Borde zod en las dos superficies.** `asignarBodegaSchema` y `asignarSateliteSchema`
      ganan `dia: diaRepartoSchema.default("hoy")`. Las Server Actions lo pasan **tal cual** al
      servicio, sin coerción.
      **Hecho:** `tests/integration/actions/ordenes-guia-action.test.ts` y
      `tests/unit/actions/recepcion-satelite-action.test.ts` afirman que el valor llega al servicio
      sin transformar y que **una petición sin el campo** se comporta como «hoy» (R4).
      **Depende de:** T1.2, T2.
- [ ] **T3.2 — Los dos servicios resuelven la fecha.** `GuiaAsignacionService.asignarDesdeBodega` y
      `AsignacionSateliteService.asignar` llaman a `resolverFechaReparto` **una vez** y pasan la
      fecha al repositorio.
      **Hecho:** `tests/unit/services/guia-asignacion-service.test.ts` y
      `tests/unit/services/asignacion-satelite-service.test.ts` afirman, con reloj inyectado, que
      «mañana» produce la fecha CR correcta y que el repositorio la recibe **ya resuelta** (el repo no
      calcula días). **Depende de:** T3.1.
- [ ] **T3.3 — La escritura (R7).** `OrdenRepository.asignarBodegaLote` añade `fechaReparto` a su
      `data`; `asignarSateliteLote` añade `"fecha_reparto" = $n` a su `SET` **parametrizado**
      (`Prisma.sql`, jamás interpolación).
      **Hecho:** `tests/unit/repositories/orden-repository.asignacion-satelite.test.ts` y el test de
      `asignarBodegaLote` afirman que la fecha va **en la misma escritura** que `asignado_at`, y que
      el `SET` **no** contiene ninguna zona horaria ni `NOW()::date`. **Depende de:** T3.2.
- [ ] **T3.4 — [P] Las vías sin elección (R8).** Deshacer gestión re-estampa `asignado_at`: estampa
      también `fechaReparto = startOfDayCR()`.
      **Hecho:** un caso en `tests/unit/repositories/cierre-dia-repository.test.ts` que lo afirma, con
      su comentario explicando **por qué** (las dos columnas nunca cuentan historias distintas).
      **Depende de:** T3.3.
- [ ] **T3.5 — [P] La limpieza (R9/R10).** Los cinco sitios que hoy ponen `asignado_at = null` junto
      a `mensajero_asignado_id = null` ponen también `fecha_reparto = null`:
      `OrdenRepository.deshacerAsignacionLote`, `OrdenRepository` (retorno a bodega satélite),
      `CierresAdminRepository` (liberar al aprobar), `DevolucionSlaRepository`,
      `LiberacionReprogramadaRepository`.
      **Hecho:** `tests/unit/repositories/orden-repository.deshacer-asignacion.test.ts`,
      `tests/unit/repositories/devolucion-sla-repository.test.ts` y los tests de liberación afirman
      la limpieza en la **misma** escritura. **Depende de:** T3.3.
- [ ] **T3.6 — Guardia de la invariante (R10).**
      `tests/unit/guards/fecha-reparto-acompana-asignado-at.guardia.test.ts` **(NUEVO)**: censo del
      árbol; **ninguna** escritura que fije o limpie `asignadoAt`/`asignado_at` lo hace sin tocar
      `fechaReparto`/`fecha_reparto` en el mismo objeto `data`/`SET`. Molde de
      `tests/unit/guards/carga-del-mensajero.guardia.test.ts`: si la guardia no puede leer lo que
      vigila, **revienta en rojo** en vez de dar por buena una lectura vacía.
      **Hecho:** verde, y **roja** al quitar el `fechaReparto` de uno de los sitios
      (**autocomprobación dentro del propio archivo**). El censo se escribe **en un archivo de test**,
      nunca por `node -e`: ahí `\b` llega como backspace y el censo miente en verde.
      **Depende de:** T3.5.
- [ ] **T3.7 — [P] La proyección de lectura (R35).** El día de reparto viaja en la proyección que ya
      lee la orden asignada, sin consulta nueva.
      **Hecho:** el test del repositorio afirma que el campo sale en el `select`. **Depende de:** T3.3.

**R cubiertos por T3:** R3, R4 (mitad), R6 (mitad), R7, R8, R9, R10, R35.

---

## T4 — Las dos pantallas de asignación *(frontend; mismo PR que T3)*

- [ ] **T4.1 — Selector compartido `components/shared/SelectorDiaReparto.tsx` (NUEVO)**: dos
      opciones, **«Hoy» preseleccionada** (R27), construido sobre la primitiva de `components/ui/`
      que ya exista (`npx shadcn add radio-group` si falta) — **nunca un componente propio si shadcn
      lo tiene**. Recibe las etiquetas de día **por props**; no llama a `new Date()` (R29).
      **Hecho:** `tests/components/SelectorDiaReparto.test.tsx` **(NUEVO)** afirma el valor por
      defecto, el cambio de opción y que **el componente no lee el reloj del navegador** (censo del
      propio archivo). **Depende de:** T3.
- [ ] **T4.2 — `AsignarBodegaModal` monta el selector** y manda `dia` en `asignarDesdeBodega` (R1).
      Las etiquetas con el día llegan desde el Server Component de la página.
      **Hecho:** `tests/components/AsignarBodegaModal.test.tsx` gana dos casos: **manda `"hoy"` por
      defecto** y **manda `"manana"` cuando se elige** (es el caso que impide que el selector quede
      decorativo). **Depende de:** T4.1.
- [ ] **T4.3 — [P] `AsignarSateliteModal`, lo mismo** (R2).
      **Hecho:** los dos casos espejo en `tests/components/AsignarSateliteModal.test.tsx`.
      **Depende de:** T4.1.
- [ ] **T4.4 — [P] La confirmación con palabras (R28).** Tras asignar, el modal dice para qué día
      quedó el lote, sin siglas ni jerga.
      **Hecho:** un caso que **lee el texto**, no una clase ni un `data-*`. **Depende de:** T4.2.

**R cubiertos por T4:** R1, R2, R27, R28, R29.

---

## T5 — El portal del mensajero

- [ ] **T5.1 — `esParaManana` en el DTO, derivado EN EL SERVIDOR** (R26).
      `MisAsignacionesService.listarMisAsignaciones` lo calcula con el mismo `startOfDayCR` que ya usa
      para la ventana del día, **sin** añadir un cuarto grupo.
      **Hecho:** `tests/unit/services/mis-asignaciones-service.test.ts` afirma, con reloj inyectado:
      una reservada para mañana llega con `esParaManana: true`; la de hoy y la sin fecha, `false`; y
      **al pasar el día, la misma fila pasa a `false` sin ninguna escritura** (R25).
      **Depende de:** T3.
- [ ] **T5.2 — La card lo dice con palabras (R22).** «Para mañana» como **texto**, no sólo color: el
      repo ya tiene guardia de contraste y una lección escrita sobre medir color en el navegador.
      **Hecho:** un caso nuevo en `tests/components/RecogerModule.test.tsx` (grupo «Por recoger», que
      es donde vive el 99 % de lo reservado) y otro en `tests/components/RepartoModule.test.tsx` (una
      ya recogida la noche anterior), los dos **leyendo el texto**. **Depende de:** T5.1.
- [ ] **T5.3 — [P] Ni se oculta ni se bloquea (R23/R24).** Dos casos: la orden reservada **aparece**
      en su grupo, y **se puede recoger** y **gestionar** exactamente igual.
      **Hecho:** dos casos que lo afirman; el de recoger comprueba que la Server Action **sí** se
      llama. Es la mitad de D5 que un test puede sostener. **Depende de:** T5.1.

**R cubiertos por T5:** R22, R23, R24, R25, R26.

---

## T6 — Mutaciones, guardias y ver la app

- [ ] **T6.1 — Mutación: el ancla del corte.** Cambiar `diaCerrado` por `startOfDayCR(now)` (el ancla
      ingenua de `design.md` §5.1) y comprobar que la suite se pone **roja** en el caso de T2.4.
      **Hecho:** salida real pegada en `progress/impl_246.md`, con el nombre del test que cae. Sin esa
      salida **no cuenta**: este repo ya tuvo un arnés de mutaciones que reportó 9/9 supervivientes
      dos veces **sin haber ejecutado un test**. **Depende de:** T2, T3.
- [ ] **T6.2 — [P] Mutación: el `WHERE` del barrido.** Quitar el `OR` del `updateMany` de
      `crearCierre` (dejándolo en el pre-`SELECT`) y comprobar que cae un caso **del repositorio**.
      **Hecho:** ídem, con salida real. ⚠️ **Se mide en el repositorio, no en el servicio**: este repo
      midió cuatro veces que los tests de servicio usan dobles y **no ven el `WHERE`**.
      **Depende de:** T2.3.
- [ ] **T6.3 — [P] Mutación: la limpieza.** Quitar `fechaReparto: null` de uno de los cinco sitios de
      T3.5 y comprobar que caen el caso de ese sitio **y** la guardia de T3.6.
      **Hecho:** ídem, con salida real. **Depende de:** T3.6.
- [ ] **T6.4 — Guardias completas.** `pnpm run test:guardias` entero. Verdes **sin tocar**:
      `carga-del-mensajero.guardia.test.ts` (R31: las listas de estatus no cambian),
      `ranking-ventana-dia.guardia.test.ts` y `tablero-dia-sql.test.ts` (R33: el denominador sigue
      siendo `asignado_at`), `asignado-at-solo-lectura.guardia.test.ts` (R10),
      `order-status-transiciones.guardia.test.ts` y `censo-catalogo-estados-v2.test.ts` (R31: ningún
      estado nuevo), `recoleccion-no-contamina.test.ts` (R34), `webhook-estado-encolado.test.ts` y
      `orden-webhook-enqueue.test.ts` (R32), y todas las money-safe (R30).
      **Hecho:** todas verdes. Un rojo en cualquiera de éstas **es regresión, no una aserción a
      cambiar** (`design.md` §8). **Depende de:** T5.
- [ ] **T6.5 — Ver la app, no sólo la suite.** Recorrido completo con los tres roles:
      1. **Bodega central**, asignar un lote **para mañana** → leer la confirmación.
      2. **Bodega satélite**, asignar otro lote **para hoy**.
      3. **Mensajero**: ver los dos lotes, leer «Para mañana» en el primero, **recoger** uno de cada.
      4. **Correr el corte a mano** contra la base local con el reloj puesto a las 00:00 CR del día
         siguiente: comprobar que la de hoy quedó `sin_gestionar` y **la de mañana sigue
         `en_reparto`**; comprobar si hubo `vencido` y por qué motivo.
      5. **Correr el corte otra vez** con el reloj un día más allá: la de mañana **ahora sí** se
         barre.
      6. Volver al portal del mensajero **con el reloj en el día reservado** y comprobar que la
         etiqueta «Para mañana» **desapareció sola**.
      **Hecho:** recorrido anotado paso a paso en `progress/recorrido_246.md`, con los textos leídos
      **tal cual**. Doce mil tests dan por buenos textos rotos que un recorrido de minutos encuentra;
      en este repo ya pasó cuatro veces. **Depende de:** T6.4.

**R cubiertos por T6:** R30, R31, R32, R33, R34 (+ verificación cruzada de todos los anteriores).

---

## T7 — Cierre documental

- [ ] **T7.1 — [P] Comentarios al día** (`design.md` §12): `ESTADOS_A_BARRER` en
      `CorteDiarioRepository`, el bloque `corteSinGestionar` de `CierreDiaRepository` y la cabecera de
      `lib/utils/fecha-cr.ts` con su tercer consumidor.
      **Hecho:** ninguno de los tres describe un comportamiento que ya no existe.
- [ ] **T7.2 — [P] Dejar escritas D7, D8 y D9** como seguimiento (ranking, cambiar el día de una
      orden ya asignada, ver el día en el listado de la bodega), con su porqué.
      **Hecho:** anotadas en `progress/impl_246.md`; se registran como fichas sólo si el humano lo
      pide (**borrador antes de registrar**, y mirando `origin/dev` para no colisionar ids).
- [ ] **T7.3 — Cerrar la ficha.** `feature_list.json` (lo estampa el leader): estado, `status_note` de
      **3-6 líneas técnicas** —el detalle vive en `progress/`— y el mapa `R<n> → test` en
      `progress/impl_246.md`.
      **Hecho:** `./init.sh` completo verde con el árbol quieto, y el SHA medido comparado contra
      `origin/dev` **justo antes** de abrir el PR (`dev` se mueve). **Depende de:** T6, T7.1, T7.2.

---

## Mapa `R<n> → tanda`

| Tanda | R cubiertos |
| --- | --- |
| **T1** | R4 (mitad), R5, R6 (mitad), R19, R21 |
| **T2** | R11, R12, R13, R14, R15, R16, R17, R18, R20 |
| **T3** | R3, R4 (mitad), R6 (mitad), R7, R8, R9, R10, R35 |
| **T4** | R1, R2, R27, R28, R29 |
| **T5** | R22, R23, R24, R25, R26 |
| **T6** | R30, R31, R32, R33, R34 |

---

## Mapa `R<n> → test`

> ⚠️ **En las cuatro fichas anteriores este mapa citó tests que no existían.** Aquí, todo archivo sin
> marca **(NUEVO)** se comprobó que **existe hoy en el árbol**; los marcados **(NUEVO)** son
> entregables de esta ficha. `vitest` **no falla** con un filtro que no casa nada: lo ignora en
> silencio. Antes de dar el mapa por bueno, **ejecutar cada archivo citado por nombre** y comprobar
> que corre casos.

| Req | Test |
| --- | --- |
| R1 | `tests/components/AsignarBodegaModal.test.tsx` — «manda `manana` cuando se elige» |
| R2 | `tests/components/AsignarSateliteModal.test.tsx` — ídem, espejo |
| R3 | `tests/unit/services/guia-asignacion-service.test.ts` — «la misma fecha se aplica a todo el lote» |
| R4 | `tests/unit/types/dia-reparto-schema.test.ts` **(NUEVO)** — «sin el campo, `hoy`» · `tests/integration/actions/ordenes-guia-action.test.ts` — «petición sin `dia` se comporta como hoy» |
| R5 | `tests/unit/utils/dia-reparto.test.ts` **(NUEVO)** — «resuelve en el servidor, con reloj inyectado, a ambos lados de 00:00 CR y de 06:00 UTC» |
| R6 | `dia-reparto-schema.test.ts` **(NUEVO)** — «una fecha no es un valor aceptable» · `tests/components/SelectorDiaReparto.test.tsx` **(NUEVO)** — «el componente no lee el reloj del navegador» |
| R7 | `tests/unit/repositories/orden-repository.asignacion-satelite.test.ts` — «la fecha va en la misma escritura que `asignado_at`» |
| R8 | `tests/unit/repositories/cierre-dia-repository.test.ts` — «deshacer gestión estampa el día de hoy» |
| R9 | `tests/unit/repositories/orden-repository.deshacer-asignacion.test.ts` · `tests/unit/repositories/devolucion-sla-repository.test.ts` — «al limpiar la asignación se limpia el día» |
| R10 | `tests/unit/guards/fecha-reparto-acompana-asignado-at.guardia.test.ts` **(NUEVO)** (censo con autocomprobación) · `tests/unit/tablero-dia/asignado-at-solo-lectura.guardia.test.ts` verde sin tocar |
| R11 | `tests/unit/repositories/cierre-dia-repository.test.ts` — «la reservada para mañana no se barre» (**mutación T6.2**) |
| R12 | ídem — «la de ayer y la sin fecha sí se barren» |
| R13 | `tests/unit/services/corte-diario-seleccion.test.ts` — «dos corridas: la segunda sí la barre» (**mutación T6.1**) |
| R14 | `tests/unit/repositories/corte-diario-repository.test.ts` — «sus únicas órdenes son de mañana: no entra en el corte» |
| R15 | `tests/unit/services/corte-diario-seleccion.test.ts` — «caso mixto: hay `vencido` y la reservada sigue en `en_reparto`» |
| R16 | `tests/unit/services/corte-diario-service.test.ts` — «el mismo `diaCerrado` llega a la selección y a `crearCierre`» + typecheck (parámetro obligatorio en las dos capas) |
| R17 | `tests/unit/utils/dia-reparto.test.ts` **(NUEVO)** + censo de la guardia de T3.6: ningún `AT TIME ZONE`, `America/Costa_Rica` ni `interval '6 hours'` en el SQL de esta ficha |
| R18 | `tests/integration/actions/corte-diario-route.test.ts` verde **sin tocar** · el caso «la rama de gestiones sin cerrar no cambia» de `corte-diario-repository.test.ts` |
| R19 | `tests/integration/db/orden-fecha-reparto-migration.test.ts` **(NUEVO)** — «nullable, sin default, filas previas en `NULL`» · `corte-diario-repository.test.ts` — «sin fecha se barre igual» |
| R20 | `cierre-dia-repository.test.ts` — «`NULL` se barre; el predicado no pregunta si es de hoy» |
| R21 | `orden-fecha-reparto-migration.test.ts` **(NUEVO)** — «aplica, re-aplica y revierte» |
| R22 | `tests/components/RecogerModule.test.tsx` — **caso nuevo** en archivo existente: la card lee el **texto** «Para mañana» en el grupo «Por recoger» · `tests/components/RepartoModule.test.tsx` — el mismo texto para una ya recogida |
| R23 | `tests/unit/services/mis-asignaciones-service.test.ts` — «la reservada aparece en su grupo» |
| R24 | ídem — «se puede recoger y gestionar: la acción sí se llama» |
| R25 | ídem — «al pasar el día, la misma fila pasa a `false` sin ninguna escritura» |
| R26 | ídem — «`esParaManana` lo decide el servidor» (el DTO llega ya resuelto) |
| R27 | `tests/components/SelectorDiaReparto.test.tsx` **(NUEVO)** — «`Hoy` preseleccionado» |
| R28 | `tests/components/AsignarBodegaModal.test.tsx` — «dice para qué día quedó el lote» (se lee el texto) |
| R29 | `SelectorDiaReparto.test.tsx` **(NUEVO)** — «las etiquetas llegan por props» |
| R30 | Todas las guardias money-safe verdes **sin tocar** (T6.4). **Su verde es coherencia, no evidencia**: ninguna ejercita la columna nueva, porque la columna no toca dinero — y ésa es exactamente la afirmación |
| R31 | `tests/unit/domain/order-status-transiciones.guardia.test.ts` y `tests/unit/guards/censo-catalogo-estados-v2.test.ts` verdes **sin tocar** |
| R32 | `tests/unit/services/webhook-estado-encolado.test.ts` y `tests/integration/repositories/orden-webhook-enqueue.test.ts` verdes **sin tocar** (reservar no es transición de estado, así que no hay nada que encolar) |
| R33 | `tests/unit/guards/ranking-ventana-dia.guardia.test.ts`, `tests/unit/services/ranking-service.test.ts` y `tests/unit/repositories/tablero-dia-sql.test.ts` verdes **sin tocar** |
| R34 | `tests/unit/guards/recoleccion-no-contamina.test.ts` verde **sin tocar** |
| R35 | El caso de proyección de T3.7 en el test del repositorio |

---

## Paralelismo y conflictos de archivo

**Dentro de la feature**

- T1.2 bloquea T1.3; T2.1 → T2.2 → T2.3 → (T2.4, T2.5, T2.6); T3.3 bloquea T3.4-T3.7; T4.1 bloquea
  T4.2-T4.4; T5.1 bloquea T5.2-T5.3.
- **T2 y T3 no son paralelas**: las dos tocan `CierreDiaRepository` y las dos mueven contratos que la
  otra consume.
- **Backend antes que frontend**: T4 y T5.2 leen contratos que T3 y T5.1 todavía están moviendo.

**Con otras fichas en vuelo**

| Ficha | Estado | ¿Choca? |
| --- | --- | --- |
| **237** — la gestión de la tienda cuenta como del mensajero | `pending`, spec escrito, **en vuelo** | **SÍ, en dos sitios.** (1) `MisAsignacionesService`: la 237 extrae la subida compensada de `gestionar`, la 246 toca `listarMisAsignaciones`. Métodos distintos, **mismo archivo**. (2) `db/migrations/`: la 237 añade un valor al enum `orden_historial_origen_tipo`; la 246 añade una columna. **Timestamps distintos, obligatorio** (T0.3). **No en paralelo sobre `MisAsignacionesService`.** |
| **240** — rechazo manual de la tienda | `pending`, sin spec | **No.** Vive en `/novedades`, `ACCIONES_POR_GRUPO` y la arista `devuelta → rechazada`. La 246 no toca ninguno. |
| **241** — guardas de bloqueo | `in_progress` | **No en código**, pero **sí en sentido**: la regla firmada de la 241 (`vencido` bloquea gestionar) es la mitad de la justificación de ésta. Si la 241 cambiara esa regla, hay que releer `design.md` §5.3. `progress/investigacion_241.md` **no se toca**. |

**Archivos que esta ficha toca (para que otra sesión pueda comprobarlo de un vistazo)**

`db/schema.prisma` · `db/migrations/<ts>_orden_fecha_reparto/` · `lib/types/dia-reparto.ts` (NUEVO) ·
`lib/utils/dia-reparto.ts` (NUEVO) · `lib/types/orden-guia.ts` · `lib/types/recepcion-satelite.ts` ·
`lib/types/mis-asignaciones.ts` · `lib/services/CorteDiarioService.ts` ·
`lib/repositories/CorteDiarioRepository.ts` · `lib/repositories/CierreDiaRepository.ts` ·
`lib/repositories/OrdenRepository.ts` · `lib/repositories/CierresAdminRepository.ts` ·
`lib/repositories/DevolucionSlaRepository.ts` · `lib/repositories/LiberacionReprogramadaRepository.ts` ·
`lib/services/GuiaAsignacionService.ts` · `lib/services/AsignacionSateliteService.ts` ·
`lib/services/MisAsignacionesService.ts` · las interfaces correspondientes ·
`components/shared/SelectorDiaReparto.tsx` (NUEVO) ·
`app/(app)/ordenes/_components/AsignarBodegaModal.tsx` ·
`app/(app)/recepcion-satelite/_components/AsignarSateliteModal.tsx` · la card de
`app/(app)/mis-asignaciones/_components/`.

**Antes de registrar cualquier id o rama nuevos**, mirar `origin/dev`: ya hubo **dos** colisiones de
id entre sesiones.
