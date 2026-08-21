# Feature 246 — Tareas

> Leer antes: `requirements.md` (R1-R46, D1-D11) y `design.md`.
>
> ⚠️ **ACTUALIZADO tras la puerta humana del 2026-08-20.** **D7 se firmó EN CONTRA de la
> recomendación del spec**: el denominador del ranking se corrige aquí. Eso añade la tanda **T6**
> entera, tres mediciones (**M5-M7**) más un `EXPLAIN` (**M8**), un índice en `orden` y dos
> decisiones nuevas que siguen **abiertas** (**D10**, **D11**). La ficha pasa de `medium` a **`high`**.
>
> **Gate:** `./init.sh --rapido` para cerrar cada tanda; **`./init.sh` completo antes de cada PR, sin
> excepción**. El gate **no** se corre en paralelo con un subagente que muta el árbol: leería el árbol
> mutado y su veredicto no valdría.
>
> **PUNTO DE DESPLIEGUE — la parte que se puede hacer mal.** T1 y T2 son **inertes**: con la columna
> recién creada todas las filas están en `NULL` y el corte se comporta **byte a byte como hoy** (R19).
> **T3/T4 (que escriben la reserva) NO pueden desplegarse antes que T2** (que la respeta): si el
> selector llega primero, las órdenes reservadas se barren igual y la feature se lee como rota.
> **Y T6 (el ranking) no puede desplegarse antes que T3**: sin órdenes con `fecha_reparto`, el
> denominador nuevo sólo ejercita su rama de respaldo — que es correcto, pero deja la mitad de D7 sin
> estrenar y sin probar en producción. Orden seguro: **T1 → T2 → T3 → T4/T5 → T6**.
>
> **Zona `fullstack` ⇒ se secuencia backend → frontend.** T1-T3, T5.1 y T6 con el subagente de
> **backend**; T4 y T5.2-T5.3 con el de **frontend**. Nunca a la vez sobre los mismos archivos.
>
> **El comentario explica el porqué, no el qué.** Cada `where` nuevo del corte lleva escrito **por qué**
> ese ancla y no otra; cada `null` que se limpia, **por qué** acompaña a `asignado_at`; y las dos ramas
> del `OR` del ranking, **por qué** son disjuntas.

---

## T0 — Puerta humana: medir y firmar (sin código)

- [x] **T0.2 — Firmar D1, D2, D4, D7.** ✅ **HECHO el 2026-08-20.** D1+D2 y D4 **con** la
      recomendación; **D7 EN CONTRA** (el ranking se corrige aquí). El spec se corrigió **antes** de
      escribir código, como manda el proceso: sección **H** nueva en `requirements.md`, §6.bis nueva
      en `design.md`, esta tanda **T6**, y el registro de la decisión en §«PUERTA HUMANA PASADA».
- [ ] **T0.1 — Medir contra producción**, vía MCP de Supabase, **solo lectura**, con las consultas de
      `design.md` §9: **M1** (horaria de `asignado_at`), **M2** (barridas recién asignadas), **M3**
      (recogidas por hora), **M4** (`vencido` por noche).
      **Hecho:** los cuatro números en `progress/impl_246.md` con su fecha **y su autocomprobación**
      (cada agregado cuadrado contra su denominador). Un cero sin denominador es «no hay datos», no
      «no pasa». **Bloquea T1.**
      ⏳ **Caduca**: se re-mide justo antes de desplegar, no antes de mergear.
- [x] **T0.5 — Medir el coste de D7** (nuevo tras la firma): **M5** (cuánto se movería el
      denominador), **M6** (cuánto dinero mueve `premio_ranking` hoy), **M7** (en cuántos días
      cambiaría el podio).
      **Hecho:** los tres en `progress/impl_246.md` **etiquetados como PROXY** donde lo son (M5 y M7
      simulan una conducta humana que todavía no existe) y con la advertencia de que M7 reimplementa a
      mano el comparador que en el código vive en `lib/ranking/orden-ranking.ts`. **Con M6 y M7 juntos
      se escribe una frase: «esta decisión mueve ≈X colones al mes entre Y personas».** Si no se puede
      escribir esa frase, la medición no está terminada. **Bloquea T6.**
- [x] **T0.6 — [P] `EXPLAIN` del denominador (M8).** El de la consulta actual contra producción (solo
      lectura, **sin `ANALYZE`**) y el de la consulta nueva contra una base **con la migración
      aplicada** (local o preview, nunca producción).
      **Hecho:** los dos planes pegados. **Si el planificador no usa `orden_fecha_reparto_idx`, el
      índice NO se crea** y T1.1 se ajusta. **Bloquea T1.1** (decide si la migración lleva índice).
- [x] **T0.7 — Firmar D10 y D11**, que la firma de D7 abre y que siguen **ABIERTAS**:
      **D10** ¿el tablero del día sigue al ranking? (recomendación: **sí**);
      **D11** ¿se recalcula el ranking ya congelado? (recomendación: **NO** — `ranking_snapshot_*` son
      inmutables por diseño y recalcular reescribe filas que ya se leyeron para pagar a alguien).
      **Hecho:** las dos respondidas en `progress/impl_246.md`. **Si D11 se firmara que sí, esta ficha
      NO lo implementa**: es una ficha aparte con su propia puerta humana. **Bloquea T6.**
- [x] **T0.3 — [P] Confirmar el timestamp de la migración contra `origin/dev`.** Hay fichas en vuelo
      (237) que también añaden migración; y ya hubo **dos colisiones de id entre sesiones**.
      **Hecho:** `<ts>` elegido tras mirar `origin/dev`, anotado. **Bloquea T1.1.**
