# Feature 253 — Tareas

> Leer antes: `requirements.md` (R1-R44, P1-P5) y `design.md` (D1-D10).
>
> **Gate:** `./init.sh --rapido` para cerrar cada tanda; **`./init.sh` completo antes del PR**.
> Ojo: este diff toca `db/migrations/**`, `db/schema.prisma` y `lib/types/**`, así que **`--rapido`
> se va a negar solo** y mandar al completo (`docs/verification.md`). No es un fallo: es la regla.
> **El gate no corre en paralelo con un subagente que muta el árbol** — leería el árbol mutado y su
> veredicto no valdría.
>
> **Punto de despliegue.** **T1 es inerte** (una tabla que nadie escribe todavía) y podría salir
> suelta. **T2-T8 van obligatoriamente en el mismo PR**: si la acción existe y el modal no la llama,
> la guardia de T8 se pone **roja a propósito**; si el modal la llama y no existe, no compila.
>
> **Zona `fullstack` ⇒ se secuencia backend → frontend.** T1-T5 con el subagente de **backend**,
> T6-T8 con el de **frontend**, nunca a la vez sobre los mismos archivos.
>
> ⚠️ **No se cita ni un test sin comprobar que existe.** Los marcados **(NUEVO)** son entregables de
> esta ficha; el resto se verificó en el árbol al escribir este spec.
>
> ⏱️ **Esta ficha corre prisa (F5).** Mientras no entre, cada persona que postule recibe un acuse
> falso. No se abre ningún frente que no esté en este documento.

---

## T0 — Puerta humana: medir y firmar *(sin código)*

- [ ] **T0.1 — Medir contra producción**, vía MCP de Supabase, **sólo lectura**, con las consultas de
      `design.md` §11: **M1** (postulaciones de mensajero por estado), **M2** (total de usuarios y
      última alta — la 252 midió 11 el 2026-08-20: **re-verificar, no citar**), **M3** (avisos
      `postulacion_mensajero_pendiente` emitidos y su ventana).
      **Hecho:** los tres números en `progress/impl_253.md` **con su fecha y su denominador** — un
      cero sin denominador no dice nada. **Bloquea T0.4.**
- [ ] **T0.2 — [P] Declarar M4 como NO MEDIBLE**, por escrito: no hay tabla, ni log, ni correo de
      las postulaciones perdidas. Lo único conocido son las dos del humano.
      **Hecho:** escrito en `progress/impl_253.md`, con el enlace a **P1**. **No bloquea nada.**
- [ ] **T0.3 — [P] Medir desde cuándo vive la maqueta:**
      `git log --follow --format='%ad %h %s' -- app/_landing/PostularRecursoModal.tsx`.
      **Hecho:** fecha del primer commit anotada; cierra **P4**.
- [ ] **T0.4 — Firmar las decisiones.** **D3** (tope del mensaje), **D5** (captcha), **D6** (aviso en
      la campana, **con M3 delante**), **D7** (extraer los detectores, que toca el archivo de la
      240), **D8** (adjuntos), **D9** (el texto del acuse) y **D10** (si la guardia cubre también
      `/postulacion`). D1, D2 y D4 las firma el leader con la recomendación del spec salvo objeción.
      **Hecho:** cada una respondida en `progress/impl_253.md`; si alguna se aparta de la
      recomendación, **el spec se corrige antes de escribir código**. **Bloquea T1.**
- [ ] **T0.5 — [P] Responder P1, P2, P3 y P5** (`requirements.md`). P1 y P2 no son técnicas y no
      bloquean el código; **P3 sí bloquea T5** (decide quién autoriza) y **P5 bloquea T2** (decide si
      `tipo` es dato de negocio).
      **Hecho:** las cuatro respondidas o explícitamente diferidas con su motivo.

---

## T1 — La tabla *(inerte: se puede desplegar suelta)* · **backend**

