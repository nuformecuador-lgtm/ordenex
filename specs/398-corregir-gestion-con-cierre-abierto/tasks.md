# 398 — Tareas

> **LLEVA MIGRACIÓN (dos enums).** El gate rápido se negará solo: al cerrar la ficha corre
> `./init.sh` **completo**, no `--rapido`.
> Zona: `fullstack` → se secuencia **backend → frontend** (`backend_dev` primero, `frontend_dev`
> después). `[P]` = paralelizable con las tareas de su misma tanda.

---

## T0 — Bloqueantes de datos (antes de escribir código)

- [ ] **T0.1 — Medir el cierre atascado, en solo lectura.** Ejecutar las tres consultas de
      `design.md §8` contra producción vía el MCP de Supabase.
      **Hecho cuando:** están anotados en `progress/` el `cierre_id`, el `estado`, el
      `cierre_bodega_id`, el `gestion_id`, el `num_guia`, los seis totales y las filas de
      `gestion_orden_pago`. **Si el estado no es `solicitado`/`vencido` o ya está consolidado, la
      ficha PARA y se replantea el alcance.**
      *Bloquea:* T0.2 y la ejecución de la vía manual. No bloquea T1-T5.
- [ ] **T0.2 — Puerta H1: firma humana de la vía manual.** Con los números de T0.1 sobre la mesa,
      el humano autoriza (o no) la escritura manual de `design.md §8`.
      **Hecho cuando:** hay un «sí» o un «no» explícito registrado, y si es «sí», los seis totales
      **antes** y **después** están anotados. *Depende de:* T0.1.
- [ ] **T0.3 [P] — Puertas H2, H3, H4, H5.** Llevar las cuatro preguntas de `requirements.md` al
      humano. **Hecho cuando:** cada una tiene respuesta escrita. **H2 bloquea T2.2.**

---

## T1 — Migración y catálogos (backend)

- [ ] **T1.1 — Crear la migración con los dos `ADD VALUE`.**
      `pnpm run db:migrate:create` (solo crea, no aplica). Nombre:
      `<ts>_correccion_resultado_gestion`.
      **Hecho cuando:** `migration.sql` contiene exactamente los dos `ALTER TYPE … ADD VALUE` de
      `design.md §5`, sin `BEFORE`/`AFTER`.
- [ ] **T1.2 — Declarar los dos valores en `db/schema.prisma`.** En `OrdenHistorialOrigenTipo` y en
      `HistorialAccionTipo`, cada uno con el comentario de por qué (§4.1 y §4.2).
      **Hecho cuando:** `pnpm exec prisma format` pasa y el valor está al final de su enum, en el
      mismo orden que lo apende `ADD VALUE`. *Depende de:* T1.1.
- [ ] **T1.3 [P] — Catálogos en TypeScript.**
      · `lib/types/orden-historial.ts`: añadir `correccion_resultado_gestion` a la tupla de origen,
        **FUERA** de `ORIGEN_TIPOS_VISITA_REAL` y **FUERA** de `ORIGEN_TIPOS_CON_GESTION`, con el
        comentario de por qué queda fuera de las dos.
      · `lib/types/historial-accion.ts`: añadir `cierre_dia_gestion_corregida` a
        `HISTORIAL_ACCION_TIPOS` (bloque «mueve dinero»), su categoría `mueve_dinero` y su etiqueta
        («Corrigió el resultado de una gestión»), y actualizar el comentario del total (51 → 52).
      **Hecho cuando:** `pnpm typecheck` pasa (los `satisfies` de esos archivos rompen el build si
      el valor no existe en el enum de Prisma). *Depende de:* T1.2.
- [ ] **T1.4 — `down.sql`, con las listas MEDIDAS.**
      **Primero medir** con las dos consultas de `pg_enum` de `design.md §5` contra la base local
      ya migrada al estado **previo**; luego escribir el archivo copiando la forma de
      `db/migrations/20260908140100_wallet_tienda_check_cobro_manual/down.sql`, **incluido su
      bloque de aviso** y las dos precondiciones ruidosas.
      **Hecho cuando:** las dos listas del `down.sql` coinciden **valor a valor y en orden** con lo
      que devolvió `pg_enum`, y el archivo dice la fecha de la medición.
      ⚠️ **Ningún `down.sql` anterior se toca.** *Depende de:* T1.1.