- [x] **T0.4 — [P] Aviso operativo, ahora con DOS mensajes** (no es código): (a) a partir del
      despliegue hay que **elegir** el día al asignar, con «Hoy» preseleccionado, y un mensajero puede
      acabar bloqueado por su cierre **con los paquetes de mañana en la mano** (§5.3); (b) **el
      ranking cambia de criterio**: quien reciba asignaciones de noche verá su porcentaje moverse, y
      **los días ya congelados no se recalculan**.
      **Hecho:** aviso enviado y anotado con fecha. **Bloquea el despliegue, no T1.**

---

## T1 — La columna y el helper *(inerte: se puede desplegar suelto)*

- [x] **T1.1 — Migración `<ts>_orden_fecha_reparto`** (`design.md` §2.2/§2.3):
      `ALTER TABLE "orden" ADD COLUMN "fecha_reparto" DATE;` **+ `CREATE INDEX
      "orden_fecha_reparto_idx"` sólo si M8 lo justifica** + `down.sql` con su `DROP INDEX IF EXISTS`
      y `DROP COLUMN IF EXISTS`, y **las dos consecuencias operativas declaradas** (revertir hace que
      el primer corte barra lo reservado **y** devuelve el denominador del ranking a `asignado_at`).
      El `migration.sql` lleva su razonamiento entero arriba, al nivel de
      `20260819170000_gestion_orden_confirmacion_fisica`. `schema.prisma` con
      `fechaReparto DateTime? @map("fecha_reparto") @db.Date` (+ `@@index([fechaReparto])` si procede).
      **Sin CHECK, sin tocar RLS, sin tocar ningún enum.**
      **Hecho:** `pnpm run db:migrate` aplica y `pnpm run db:rollback` revierte en local;
      `tests/integration/db/orden-fecha-reparto-migration.test.ts` **(NUEVO)** —molde de
      `tests/integration/db/orden-prioridad-migration.test.ts`— afirma que la columna es **nullable,
      sin default**, que las filas previas quedan en `NULL` (R19), que el índice existe **si se creó**
      y que aplicar dos veces no rompe. **Depende de:** T0.2, T0.3, T0.6.
- [x] **T1.2 — [P] `lib/types/dia-reparto.ts` (NUEVO)**: `DIA_REPARTO`, `DiaReparto`,
      `diaRepartoSchema`. Un único punto para las dos superficies.
      **Hecho:** `tests/unit/types/dia-reparto-schema.test.ts` **(NUEVO)** cubre: valor válido,
      valor desconocido rechazado, **ausencia ⇒ `"hoy"`** (R4) y que **una fecha no es un valor
      aceptable** (R6). **Depende de:** T0.2.
- [x] **T1.3 — `lib/utils/dia-reparto.ts` (NUEVO)**: `resolverFechaReparto(dia, now)` sobre
      `startOfDayCR`. **Con reloj inyectable**, jamás `new Date()` interno.
      **Hecho:** `tests/unit/utils/dia-reparto.test.ts` **(NUEVO)** con casos a ambos lados de las
      dos fronteras que este repo confunde: **00:00 CR** y **06:00 UTC**. Al menos: `23:59 CR`,
      `00:01 CR`, `05:59Z`, `06:01Z`. Un caso afirma explícitamente que **no** se usa
      `inicioDelDiaCREnUtc` (riesgo 3). **Depende de:** T1.2.

**R cubiertos por T1:** R4 (mitad), R5, R6 (mitad), R19, R21.

---

## T2 — El corte *(inerte con la columna en `NULL`; se despliega ANTES que T3/T4)*

- [x] **T2.1 — `CorteDiarioService.ejecutarCorte` calcula `diaCerrado` UNA vez** por corrida
      (`startOfDayCR(now) − 1 día`) y lo pasa a las dos capas. Reloj **inyectable**.
      **Hecho:** `tests/unit/services/corte-diario-service.test.ts` gana un caso que afirma que **el
      mismo valor** llega a la selección y a `crearCierre` (R16/R17). **Depende de:** T1.1.
- [x] **T2.2 — `findMensajerosConActividadSinCierre(diaCerrado)`**: el `where` de la rama (b) gana
      `OR: [{ fechaReparto: null }, { fechaReparto: { lte: diaCerrado } }]`. **El parámetro es
      obligatorio**, no opcional: así olvidar cablearlo rompe el typecheck en vez de dejar el corte
      con un criterio silencioso.
      **Hecho:** `tests/unit/repositories/corte-diario-repository.test.ts` afirma, con un doble que
      **honra el `where`** (nunca un `vi.fn()` mudo): un mensajero cuyas únicas órdenes están
      reservadas para mañana **no sale** (R14); uno con órdenes sin fecha **sí** sale (R19/R20); uno
      con órdenes de ayer **sí** sale (R12); la rama de gestiones sin cerrar **no cambia** (R18).
      **Depende de:** T2.1.
- [x] **T2.3 — `CorteSinGestionarInput` gana `diaCerrado`** y el bloque de `crearCierre` aplica el
      **mismo** `OR` en el pre-`SELECT` **y** en el `where` del `updateMany` guardado.
      **Hecho:** `tests/unit/repositories/cierre-dia-repository.test.ts` afirma: se barren las de
      ayer y las sin fecha; **no** se barre la reservada para mañana; el `updateMany` lleva el filtro
      **en el `where`** y no se filtra en memoria. El typecheck **rompe** en todo doble que no pase el
      campo — **esa es la señal buscada**. **Depende de:** T2.2.