- [ ] **T1.1 — La migración.** `db/migrations/<ts>_postulacion_recurso/` con `<ts>` **posterior a
      `20260820190000`** y verificado contra `origin/dev` **en el momento de crearla** (`dev` se
      mueve). Contenido: `design.md` §2.1 — enum, tabla, FK RESTRICT, CHECK
      `postulacion_recurso_atendida_completa`, dos índices, `ENABLE ROW LEVEL SECURITY` **sin
      policies**. Cabecera con el porqué de cada decisión, al estilo de
      `20260815120000_orden_nota/migration.sql`.
      **Hecho:** `pnpm run db:migrate:create` genera, se edita a mano y **no se vuelve a tocar
      después de aplicarla** (una migración editada en sitio es drift). **Depende de:** T0.4.
- [ ] **T1.2 — El `down.sql`** (`design.md` §2.2): `DROP TABLE` y **después** `DROP TYPE` — este
      enum lo crea esta migración, al revés que el de `orden_nota`.
      **Hecho:** `pnpm run db:migrate` aplica y `pnpm run db:rollback` **revierte de verdad en
      local**, y el up se aplica **dos veces** para probar idempotencia. Salida pegada en
      `progress/impl_253.md`. Un `down.sql` que nadie ejecutó es papel. **Depende de:** T1.1.
- [ ] **T1.3 — `db/schema.prisma`**: enum `PostulacionRecursoTipo`, modelo `PostulacionRecurso` y la
      **relación inversa en `Usuario`** (`postulacionesRecursoAtendidas`), sin la cual Prisma no
      valida. Comentarios: por qué `atendida_at` y no un enum de estado, y que el `CHECK` vive sólo
      en la migración.
      **Hecho:** `pnpm exec prisma validate` limpio, cliente regenerado y **dev server reiniciado**
      (un cliente Prisma rancio produce 404 que parecen de ruta). **Depende de:** T1.1.
- [ ] **T1.4 — [P] Test de integración de la migración (NUEVO).**
      `tests/integration/db/postulacion-recurso-migration.test.ts`, molde literal de
      `tests/integration/db/postulacion-mensajero-migration.test.ts`: los dos valores del enum, las
      columnas con su nullabilidad, la FK RESTRICT, **el CHECK presente**, los dos índices,
      `ENABLE ROW LEVEL SECURITY` **y ningún `CREATE POLICY`** (R22), y que el `down.sql` suelta
      tabla **y** tipo (R23).
      **Hecho:** verde. **Depende de:** T1.2.

**R cubiertos por T1:** R21, R22, R23, R26 (la mitad de infraestructura).

---

## T2 — Tipos, schema zod y config *(mismo PR que T3-T8)* · **backend**

- [ ] **T2.1 — `lib/types/postulacion-recurso.ts` (NUEVO)**: `RECURSO_TIPOS`,
      `postulacionRecursoSchema`, `PostularRecursoResult`, `PostulacionRecursoDTO` y los resultados
      del admin (`design.md` §10). **Los mensajes de error se copian palabra por palabra** de
      `PostularRecursoModal.tsx:72-77`.
      **Hecho:** `tests/unit/types/postulacion-recurso-schema.test.ts` (NUEVO) verde: un caso por
      campo, uno por el tope de longitud, uno por `tipo` inválido y uno que afirma que el correo
      sale **recortado y en minúsculas**. **Depende de:** T0.4, T0.5 (P5).
- [ ] **T2.2 — [P] `lib/config/postulacion-recurso.ts` (NUEVO)**, patrón `lib/config/postulacion.ts`:
      topes de longitud, `RATE_MAX`, `RATE_WINDOW_MINUTES`, `PAGE_SIZE_DEFAULT`, `PAGE_SIZE_MAX`,
      todos sobreescribibles por entorno y **con el porqué del número escrito al lado**.
      **Hecho:** test de la config (default y override) verde. **Depende de:** T0.4 (D3, D4).

**R cubiertos por T2:** R8-R13, R15, R20 (la parte de schema).

---

## T3 — Repositorio y servicio *(mismo PR)* · **backend**