- [ ] **T1.5 — Test de la migración contra Postgres.**
      `tests/integration/db/correccion-resultado-gestion-migration.test.ts`, con el patrón del test
      de la 381: reconstruye el estado previo **ejecutando las migraciones reales anteriores
      descubiertas leyendo `db/migrations`** (no una lista escrita a mano) y compara los dos
      catálogos valor a valor y en orden, antes y después.
      **Hecho cuando:** pasa, y **una mutación** que quite un valor de la lista del `down.sql` lo
      pone rojo. *Depende de:* T1.4.
- [ ] **T1.6 — Aplicar y regenerar.** `pnpm run db:migrate` + `prisma generate`.
      **Hecho cuando:** `prisma migrate status` dice «up to date» **y nombra el host esperado**;
      un cliente Prisma rancio da falsos negativos. *Depende de:* T1.2, T1.4.

---

## T2 — Repositorio: la única escritura (backend)

- [ ] **T2.1 — `corregirResultadoGestionEnCierre` en `CierresAdminRepository`, método NUEVO.**
      Los seis pasos de `design.md §2` en una `$transaction`, con las guardias en el `WHERE` tal
      como están tabuladas. Interfaz en `lib/interfaces/repositories/ICierresAdminRepository.ts`.
      **Hecho cuando:** `pnpm typecheck` pasa y el método **no** vive dentro de
      `actualizarPagosGestion`. *Depende de:* T1.6.
- [ ] **T2.2 — El recálculo de los seis totales.** Los cuatro del recaudo con `computeTotales`; los
      dos de pago/ingreso como **suma de las columnas congeladas** (§2.2), nunca con
      `derivarPagos`/`derivarIngresoBodega`. `Prisma.Decimal` y `toFixed(2)` en todo el camino.
      **Hecho cuando:** existe un test que **muere** si alguien sustituye la suma de snapshots por
      una re-derivación con la tarifa viva. *Depende de:* T2.1, **T0.3 (H2)**.
- [ ] **T2.3 — Integración contra Postgres real: las filas que se tocan y las que NO.**
      `tests/integration/db/correccion-resultado-gestion.int.test.ts`. Cubre R6, R7, R8, R9, R12,
      R13 y **mide el invariante «abierto ⇒ no consolidado»** con datos reales (no se razona: se
      inserta un cierre `aprobado` consolidado y se comprueba que la corrección lo rechaza).
      **Hecho cuando:** pasa, **no tiene ningún `if (…) return;` que salte el cuerpo**, y las
      mutaciones de T5.1 lo ponen rojo. *Depende de:* T2.2.
- [ ] **T2.4 [P] — Atomicidad (R11).** Forzar el fallo del paso 5 (snapshot) y comprobar que ni la
      gestión, ni sus líneas de pago, ni la orden, ni el historial quedaron tocados.
      **Hecho cuando:** el test pasa y su control positivo (quitar el `throw`) lo pone rojo.
      *Depende de:* T2.1.
- [ ] **T2.5 — Entrada nueva en el CENSO del historial.**
      En `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts`, entrada propia
      con `tipos: ["cierre_dia_gestion_corregida"]`, `metodo: "corregirResultadoGestionEnCierre"`,
      `forma: "abre_tx"`, `mutacion: /tx\.gestionOrden\.updateMany\(/`.
      **Hecho cuando:** la guardia pasa. ⚠️ **Y NO BASTA:** la cobertura real de R10 la da T2.3, que
      comprueba **la fila escrita** en Postgres. *Depende de:* T2.1, T1.3.

---

## T3 — Servicio y borde (backend)

- [ ] **T3.1 — `corregirResultadoGestionSchema` en `lib/types/cierres-admin.ts`.** `.strict()`,
      `gestionId` uuid y `motivo` con el **mismo** `motivoSchema` que usa una gestión rechazada
      real. Sin `nuevoResultado`.
      **Hecho cuando:** hay un test que rechaza una petición con `nuevoResultado` colado.
- [ ] **T3.2 — `CierresAdminService.corregirResultadoGestion`.** Las cinco guardias de R1-R5 en el
      orden del servicio hermano: rol → alcance → estado → resultado → motivo. Reusa
      `findGestionEditableEnCierre` para la lectura previa (ya devuelve `cierreEstado` y
      `resultado`).
      **Hecho cuando:** hay un test unitario por cada uno de R1-R5, y cada uno afirma **cero
      llamadas al repositorio**. *Depende de:* T2.1, T3.1.
