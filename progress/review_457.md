# Revisión 457 — «Una tienda le paga a Ordenex» (reviewer, adversarial)

- **Revisado:** `origin/feature/457-backend` @ `0ab05a1d` (HEAD desacoplado), contra `origin/dev`
  (diff de tres puntos: 103 archivos, backend + frontend + ayuda + tests).
- **Contra:** `specs/457-la-tienda-paga-a-ordenex/{requirements,design,tasks}.md` (79 R),
  `progress/impl_457.md`, `progress/fase0_457.md`, `progress/contraste_457.md`, `CHECKPOINTS.md`, `docs/`.
- **Búsqueda:** el MCP `codebase-memory` no estaba en el conjunto de herramientas de esta sesión; todo se
  leyó con `grep` y lectura directa de los archivos reales.
- **Base propia:** `ordenex_457r` (`CREATE DATABASE … TEMPLATE ordenex`, 0 conexiones a la plantilla) +
  `prisma migrate deploy` (aplicó las dos de la 457) + `pnpm install --frozen-lockfile` propio. `.env`
  del worktree copiado del principal con la base cambiada y SIN `DATABASE_URL_PREVIEW`, sin imprimirlo.
  Al terminar: `DROP DATABASE ordenex_457r` (verificado: ya no está en `pg_database`) y `.env` borrado.

## Veredicto: **RECHAZADA** (como «hecha»; el código del dinero no tiene bloqueantes)

Ningún hallazgo del dinero, de las migraciones, de los permisos ni de los nombres bloquea. Lo que
bloquea es el CIERRE de la ficha: `tasks.md` sin ni una tarea marcada, R79 sin su evidencia y el anexo
T9.1 vacío. Son tres cosas de proceso, sin tocar código de producción. En cuanto estén, la ficha
pasa. Detalle en «Bloqueantes».

## Verificación ejecutable (la corrí yo)

`./init.sh` COMPLETO sobre `0ab05a1d` contra `ordenex_457r`, con `INIT_EXIT=$?` escrito dentro del log
(scratchpad de la sesión, `gate_review_457.log`, sin `tail`):

```
✓ typecheck paso
✓ lint paso                (0 errors, 218 warnings)
 Test Files  1 failed | 2256 passed (2257)
      Tests  1 failed | 31781 passed | 26 skipped (31808)
ROJOS NUEVOS: tests/integration/db/seed-zonas-cruza-por-codigo.test.ts
INIT_EXIT=1
```

- **El único rojo es AJENO y es un flake:** `seed-zonas-cruza-por-codigo.test.ts` («un distrito ausente
  se crea…», `expected +0 to be 1`, ficha 375; la 457 no toca zonas). **Aislado, 3 de 3 verdes**
  (8/8 tests cada vez). Familia «carrera bajo carga» de la memoria del repo.
- `tests/integration/db`: **382 archivos ✓ + 1 ✗ (el flake) = 383, 0 saltados (`↓` = 0)**. Los 26
  `skipped` son los de `AnaliticaPage`/`AnaliticaShell`, como en los gates del implementer.
- Los gates del implementer (`progress/gate_457_backend.log`, `gate_457_frontend.log`) dicen
  `INIT_EXIT=0`; el mío coincide salvo el flake ajeno.

### Mutaciones propias (autocomprobación: numstat `1 1` o `0 2`, solo los tests nombrados, archivo restaurado, árbol limpio)

