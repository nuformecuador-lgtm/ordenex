# Feature 118 — Corrección ortográfica SIMPE → SINPE (requirements)

> Zona: fullstack · Complexity: high · Rama: `feature/118-sinpe-correccion` · depends_on: null
> SINPE es el medio de pago correcto de Costa Rica. `SIMPE` es un typo introducido
> en la feature 36 (decisión F1.4-c) y propagado al enum Postgres `metodo_pago_value`,
> a los tipos TS, a los textos user-facing y a los tests. Esta feature lo corrige de
> forma reversible y sin tocar identificadores internos.

## Alcance en una frase
Renombrar el **valor** del enum `metodo_pago_value` de `SIMPE` a `SINPE` (Postgres +
Prisma + tipos TS + etiquetas + tests), preservando las filas existentes y **sin**
renombrar identificadores internos no user-facing (`total_simpe`, `totalSimpe`, la
clave DTO `simpe` de los objetos de totales) ni migraciones históricas ya aplicadas.

## Requisitos (EARS)

- **R1 (Ubicuo — enum canónico).** El sistema DEBE exponer el enum Postgres
  `metodo_pago_value` con exactamente los valores `{efectivo, SINPE, transferencia}`;
  el valor `SIMPE` NO DEBE existir como valor vigente del tipo tras aplicar la feature.

- **R2 (Por evento — migración UP).** CUANDO se aplique la migración UP de esta
  feature, el sistema DEBE renombrar el valor del enum mediante
  `ALTER TYPE "metodo_pago_value" RENAME VALUE 'SIMPE' TO 'SINPE'`, sin recrear el
  tipo ni alterar columnas que lo referencian.

- **R3 (Por evento — migración DOWN reversible).** CUANDO se aplique el `down.sql`
  de esta feature, el sistema DEBE revertir el valor mediante
  `ALTER TYPE "metodo_pago_value" RENAME VALUE 'SINPE' TO 'SIMPE'`, dejando el enum
  idéntico al estado previo a la migración UP.

- **R4 (De estado — compatibilidad de datos existentes).** MIENTRAS existan filas
  cuyo método de pago fuera `SIMPE` antes de la migración, tras el UP esas filas
  DEBEN quedar con el valor `SINPE` sin pérdida de datos, sin reescritura de filas y
  sin cambiar el conteo de filas (el `RENAME VALUE` preserva el OID del valor y por
  tanto las filas ya almacenadas).

- **R5 (Ubicuo — fuente única de tipos TS).** El sistema DEBE reflejar `SINPE` (no
  `SIMPE`) como valor en la fuente única de verdad de dominio: el enum Prisma
  `MetodoPagoValue` (`db/schema.prisma`) y la tupla `METODO_PAGO_SEED` / el tipo
  `MetodoPago` (`lib/types/metodo-pago.ts`), manteniendo verde el chequeo de
  exhaustividad `satisfies readonly MetodoPagoValue[]` / `_EnsureExhaustive`.

- **R6 (Ubicuo — etiquetas y opciones).** El sistema DEBE usar la clave `SINPE` con
  etiqueta legible `"SINPE"` en todos los mapas `Record<MetodoPagoValue, string>` y
  en las opciones del selector de método de pago.

- **R7 (Por evento — lógica de agregación de totales).** CUANDO se calculen los
  totales por método de pago, el sistema DEBE ramificar por el valor `SINPE` (no
  `SIMPE`), acumulando el `montoRecibido` de las gestiones `entregada` con método
  `SINPE` en su carril correspondiente.

- **R8 (Por evento — texto user-facing).** CUANDO la UI muestre el método de pago
  correspondiente a SINPE, el sistema DEBE presentar el texto `"SINPE"` y NUNCA el
  texto `"SIMPE"` (paneles de totales, columnas de tablas, etiquetas de detalle).

- **R9 (NEGATIVO — identificadores internos intactos).** El sistema NO DEBE renombrar
  los identificadores internos no user-facing: la columna Postgres `total_simpe`, el
  campo Prisma `totalSimpe` (`@map("total_simpe")`), ni la clave `simpe` de los
  objetos DTO de totales (`{ efectivo, simpe, transferencia, general }`). Estos
  conservan su nombre actual.