- [x] **T2.4 — El caso que impide el «nunca se barre» (R13).** Dos corridas consecutivas con reloj
      inyectado: la primera respeta la orden reservada para mañana; **la segunda la barre**.
      **Hecho:** un caso en `tests/unit/services/corte-diario-seleccion.test.ts` que corre el corte
      dos veces con `now` distinto y afirma los dos desenlaces. Es **el** caso de esta ficha.
      **Depende de:** T2.3.
- [x] **T2.5 — [P] El caso mixto (R15).** Mensajero con órdenes reservadas **y** gestiones sin
      cerrar: recibe su `vencido` y se barren **sólo** las no protegidas.
      **Hecho:** un caso que afirma las dos mitades a la vez (el cierre existe **y** la reservada
      sigue en `en_reparto`). **Depende de:** T2.3.
- [x] **T2.6 — [P] El corte no cambia en nada más (R18).**
      `tests/integration/actions/corte-diario-route.test.ts` verde **sin tocar**; la exclusión por
      cierre abierto, el snapshot de totales y la idempotencia, verdes sin tocar.
      **Hecho:** anotado en `progress/impl_246.md` con los archivos comprobados. **Depende de:** T2.3.

**R cubiertos por T2:** R11, R12, R13, R14, R15, R16, R17, R18, R20.

---

## T3 — La asignación escribe el día *(backend; NO se despliega antes que T2)*

- [x] **T3.1 — Borde zod en las dos superficies.** `asignarBodegaSchema` y `asignarSateliteSchema`
      ganan `dia: diaRepartoSchema.default("hoy")`. Las Server Actions lo pasan **tal cual** al
      servicio, sin coerción.
      **Hecho:** `tests/integration/actions/ordenes-guia-action.test.ts` y
      `tests/unit/actions/recepcion-satelite-action.test.ts` afirman que el valor llega al servicio
      sin transformar y que **una petición sin el campo** se comporta como «hoy» (R4).
      **Depende de:** T1.2, T2.
- [x] **T3.2 — Los dos servicios resuelven la fecha.** `GuiaAsignacionService.asignarDesdeBodega` y
      `AsignacionSateliteService.asignar` llaman a `resolverFechaReparto` **una vez** y pasan la
      fecha al repositorio.
      **Hecho:** `tests/unit/services/guia-asignacion-service.test.ts` y
      `tests/unit/services/asignacion-satelite-service.test.ts` afirman, con reloj inyectado, que
      «mañana» produce la fecha CR correcta y que el repositorio la recibe **ya resuelta**.
      **Depende de:** T3.1.
- [x] **T3.3 — La escritura (R7).** `OrdenRepository.asignarBodegaLote` añade `fechaReparto` a su
      `data`; `asignarSateliteLote` añade `"fecha_reparto" = $n` a su `SET` **parametrizado**
      (`Prisma.sql`, jamás interpolación).
      **Hecho:** `tests/unit/repositories/orden-repository.asignacion-satelite.test.ts` y el test de
      `asignarBodegaLote` afirman que la fecha va **en la misma escritura** que `asignado_at`, y que
      el `SET` **no** contiene ninguna zona horaria ni `NOW()::date`. **Depende de:** T3.2.
- [x] **T3.4 — [P] Las vías sin elección (R8).** Deshacer gestión re-estampa `asignado_at`: estampa
      también `fechaReparto = startOfDayCR()`.
      **Hecho:** un caso en `tests/unit/repositories/cierre-dia-repository.test.ts` que lo afirma, con
      su comentario explicando **por qué** (las dos columnas nunca cuentan historias distintas).
      **Depende de:** T3.3.
- [x] **T3.5 — [P] La limpieza (R9/R10).** Los cinco sitios que hoy ponen `asignado_at = null` junto
      a `mensajero_asignado_id = null` ponen también `fecha_reparto = null`:
      `OrdenRepository.deshacerAsignacionLote`, `OrdenRepository` (retorno a bodega satélite),
      `CierresAdminRepository` (liberar al aprobar), `DevolucionSlaRepository`,
      `LiberacionReprogramadaRepository`.
      **Hecho:** `tests/unit/repositories/orden-repository.deshacer-asignacion.test.ts`,
      `tests/unit/repositories/devolucion-sla-repository.test.ts` y los tests de liberación afirman
      la limpieza en la **misma** escritura. **Depende de:** T3.3.
- [x] **T3.6 — Guardia de la invariante (R10).**
      `tests/unit/guards/fecha-reparto-acompana-asignado-at.guardia.test.ts` **(NUEVO)**: censo del
      árbol; **ninguna** escritura que fije o limpie `asignadoAt`/`asignado_at` lo hace sin tocar
      `fechaReparto`/`fecha_reparto` en el mismo objeto `data`/`SET`. Molde de
      `tests/unit/guards/carga-del-mensajero.guardia.test.ts`: si la guardia no puede leer lo que
      vigila, **revienta en rojo** en vez de dar por buena una lectura vacía.
      **Hecho:** verde, y **roja** al quitar el `fechaReparto` de uno de los sitios
      (**autocomprobación dentro del propio archivo**). El censo se escribe **en un archivo de test**,
      nunca por `node -e`: ahí `\b` llega como backspace y el censo miente en verde.
      **Depende de:** T3.5.