| # | Mutación | Resultado |
| --- | --- | --- |
| A | `AbonoTiendaService.ts:295` — quitar el candado de `anular` | **roja solo por el unitario** (orden de llamadas); integración y concurrencia siguen verdes → menor m2 |
| B | `:161` — quitar la lectura de la clave ANTES de la regla (deshacer la desviación de §5.1) | **roja**: integración «R25» y unitario «R25 (reenvío…)» |
| C | `:203` — decidir con el saldo del pre-chequeo (`const saldo = previo`) | **roja**: 7 tests, incluida la concurrencia «R16 (mutación 5)» |
| D | `:189` — asientos a 00:00Z (`medianocheUtcDelDia`) | **roja**: integración R20 y unitario R20 |
| E | `:379` — `gte(0)` → `gt(0)` (saldo cero «debe») | **roja**: 4 tests (R14, R15/R66, R29) |
| F | `:344` — quitar la comprobación de tienda dueña del comprobante | **roja**: unitario R43 e integración R42–R44 |
| G | `:286` — instante de la anulación por día UTC en vez de CR | **roja**: R32 (caso de las 22:00 CR) |
| H | `lib/analytics/metrics.ts:794-795` — quitar `abono_tienda`/`abono_tienda_anulado` de `cuenta_por_pagar_tienda` | **SUPERVIVIENTE**: `tests/unit/analytics` 176/176 verdes → menor m1 |

## Checklist (`CHECKPOINTS.md`)

### Especificación
- [x] `requirements.md` con R1–R79 EARS.
- [x] `design.md` con alternativas descartadas (§16, A1–A12).
- [ ] **`tasks.md` con todas las tareas `[x]` — FALLA: las 43 están en `[ ]`** (incluidas las que la
  bitácora da por hechas con su «*Hecho:*»). → B1.

### Trazabilidad
- [x] R1–R77 mapeados a tests concretos en `progress/impl_457.md` §6/§11 (revisados; ver m1 y m2).
- [ ] **R79 sin evidencia** (`progress/recorrido_457.md` y `progress/recorrido_457/` no existen). → B2.
- [~] R78 (contraste en producción): «ANTES» hecho en `progress/contraste_457.md`; «DESPUÉS» es del
  despliegue (T9.5, leader). No bloquea la integración en `dev`; sí el despliegue.

### Calidad de código
- [x] typecheck 0 errores · [x] lint 0 errores · [x] tests (salvo el flake ajeno, aislado verde).
- [n/a] E2E Playwright: el repo no tiene arnés E2E (memoria «Nada de E2E»); el riesgo lo cubren la
  integración POR LA ACTION contra Postgres y la concurrencia real. R79 es el recorrido ad hoc que lo
  sustituye, y falta (B2).

### Datos y seguridad
- [x] RLS activada en `abono_tienda` y `abono_tienda_anulacion` (`…_tablas_y_checks/migration.sql:65-66`;
  verificada contra el motor por `abono-tienda-457-migration.test.ts` (c)).
- [x] Migraciones con `down.sql`; la 1 con la función dinámica de la 461 byte a byte salvo el sufijo (la
  comparé línea a línea: solo cambian comentarios, el sufijo, los textos `rollback 457` y las llamadas);
  la 2 con precondición ruidosa y los CHECK devueltos EXACTAMENTE a la 461 (test (d)).
- [x] Sin secretos. [n/a] Webhooks: no hay.

### Capas / permisos / configuración
- [x] Action → servicio → repositorio; el servicio no conoce HTTP; el repositorio solo Prisma (+ la fila
  de historial en la misma tx, patrón del repo); interfaces en `lib/interfaces/{repositories,services}`.
- [x] Páginas: `/wallet` y `/wallet/tiendas` hacen `notFound` sin acceso total
  (`app/(app)/wallet/tiendas/page.tsx:24`); el botón del desglose solo se monta con `puedeRegistrarPago`
  (`SaldosTiendasTable.tsx:210-213`) y solo con `signo === "negativo"` (`PagoTiendaAcciones.tsx:146,206`).
- [x] Mutaciones por Server Action. [x] Sin país/moneda hardcodeados (`money` de config).

### Verificación final
- [ ] `./init.sh` verde: rojo por UN flake ajeno, aislado 3/3 verde (aceptable con la regla del arnés,
  pero no es «verde» literal: repetir el completo tras integrarla en `dev`, como manda la regla 5).
- [x] Este informe. [ ] Entrada en `progress/history.md` (T9.6, leader).

## Lo que miré del dinero, y qué encontré