- [ ] **T3.1 — Interfaces** en `lib/interfaces/repositories/IPostulacionRecursoRepository.ts` y
      `lib/interfaces/services/IPostulacionRecursoService.ts` (un archivo por interfaz, como manda
      `docs/architecture.md`).
      **Hecho:** typecheck limpio. **Depende de:** T2.1.
- [ ] **T3.2 — `lib/repositories/PostulacionRecursoRepository.ts` (NUEVO)**: `crear`, `listar`,
      `marcarAtendida` (`updateMany` con `where: { id, atendidaAt: null }` → `count`) y `findById`.
      Sólo queries Prisma, cero lógica de negocio.
      **Hecho:** test unitario con doble de Prisma verde. **Depende de:** T3.1.
- [ ] **T3.3 — ⚠️ Test del repositorio CONTRA POSTGRES REAL (NUEVO)** — no es opcional y no lo
      sustituye T3.2: un doble **no ve el SQL**, y en este repo se midió cuatro veces que una
      mutación del `WHERE` pasa en verde contra dobles. Casos: dos filas con el **mismo correo**
      conviven (R25); `marcarAtendida` devuelve **1** la primera vez y **0** la segunda (R32);
      `listar` con filtro trae sólo pendientes, ordenadas por fecha descendente (R26).
      **Hecho:** verde contra Postgres, y **matado con una mutación del `WHERE`** antes de creerlo.
      **Depende de:** T3.2, T1.2.
- [ ] **T3.4 — `lib/services/PostulacionRecursoService.ts` (NUEVO)**: `registrar` (normaliza y
      delega), `listar` y `atender` con **guard de rol antes de tocar datos** y la distinción
      `not_found` / `conflict` cuando `count === 0`. Molde: `AprobacionPostulacionService:40,68-85`.
      **Hecho:** test unitario verde con **un caso por rol** del enum `RolValue` (R27/R28), el caso
      de doble atención (R32) y el caso de que no se toca ningún repositorio de usuarios (R24).
      **Depende de:** T3.1.

**R cubiertos por T3:** R24, R25, R26, R27, R28, R31, R32, R33 (servidor).

---

## T4 — La acción pública *(mismo PR)* · **backend**

- [ ] **T4.1 — `lib/actions/postulacion-recurso.ts` (NUEVO)**, con el orden de operaciones de
      `design.md` §4 y el limitador a nivel de **módulo**. Cabecera que declare **por escrito** que
      no resuelve actor **a propósito**, con la cita a `rastreo-publico.ts:18-22` — para que nadie lo
      lea como olvido y lo «arregle».
      **Hecho:** `tests/unit/actions/postulacion-recurso-action.test.ts` (NUEVO) verde con: orden
      zod → IP → límite → registrar → servicio (R18); `rate_limited` **sin llamar al repositorio**
      (R16); entrada inválida **sin pasar por el formulario** → `validation_error` y cero escrituras
      (R14); **no lee ni escribe cookies** (R4); **nunca lanza** (todo desenlace es un resultado).
      **Depende de:** T3.4, T2.2.
- [ ] **T4.2 — [P] El caso de los logs (R19)**: test que captura el logger y afirma que **ningún**
      argumento contiene el mensaje, el correo ni el teléfono, ni en el camino feliz ni cuando el
      repositorio lanza.
      **Hecho:** verde, y **se comprueba que falla** si se añade a propósito un `console.info` con el
      correo (si no, no está midiendo nada). **Depende de:** T4.1.

**R cubiertos por T4:** R4, R14, R16, R18, R19, R20.

---

## T5 — El borde del admin *(mismo PR)* · **backend**

- [ ] **T5.1 — `lib/actions/atencion-postulaciones-recurso.ts` (NUEVO)**:
      `listarPostulacionesRecurso` y `marcarPostulacionRecursoAtendida`, molde literal de
      `lib/actions/aprobacion-postulaciones.ts` (`withErrorHandler` → actor → zod → servicio →
      `toActionError`).
      **Hecho:** test de integración de las acciones (NUEVO), molde de
      `tests/integration/actions/aprobacion-postulaciones-action.test.ts`: sin sesión →
      `unauthenticated`; rol no autorizado → `forbidden` **sin tocar la base**; id inválido →
      `validation_error`. **Depende de:** T3.4, T0.5 (P3).

