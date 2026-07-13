# Review — Feature 42: wallet, caja PRINCIPAL de Ordenex

Reviewer: reviewer (arnes SDD). Rama feature/42-wallet-caja-principal (a9769ea backend,
f85ee42 frontend, 32955c4 bitacora) sobre origin/dev 84ddc3b. Fecha: 2026-07-12.

## Veredicto: APROBADO

Actualizacion de cierre 2026-07-12 (verificacion acotada, commit 1f9124b). El unico bloqueante del
review original (BLOQUEANTE-1: faltaba el E2E de /wallet) quedo CERRADO: existe `e2e/wallet.spec.ts`
cubriendo los dos flujos exigidos (acceso maestro con libro + balance derivado + filtro por tipo +
alta de movimiento manual con `descripcion` obligatoria; y bloqueo de rol NO autorizado que no ve
movimientos ni balance), consistente con el precedente de la cadena de cierres y usando selectores/
textos REALES de la pagina y sus componentes. Todo lo money-critical ya estaba correcto y verificado
de forma EJECUTABLE (incluido el round-trip REAL de la migracion). Las 4 deudas menores (menor-1..4)
siguen como seguimiento y NO bloquean el merge.

### Verificacion de cierre (numeros reales, reviewer)
- typecheck (tsc --noEmit strict) -> 0 errores.
- lint (eslint) -> 0 errores, 135 warnings (TODOS preexistentes en .claude/skills).
- test (vitest run) -> 223 files, 2008/2008 passed. Sin regresion; vitest NO ejecuta los `e2e/*.spec.ts`.
- E2E revisado contra los componentes reales: region "Balance general" (WalletBalanceCard),
  table "Libro de movimientos" (DataTable ariaLabel), combobox "Filtrar por tipo" + option "Ingreso"
  + button "Aplicar" (WalletFiltros/Select), button "Registrar movimiento" y dialog "Registrar
  movimiento manual" con labels "Monto"/"Descripcion", boton confirm "Registrar", error exacto
  "La descripcion es obligatoria." y toast "Movimiento registrado correctamente." (todos existen).
- Trazabilidad del E2E: T17 marcada [x] en tasks.md; anotado en impl_42 ("Loose-end del review").

## Veredicto original: RECHAZADO — 1 BLOQUEANTE (historico, ya resuelto)

Todo lo money-critical esta correcto y verificado de forma EJECUTABLE (incluido el round-trip
REAL de la migracion que el implementer difirio). El unico bloqueante es un incumplimiento del
gate de CHECKPOINTS: falta el E2E para un flujo money-critical. Es un arreglo acotado.

## Verificacion ejecutable (numeros reales, corridos por el reviewer)

- prisma validate -> schema valido. OK.
- typecheck (tsc --noEmit strict) -> 0 errores.
- lint (eslint) -> 0 errores, 135 warnings (TODOS preexistentes en .claude/skills). OK.
- test (vitest run) -> 223 files, 2008/2008 passed. Baseline 1931 +77 = 2008, sin regresion de la
  cadena 37/38/39/40/56/41. Corrido dos veces, verde.
- ./init.sh -> "== init OK ==". VERDE.

### Round-trip REAL de la migracion (reviewer, contra Postgres LOCAL localhost:5432 db ordenex)

Metodo: migrate deploy (apply) -> introspeccion por CATALOGO DEL SISTEMA (no regex) -> db:rollback
(down.sql) -> introspeccion -> migrate deploy (re-apply) -> introspeccion.

- Tras APPLY: wallet_movimiento existe; sin updated_at/deleted_at (inmutable R1/R3); orden.cobra_comision
  = boolean NOT NULL default true (R26); 3 enums nativos con todos sus labels; indices fecha, (tipo,categoria),
  (origen_tipo,origen_id), pkey, y UNIQUE PARCIAL wallet_movimiento_origen_categoria_uq
  (origen_tipo,origen_id,categoria) WHERE origen_id IS NOT NULL (R24); relrowsecurity=true, 0 policies (R22).
- Tras ROLLBACK: la tabla ya no existe (regclass NULL); orden.cobra_comision eliminada; los 3 enums
  eliminados; registro en _prisma_migrations borrado. REVERSIBILIDAD REAL confirmada por introspeccion,
  incluida la columna en orden.
- Tras RE-APPLY: todo vuelve. Re-aplicable.

### Idempotencia por CONSTRAINT DB REAL (reviewer, contra la DB viva)

Via WalletMovimientoRepository.crearMovimientos (createMany skipDuplicates -> ON CONFLICT DO NOTHING)
inserte el mismo triple (cierre_dia, reviewer-c1, ingreso_flete) dos veces: 1a count=1; 2a count=0
(no-op, sin error); queda 1 fila. Manual (origen_id NULL) x2 -> 2 filas (fuera del indice parcial).
Confirma R6/R13 a nivel DB (sin TOCTOU), no check-then-insert.

## Checklist CHECKPOINTS

- [x] requirements.md EARS R1..R26 + design.md con alternativas descartadas + tasks.md todas marcadas.
- [x] Trazabilidad R1..R26 -> test (mapa en impl); tests no vacios (formulas, idempotencia, atomicidad,
      forbidden, DTO STRING, migracion).
- [x] typecheck 0, lint 0, test verde.
- [x] E2E (Playwright) para flujo money-critical -> e2e/wallet.spec.ts (CERRADO en 1f9124b; ver cierre arriba).
- [x] RLS activada sin policies en tabla nueva (verificado en DB real).
- [x] Migracion versionada y reversible; db:rollback funciona (reversibilidad real).
- [x] Sin secretos hardcodeados.
- [x] Capas: Action sin queries; Service sin HTTP; Repository solo Prisma; interfaces en lib/interfaces.
- [x] /wallet valida rol server-side via resolveActorFromSession (cookies); componentes private reciben
      props STRING sin fetch de datos sensibles; mutaciones via Server Action.
