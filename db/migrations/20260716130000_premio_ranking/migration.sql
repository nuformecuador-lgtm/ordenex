-- Feature 76 (R8/R21, design §4.3): tabla NUEVA `premio_ranking` — CONFIGURACION que el
-- maestro administra (edita el monto de cada posicion del podio). Exactamente 3 posiciones
-- (1, 2, 3): `UNIQUE(posicion)` + `CHECK (posicion BETWEEN 1 AND 3)` garantizan R8. `monto`
-- NULLABLE = "sin premio asignado" (R9): NUNCA es cero ni error. Monto-only (sin `etiqueta`).
-- El ganador NO se guarda: el ocupante del podio se calcula on-read (R14/R15).
-- Migracion ADITIVA (R21): no altera tablas existentes. Se siembran las 3 filas (monto NULL).
-- Patron `gasto_fijo_plantilla` / `wallet_movimiento`: tabla + RLS habilitada sin policies
-- (solo service role; la autorizacion de negocio vive en el service, R16/R19).

CREATE TABLE "premio_ranking" (
  "id" TEXT NOT NULL,
  "posicion" INTEGER NOT NULL,
  "monto" DECIMAL(12,2),
  -- Cambio de alcance (2026-07-16): rotulo libre opcional por posicion, INDEPENDIENTE del
  -- monto (NULLABLE = sin descripcion). Una posicion puede tener descripcion sin monto y
  -- viceversa. Va en el CREATE (la tabla es nueva), no en un ALTER.
  "descripcion" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "premio_ranking_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "premio_ranking_posicion_check" CHECK ("posicion" BETWEEN 1 AND 3)
);

-- R8: exactamente una fila por posicion (1,2,3).
CREATE UNIQUE INDEX "premio_ranking_posicion_key" ON "premio_ranking"("posicion");

-- Semilla: las 3 posiciones del podio, monto NULL = sin premio asignado (R9). El maestro
-- las edita on-read. `md5(random()...)` genera un id de texto sin depender de extensiones.
INSERT INTO "premio_ranking" ("id", "posicion", "monto") VALUES
  (md5(random()::text || clock_timestamp()::text), 1, NULL),
  (md5(random()::text || clock_timestamp()::text), 2, NULL),
  (md5(random()::text || clock_timestamp()::text), 3, NULL);

-- R21: RLS habilitada sin policies (solo service role), patron gasto_fijo_plantilla /
-- wallet_movimiento. La autorizacion de quien edita vive en el service (R16/R19).
ALTER TABLE "premio_ranking" ENABLE ROW LEVEL SECURITY;