- **R7/R8 al céntimo.** `NATURALEZA` terceros + `LIQUIDEZ` efectivo para las dos categorías de caja
  (`lib/utils/caja-tesoreria.ts:98-99,156-157`); `CONTRAPARTIDA_EN_CAJA` con las dos parejas
  (`lib/utils/invariante-tiendas.ts:92-93`); `CUBETA` aFavor/cargos (`desglose-tienda.ts:65-66`). La
  invariante corre sobre la caja ENTERA con tres pasos nuevos (cobro grande, pago, anulación) y fija
  Δ «Entró», «Salió», cifra, ganancia, «De las tiendas», capital y saldo de B en cada uno
  (`caja-invariante-tiendas.test.ts`, pasos 10–12). La identidad R7 además sobre 500 subconjuntos con
  semilla fija (`caja-derivacion-457.test.ts`). Correcto.
- **Clasificación de la liquidez:** efectivo en los dos sentidos; las contrapruebas de la guardia
  (propio → rojo; `cargo_a_tienda` → rojo) existen y las mutaciones 2 y 3 del implementer lo prueban.
- **Candado compartido:** `bloquearBeneficiario(tx, {tipo:"tienda"})` = `SELECT … FROM usuario … FOR
  UPDATE` (`LiquidacionPagoRepository.ts:172-175`), el mismo que `registrarPagoTienda` y
  `PagoPorCuentaTiendaService.registrar`. La concurrencia real lo prueba contra los tres tipos
  (`abono-tienda-457-concurrencia.test.ts`, con «terminó durante la pausa» = false).
- **Tope bajo el candado:** la regla se evalúa sobre un saldo leído DESPUÉS del `FOR UPDATE`
  (`AbonoTiendaService.ts:201-208`); `sin_deuda` con `gte(0)` y `excede` con `gt(deuda)` (`:379-381`),
  exacto al céntimo con `Prisma.Decimal`. Mis mutaciones C y E lo confirman.
- **Idempotencia:** clave UNIQUE en el documento; `ya_registrado` devuelve el original y el saldo de SU
  tienda; un P2002 sin pista se lee como clave (premisa de dos únicos, verificada contra el motor).
- **Anulación y contra-asientos:** constancia con `UNIQUE(abono_id)`, débito y egreso por el monto DEL
  DOCUMENTO (el schema `.strict()` rechaza `monto`), mismo origen, idempotentes por los índices
  parciales (el de la tienda incluye `categoria`: `20260712170000_wallet_tienda_movimiento`, l. 69-71,
  así que el débito no choca con el crédito del mismo origen). No se toca el original (test R33 con
  `toEqual` de las filas antes/después).
- **Fechas CR:** asientos al inicio del día CR de la fecha real (06:00Z); anulación al inicio del día CR
  de hoy, con el caso de las 22:00 CR (mi mutación G lo confirma); `fechaPagoSchema` compara contra
  `fechaCalendarioCR`.

### La desviación de `design.md` §5.1 (la clave antes que la regla del dinero)

`AbonoTiendaService.ts:157-161` mira la clave DESPUÉS del rol y de validar la tienda y ANTES del
pre-chequeo; y otra vez en el `catch` de `sin_deuda`/`excede` (`:252-256`) para el envío simultáneo.
**Es correcta y necesaria:** con el orden del diseño, el doble clic del recorrido §17.4 sobre un pago
que salda la deuda respondía `sin_deuda`/`excede` a un pago que SÍ quedó (medido por el implementer;
mi mutación B lo reproduce: integración «R25» roja). No abre ningún agujero: la lectura por clave no
escribe, va detrás del rol (un rol sin acceso no puede sondear claves: R2 intacto) y no sube archivo
(R25 «sin comprobante adicional»). Lo único pendiente es documental: `design.md` §5.1 sigue diciendo el
orden viejo (m4).

## Hallazgos

### BLOQUEANTES

**B1 — `tasks.md` sin ni una tarea marcada.** `specs/457-la-tienda-paga-a-ordenex/tasks.md:32-258`:
las 43 tareas en `[ ]`, incluidas todas las que la bitácora da por hechas (T0.1–T8.3). CHECKPOINTS
«todas las tasks marcadas `[x]`». *Qué falta:* marcar `[x]` lo hecho; dejar abiertas SOLO T9.5 y T9.6
(leader, post-despliegue) con esa nota.

