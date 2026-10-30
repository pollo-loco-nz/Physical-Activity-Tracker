-- Opt-in "Māori Mode": takes 30 kg off weight in the BMI calculation.
ALTER TABLE users ADD COLUMN maori_mode INTEGER NOT NULL DEFAULT 0;
