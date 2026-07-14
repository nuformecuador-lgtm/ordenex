# Review - Feature 45: wallet gastos fijos/variables y sueldos

Reviewer (verificacion, no edicion). Money-critical. Rama feature/45-wallet-gastos-sueldos
(working tree, sin commit). Comparado contra origin/dev. Fecha 2026-07-13.
Corridas por el reviewer: tsc --noEmit, eslint, vitest run, init.sh.

## VEREDICTO: APROBADO - 0 bloqueantes de codigo / money / seguridad

Superficie money-critical (idempotencia del cron, atomicidad, no doble conteo, reversa net-cero
idempotente, auth del cron antes de efectos, gate a rol maestro, migraciones aditivas con
down.sql, RLS de la tabla nueva, no-regresion 42/43/44) implementada y verificada por tests que
corri yo mismo. Quedan 5 hallazgos MENORES (proceso/deuda) a cerrar antes de done; ninguno es
defecto de codigo.

## Verificacion ejecutable (corrida por el reviewer)

- npx tsc --noEmit  -> 0 errores.
- npx eslint        -> 0 errores (135 warnings, todos en carpetas .claude/skills, ajenos).
- npx vitest run    -> 2545/2545 tests, 283 archivos, VERDE.
- ./init.sh         -> VERDE (typecheck 0, lint 0, 2545 tests, migraciones con down.sql, init OK).
- Money-critical puntuales (28 tests): generacion-gastos-fijos, wallet-egreso,
  wallet-egreso-service, generar-gastos-fijos-route -> VERDE.

## Checklist CHECKPOINTS