**B2 — R79 sin evidencia.** `requirements.md:408-409` («Antes de darla por hecha, el recorrido por rol
de §17 … DEBE tener sus capturas y sus números en `progress/`»). No existen `progress/recorrido_457.md`
ni `progress/recorrido_457/`; `impl_457.md:207` y `:454` lo pasan al leader, pero T9.3 no está rotulada
como del leader. Es la única verificación de lo que el usuario ve (la memoria «Ver la app encuentra lo
que la suite no» midió 7 textos rotos con 12.000 tests verdes). *Qué falta:* el guion de §17 (maestro,
admin, adminTienda, mensajero) en local sembrado con un solo dev server, capturas y números (incluidos
el doble clic del paso 4 y el `excede`/`sin_deuda` del paso 5).

**B3 — El anexo T9.1 está vacío.** `progress/fase0_457.md:100-102` dice «Pendiente: repetir la fase 0
sobre el árbol final con las 14 mutaciones». Las 14 SÍ se corrieron (12 en `impl_457.md` §7 + 9, 13 y
11 en §11.5), pero en dos sesiones y árboles distintos, y R77 remite a este anexo. *Qué falta:*
consolidar en el anexo las 14 con el SHA final y la fotografía verde sin tocar literales.

### Menores

**m1 — R52, cláusula de `cuenta_por_pagar_tienda` sin test.** Mi mutación H (`lib/analytics/metrics.ts:794-795`
fuera) deja verde toda `tests/unit/analytics` (176 archivos). El cálculo NO cambia (el repositorio suma
el libro entero sin filtrar por categoría, `CuentasPorPagarAnaliticaRepository.ts:25-31`), así que es
documental, pero R52 lo exige y el catálogo es lo que se describe al asistente. *Arreglo:* una aserción
«`definicion.categorias` de `cuenta_por_pagar_tienda` = `WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED`» (el
mismo hueco lo tenía `cobro_tienda_anulado` de la 461).

**m2 — El candado de la ANULACIÓN solo lo prueba un doble.** Mutación A (`AbonoTiendaService.ts:295`)
sobrevive a la integración y a la concurrencia; la mata solo el orden de llamadas del unitario. La
anulación no lee el saldo para decidir (el `UNIQUE(abono_id)` protege la doble anulación), así que es
defensa en profundidad; pero R38 dice «DEBE tomar el mismo bloqueo». *Arreglo:* un caso de concurrencia
«anulación ∥ pago de la misma tienda pausado» con «terminó durante la pausa = false».

**m3 — El saldo bajo el candado se lee por OTRA conexión del pool.** `AbonoTiendaService.ts:203` →
`saldoDe` → `tiendaRepo.agregarSaldoPorTienda` con el cliente global, no con `tx`. Es correcto en READ
COMMITTED (los que toman el mismo candado ya confirmaron su transacción) y es el molde de
`LiquidacionService.ts:645`. Escenario de fallo: el pool es de 3 por instancia
(`lib/db/prisma-client.ts:21`); tres registros simultáneos de la MISMA tienda en la misma instancia
ocupan las 3 conexiones (uno con el candado, dos esperándolo) y el primero no consigue una cuarta para
leer el saldo → `connectionTimeoutMillis` 10 s / timeout de la tx → error y rollback. Falla CERRADO (no
escribe dinero mal) y es improbable (solo maestro/admin registran), pero es un cuelgue posible.
*Arreglo sugerido (futuro, también para la 172):* leer el agregado con `tx`.

**m4 — `design.md` §5.1 describe el orden viejo.** El código y los tests van por el orden nuevo (clave
antes de la regla, y otra vez tras un rechazo bajo el candado). *Arreglo:* actualizar §5.1 (lo anota
`impl_457.md:325,457`).

