# 412 — Desglose

> Requisitos en `requirements.md` (**26**, R1–R26, **sin preguntas abiertas**), diseño en
> `design.md`.
> **Ficha PREVENTIVA:** producción tiene **0 cierres rechazados** (T0.1). **Nadie verá un cambio al
> desplegar** — la verificación observable es local (T7.4), no productiva.
> `[P]` = puede ir en paralelo con las tareas marcadas igual **dentro de su bloque**.
> **Criterio de «hecho» en toda la ficha:** un **aserto que se pone ROJO si el código está mal**.
> Un `grep` sobre un comentario no cierra ninguna tarea.
> **El gate de esta ficha es `./init.sh` COMPLETO** (`design.md §11`). No hay modo rápido posible.

---

## Bloque 0 — Pre-vuelo (antes de tocar una línea)

- [x] **T0.1 — YA MEDIDO por el humano el 2026-09-11: CERO cierres rechazados en producción.**
      En toda la historia, desde el arranque comercial del 2026-08-27: **78 `aprobado`,
      5 `solicitado`, 0 `rechazado`** — luego tampoco ha habido ningún segundo rechazo.
      **Queda por hacer:** copiar ese número **con su fecha** a `progress/impl_412.md` al abrir la
      bitácora, y con las dos lecturas que tira en direcciones opuestas: **(a)** la ficha es
      **preventiva** —como la 417 y la 418— y nadie verá un cambio al desplegar; **(b)** el agujero 2
      de `requirements.md §0` **sigue siendo un fallo real del código**, esperando al primer caso.
      ⚠️ **No se vuelve a medir para «confirmar»**: un cero aquí significa «aún no ha pasado», no
      «no puede pasar», y producción se vació el 2026-08-25.
- [x] **T0.2 — Confirmar el orden con la 410.** `git log origin/dev` para ver si
      `lib/notificaciones/push-elegibles.ts` y `push_envio_dia` ya están en `dev`. La 410 estaba
      **en revisión** el 2026-09-11, así que **la rama A de T6.1 es la probable** — pero se comprueba,
      no se supone.
      **Hecho:** anotada la rama de T6.1 que aplica y el SHA de `origin/dev` medido. ⚠️ El pre-vuelo
      caduca (`dev` se mueve): se vuelve a comparar antes del PR, en T2.4.
- [x] **T0.3 — Reconfirmar en el ARCHIVO REAL los cinco hechos de `design.md §1`** (el grafo del MCP
      devuelve de más): el `if (!bloqueo.bloqueado) return;` de `CierresAdminService`, el
      `entidadId: cierreId` del aviso de bloqueo, el `P2002 → false` de `crear`, la reutilización de
      la fila en `transicionarASolicitado`, y que `resolverCierre` escribe `resueltoAt: new Date()`.
      **Hecho:** cinco líneas con archivo:línea en `progress/impl_412.md`. Si alguna cambió, **se
      para y se revisa el spec** antes de seguir.

## Bloque 1 — El enum y los tipos espejo *(depende de T0)*

- [x] **T1.1 — `db/schema.prisma`:** +`cierre_dia_rechazado` en `NotificacionEvento` y
      +`cierre_dia_rechazo` en `NotificacionEntidadTipo`, cada uno con el comentario de **por qué la
      entidad lleva el instante** (el patrón de los cinco que ya lo explican).
      **Hecho:** `pnpm run typecheck` rojo en el catálogo y en el tipo espejo — es la señal correcta:
      el `Record` no compila sin decidir.
- [x] **T1.2 — `lib/types/notificacion.ts`:** +1 valor en cada tipo espejo, con su comentario.
      **Hecho:** typecheck verde salvo por el catálogo (T3). ⚠️ Tocar `lib/types/**` **obliga al gate
      completo**: está contado.
- [x] **T1.3 — `prisma generate`.** **Hecho:** el enum del cliente trae 14 valores; si el servidor de
      desarrollo estaba levantado, se reinicia (un cliente Prisma rancio da 404 con el armazón
      pintado).

## Bloque 2 — La migración *(depende de T1.1)*

- [x] **T2.1 — Crear `db/migrations/<ts>_notificacion_evento_cierre_rechazado/migration.sql`** con
      los dos `ALTER TYPE … ADD VALUE IF NOT EXISTS`, sola y con timestamp propio (`55P04`).
      **Hecho:** el archivo existe y **no contiene ningún uso** de los valores nuevos.
- [x] **T2.2 — Enumerar las columnas que usan los dos tipos** con la consulta de `design.md §10.2`
      (o, si no hay base, leyendo `db/schema.prisma` entero).
      **Hecho:** la lista escrita en el encabezado del `down.sql`. ⚠️ Si la 410 ya entró, **son dos
      columnas**: `notificacion.evento` y `push_envio_dia.evento`. *Depende de T2.1.*