- [x] **T3.7 — [P] La proyección de lectura (R35).** El día de reparto viaja en la proyección que ya
      lee la orden asignada, sin consulta nueva.
      **Hecho:** el test del repositorio afirma que el campo sale en el `select`. **Depende de:** T3.3.

**R cubiertos por T3:** R3, R4 (mitad), R6 (mitad), R7, R8, R9, R10, R33, R35.

---

## T4 — Las dos pantallas de asignación *(frontend; mismo PR que T3)*

- [x] **T4.1 — Selector compartido `components/shared/SelectorDiaReparto.tsx` (NUEVO)**: dos
      opciones, **«Hoy» preseleccionada** (R27), construido sobre la primitiva de `components/ui/`
      que ya exista (`npx shadcn add radio-group` si falta) — **nunca un componente propio si shadcn
      lo tiene**. Recibe las etiquetas de día **por props**; no llama a `new Date()` (R29).
      **Hecho:** `tests/components/SelectorDiaReparto.test.tsx` **(NUEVO)** afirma el valor por
      defecto, el cambio de opción y que **el componente no lee el reloj del navegador** (censo del
      propio archivo). **Depende de:** T3.
- [x] **T4.2 — `AsignarBodegaModal` monta el selector** y manda `dia` en `asignarDesdeBodega` (R1).
      Las etiquetas con el día llegan desde el Server Component de la página.
      **Hecho:** `tests/components/AsignarBodegaModal.test.tsx` gana dos casos: **manda `"hoy"` por
      defecto** y **manda `"manana"` cuando se elige** (es el caso que impide que el selector quede
      decorativo). **Depende de:** T4.1.
- [x] **T4.3 — [P] `AsignarSateliteModal`, lo mismo** (R2).
      **Hecho:** los dos casos espejo en `tests/components/AsignarSateliteModal.test.tsx`.
      **Depende de:** T4.1.
- [x] **T4.4 — [P] La confirmación con palabras (R28).** Tras asignar, el modal dice para qué día
      quedó el lote, sin siglas ni jerga.
      **Hecho:** un caso que **lee el texto**, no una clase ni un `data-*`. **Depende de:** T4.2.

**R cubiertos por T4:** R1, R2, R27, R28, R29.

---

## T5 — El portal del mensajero

- [x] **T5.1 — `esParaManana` en el DTO, derivado EN EL SERVIDOR** (R26).
      `MisAsignacionesService.listarMisAsignaciones` lo calcula con el mismo `startOfDayCR`, **sin**
      añadir un cuarto grupo.
      **Hecho:** `tests/unit/services/mis-asignaciones-service.test.ts` afirma, con reloj inyectado:
      una reservada para mañana llega con `esParaManana: true`; la de hoy y la sin fecha, `false`; y
      **al pasar el día, la misma fila pasa a `false` sin ninguna escritura** (R25).
      **Depende de:** T3.
- [x] **T5.2 — La card lo dice con palabras (R22).** «Para mañana» como **texto**, no sólo color: el
      repo ya tiene guardia de contraste y una lección escrita sobre medir color en el navegador.
      **Hecho:** un caso nuevo en `tests/components/RecogerModule.test.tsx` (grupo «Por recoger», que
      es donde vive el 99 % de lo reservado) y otro en `tests/components/RepartoModule.test.tsx` (una
      ya recogida la noche anterior), los dos **leyendo el texto**. **Depende de:** T5.1.
- [x] **T5.3 — [P] Ni se oculta ni se bloquea (R23/R24).** Dos casos: la orden reservada **aparece**
      en su grupo, y **se puede recoger** y **gestionar** exactamente igual.
      **Hecho:** dos casos que lo afirman; el de recoger comprueba que la Server Action **sí** se
      llama. Es la mitad de D5 que un test puede sostener. **Depende de:** T5.1.

**R cubiertos por T5:** R22, R23, R24, R25, R26.

---

## T6 — El denominador del ranking *(NUEVA — entra por D7, firmada en contra; backend)*

> ⚠️ **Aquí se decide quién ocupa el podio y, con él, quién cobra `premio_ranking`.** No se empieza
> sin T0.5 (M5/M6/M7) y T0.7 (D10/D11) respondidas.

- [x] **T6.1 — `IRankingRepository.contarAsignadasPorMensajero` gana un tercer parámetro
      `diaReparto: Date`** (convención `DATE`: medianoche UTC de la fecha CR). **Obligatorio, sin
      default**: un default dejaría el vivo y el snapshot contando distinto sin que nadie se entere,
      que es lo que R41 prohíbe.
      **Hecho:** el typecheck **rompe** en todos los dobles de `IRankingRepository` — esa es la señal
      buscada. **Depende de:** T0.5, T0.7, T3.
- [x] **T6.2 — La consulta con el `OR` de dos ramas disjuntas** (`design.md` §6.bis.3) en
      `RankingRepository`. Cabecera reescrita explicando las **dos** ramas y **por qué** la segunda
      lleva `fechaReparto: null`.
      **Hecho:** `tests/unit/repositories/ranking-repository.test.ts`, con un doble que **honra el
      `where`**, afirma cuatro cosas: (a) una orden reservada para el día cuenta (R36); (b) una sin
      fecha cuenta por `asignado_at` (R37); (c) una asignada hoy para mañana **no** cuenta hoy
      (R38); (d) **ninguna orden se cuenta dos veces** — el caso testigo de las ramas disjuntas.
      **Depende de:** T6.1.
