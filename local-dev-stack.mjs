import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "..");
const dataFile = path.join(__dirname, "local-dev-data.json");

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
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // Local env files are optional; CI and hosted services can inject variables directly.
  }
}

await loadEnvFile(path.join(workspaceRoot, ".env"));
await loadEnvFile(path.join(__dirname, ".env"));

process.env.MUX_TOKEN_ID ??= process.env.MUX_Token_Id;
process.env.MUX_TOKEN_SECRET ??= process.env.MUX_Secret_Key;

const hashPassword = (password) => createHash("sha256").update(String(password)).digest("hex");
const publicUser = (user) => {
  if (!user) return user;
  const { password_hash: _passwordHash, ...safeUser } = user;
  return safeUser;
};

const adminSeed = {
  email: (process.env.ADMIN_EMAIL || "admin@learnlink.local").toLowerCase(),
  name: process.env.ADMIN_NAME || "LearnLink Admin",
  roles: ["admin"],
  password_hash: hashPassword(process.env.ADMIN_PASSWORD || "learnlink_admin_123")
};

const seedData = {
  users: [
    {
      id: "local-admin",
      ...adminSeed,
      created_at: new Date().toISOString()
    }
  ],
  sessions: [],
  posts: [
    {
      id: "local-post-1",
      author_id: "system",
      author: "Local Backend",
      source: "Community API",
      status: "approved",
      content: "This post is persisted by the LearnLink local API layer.",
      metrics: "Served through gateway on localhost:4000",
      ai_moderation_status: "approved",
      post_type: "platform_post",
      created_at: new Date().toISOString()
    }
  ],
  courses: [
    { id: "course-ai-foundations", title: "AI Career Foundations", description: "Recommended from onboarding answers.", category: "ai-and-data", is_paid: false },
    { id: "course-live-data", title: "Live Class: Data Skills", description: "Organization and grade filters supported.", category: "live-class", is_paid: false },
    { id: "course-premium-roadmap", title: "Premium Roadmap", description: "Unlocks roadmap plus 15 matching jobs.", category: "premium", is_paid: true }
  ],
  jobs: [
    { id: "job-data-analyst", title: "Junior Data Analyst", company: "LearnLink Demo", location: "Karachi", category: "data", is_active: true },
    { id: "job-frontend-intern", title: "Frontend Intern", company: "Remote Studio", location: "Remote", category: "engineering", is_active: true },
    { id: "job-product-associate", title: "Product Associate", company: "Growth Lab", location: "Hybrid", category: "product", is_active: true }
  ],
  communities: [
    { id: "community-ai-data", name: "AI and Data Community", description: "Public discussion space.", subscriber_count: 128 },
    { id: "community-career-switchers", name: "Career Switchers", description: "AI-moderated posts from subscribed members.", subscriber_count: 91 },
    { id: "community-help-desk", name: "Student Help Desk", description: "Ask questions and follow updates.", subscriber_count: 213 }
  ],
  channels: [
    { id: "channel-product-careers", name: "Product Careers Channel", description: "Free creator channel.", is_paid: false, price_monthly: 0 },
    { id: "channel-data-mentorship", name: "Premium Data Mentorship", description: "Paid private channel via Stripe.", is_paid: true, price_monthly: 2500 },
    { id: "channel-teacher-materials", name: "Teacher Materials", description: "Async course-linked channel.", is_paid: false, price_monthly: 0 }
  ],
  agent_logs: [
    { id: "agent-log-1", agent_name: "content-moderation-agent", trigger: "local_seed", status: "ok", created_at: new Date().toISOString() }
  ],
  feature_flags: {
    FF_SELF_HOST_VIDEO: true,
    FF_PREMIUM_KEY_POINTS: true,
    FF_LIVE_QUIZ_GRADING: true,
    FF_CHANNEL_CREATION_AUTO: true
  }
};

let pgPool = null;
let data = null;

