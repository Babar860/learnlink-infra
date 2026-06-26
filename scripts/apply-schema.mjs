import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(repoRoot, "..");

async function loadEnvFile(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex < 1) continue;
      const key = trimmed.slice(0, separatorIndex).trim();
      let value = trimmed.slice(separatorIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] ??= value;
    }
  } catch {
    // Optional; hosted environments usually inject variables directly.
  }
}

await loadEnvFile(path.join(workspaceRoot, ".env"));
await loadEnvFile(path.join(repoRoot, ".env"));

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to apply the LearnLink schema.");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  const schema = await fs.readFile(path.join(repoRoot, "postgres", "schema.sql"), "utf8");
  const seed = await fs.readFile(path.join(repoRoot, "postgres", "seed.sql"), "utf8");
  await pool.query(schema);
  await pool.query(seed);
  console.log("LearnLink PostgreSQL schema and seed data applied.");
} finally {
  await pool.end();
}