- [ ] **T3.3 [P] — Server Action `corregirResultadoGestion` en `lib/actions/cierres-admin.ts`.**
      Parseo zod en el borde, actor de cookies, delega en el servicio.
      **Hecho cuando:** `pnpm typecheck` + `pnpm lint` pasan. *Depende de:* T3.2.

---

## T4 — Pantalla (frontend, arranca cuando T3 está en `dev`)

- [ ] **T4.1 — `CorregirResultadoDialog.tsx`.** Hermano de `CorregirPagosDialog.tsx`: mismo `Modal`,
      mismos desenlaces, campo de motivo obligatorio y el aviso de las tres consecuencias
      (`design.md §7`). Sin siglas ni jerga.
      **Hecho cuando:** hay un test de componente que afirma el texto del aviso y que el botón está
      deshabilitado sin motivo. *Depende de:* T3.3.
- [ ] **T4.2 — Montaje en `CierresAdminModule.tsx` (R16).** La acción aparece **solo** en filas
      `entregada` de un cierre `solicitado`/`vencido`.
      **Hecho cuando:** hay un test que comprueba que **no** aparece sobre una `rechazada` ni sobre
      un cierre `aprobado`. *Depende de:* T4.1.

---

## T5 — Verificación y cierre

- [ ] **T5.1 — Mutaciones sobre lo que decide el dinero.** Como mínimo, y cada una tiene que poner
      **algo ROJO** y se anota qué test murió:
      1. quitar `resultado: 'entregada'` del `WHERE` del paso 1;
      2. quitar `estado IN ('solicitado','vencido')` del `WHERE` del paso 5;
      3. no borrar las filas de `gestion_orden_pago`;
      4. dejar `pago_mensajero` como estaba en vez de `'0.00'`;
      5. sustituir la suma de snapshots por `derivarPagos` con la tarifa viva;
      6. borrar el `appendAccion` del método nuevo;
      7. meter `correccion_resultado_gestion` en `ORIGEN_TIPOS_VISITA_REAL`.
      **Hecho cuando:** las 7 están anotadas en `progress/impl_398.md` con el nombre del test que
      murió. Si alguna sigue verde, **es un agujero de cobertura, no una mutación mala**.
      ⚠️ El arnés de mutaciones de este repo ya reportó supervivientes sin ejecutar un solo test:
      pegar la salida real. *Depende de:* T2.3, T2.4, T2.5.
- [ ] **T5.2 — Mapa `R<n> → test` completo en `progress/impl_398.md`.** Los 16 requisitos.
      **Hecho cuando:** no queda ningún `R` sin un nombre de test concreto. El reviewer rechaza si
      falta uno.
- [ ] **T5.3 — Gate COMPLETO.** `./init.sh` (no `--rapido`: hay migración).
      **Hecho cuando:** `INIT_EXIT=0` escrito **dentro** del log, y los `skipped` revisados uno a
      uno: sin `.env`, los ~78 archivos de `tests/integration/db` se saltan y el gate dice «OK»
      igual. Un `skipped` en T1.5 o T2.3 **invalida esta tarea**. *Depende de:* todo lo anterior.
- [ ] **T5.4 — PR hacia `dev`.** Con el informe commiteado (`progress/impl_398.md`): un informe sin
      commitear describe el disco, no la rama.
      **Hecho cuando:** la URL del PR está reportada y el blob de `progress/impl_398.md` está
      verificado en la rama subida. *Depende de:* T5.3.

---

## Paralelismo y conflicto de archivos

`lib/repositories/CierresAdminRepository.ts` y `lib/services/CierresAdminService.ts` son archivos
grandes y muy disputados en este repo (el merge de la 238 ya chocó ahí con `actualizarPagosGestion`).
Antes de arrancar, el leader comprueba que ninguna feature `in_progress` de zona `backend` los esté
tocando; si alguna lo hace, **esta ficha se bloquea** hasta que pase a `done`.

`db/schema.prisma` y una migración nueva ponen rojo el gate de las demás features que compartan la
base local: si hay otro agente vivo, T1.6 se coordina con él.
