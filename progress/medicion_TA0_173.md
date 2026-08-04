# T A.0 — Medición de la base ANTES de escribir el `CHECK` (feature 173)

> Ejecutada por el **leader** el **2026-08-03**, por MCP de Supabase, con autorización humana
> explícita dada en esa sesión. Cifras **medidas**, no deducidas del código ni del PR.
>
> Este archivo existe aparte de `impl_173-caja-tesoreria.md` porque en el momento de medir había un
> `backend_dev` escribiendo esa bitácora (Tanda C). **Debe integrarse en ella** al cerrar la feature.

## Por qué esta task existe

El `CHECK` de `T A.2` **valida las filas existentes al aplicarse**, y en Vercel **el build migra antes
de compilar: mergear ES aplicar**. Si alguna fila lo incumpliera, el despliegue fallaría y dejaría una
fila fallida en `_prisma_migrations`, que **bloquea los despliegues siguientes** hasta repararla a
mano. Es la misma task que la 172 corrió antes de su `CHECK`.

## PRODUCCIÓN (`scfnwxqbsgkzwsdntdvd`) — medida

Reparto real de `wallet_movimiento`:

| tipo | categoría | filas |
| --- | --- | --- |
| egreso | `egreso_indemnizacion` | 1 |
| egreso | `egreso_pago_mensajero` | 4 |
| ingreso | `ingreso_comision_cod` | 5 |
| ingreso | `ingreso_flete` | 5 |
| ingreso | `ingreso_flete_devolucion` | 5 |
| ingreso | `ingreso_iva_comision_cod` | 5 |
| ingreso | `ingreso_iva_flete` | 5 |
| ingreso | `ingreso_iva_flete_devolucion` | 5 |

Contraste contra la **disyunción exacta** de `design.md §2.2` (no contra una regla de prefijos
inventada para la ocasión):

| Comprobación | Resultado |
| --- | --- |
| Filas totales | **35** |
| Categorías distintas | **8** |
| **Filas que violarían el `CHECK`** | **0** |

### Decisión, con su motivo

**El `CHECK` va DIRECTO, sin `NOT VALID` + `VALIDATE` posterior.** Cero filas incumplen la
restricción en producción y las 8 categorías presentes están **todas** cubiertas por alguna rama de
la disyunción, así que la validación al aplicarse no puede rechazar nada. Es la misma conclusión —y
por la misma vía— a la que llegó la `T A.0` de la 172.

## PREVIEW — NO alcanzable, y queda DECLARADO (no asumido)

El `spec` exige que si preview no se puede medir, se diga. **No se pudo.** El MCP está fijado por
`.mcp.json` al `project_ref` de **producción** y preview tiene base propia desde el 2026-07-27.
Vías probadas y descartadas, ahora **cinco**:

1. `list_projects` — el MCP de Supabase no lo expone.
2. `get_project` de Vercel — no devuelve variables de entorno.
3. No hay CLI de Vercel instalada.
4. El `project_ref` de preview no está escrito en ningún archivo del repo.
5. **`list_branches` (2026-08-03)** — falla con `Project reference is missing when validating
   permissions`. Confirmado en la misma sesión que `get_project_url` devuelve
   `scfnwxqbsgkzwsdntdvd`, o sea **producción**.

### Riesgo residual, acotado y con nombre

**Producción está a salvo**: está medida y da 0. Lo que puede pasar es que preview tenga una fila
incoherente que nadie ha visto, el build del PR salga rojo y deje una fila fallida en el
`_prisma_migrations` **de preview**, bloqueando sus despliegues hasta repararla a mano.

Por qué es poco probable, dicho como estimación y no como medida: preview corre **el mismo código**
que producción, y los escritores de este libro son los mismos cinco; una incoherencia
categoría↔tipo solo podría venir de un defecto que en producción no se ha materializado ni una vez
en 35 filas.

**El humano ya aceptó este riesgo a sabiendas en la 172**, con el dato de que preview y producción
son bases de prueba con datos desechables hasta que la app esté terminada. Si esta vez prefiere no
correrlo, la salida está en `design.md §13.1`.

## Qué desbloquea

`T A.2` puede escribirse ya: `ADD CONSTRAINT` directo sobre `wallet_movimiento`, más su
`DROP CONSTRAINT IF EXISTS` **al principio** del `down.sql` de
`db/migrations/20260803120000_caja_tesoreria/`, antes de los `DROP INDEX` (encargo dejado por el
`backend_dev` de la Tanda A).