async function loadPgPool() {
  if (!process.env.DATABASE_URL) return null;
  try {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query("select 1");
    console.log("PostgreSQL persistence enabled from DATABASE_URL");
    return pool;
  } catch (error) {
    console.warn(`PostgreSQL unavailable; using local JSON persistence. ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

async function loadJsonData() {
  try {
    return JSON.parse(await fs.readFile(dataFile, "utf8"));
  } catch {
    await fs.writeFile(dataFile, JSON.stringify(seedData, null, 2));
    return structuredClone(seedData);
  }
}

async function saveJsonData() {
  if (!pgPool) {
    await fs.writeFile(dataFile, JSON.stringify(data, null, 2));
  }
}

async function initStorage() {
  pgPool = await loadPgPool();
  data = pgPool ? structuredClone(seedData) : await loadJsonData();
  await ensureAdminUser();
}

const json = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "content-length": Buffer.byteLength(payload)
  });
  res.end(payload);
};

const readJson = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

async function getUserBySession(token) {
  if (!token) return undefined;
  if (pgPool) {
    const result = await pgPool.query(
      "select u.* from auth_sessions s join users u on u.id = s.user_id where s.token = $1 and s.expires_at > now()",
      [token]
    );
    return result.rows[0];
  }
  const session = data.sessions.find((item) => item.token === token && new Date(item.expires_at) > new Date());
  return session ? data.users.find((user) => user.id === session.user_id) : undefined;
}

async function getUserByEmail(email) {
  if (pgPool) {
    const result = await pgPool.query("select id, email, name, roles, password_hash, created_at from users where lower(email) = lower($1)", [email]);
    return result.rows[0];
  }
  return data.users.find((user) => user.email.toLowerCase() === email.toLowerCase());
}

async function requireAuth(req, res) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const user = await getUserBySession(token);
  if (!user) {
    json(res, 401, { error: "authentication_required" });
    return undefined;
  }
  return user;
}

async function upsertUser({ email, name, roles, password }) {
  const passwordHash = password ? hashPassword(password) : null;
  if (pgPool) {
    const result = await pgPool.query(
      `insert into users (email, name, roles, password_hash)
       values ($1, $2, $3, $4)
       on conflict (email) do update
       set name = excluded.name,
           roles = excluded.roles,
           password_hash = coalesce(excluded.password_hash, users.password_hash)
       returning id, email, name, roles, created_at`,
      [email, name, roles, passwordHash]
    );
    return result.rows[0];
  }

  const existing = data.users.find((user) => user.email === email);
  if (existing) {
    existing.name = name || existing.name;
    existing.roles = roles;
    if (passwordHash) existing.password_hash = passwordHash;
    await saveJsonData();
    return existing;
  }

  const user = { id: crypto.randomUUID(), email, name, roles, password_hash: passwordHash, created_at: new Date().toISOString() };
  data.users.push(user);
  await saveJsonData();
  return user;
}

async function ensureAdminUser() {
  if (pgPool) {
    await pgPool.query(
      `insert into users (email, name, roles, password_hash)
       values ($1, $2, $3, $4)
       on conflict (email) do update
       set name = excluded.name,
           roles = excluded.roles,
           password_hash = excluded.password_hash`,
      [adminSeed.email, adminSeed.name, adminSeed.roles, adminSeed.password_hash]
    );
    return;
  }

  const existing = data.users.find((user) => user.email.toLowerCase() === adminSeed.email);
  if (existing) {
    existing.name = adminSeed.name;
    existing.roles = adminSeed.roles;
    existing.password_hash = adminSeed.password_hash;
  } else {
    data.users.push({ id: "local-admin", ...adminSeed, created_at: new Date().toISOString() });
  }
  await saveJsonData();
}

async function createSession(user) {
  const token = `local-token-${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  if (pgPool) {
    await pgPool.query("insert into auth_sessions (token, user_id, expires_at) values ($1, $2, $3)", [token, user.id, expiresAt]);
  } else {
    data.sessions.push({ token, user_id: user.id, expires_at: expiresAt });
    await saveJsonData();
  }
  return token;
}

async function listPosts() {
  if (pgPool) {
    const result = await pgPool.query(
      `select p.id, p.content, p.post_type, p.ai_moderation_status, p.created_at,
              coalesce(u.name, 'LearnLink user') as author,
              p.post_type as source,
              'Persisted in PostgreSQL' as metrics
       from posts p
       left join users u on u.id = p.author_id
       where p.ai_moderation_status = 'approved'
       order by p.created_at desc
       limit 50`
    );
    return result.rows.map((post) => ({ ...post, status: post.ai_moderation_status }));
  }
  return data.posts;
}

async function createPost(user, body) {
  const content = String(body.content ?? "").trim();
  if (!content) return undefined;

  if (pgPool) {
    const result = await pgPool.query(
      `insert into posts (content, author_id, post_type, ai_moderation_status, ai_moderation_reason, ai_moderation_checked_at, published_at)
       values ($1, $2, $3, 'approved', 'Local development moderation approved.', now(), now())
       returning id, content, post_type, ai_moderation_status, created_at`,
      [content, user.id, body.post_type ?? "platform_post"]
    );
    const post = result.rows[0];
    return {
      ...post,
      author: user.name,
      source: post.post_type,
      status: post.ai_moderation_status,
      metrics: "Persisted in PostgreSQL"
    };
  }

  const post = {
    id: crypto.randomUUID(),
    author_id: user.id,
    author: user.name,
    source: body.post_type ?? "platform_post",
    status: "approved",
    content,
    metrics: "Persisted in local storage",
    ai_moderation_status: "approved",
    post_type: body.post_type ?? "platform_post",
    created_at: new Date().toISOString()
  };
  data.posts.unshift(post);
  await saveJsonData();
  return post;
}

async function listTable(tableName, fallbackKey) {
  if (pgPool) {
    const result = await pgPool.query(`select * from ${tableName} order by created_at desc nulls last limit 50`);
    return result.rows;
  }
  return data[fallbackKey];
}

async function listAdminLogs() {
  if (pgPool) {
    const moderation = await pgPool.query("select id, content, ai_moderation_status, ai_moderation_reason, created_at from posts order by created_at desc limit 50");
    const agents = await pgPool.query("select * from agent_execution_logs order by created_at desc limit 50");
    return { moderation_log: moderation.rows, agent_logs: agents.rows };
  }
  return { moderation_log: data.posts, agent_logs: data.agent_logs };
}

function createServer(port, serviceName, handler) {
  const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type,authorization"
      });
      res.end();
      return;
    }

    try {
      if (req.url === "/health") {
        json(res, 200, {
          ok: true,
          service: serviceName,
          persistence: pgPool ? "postgresql" : "local-json",
          integrations: integrationStatus()
        });
        return;
      }

      await handler(req, res);
    } catch (error) {
      json(res, 500, { error: "local_stack_error", message: error instanceof Error ? error.message : String(error) });
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`${serviceName} listening on http://127.0.0.1:${port}`);
  });
}