- [x] Sin hardcode de pais/moneda/cuenta.
- [x] Money-safe: cero parseFloat/Number sobre montos; Prisma.Decimal + STRING toFixed(2) en la frontera.

## Auditoria money-critical

1. Formula del ingreso (lib/utils/ingreso-ordenex.ts) CORRECTA. entregada: flete valorFleteGam/valorFlete
   por esCentral + ivaFlete pct; comision montoCobrar x comisionCod/100 + ivaComisionCod pct SOLO si
   cobraComision true (ausentes, no 0.00, si false). devuelta/rechazada: flete de devolucion
   valorFleteDevueltoGam/valorFleteDevuelto + ivaFlete pct, SIN comision. reprogramada: nada. tarifa null
   -> objeto vacio (0.00 en el agregado, no bloquea, R9). Todo Prisma.Decimal, ROUND_HALF_UP, salida STRING.
   Test cubre cobraComision false -> sin comision ni su IVA, y si flete+IVA flete.
2. Idempotencia + atomicidad (CierresAdminRepository.resolverCierre): feed + insert EN LA MISMA transaccion
   que el updateMany de aprobacion; alimenta solo si count 1 y nuevoEstado aprobado; idempotencia por
   constraint DB (verificado real). Guardia de transicion estado IN (solicitado,vencido) + alcance INTACTA
   (no se debilito 38/41). R7: el error del insert se propaga por la transaccion (rollback, garantia de
   Prisma) y no retorna updated.
3. No doble conteo (R11): CierresBodegaAdminRepository/Service NO tocan wallet (grep limpio); test confirma
   que aprobar bodega no invoca feed y walletMovimientoRepo es undefined. Fuente unica = CierreDia.
4. Balance derivado (R16/R17): SUM ingreso - SUM egreso con Prisma.Decimal, STRING+signo; sin saldo mutable.
5. Inmutabilidad (R1/R3): tabla sin updated_at/deleted_at; repo sin update/delete; correccion = ajuste
   compensatorio. Manual: origen_tipo manual, origen_id NULL, monto>0, descripcion obligatoria (zod),
   registrado_por actor, solo maestro.
6. orden.cobra_comision (R26): Boolean NOT NULL DEFAULT true (verificado real); leido en el feed; down la
   quita. Captura editable = deuda A5, DOCUMENTADA.
7. RLS + indices (R22/R24): verificado real (RLS on, 0 policies; unique parcial + 3 indices).
8. UI (R18-R21): /wallet solo maestro (notFound si no); datos pre-obtenidos en Server Component y pasados
   YA como STRING; cliente no recibe Prisma.Decimal; libro paginado + balance + filtros.
9. Egresos genericos (R14): enum reserva categorias/tipo egreso + origen polimorfico para 43/44/45.

## Hallazgos

### BLOQUEANTE-1 (RESUELTO en 1f9124b) — Falta test E2E (Playwright) para /wallet (money-critical, gate CHECKPOINTS)
CHECKPOINTS.md exige al menos un test E2E (Playwright) para features que tocan flujos criticos
(pagos/recaudo). La wallet es LA caja money-critical (deriva ingresos de recaudo y permite ajustes
manuales del maestro). Toda la cadena comparable tiene su E2E (e2e/cierre-dia.spec.ts,
e2e/cierres-admin.spec.ts, e2e/cierre-bodega-satelite.spec.ts, e2e/reglas-bloqueos-cierre.spec.ts),
pero NO existe e2e/wallet.spec.ts ni cobertura E2E de /wallet.
Para levantarlo: anadir un spec Playwright que cubra, minimo: (a) el maestro accede a /wallet y ve libro
+ balance; (b) un rol no-maestro (o sin sesion) recibe forbidden/notFound sin exponer datos. Opcional
recomendado: filtros tipo/categoria/fecha y registro de movimiento manual.

### menor-1 (deuda) — wallet-idempotencia.test.ts NO golpea Postgres real
Esta en tests/integration/db pero usa un mock en memoria (makeWalletStore + vi.fn) que SIMULA el indice
unico parcial; su nombre/ubicacion sobre-declaran cobertura DB. El comportamiento real es solido: el
reviewer verifico la idempotencia por el constraint REAL contra la DB viva. Recomendacion: renombrar/reubicar
como unit, o anadir una prueba que corra contra Postgres.

### menor-2 (deuda) — round-trip de migracion solo cubierto por test estatico
wallet-migration.test.ts es regex sobre el SQL (declarado por el implementer). El round-trip REAL fue diferido
por el implementer; lo corrio el reviewer y quedo verde. Recomendacion: dejar registrado el criterio (entorno
local) para futuras migraciones money-critical.

### menor-3 — WalletService.registrarMovimientoManual relee el mas reciente por tipo+categoria
Para devolver el movimiento creado relee listar(page1, size1, tipo, categoria). Bajo concurrencia podria
devolver otro movimiento con el mismo tipo+categoria. Solo afecta el valor de retorno (no la integridad del
libro, append-only e inmutable). Riesgo bajo; considerar devolver el id insertado directamente.

### menor-4 (deuda ya declarada A5) — sin punto de captura editable de cobraComision
La 42 anade y LEE la columna con default true; poblarla desde 14/15/16/17 es follow-up. Documentado.

## Que corregir para APROBAR
1. Anadir e2e/wallet.spec.ts (Playwright): acceso maestro (libro+balance) + bloqueo de rol no autorizado,
   consistente con el precedente de la cadena de cierres. (BLOQUEANTE-1)

Los menores 1-4 son deuda/seguimiento; no bloquean el merge una vez cerrado el E2E.