- [x] **T6.3 — El vivo y el congelado, con el mismo criterio (R41).** `RankingService` calcula el
      tercer valor con `startOfDayCR`; `RankingSnapshotService` lo saca de
      `fechaComoDate(fechaObjetivo(now))`, que **ya existe**.
      **Hecho:** `tests/unit/services/ranking-service.test.ts` y
      `tests/unit/services/ranking-snapshot-service.test.ts` afirman **qué valor exacto** recibe el
      repositorio en cada caso, y que los dos usan el **mismo** criterio para días distintos.
      **Depende de:** T6.2.
- [x] **T6.4 — El día del despliegue (R43) — el caso de dinero.** Un caso con una mezcla de órdenes
      **con** y **sin** `fecha_reparto` que afirma que el denominador es el de siempre para las
      viejas y el nuevo para las nuevas, **sin salto**.
      **Hecho:** el caso vive en `ranking-repository.test.ts` (es donde está el `WHERE`, no en el
      servicio) y **su mutación está en T7.4**. **Depende de:** T6.2.
- [x] **T6.5 — [P] Lo que NO se toca (R45).** `lib/ranking/orden-ranking.ts` (orden, podio,
      redondeo), el cron del snapshot y su idempotencia, y `premio_ranking`: **verdes sin una sola
      línea modificada**.
      **Hecho:** anotado en `progress/impl_246.md` con los archivos comprobados;
      `tests/unit/guards/ranking-snapshot-cron.guardia.test.ts` verde sin tocar. **Depende de:** T6.3.
- [x] **T6.6 — [P] Enseñar a la guardia de la ventana a leer las DOS convenciones.**
      `tests/unit/guards/ranking-ventana-dia.guardia.test.ts` vigila que las cotas del día sean las de
      la convención 144/166. Sigue valiendo para el numerador y para la rama de respaldo, pero ahora
      hay una tercera fecha con convención `DATE`. **Se amplía, no se relaja**: si acaba aceptando
      cualquier fecha, deja de proteger del off-by-one de la 166.
      **Hecho:** la guardia distingue las dos convenciones y **se pone roja** si alguien usa
      `startOfDayCR` como cota de un `timestamp` o `inicioDelDiaCREnUtc` como valor de un `DATE`
      (autocomprobación en el propio archivo). **Depende de:** T6.3.
> 🚫 **T6.7 — N/A por la firma de D10, no «hecha».** D10 se firmó **«el tablero NO sigue al
> ranking»**, así que el `OR` no entra ahí a propósito. Se marca para que la contabilidad cuadre,
> pero **no hubo trabajo**: hubo una decisión de no hacerlo.
- [x] **T6.7 — El tablero del día, SÓLO si D10 se firmó que sí.** El mismo `OR` en el CTE
      `ids_del_dia` de `TableroDiaRepository`, con la fecha **como parámetro** (SQL crudo, cero zonas
      horarias).
      **Hecho:** `tests/unit/repositories/tablero-dia-sql.test.ts` afirma el predicado nuevo y
      `tests/unit/tablero-dia/asignado-at-solo-lectura.guardia.test.ts` sigue **verde** (se sigue
      leyendo, no escribiendo). **Si D10 se firmó que NO**, esta tarea se marca `N/A` y se corrige el
      comentario de cabecera del tablero, que hoy afirma que `asignado_at` «es el denominador del
      ranking diario» — con D7 **eso deja de ser cierto**. **Depende de:** T0.7, T6.3.

**R cubiertos por T6:** R36, R37, R38, R39, R40, R41, R42, R43, R44, R45, R46.

---

## T7 — Mutaciones, guardias y ver la app

- [x] **T7.1 — Mutación: el ancla del corte.** Cambiar `diaCerrado` por `startOfDayCR(now)` (el ancla
      ingenua de `design.md` §5.1) y comprobar que la suite se pone **roja** en el caso de T2.4.
      **Hecho:** salida real pegada en `progress/impl_246.md`, con el nombre del test que cae. Sin esa
      salida **no cuenta**: este repo ya tuvo un arnés de mutaciones que reportó 9/9 supervivientes
      dos veces **sin haber ejecutado un test**. **Depende de:** T2, T3.
- [x] **T7.2 — [P] Mutación: el `WHERE` del barrido.** Quitar el `OR` del `updateMany` de
      `crearCierre` (dejándolo en el pre-`SELECT`) y comprobar que cae un caso **del repositorio**.
      **Hecho:** ídem, con salida real. ⚠️ **Se mide en el repositorio, no en el servicio**: este repo
      midió cuatro veces que los tests de servicio usan dobles y **no ven el `WHERE`**.
      **Depende de:** T2.3.
- [x] **T7.3 — [P] Mutación: la limpieza.** Quitar `fechaReparto: null` de uno de los cinco sitios de
      T3.5 y comprobar que caen el caso de ese sitio **y** la guardia de T3.6.
      **Hecho:** ídem, con salida real. **Depende de:** T3.6.
- [x] **T7.4 — Mutación: la rama de respaldo del ranking. LA MÁS CARA DE LA FICHA.** Quitar la
      segunda rama del `OR` (`{ fechaReparto: null, asignadoAt: {...} }`) y comprobar que cae el caso
      de T6.4. **Es la mutación que protege el podio del día del despliegue** (R43).
      **Hecho:** salida real pegada. **Depende de:** T6.4.
- [x] **T7.5 — [P] Mutación: las ramas disjuntas.** Quitar el `fechaReparto: null` de la segunda rama
      (dejando sólo el rango) y comprobar que cae el caso de doble conteo de T6.2.
      **Hecho:** ídem, con salida real. **Depende de:** T6.2.