const handleAuth = async (req, res) => {
  if (req.method === "POST" && req.url === "/auth/signup") {
    const body = await readJson(req);
    const email = String(body.email ?? "").trim().toLowerCase();
    const name = String(body.name ?? email.split("@")[0] ?? "Local user").trim();
    const password = String(body.password ?? "");
    const roles = body.roles?.length ? body.roles : ["student"];

    if (!email || !name || password.length < 8) {
      json(res, 400, { error: "name_email_and_8_char_password_required" });
      return true;
    }

    const user = await upsertUser({ email, name, roles, password });
    const token = await createSession(user);
    json(res, 201, { user: publicUser(user), token });
    return true;
  }

  if (req.method === "POST" && req.url === "/auth/login") {
    const body = await readJson(req);
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const user = email ? await getUserByEmail(email) : undefined;

    if (!user || user.password_hash !== hashPassword(password)) {
      json(res, 401, { error: "invalid_email_or_password" });
      return true;
    }

    const token = await createSession(user);
    json(res, 200, { user: publicUser(user), token });
    return true;
  }

  if (req.method === "GET" && req.url === "/auth/me") {
    const user = await requireAuth(req, res);
    if (!user) return true;
    json(res, 200, { user: publicUser(user) });
    return true;
  }

  return false;
};