- [x] **T2.3 — Escribir `down.sql`**: recrea los dos tipos con la lista previa, un `ALTER COLUMN` por
      **cada** columna de T2.2, y el `DROP TYPE … _old` al final. Sin un solo `DELETE`.
      **Hecho:** T2.5 lo revierte contra Postgres y el `DROP TYPE` no falla. *Depende de T2.2.*
- [x] **T2.4 — Releer las listas contra `db/schema.prisma` de `origin/dev` JUSTO ANTES DE ABRIR EL
      PR**, no antes. Si otra ficha añadió un valor a estos enums y entró primero, **se reescriben**.
      **Hecho:** el SHA de `origin/dev` leído, escrito en el propio `down.sql`, y comparado con el de
      T0.2. ⚠️ **No se toca ningún `down.sql` anterior**: son fotos históricas.
- [x] **T2.5 — Aplicar y revertir en local** (`pnpm run db:migrate`, `pnpm run db:rollback`, volver a
      aplicar). **Hecho:** `prisma migrate status` limpio y el host confirmado **antes** de migrar
      (nunca contra una base que no sea la local). *Depende de T2.3.*

## Bloque 3 — El catálogo *(depende de T1.2)*

- [x] **T3.1 [P] — Entrada 14 en `lib/notificaciones/catalogo-avisos.ts`**: accionable, atajo
      `{ href: "/cierre-dia", etiqueta: "Ver mi cierre" }`, `destinatarios: ["mensajero"]`, con el
      comentario de por qué **no** lleva `porRol`.
      **Hecho:** typecheck verde y la guardia vigente `atajo-aviso-ruta-visible.guardia.test.ts`
      pasa **sin editarla** (R21). Mutación comprobada a mano: poner `/cierres-admin` ⇒ guardia roja.

## Bloque 4 — El texto y el emisor *(depende de T1.2; [P] con el bloque 3)*

- [x] **T4.1 [P] — Exportar `NO_PUEDES`** en `lib/constants/bloqueo-mensajero.ts` **sin cambiar su
      valor**. **Hecho:** las suites de `bloqueo-textos` siguen verdes sin tocarlas.
- [x] **T4.2 — `textoCierreRechazadoMensajero(jornadaCR, quedaBloqueado)`** en
      `lib/notificaciones/emitir.ts`, con las tres salidas literales de `design.md §4`.
      **Hecho:** tests unitarios con los **literales escritos a mano** (nunca contra la función).
      *Depende de T4.1.*
- [x] **T4.3 — `CierreRechazadoContexto` + `emitirCierreDiaRechazado`**: una sola fila, `tipo:
      "alert"`, destinatario `{tipo:"usuario"}`, `anexo: null`, `entidadTipo: "cierre_dia_rechazo"`,
      `entidadId: \`${cierreId}:${resueltoAtISO}\``.
      **Hecho:** test que afirma la fila completa, incluida **la forma exacta del `entidadId`**, y
      que el contexto **no tiene campo de motivo** (R16 por construcción). *Depende de T4.2.*
- [x] **T4.4 — `emitirMensajeroBloqueado` respeta `destinatarios`** (`"mensajero_y_bodega"` |
      `"solo_bodega"`), campo **obligatorio** del contexto.
      **Hecho:** typecheck rojo en los dos llamadores hasta que cada uno decide; y test de que con
      `solo_bodega` salen las tres filas de administración con **el texto y la entidad de hoy**, y
      **ninguna** de usuario (R18).

## Bloque 5 — El servicio y el cableado *(depende de 3 y 4)*

- [x] **T5.1 — `findJornadaDeCierre(cierreId)`** en `IOrdenRepository` + `OrdenRepository`, con
      **una** consulta y pasando por `derivarJornada` (el único derivador).
      **Hecho:** test contra Postgres real: cierre creado el día D con gestiones del D−1 ⇒ devuelve
      D−1; gestiones en dos días ⇒ `null`; sin gestiones ⇒ D−1 por la rama B (R11).
- [x] **T5.2 — `avisarBloqueoPorRechazo` → `avisarDelRechazo`** en `CierresAdminService`, con las
      tres unidades best-effort independientes de `design.md §5` y el **fallo cerrado** si
      `resueltoAt` es `null`.
      **Hecho:** los tests de R1, R3, R4, R5 y R17 en verde, incluida la mutación «mover la emisión
      dentro del `if (bloqueo.bloqueado)`» ⇒ rojo. *Depende de T5.1, T4.3, T4.4.*
- [x] **T5.3 — Notificador**: `CierreRechazadoNotificador`, `notificarCierreDiaRechazadoCon(repo)`,
      `notificarCierreDiaRechazadoReal` y ampliar `notificadorNoOp`.
      **Hecho:** el `Real` resuelve su repositorio por **`repoReal()`** (no `new
      NotificacionRepository(...)`), para no poner roja la guardia del punto único de push (410/R51).