- [x] **T7.6 — Guardias completas.** `pnpm run test:guardias` entero. Verdes **sin tocar**:
      `carga-del-mensajero.guardia.test.ts` (las listas de estatus no cambian),
      `asignado-at-solo-lectura.guardia.test.ts` (R33),
      `order-status-transiciones.guardia.test.ts` y `censo-catalogo-estados-v2.test.ts` (R31: ningún
      estado nuevo), `recoleccion-no-contamina.test.ts` (R34), `webhook-estado-encolado.test.ts` y
      `orden-webhook-enqueue.test.ts` (R32), `ranking-snapshot-cron.guardia.test.ts` (R45), y todas
      las money-safe (R30).
      **Hecho:** todas verdes. Un rojo en cualquiera de éstas **es regresión, no una aserción a
      cambiar** (`design.md` §8). **Depende de:** T6.
> ⚠️ **T7.7 — HECHA A MEDIAS, y se dice.** Se recorrió el selector con Playwright y quedó escrito en
> `progress/recorrido_240_246.md`: existe, su defecto es «Hoy» explícito y marcado, las dos opciones
> enseñan la **fecha concreta** y **las resuelve el servidor**. Lo que **NO** se vio con los ojos es
> **el corte nocturno respetando el día de mañana** — no se puede provocar a mano sin esperar al cron
> o invocarlo. Está cubierto por tests, incluida la mutación del ancla (9 rojos), pero **cubierto por
> tests no es visto**: en esta pila «ver la app» encontró un cierre imposible de aprobar y un botón
> que siempre fallaba.
- [x] **T7.7 — Ver la app, no sólo la suite.** Recorrido completo con los tres roles:
      1. **Bodega central**, asignar un lote **para mañana** → leer la confirmación.
      2. **Bodega satélite**, asignar otro lote **para hoy**.
      3. **Mensajero**: ver los dos lotes, leer «Para mañana» en el primero, **recoger** uno de cada.
      4. **Abrir `/ranking` y anotar los números** antes de nada.
      5. **Correr el corte a mano** con el reloj a las 00:00 CR del día siguiente: la de hoy queda
         `sin_gestionar` y **la de mañana sigue `en_reparto`**; comprobar si hubo `vencido` y por qué.
      6. **Correr el corte otra vez** un día más allá: la de mañana **ahora sí** se barre.
      7. **Volver a `/ranking`** con el reloj en el día reservado y comprobar que **las órdenes de
         mañana cuentan hoy y no contaron ayer** — con los números del paso 4 al lado.
      8. Volver al portal del mensajero y comprobar que la etiqueta «Para mañana» **desapareció
         sola**.
      **Hecho:** recorrido anotado paso a paso en `progress/recorrido_246.md`, con los textos leídos
      **tal cual** y con los dos juegos de números del ranking. Doce mil tests dan por buenos textos
      rotos que un recorrido de minutos encuentra; en este repo ya pasó cuatro veces.
      **Depende de:** T7.6.

**R cubiertos por T7:** R30, R31, R32, R34 (+ verificación cruzada de todos los anteriores).

---

## T8 — Cierre documental

- [x] **T8.1 — [P] Comentarios al día** (`design.md` §12): `ESTADOS_A_BARRER` en
      `CorteDiarioRepository`; el bloque `corteSinGestionar` de `CierreDiaRepository`; la cabecera de
      `lib/utils/fecha-cr.ts`; **la cabecera de `RankingRepository`** (las dos ramas y por qué son
      disjuntas); **el comentario de `TableroDiaRepository`** que afirma que `asignado_at` «es el
      denominador del ranking diario» —con D7 **deja de ser cierto**—; y **el ⛔ de
      `lib/ranking/snapshot-dia.ts`**, que sigue vigente para el numerador pero ahora convive con una
      fecha `DATE` que sí usa `startOfDayCR`.
      **Hecho:** ninguno de los seis describe un comportamiento que ya no existe.
- [x] **T8.2 — [P] Dejar escritas D8, D9 y —si D11 se firmó que sí— la ficha del recálculo**, con su
      porqué.
      **Hecho:** anotadas en `progress/impl_246.md`; se registran como fichas sólo si el humano lo
      pide (**borrador antes de registrar**, y mirando `origin/dev` para no colisionar ids).
- [ ] **T8.3 — Cerrar la ficha.** `feature_list.json` (lo estampa el leader): estado,
      **`complexity: "high"`** (ver el veredicto en `requirements.md`), `status_note` de **3-6 líneas
      técnicas** —que **debe** mencionar que la ficha movió el denominador del ranking por D7— y el
      mapa `R<n> → test` en `progress/impl_246.md`.
      **Hecho:** `./init.sh` completo verde con el árbol quieto, y el SHA medido comparado contra
      `origin/dev` **justo antes** de abrir el PR (`dev` se mueve). **Depende de:** T7, T8.1, T8.2.

---

## Mapa `R<n> → tanda`