function integrationStatus() {
  return {
    database: pgPool ? "postgresql" : "local-json",
    gemini: Boolean(process.env.GEMINI_API_KEY),
    smtp: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD),
    mux: Boolean(process.env.MUX_TOKEN_ID && process.env.MUX_TOKEN_SECRET),
    firebase: Boolean(process.env.FIREBASE_PROJECT_ID || process.env.FIREBASE_WEB_PUSH_KEY),
    googleCloudProject: process.env.GOOGLE_CLOUD_PROJECT || null
  };
}

await initStorage();

createServer(4100, "learnlink-service-community", async (req, res) => {
  if (req.method === "GET" && req.url?.startsWith("/feed/")) {
    const user = await requireAuth(req, res);
    if (!user) return;
    json(res, 200, { posts: await listPosts() });
    return;
  }

  if (req.method === "GET" && req.url === "/communities") {
    const user = await requireAuth(req, res);
    if (!user) return;
    json(res, 200, { communities: await listTable("communities", "communities") });
    return;
  }

  if (req.method === "GET" && req.url === "/channels") {
    const user = await requireAuth(req, res);
    if (!user) return;
    json(res, 200, { channels: await listTable("channels", "channels") });
    return;
  }

  if (req.method === "POST" && req.url === "/posts") {
    const user = await requireAuth(req, res);
    if (!user) return;
    const post = await createPost(user, await readJson(req));
    json(res, post ? 202 : 400, post ? { post, notification: "local FCM placeholder" } : { error: "content_required" });
    return;
  }

  json(res, 404, { error: "not_found" });
});

createServer(4200, "learnlink-service-courses", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  json(res, 200, { courses: await listTable("courses", "courses") });
});

createServer(4300, "learnlink-service-jobs", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  json(res, 200, { jobs: await listTable("jobs", "jobs") });
});

createServer(4000, "learnlink-backend-gateway", async (req, res) => {
  if (await handleAuth(req, res)) return;

  if (req.method === "GET" && req.url?.startsWith("/community/feed/")) {
    const user = await requireAuth(req, res);
    if (!user) return;
    json(res, 200, { posts: await listPosts() });
    return;
  }

  if (req.method === "POST" && req.url === "/community/posts") {
    const user = await requireAuth(req, res);
    if (!user) return;
    const post = await createPost(user, await readJson(req));
    json(res, post ? 202 : 400, post ? { post } : { error: "content_required" });
    return;
  }

  if (req.method === "GET" && req.url === "/community/communities") {
    const user = await requireAuth(req, res);
    if (!user) return;
    json(res, 200, { communities: await listTable("communities", "communities") });
    return;
  }

  if (req.method === "GET" && req.url === "/community/channels") {
    const user = await requireAuth(req, res);
    if (!user) return;
    json(res, 200, { channels: await listTable("channels", "channels") });
    return;
  }

  if (req.method === "GET" && req.url?.startsWith("/courses")) {
    const user = await requireAuth(req, res);
    if (!user) return;
    json(res, 200, { courses: await listTable("courses", "courses") });
    return;
  }

  if (req.method === "GET" && req.url?.startsWith("/jobs")) {
    const user = await requireAuth(req, res);
    if (!user) return;
    json(res, 200, { jobs: await listTable("jobs", "jobs") });
    return;
  }

  if (req.method === "GET" && req.url === "/admin/overview") {
    const user = await requireAuth(req, res);
    if (!user) return;
    if (!user.roles?.includes("admin")) {
      json(res, 403, { error: "admin_required" });
      return;
    }
    json(res, 200, {
      ...(await listAdminLogs()),
      feature_flags: data.feature_flags,
      persistence: pgPool ? "postgresql" : "local-json",
      integrations: integrationStatus()
    });
    return;
  }

  json(res, 404, { error: "not_found" });
});