**R cubiertos por T5:** R27, R28, R30, R33 (borde).

---

## T6 — El modal deja de mentir *(mismo PR; **frontend**, después de T4)*

- [ ] **T6.1 — `PostularRecursoModal.tsx`**: `useTransition` + `await postularRecurso(...)` dentro de
      **`try/catch`**, `switch` exhaustivo sobre el resultado, `TEXTO_POR_FALLO` tipado como
      `Record<Exclude<PostularRecursoResult["status"], "ok">, string>` (R5), botón deshabilitado
      mientras envía (R3), y **el acuse sólo tras `ok`** (R1/R2). Los valores **no se limpian** en
      ningún camino de error.
      ⚠️ **La cabecera del archivo deja de declararse maqueta**: si se queda, pasa a ser falsa.
      **Hecho:** `tests/components/PostularRecursoModal.test.tsx` (NUEVO) verde con **un caso por
      desenlace** —`ok`, `validation_error`, `rate_limited`, `error` y **promesa rechazada**—, más el
      caso de doble click (R3) y el de que los valores sobreviven al error (R2).
      **Depende de:** T4.1.
- [ ] **T6.2 — [P] El texto del acuse (D9)** y el del límite de tasa (R17), cada uno en su
      constante con nombre, no incrustado en el JSX.
      **Hecho:** los textos afirmados en el test de T6.1 **como literales**, no derivados de la misma
      constante que los produce — una aserción contra su propia fuente siempre está verde.
      **Depende de:** T6.1.

**R cubiertos por T6:** R1, R2, R3, R5, R6, R7, R17.

---

## T7 — El panel del admin *(mismo PR; **frontend**)*

- [ ] **T7.1 — `app/(app)/_components/PostulacionRecursoCard.tsx` (NUEVO)**: tarjeta con tipo,
      nombre, teléfono, correo, **mensaje completo** y fecha (R29). Molde visual: `PostulacionCard`.
      **Hecho:** test de componente verde. **Depende de:** T5.1.
- [ ] **T7.2 — `app/(app)/_components/PostulacionRecursoPanel.tsx` (NUEVO)**: SWR con fetcher que
      **lanza** si el status no es `ok`, `Pagination`, `EmptyState`, `Modal` de confirmación para
      atender, y las **dos pestañas** pendientes / atendidas (R33).
      **Hecho:** test de componente (NUEVO) verde con: lista, vacío (R35), error de carga, atender →
      la fila desaparece (R31), **atender que falla → mensaje visible y la fila permanece (R34)** y
      cambio de pestaña. **Depende de:** T7.1.
- [ ] **T7.3 — Montarlo en `AdminMaestroDashboard.tsx`**, debajo del panel de mensajeros, cada uno en
      su `ContenedorSeccion` con título, **y corregir la descripción de la página** que hoy dice
      «Postulaciones de mensajeros pendientes» (R36).
      **Hecho:** `tests/components/PostulacionesPendientesPanel.test.tsx` sigue verde **sin tocarse**
      (R43) y el test del dashboard afirma la descripción nueva. **Depende de:** T7.2.

**R cubiertos por T7:** R29, R30, R31, R33, R34, R35, R36.

---

## T8 — La guardia de la landing *(mismo PR; **frontend**)*

- [ ] **T8.1 — `tests/fixtures/deteccion-maqueta.ts` (NUEVO, si D7 = extraer)**: mover
      `aristasDeImport`, `importaElSimbolo`, `invocaElSimbolo`, `fuenteDelModulo`, `exportaLaAccion`,
      `esModuloDeServidor` y `faltaDelMotivo` desde
      `tests/unit/guards/novedad-acciones-sin-maqueta.guardia.test.ts`, **sin cambiar una línea de su
      cuerpo** ni de sus comentarios (esa prosa documenta agujeros medidos).
      **Hecho:** la guardia de la 240 verde **sin modificar ninguno de sus casos**, sólo sus imports.
      **Depende de:** T0.4 (D7).