- [x] **T5.4 — COMPOSITION ROOT**: `lib/actions/cierres-admin.ts` **pasa**
      `notificarCierreDiaRechazadoReal` a `new CierresAdminService(...)`; el default del servicio
      sigue siendo el no-op.
      **Hecho:** `notificacion-notificadores-reales.test.ts` ampliado afirma el **uso efectivo** sobre
      el fuente sin imports ni comentarios. **Mutación obligatoria:** borrar el argumento dejando el
      import ⇒ rojo. *Depende de T5.3.*

## Bloque 6 — Push *(depende de T1.1)*

- [x] **T6.1 — Escribir la decisión de elegibilidad donde toque.**
      **Rama A (la 410 ya está en `dev`):** añadir la línea a `lib/notificaciones/push-elegibles.ts`
      con el perfil **usuario**, y su test (elegible para el mensajero, no elegible para ningún rol).
      **Rama B (la 410 sigue fuera):** el archivo no existe; se deja **anotado en
      `progress/impl_412.md`** que R23 lo cierra la 410 y que su `Record` **no compilará** sin
      decidirlo. **Hecho:** en A, typecheck + test verdes; en B, la nota escrita **y** el motivo.
- [x] **T6.2 — Avisar a la 410 del valor nuevo del enum** (un renglón en su ficha o en el PR):
      **Hecho:** dicho por escrito, para que no se descubra al mergear.

## Bloque 7 — Verificación *(depende de todo lo anterior)*

- [x] **T7.1 — Los tests del mapa `R<n> → test`**, uno por requisito, con las **diez mutaciones
      obligatorias** de `design.md §12` aplicadas y revertidas.
      **Hecho:** por cada mutación, la salida del test **rojo** pegada en `progress/impl_412.md`. Un
      arnés de mutaciones que reporta supervivientes **sin haber ejecutado un test** ya mintió dos
      veces en este repo: se exige la salida real.
- [x] **T7.2 — Autocomprobación de los tests de integración:** sembrar **cero** filas y comprobar que
      **fallan** en vez de pasar por vacío (`if (!fks) return;` es un verde que no prueba nada).
      **Hecho:** la evidencia de los dos estados (con datos → verde, sin datos → rojo).
- [x] **T7.3 — `./init.sh` COMPLETO, con `DATABASE_URL` resoluble.**
      **Hecho:** `INIT_EXIT=0` **escrito dentro del log** (un `echo` posterior tapa el exit code) y
      la cifra de `skipped` revisada: si los archivos de `tests/integration/db/**` de esta ficha
      salen **saltados**, la ficha **NO está verificada**. En un worktree no hay `.env`: se exporta
      `DATABASE_URL` en la sesión.
- [x] **T7.4 — Ver el aviso en la app, EN LOCAL, con un rechazo provocado.** Es la **única**
      observación posible de esta ficha: en producción hay **0 rechazos** (T0.1), así que mirar allí
      devolverá cero avisos nuevos y eso será lo correcto, no un síntoma — quien busque la
      confirmación en producción concluirá mal.
      Las cuatro observaciones: el mensajero abre la campana y lee **un solo** aviso, en «Requieren
      tu acción», con su botón; el botón lo deja en `/cierre-dia`; el **segundo** rechazo del mismo
      cierre produce **un segundo aviso**; y el distintivo cuenta **uno**, no dos.
      **Hecho:** las cuatro escritas. Mirar la app encuentra lo que la suite no.
- [x] **T7.5 — Bitácora `progress/impl_412.md`**: el mapa `R<n> → test` confirmado, la salida real
      del gate, las mutaciones y lo que quedó fuera. **Hecho: COMMITEADO** — el informe que no se
      commitea se lo lleva el primer `git checkout` (ya pasó tres veces en un día).

---

## Orden y paralelismo, de un vistazo

```
T0 ──► T1 ──┬──► T2 (migración)          ──┐
            ├──► T3 [P] (catálogo)         ├──► T5 ──► T7
            ├──► T4 [P] (texto y emisor) ──┘
            └──► T6 [P] (push)
```

- **T2, T3, T4 y T6 son paralelizables entre sí** una vez cerrado T1: tocan archivos distintos.
- **T5 los necesita a todos** y no empieza antes.
- **T7 va SIEMPRE al final y en secuencia**: el gate lee el árbol, así que no puede correr mientras
  otra tanda lo muta — su veredicto no valdría.

## Lo que NO se hace en esta ficha

- No se toca `estaBloqueadoPorCierres` ni la salida de `avisoBloqueo`.
- No se toca el predicado de visibilidad, ni la autorización del rechazo, ni `NotificacionRepository`.
- No se toca ningún `down.sql` anterior.
- No se añade el aviso al rechazo de cierres de **bodega**: queda como **ficha posible**, no como
  deuda de ésta (D2 de `requirements.md §10`).
- No se escribe en `feature_list.json` mientras haya agentes trabajando dentro.