- **R10 (NEGATIVO — migraciones históricas inmutables).** El sistema NO DEBE modificar
  migraciones ya versionadas/aplicadas; en particular
  `db/migrations/20260711150000_gestion_orden_estados_metodo_pago/migration.sql` DEBE
  conservarse tal cual (crea el tipo con `SIMPE`, que refleja el estado histórico). El
  cambio DEBE introducirse en una migración NUEVA con su `down.sql` (R2/R3).

- **R11 (Ubicuo — tests coherentes con el valor vigente).** Todos los tests que usen
  el valor del enum como dato de entrada o aserción (p. ej. `metodoPago: "SIMPE"`,
  `getByText("SIMPE")`, la aserción del set de `METODO_PAGO_SEED`) DEBEN usar `SINPE`.
  El test de la migración histórica DEBE desacoplarse de `METODO_PAGO_SEED` y afirmar
  el literal histórico `SIMPE`; ADEMÁS DEBE existir un test de la migración nueva que
  verifique el `RENAME VALUE` en UP y su inverso en DOWN (trazabilidad de R2/R3).

- **R12 (Ubicuo — invariante de censo).** SI se ejecuta un censo case-sensitive del
  literal `SIMPE` sobre el árbol de fuentes de producción y tests (excluyendo la
  migración histórica de R10, el `down.sql` de esta feature, y los docs de
  `specs/`/`progress/`), ENTONCES NO DEBE haber ninguna coincidencia. (El literal
  `SIMPE` solo puede sobrevivir en la migración histórica y en el `down.sql` inverso.)

## Trazabilidad requisito → prueba (resumen; el mapa fino lo cierra el implementer)

| R    | Verificación |
| ---- | ------------ |
| R1   | Test de introspección/migración: enum vigente = {efectivo, SINPE, transferencia}. |
| R2   | Test lee `migration.sql` nuevo y afirma `RENAME VALUE 'SIMPE' TO 'SINPE'`. |
| R3   | Test lee `down.sql` nuevo y afirma `RENAME VALUE 'SINPE' TO 'SIMPE'`. |
| R4   | Test integración DB: fila con `SIMPE` antes → `SINPE` después; mismo conteo. |
| R5   | `tests/unit/types/metodo-pago.test.ts`: seed == {efectivo, SINPE, transferencia}; build type-check verde. |
| R6   | Test de `metodo-pago-options` / componentes: etiqueta `"SINPE"`. |
| R7   | `tests/unit/utils/cierre-totales.test.ts`: `metodoPago: "SINPE"` suma al carril. |
| R8   | `CierreDiaModule.test.tsx` / `CierresAdminModule.test.tsx`: `getByText("SINPE")`; sin `"SIMPE"`. |
| R9   | Test migración/schema: `total_simpe` persiste; repos siguen mapeando `simpe`/`totalSimpe`. |
| R10  | Test: `20260711150000_.../migration.sql` sigue conteniendo `'SIMPE'`. |
| R11  | Todos los tests de la tabla anterior en verde + test nuevo de migración rename. |
| R12  | Test/guard de censo case-sensitive de `SIMPE` sobre fuentes (excepciones de R10/R3). |

## Preguntas abiertas

1. **Clave DTO `simpe` (minúscula) en los objetos de totales** (`{ efectivo, simpe,
   transferencia, general }`, presente en interfaces, repos, servicios y ~30 tests):
   se trata como **identificador interno no user-facing** y por tanto **NO se renombra**
   (misma regla que `total_simpe`, con el que está acoplado 1-a-1 vía `@map`). Se pide
   confirmación explícita de que este acoplamiento interno `simpe` ↔ `total_simpe` se
   conserva (renombrarlo dispararía un refactor amplio fuera del alcance de un chore).

2. **Guard de censo (R12) en CI:** el repo no tiene GitHub Actions (CI = build de
   Vercel). ¿Se acepta el guard como test de la suite (Vitest) en lugar de un check de
   CI dedicado? Propuesta por defecto: sí, como test.

3. **Textos en comentarios/nombres de tests** (p. ej. descripción "no se paga con
   SIMPE ni transferencia", comentario del e2e): se actualizan a `SINPE` por
   consistencia aunque no sean strings renderizados. Confirmar que se desea también
   este barrido cosmético (asumido: sí).