| Tanda | R cubiertos |
| --- | --- |
| **T1** | R4 (mitad), R5, R6 (mitad), R19, R21 |
| **T2** | R11, R12, R13, R14, R15, R16, R17, R18, R20 |
| **T3** | R3, R4 (mitad), R6 (mitad), R7, R8, R9, R10, R33, R35 |
| **T4** | R1, R2, R27, R28, R29 |
| **T5** | R22, R23, R24, R25, R26 |
| **T6** | R36, R37, R38, R39, R40, R41, R42, R43, R44, R45, R46 |
| **T7** | R30, R31, R32, R34 |

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
| R10 | `tests/unit/guards/fecha-reparto-acompana-asignado-at.guardia.test.ts` **(NUEVO)** (censo con autocomprobación) |
| R11 | `tests/unit/repositories/cierre-dia-repository.test.ts` — «la reservada para mañana no se barre» (**mutación T7.2**) |
| R12 | ídem — «la de ayer y la sin fecha sí se barren» |
| R13 | `tests/unit/services/corte-diario-seleccion.test.ts` — «dos corridas: la segunda sí la barre» (**mutación T7.1**) |
| R14 | `tests/unit/repositories/corte-diario-repository.test.ts` — «sus únicas órdenes son de mañana: no entra en el corte» |
| R15 | `tests/unit/services/corte-diario-seleccion.test.ts` — «caso mixto: hay `vencido` y la reservada sigue en `en_reparto`» |
| R16 | `tests/unit/services/corte-diario-service.test.ts` — «el mismo `diaCerrado` llega a la selección y a `crearCierre`» + typecheck (parámetro obligatorio en las dos capas) |
| R17 | `tests/unit/utils/dia-reparto.test.ts` **(NUEVO)** + el censo de la guardia de T3.6: ningún `AT TIME ZONE`, `America/Costa_Rica` ni `interval '6 hours'` en el SQL de esta ficha |
| R18 | `tests/integration/actions/corte-diario-route.test.ts` verde **sin tocar** · el caso «la rama de gestiones sin cerrar no cambia» de `corte-diario-repository.test.ts` |
| R19 | `tests/integration/db/orden-fecha-reparto-migration.test.ts` **(NUEVO)** — «nullable, sin default, filas previas en `NULL`» · `corte-diario-repository.test.ts` — «sin fecha se barre igual» |
| R20 | `cierre-dia-repository.test.ts` — «`NULL` se barre; el predicado no pregunta si es de hoy» |
| R21 | `orden-fecha-reparto-migration.test.ts` **(NUEVO)** — «aplica, re-aplica y revierte» |
| R22 | `tests/components/RecogerModule.test.tsx` — **caso nuevo** en archivo existente: la card lee el **texto** «Para mañana» · `tests/components/RepartoModule.test.tsx` — el mismo texto para una ya recogida |
| R23 | `tests/unit/services/mis-asignaciones-service.test.ts` — «la reservada aparece en su grupo» |
| R24 | ídem — «se puede recoger y gestionar: la acción sí se llama» |
| R25 | ídem — «al pasar el día, la misma fila pasa a `false` sin ninguna escritura» |
| R26 | ídem — «`esParaManana` lo decide el servidor» (el DTO llega ya resuelto) |
| R27 | `tests/components/SelectorDiaReparto.test.tsx` **(NUEVO)** — «`Hoy` preseleccionado» |
| R28 | `tests/components/AsignarBodegaModal.test.tsx` — «dice para qué día quedó el lote» (se lee el texto) |
| R29 | `SelectorDiaReparto.test.tsx` **(NUEVO)** — «las etiquetas llegan por props» |
| R30 | Todas las guardias money-safe verdes **sin tocar** (T7.6). **Su verde es coherencia, no evidencia**: ninguna ejercita la columna nueva, porque la columna no toca dinero — y ésa es exactamente la afirmación |
| R31 | `tests/unit/domain/order-status-transiciones.guardia.test.ts` y `tests/unit/guards/censo-catalogo-estados-v2.test.ts` verdes **sin tocar** |
| R32 | `tests/unit/services/webhook-estado-encolado.test.ts` y `tests/integration/repositories/orden-webhook-enqueue.test.ts` verdes **sin tocar** |
| R33 | `tests/unit/tablero-dia/asignado-at-solo-lectura.guardia.test.ts` verde **sin tocar** — esta ficha lee y acompaña `asignado_at`, no cambia quién lo escribe |
| R34 | `tests/unit/guards/recoleccion-no-contamina.test.ts` verde **sin tocar** |
| R35 | El caso de proyección de T3.7 en el test del repositorio |
| R36 | `tests/unit/repositories/ranking-repository.test.ts` — «una orden reservada para el día cuenta en su denominador» |
| R37 | ídem — «una orden sin día de reparto cuenta por `asignado_at`» (**mutación T7.4**) |
| R38 | ídem — «asignada hoy para mañana: no cuenta hoy, cuenta mañana» |
| R39 | ídem — el numerador (`contarEntregadasPorMensajero`) **verde sin tocar** |
| R40 | `tests/unit/services/ranking-service.test.ts` — «entrega hoy de una reservada para mañana: numerador hoy, denominador mañana» |
| R41 | `ranking-service.test.ts` y `tests/unit/services/ranking-snapshot-service.test.ts` — «los dos pasan el mismo tipo de valor, para días distintos» |
| R42 | `ranking-snapshot-service.test.ts` — «una fecha ya congelada no se reescribe» (la unicidad de `fecha` sigue siendo la idempotencia) |
| R43 | `ranking-repository.test.ts` — «mezcla de órdenes con y sin fecha: sin salto en el denominador» (**mutación T7.4**) |
| R44 | **M8**, no un test: el `EXPLAIN` de T0.6 pegado en `progress/impl_246.md`. **Un test no puede afirmar un plan de ejecución**, y fingir que sí sería una aserción contra su propia fuente |
| R45 | Los tests de `lib/ranking/orden-ranking.ts` y `tests/unit/guards/ranking-snapshot-cron.guardia.test.ts` verdes **sin una línea modificada** |
| R46 | `ranking-snapshot-service.test.ts` — «el denominador del día congelado no lo puede cambiar una asignación posterior» (por el alcance hoy/mañana: no hay escritura posible después de las 02:00 CR del día siguiente) |