**m5 — R74, dos aserciones que no pueden fallar.** `abono-tienda-457.test.ts:445-449` comprueba que el
pago no escribió `liquidacion_pago` ni cambió el `origen_id` de un `cobro_manual`: el servicio no toca
esas tablas, así que siempre son verdes. Lo que protege R74 de verdad es que el backfill de la 173 lee
`cierre_dia`, `liquidacion_pago` y `liquidacion_anulacion` (`CajaBackfillTesoreriaService.ts:156-216`) y
no la tabla del pago; conviene decirlo en el test en vez de afirmar tautologías.

**m6 — Sin límite hacia atrás, un pago puede quedar ANTES del saldo inicial.** D3 lo aceptó (molde del
pago a tienda). Pero la 459 exige que el saldo inicial no sea posterior al primer día con movimientos
(`AporteCapitalService.ts:113-121`) y esa regla solo se evalúa al registrar el saldo inicial: un pago
retroactivo registrado después deja dinero «entrando» antes del saldo inicial. No rompe R7/R8. Anotarlo
como límite en design §19.

**m7 — Reintento con otra cifra y la misma clave.** Si el primer envío quedó pero el navegador no vio la
respuesta y el usuario cambia el monto y reintenta en el mismo diálogo, recibe `ya_registrado` y el
aviso «Pago registrado. El saldo de … queda en …» (`RegistrarMovimientoCajaDialog.tsx`,
`TEXTO_ABONO.registrado`) sin decir el importe que quedó. Es la semántica de idempotencia de la 461;
decir el monto del original en el aviso lo haría inequívoco.

**m8 — No pude repetir el ciclo real up → down → up.** El clasificador de permisos bloqueó
`pnpm run db:rollback` sobre mi clon. Me apoyo en el test (d)/(e) (precondición contra el motor, CHECK
textuales iguales a la 461, función byte a byte) y en el ciclo medido por el implementer
(`impl_457.md` §2, md5 de los CHECK idénticos tras volver a subir).

### Revisado sin hallazgo

- **Migraciones y orden tras la 461:** `20260927120000`/`20260927120100` después de
  `20260926120500_wallet_461_fechas_cr_pagos`; `migrate status` en el clon: solo esas dos pendientes; las
  listas de los CHECK = las de la 461 + los cuatro valores (comparadas con
  `20260926120100_…/migration.sql:41-63`).
- **Permisos por rol:** registrar y anular → solo acceso total, rol antes de leer (R2/R37); comprobante →
  acceso total o la tienda dueña, ajena = inexistente (R42/R43); sesión antes de validar (R3).
- **Nombres exactos:** los textos de design §2 coinciden en `wallet-labels.ts`, `desglose-tienda-labels.ts`,
  `mi-wallet-labels.ts` (incluido `ORIGEN_TIENDA_LABEL`, el `Record<string,string>` sin red del
  compilador), `historial-accion.ts` y `PagoTiendaAcciones.tsx`; pistas de cabecera R50 literales.
- **Sin uuids ni códigos crudos:** DTO sin `tiendaId`/clave/ruta; descripciones sin ids (regex de uuid en
  los tests); tablas y descargas de las tres superficies con test de pantalla.
- **Ayuda y asistente:** tres documentos con las frases de §11, fuentes añadidas, fecha 2026-09-25 (ya
  lo era por la 461: mismo día), `contexto-457.test.ts` por rol.

## Qué hace falta para APROBADA

1. B1: marcar `tasks.md` (T9.5/T9.6 abiertas y rotuladas como post-despliegue del leader).
2. B2: el recorrido R79 de §17 con capturas y números en `progress/recorrido_457*`.
3. B3: el anexo T9.1 de `progress/fase0_457.md` con las 14 mutaciones sobre el SHA final.
4. (Recomendado, no bloquea) m1 y m2: dos tests pequeños; m4: `design.md` §5.1.
5. Tras integrarla en `dev`: `./init.sh` completo en segundo plano (regla 5). Antes de desplegar: T9.5
   (bucket `wallet-comprobantes` en preview y prod; M3/M4/M6/M8 y RLS después).