Especificacion
- [x] requirements.md EARS R1..R33.
- [x] design.md con alternativas descartadas + porque (seccion 8, 5 alternativas).
- [ ] tasks.md con todas las tasks marcadas [x] -> NO (headers T# sin checkboxes). Hallazgo #2.

Trazabilidad
- [x] Cada R<n> mapea a un test concreto; reproduje el mapa contra los archivos reales.
- [ ] progress/impl_45.md con el mapa R->test -> NO EXISTE. Hallazgo #1.

Calidad de codigo
- [x] typecheck 0, lint 0, tests verde.
- [ ] E2E para flujo critico (pagos/caja) -> ausente para egresos/plantillas/cron. Hallazgo #3.

Datos y seguridad
- [x] Tabla nueva gasto_fijo_plantilla con RLS habilitada sin policies.
- [x] Migraciones versionadas y reversibles: ambas con down.sql; init.sh lo confirma.
- [x] Sin secretos hardcodeados: CRON_SECRET via process.env (lib/config/cron.ts).
- [x] Cron valida CRON_SECRET (Bearer) ANTES de efectos + idempotente por indice unico parcial.

Patron de capas
- [x] Controller sin queries ni logica; Service sin HTTP/Prisma directo (DI); Repository solo
      Prisma; interfaces en lib/interfaces (services/repositories).

Permisos
- [x] page.tsx valida rol server-side (notFound a no-maestro); datos por props; mutaciones via
      Server Actions.

Multi-pais / config
- [x] Sin hardcode de pais/moneda; montos STRING en toda la frontera.

## Verificacion money-critical (a fondo)

1. Idempotencia del cron (R28/R31). ejecutarGeneracion arma un UNICO createMany(skipDuplicates)
   con origen_id = plantillaId:YYYY-MM, categoria egreso_gasto_fijo, origen_tipo gasto. Cae bajo
   el indice unico parcial EXISTENTE wallet_movimiento_origen_categoria_uq (origen_tipo,
   origen_id, categoria) WHERE origen_id IS NOT NULL. No se crea ni altera indice (migracion enum
   solo ADD VALUE). Test integracion: reejecutar el mismo periodo inserta 0 filas y el balance NO
   cambia; dos periodos distintos generan 2 egresos por plantilla.
2. No colision de claves. Egreso manual origen_id NULL (fuera del indice); reversa origen_id =
   uuid del egreso + ingreso_ajuste; cron uuid:YYYY-MM (no iguala un uuid puro).
3. Atomicidad / no doble conteo (R7/R8/R31). Manual = un solo crearMovimientos de 1 fila; cron =
   un solo createMany. Balance DERIVADO (SUM ingreso menos SUM egreso). El egreso resta una vez.
4. Reversa append-only idempotente (R13-R16/R32). ingreso_ajuste de igual monto leido
   SERVER-SIDE, origen_id = egreso, net cero; segundo intento count 0 -> already_reversed. Aplica
   a egresos del cron. not_found si no es egreso administrativo (tipo egreso AND origen_tipo
   gasto): excluye ingresos, pago_mensajero, egreso_ajuste manual.
5. Auth del cron (R29). handleGenerarGastosFijos devuelve 401 ANTES de construir el service o
   tocar la DB. Secreto no configurado -> 401. Sin loguear secreto ni PII (respuesta solo conteos
   mas periodo). Test confirma que el service NO se invoca en los 3 casos de 401.
6. Gate a rol maestro (R17/R18). WalletEgresoService y GastoFijoPlantillaService: rol distinto de
   maestro -> forbidden en TODOS los metodos, sin efectos. Actions -> UnauthenticatedError sin
   sesion. page.tsx notFound a no-maestro.
7. Migraciones (R20/R21/R33). Enum: ALTER TYPE ADD VALUE IF NOT EXISTS x2 (aditivo, fuera de tx,
   sin usar los valores, respeta la restriccion de Postgres). down.sql recrea el tipo con los 12
   valores originales (drop/recreate de los 2 indices que referencian categoria), sin tocar RLS;
   precondicion sin filas con los valores nuevos. Tabla: CREATE TABLE + indice activa + ENABLE RLS
   sin policies; down.sql = DROP TABLE IF EXISTS.
8. montoPositivoSchema blindaje (punto 6 del encargo). El refine envuelve Prisma.Decimal(v).gt(0)
   en try/catch: vacio o no-numerico devuelve false (ZodError -> validation_error) en vez de 500.
   Para entradas VALIDAS el resultado es identico. Sin efecto colateral en el ajuste manual de la
   42 (suite 42/43/44 verde). Test dedicado: monto vacio o cero -> validation_error.
9. No regresion 42/43/44. Cambios en compartido (types/wallet, WalletMovimientoRepository e
   interfaz, wallet-labels, WalletLedger/Module, page.tsx) son ADITIVOS. Mocks compartidos solo
   suman obtenerPorId/agregarPorCategoria. esEgresoAdministrativo acota la reversa a egresos de
   gasto: ingresos/pagos/ajustes de 42/44 no muestran Reversar.
10. UI. Form manual ofrece solo gasto variable y sueldo; gasto_fijo cae fuera del enum ->
    validation_error. Plantillas solo generan por cron (nota explicita en el panel). Reversa solo
    en egresos administrativos. Desglose y balance NO se recalculan en cliente (STRING por props;
    el modulo los repide server-side con los mismos filtros).

## Trazabilidad R1-R33 (reproducida)

Todos los R tienen test real que verifica lo que dice. R1/R2/R3/R7 unit wallet-egreso-service;
R4/R5/R19 action wallet-egresos-actions mas dialog; R6 assert de API mas grep 0 update/delete;
R8/R14/R15/R16 integracion wallet-egreso; R9 suite 42/43/44; R10/R11 wallet-labels mas desglose
unit mas card; R12 DTOs STRING mas wallet-page; R13/R15/R16/R32 wallet-egreso-service (incl.
reversa de egreso del cron) mas integracion; R17/R18 forbidden/unauthenticated service mas action;
R20 migraciones mas RLS; R21 wallet-egreso-migration; R22/R23 componentes; R24/R25/R26
gasto-fijo-plantilla-service mas panel; R27/R28/R30/R31 generacion-gastos-fijos-service mas
integracion mas fecha-cr-periodo; R29 generar-gastos-fijos-route; R33 gasto-fijo-plantilla-migration.
No hay R sin test.

## Hallazgos

MENOR #1 - progress/impl_45.md no existe (checkpoint de trazabilidad). CHECKPOINTS lo exige con el
mapa R->test mas evidencia. Todas las 40-49 lo tienen; la 45 no. La trazabilidad SI esta en
tasks.md y la verifique yo (2545 verde), riesgo nulo, artefacto faltante. Accion: crear
impl_45.md antes de done. No es defecto de codigo.

MENOR #2 - specs/45/tasks.md sin marcas [x]. Usa headers T# mas Hecho cuando sin checkboxes (la 44
si las usa). Verifique que cada Hecho cuando se cumple. Accion: marcar [x] antes de done.
Formato/proceso.

MENOR #3 - Sin E2E (Playwright) del flujo de egresos/plantillas/cron. Money-critical (caja); la 42
fue rechazada en su dia por esto, pero 43/44/46-49 DIFIRIERON el E2E como deuda menor con
aprobacion. Lo registro alineado a ese precedente. Recomendacion: E2E de egreso, reversa y toggle.

MENOR #4 - Round-trip de migracion por test ESTATICO (regex), no up-down-up real. El round-trip
real es manual (db:migrate / db:rollback), como en 42/43/44. init.sh confirma down.sql presente.
Deuda menor, consistente con el precedente.

MENOR #5 - Tests integration/db con store en memoria (no Postgres real). Simulan el indice unico
parcial con un Set (ESPEJO de wallet-idempotencia de la 42). Prueban la LOGICA, no el constraint
real de Postgres. Precedente aceptado en 42-44. Deuda menor.

## Conclusion

Implementacion money-critical SOLIDA: 0 bloqueantes de codigo/seguridad/dinero. La feature NO debe
marcarse done hasta cerrar los checkpoints #1 (crear impl_45.md) y #2 (marcar tasks [x]); #3/#4/#5
son deuda menor alineada al precedente 42-49. Trabajo del leader/implementer (artefactos/deuda);
no requiere tocar el codigo.