---

## Paralelismo y conflictos de archivo

**Dentro de la feature**

- T1.2 → T1.3; T2.1 → T2.2 → T2.3 → (T2.4, T2.5, T2.6); T3.3 → T3.4-T3.7; T4.1 → T4.2-T4.4;
  T5.1 → T5.2-T5.3; T6.1 → T6.2 → (T6.3, T6.4) → (T6.5, T6.6, T6.7).
- **T2 y T3 no son paralelas**: las dos tocan `CierreDiaRepository` y las dos mueven contratos que la
  otra consume.
- **T6 no es paralela con T3**: necesita que la columna se escriba de verdad para que su rama
  principal signifique algo, y comparte `progress/impl_246.md`.
- **T6 no toca ninguno de los archivos de T2, T4 ni T5** — es la tanda más aislada de la ficha, y por
  eso puede ir en **PR propio** una vez T3 esté en `dev`.
- **Backend antes que frontend**: T4 y T5.2-T5.3 leen contratos que T3 y T5.1 todavía están moviendo.

**Con otras fichas en vuelo**

| Ficha | Estado | ¿Choca? |
| --- | --- | --- |
| **237** — la gestión de la tienda cuenta como del mensajero | `pending`, spec escrito, **en vuelo** | **SÍ, en dos sitios.** (1) `MisAsignacionesService`: la 237 extrae la subida compensada de `gestionar`, la 246 toca `listarMisAsignaciones`. Métodos distintos, **mismo archivo**. (2) `db/migrations/`: la 237 añade un valor al enum `orden_historial_origen_tipo`; la 246 añade una columna. **Timestamps distintos, obligatorio** (T0.3). **No en paralelo sobre `MisAsignacionesService`.** ¿Y con T6? **No**: la 237 crea gestiones `reprogramada`/`rechazada`, y el numerador del ranking sólo cuenta `entregada`. |
| **240** — rechazo manual de la tienda | `pending`, sin spec | **La superficie del ranking NO choca**: la 240 vive en `/novedades`, `ACCIONES_POR_GRUPO` y la arista `devuelta → rechazada`, y no toca `RankingRepository`, `RankingService`, `RankingSnapshotService` ni `premio_ranking`. **Pero hay un choque nuevo, y no es de archivo sino de GUARDIA:** si la arista manual que la 240 abre **limpia la asignación** (`mensajero_asignado_id`/`asignado_at`), la guardia de T3.6 la pondrá **roja** por no limpiar también `fecha_reparto`. Eso es la guardia haciendo su trabajo, no un fallo de la 240 — pero **quien llegue segundo tiene que saberlo antes de abrir el PR**, o leerá un rojo ajeno como propio. |
| **241** — guardas de bloqueo | `in_progress` | **No en código**, pero **sí en sentido**: la regla firmada de la 241 (`vencido` bloquea gestionar) es la mitad de la justificación de ésta. Si la 241 cambiara esa regla, hay que releer `design.md` §5.3. `progress/investigacion_241.md` **no se toca**. |

**Archivos que esta ficha toca (para que otra sesión pueda comprobarlo de un vistazo)**

*Corte y asignación:* `db/schema.prisma` · `db/migrations/<ts>_orden_fecha_reparto/` ·
`lib/types/dia-reparto.ts` (NUEVO) · `lib/utils/dia-reparto.ts` (NUEVO) · `lib/types/orden-guia.ts` ·
`lib/types/recepcion-satelite.ts` · `lib/types/mis-asignaciones.ts` ·
`lib/services/CorteDiarioService.ts` · `lib/repositories/CorteDiarioRepository.ts` ·
`lib/repositories/CierreDiaRepository.ts` · `lib/repositories/OrdenRepository.ts` ·
`lib/repositories/CierresAdminRepository.ts` · `lib/repositories/DevolucionSlaRepository.ts` ·
`lib/repositories/LiberacionReprogramadaRepository.ts` · `lib/services/GuiaAsignacionService.ts` ·
`lib/services/AsignacionSateliteService.ts` · `lib/services/MisAsignacionesService.ts` ·
`components/shared/SelectorDiaReparto.tsx` (NUEVO) ·
`app/(app)/ordenes/_components/AsignarBodegaModal.tsx` ·
`app/(app)/recepcion-satelite/_components/AsignarSateliteModal.tsx` · la card de
`app/(app)/mis-asignaciones/_components/`.

*Ranking (entra por D7):* `lib/interfaces/repositories/IRankingRepository.ts` ·
`lib/repositories/RankingRepository.ts` · `lib/services/RankingService.ts` ·
`lib/services/RankingSnapshotService.ts` · `lib/repositories/TableroDiaRepository.ts` **(sólo si D10
se firma que sí)**. **NO se tocan** `lib/ranking/orden-ranking.ts`, `lib/ranking/snapshot-dia.ts`
(salvo su comentario), `premio_ranking` ni `ranking_snapshot_*`.

**Antes de registrar cualquier id o rama nuevos**, mirar `origin/dev`: ya hubo **dos** colisiones de
id entre sesiones.