- [ ] **T8.2 — `tests/fixtures/superficies-publicas.ts` (NUEVO)**: el censo de `design.md` §9.1.
      ⚠️ **Se escribe en un archivo, nunca por `node -e`**: ahí `\b` llega como backspace y el censo
      miente en verde.
      **Hecho:** el archivo existe y el `satisfies` compila. **Depende de:** T4.1.
- [ ] **T8.3 — `tests/unit/guards/landing-sin-maqueta.guardia.test.ts` (NUEVO)**: los cinco frentes
      de `design.md` §9.2 más el bloque 0.
      **Hecho:** verde **con el modal ya cableado**, y `pnpm run test:guardias` la selecciona sola
      (R42). **Depende de:** T8.2, T6.1.
- [ ] **T8.4 — La autocomprobación (R41)**, con los seis fuentes sintéticos de `design.md` §9.2,
      incluido **`LA_MAQUETA_253`** (el `handleSubmit` que valida y sólo hace `setEnviado(true)`) y
      **`FORM_SIN_CENSO`**. Más los controles de anti-vacuidad.
      **Hecho:** cada detector probado en **las dos direcciones**. Una guardia estática rota no
      falla: **calla**. **Depende de:** T8.3.
- [ ] **T8.5 — ⚠️ La prueba de que la guardia SIRVE, y sin ella T8 no está hecha.** Revertir
      `handleSubmit` a la maqueta (`setEnviado(true)`, sin la llamada) **en el árbol**, correr la
      guardia, **ver el rojo con su mensaje**, y restaurar. Repetirlo con la variante sutil: **dejar
      el `import` y borrar la invocación**.
      **Hecho:** las dos salidas rojas pegadas en `progress/impl_253.md`, con el SHA antes / mutado /
      después del archivo — el arnés de mutaciones de este repo ya reportó supervivientes **sin haber
      ejecutado un test**. **Depende de:** T8.4.

**R cubiertos por T8:** R37, R38, R39, R40, R41, R42, R44.

---

## T9 — Mutaciones, guardias y gate completo

- [ ] **T9.1 — Matar los tests con mutaciones**, mínimo estas cuatro, cada una con sus SHA antes /
      mutado / después: (a) quitar el `WHERE atendida_at IS NULL` de `marcarAtendida` → debe caer
      T3.3; (b) devolver `ok` sin llamar al repositorio en `registrar` → debe caer T4.1; (c) quitar
      el guard de rol del servicio → debe caer T3.4; (d) borrar una entrada del censo de T8.2 → debe
      caer el frente 5.
      **Hecho:** las cuatro caen y se restauran; salidas pegadas. **Depende de:** T3-T8.
- [ ] **T9.2 — `./init.sh` completo, verde**, y **medido contra `origin/dev` en ese momento** (el
      pre-vuelo caduca: otra sesión empuja en paralelo).
      **Hecho:** salida pegada con el SHA de `origin/dev` con el que se midió. **Depende de:** T9.1.

---

## T10 — Ver la app *(no es opcional: aquí mirar la pantalla ha encontrado lo que la suite no)*

- [ ] **T10.1 — Levantar la app** (`pnpm dev > dev.log 2>&1`) y conducirla con `@playwright/test`,
      receta ya probada en este repo.
      ⚠️ **Dos contextos de navegador, y esto no es un detalle:** con cookie de sesión, `middleware.ts:56-58`
      **redirige `/` a `/dashboard`**, así que **la landing no se puede ver estando logueado**. Uno
      limpio para la landing, otro para el admin.
      **Hecho:** las dos pantallas alcanzadas.
- [ ] **T10.2 — El camino completo, de verdad:** en el contexto limpio, postular **un vehículo**;
      leer el acuse; entrar como `admin` (email + contraseña, **sin OTP** para ese rol) a
      `/dashboard`; **ver la fila** con los datos que se escribieron; marcarla atendida; ver que
      desaparece de pendientes y **aparece en atendidas**.
      **Hecho:** el `innerText` de cada panel pegado en `progress/impl_253.md` — el texto es la
      evidencia citable, la captura sólo la confirma. **Depende de:** T10.1.
- [ ] **T10.3 — [P] Los caminos feos:** enviar con campos vacíos (los errores salen por campo y el
      acuse **no** aparece); enviar **cuatro veces** seguidas para ver el texto del límite de tasa
      (R17); y postular **una bodega** para comprobar que el `tipo` llega correcto.
      **Hecho:** los tres textos leídos y pegados. **Depende de:** T10.1.
- [ ] **T10.4 — [P] Leer los textos como los lee una persona**: tildes, «Postulación», nombres de la
      marca. En este repo, mirar la pantalla encontró **7 etiquetas mal escritas** que 12.000 tests
      daban por buenas.
      **Hecho:** revisado, o defectos anotados. **Depende de:** T10.2.

---

## T11 — Cierre documental

- [ ] **T11.1 — `progress/impl_253.md`** con: el mapa **`R<n> → test`** (nombre de caso, no de
      archivo), las mediciones de T0, las salidas de las mutaciones y del gate, y el `innerText` de
      T10. **Un requisito sin test es un fallo de la feature.**
      **Depende de:** T9.2, T10.
- [ ] **T11.2 — Actualizar `feature_list.json`** (`status`, `spec_path`, `branch`, `status_note` de
      3-6 líneas técnicas; el detalle vive en `progress/`). **Lo estampa el leader**, mirando antes
      `origin/dev` — ya hubo dos colisiones de id entre sesiones. **Depende de:** T11.1.
- [ ] **T11.3 — [P] Dejar escrito lo que NO entró**: D5 (captcha), D6 (aviso en la campana), D8
      (adjuntos) y P2 (retención). Si alguna se convierte en ficha, se registra con su motivo.
      **Depende de:** T0.4.

---

## Mapa `R<n> → tanda`

| Tanda | R cubiertos |
| --- | --- |
| T1 | R21, R22, R23, R26 (infra) |
| T2 | R8, R9, R10, R11, R12, R13, R15, R20 |
| T3 | R24, R25, R26, R27, R28, R31, R32, R33 |
| T4 | R4, R14, R16, R18, R19, R20 |
| T5 | R27, R28, R30, R33 |
| T6 | R1, R2, R3, R5, R6, R7, R17 |
| T7 | R29, R30, R31, R33, R34, R35, R36 |
| T8 | R37, R38, R39, R40, R41, R42, R44 |
| T9 | R43 (las suites ajenas verdes sin tocarse) |

**Ningún R se queda sin tanda.** Si al implementar aparece uno que no encaja, es señal de que el
spec está mal y se corrige **antes** de escribir el código.

---

## Paralelismo y conflictos de archivo

- **`[P]` marcado arriba** = se puede hacer a la vez que su hermana de la misma tanda.
- **T1 no se paraleliza con nada** que toque `db/schema.prisma`: dos migraciones nacidas a la vez con
  el mismo timestamp son un choque garantizado. **Comprobar `origin/dev` antes de fijar `<ts>`.**
- **T6-T8 (frontend) no arrancan hasta que T4-T5 estén dentro**: el modal no puede invocar una acción
  que no existe, y la guardia mediría el árbol a medias.
- **Archivos que esta ficha toca y que otra ficha podría estar tocando:**
  `db/schema.prisma` · `app/(app)/_components/AdminMaestroDashboard.tsx` ·
  `tests/unit/guards/novedad-acciones-sin-maqueta.guardia.test.ts` (sólo sus imports, T8.1, y **sólo
  si D7 se firma**).
- **`app/_landing/LandingPostular.tsx` NO se toca** (R7). Si el diff lo incluye, algo se salió del
  alcance.
