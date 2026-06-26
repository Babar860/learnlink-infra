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
      source: "Platform update",
      status: "approved",
      content: "This post is persisted by the LearnLink local API layer.",
      media_url: [],
      ai_moderation_status: "approved",
      post_type: "platform_post",
      ai_moderation_reason: "Seed post approved by the local moderation agent.",
      created_at: new Date().toISOString()
    }
  ],
  post_likes: [],
  post_comments: [],
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
    { id: "community-ai-data", name: "AI and Data Community", description: "Public discussion space.", subscriber_count: 128, allows_public_posts: true, owner_id: "local-admin" },
    { id: "community-career-switchers", name: "Career Switchers", description: "AI-moderated posts from subscribed members.", subscriber_count: 91, allows_public_posts: true, owner_id: "local-admin" },
    { id: "community-help-desk", name: "Student Help Desk", description: "Owner-curated questions and updates.", subscriber_count: 213, allows_public_posts: false, owner_id: "local-admin" }
  ],
  channels: [
    { id: "channel-product-careers", name: "Product Careers Channel", description: "Free creator channel.", is_paid: false, price_monthly: 0, owner_id: "local-admin" },
    { id: "channel-data-mentorship", name: "Premium Data Mentorship", description: "Paid private channel via Stripe.", is_paid: true, price_monthly: 2500, owner_id: "local-admin" },
    { id: "channel-teacher-materials", name: "Teacher Materials", description: "Async course-linked channel.", is_paid: false, price_monthly: 0, owner_id: "local-admin" }
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
  if (pgPool) await ensureRuntimeSchema();
  data = pgPool ? structuredClone(seedData) : await loadJsonData();
  data.post_likes ??= [];
  data.post_comments ??= [];
  await ensureAdminUser();
}

async function ensureRuntimeSchema() {
  await pgPool.query("alter table communities add column if not exists allows_public_posts boolean not null default false");
  await pgPool.query(`
    create table if not exists post_likes (
      post_id uuid not null references posts(id) on delete cascade,
      user_id uuid not null references users(id) on delete cascade,
      created_at timestamptz not null default now(),
      primary key (post_id, user_id)
    )`);
  await pgPool.query(`
    create table if not exists post_comments (
      id uuid primary key default uuid_generate_v4(),
      post_id uuid not null references posts(id) on delete cascade,
      user_id uuid not null references users(id) on delete cascade,
      content text not null,
      created_at timestamptz not null default now()
    )`);
  await pgPool.query("update communities set allows_public_posts = true where name in ('AI and Data Community', 'Career Switchers')");
  await pgPool.query("update communities set allows_public_posts = false where name = 'Student Help Desk'");
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

const requestUrl = (req) => new URL(req.url ?? "/", "http://localhost");

function normalizePostType(value) {
  return ["community_post", "channel_post", "platform_post"].includes(value) ? value : "platform_post";
}

function postTypeLabel(postType) {
  if (postType === "community_post") return "Community post";
  if (postType === "channel_post") return "Channel post";
  return "Platform post";
}

function moderatePost(content) {
  const text = content.toLowerCase();
  const rejectedPatterns = [
    { pattern: "spam", reason: "Rejected because the post looks like spam or repeated promotional content." },
    { pattern: "scam", reason: "Rejected because the post appears to promote a scam or unsafe opportunity." },
    { pattern: "hate", reason: "Rejected because the post may contain hateful or abusive language." },
    { pattern: "violence", reason: "Rejected because the post may encourage violence or harm." }
  ];
  const rejected = rejectedPatterns.find((item) => text.includes(item.pattern));
  if (rejected) {
    return { status: "rejected", reason: rejected.reason, publishedAt: null };
  }
  if (text.includes("needs review") || text.includes("pending review")) {
    return {
      status: "pending",
      reason: "Queued for a deeper agent review because the post requested manual-style review.",
      publishedAt: null
    };
  }
  return { status: "approved", reason: "Approved by the local AI moderation agent.", publishedAt: new Date().toISOString() };
}

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

function enrichJsonPost(post, user) {
  const comments = (data.post_comments || [])
    .filter((comment) => comment.post_id === post.id)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .map((comment) => ({
      ...comment,
      author: data.users.find((item) => item.id === comment.user_id)?.name || "LearnLink user"
    }));
  return {
    ...post,
    source: post.source || postTypeLabel(post.post_type),
    status: post.ai_moderation_status,
    like_count: (data.post_likes || []).filter((like) => like.post_id === post.id).length,
    comment_count: comments.length,
    liked_by_me: Boolean(user && (data.post_likes || []).find((like) => like.post_id === post.id && like.user_id === user.id)),
    comments: comments.slice(-10)
  };
}

async function listPosts(user) {
  if (pgPool) {
    const result = await pgPool.query(
      `select p.id, p.author_id::text, p.content, p.media_url, p.post_type, p.ai_moderation_status, p.ai_moderation_reason, p.created_at,
              coalesce(u.name, 'LearnLink user') as author,
              p.post_type as source,
              count(distinct pl.user_id)::int as like_count,
              count(distinct pc.id)::int as comment_count,
              bool_or(pl.user_id = $1) as liked_by_me
       from posts p
       left join users u on u.id = p.author_id
       left join post_likes pl on pl.post_id = p.id
       left join post_comments pc on pc.post_id = p.id
       where p.ai_moderation_status = 'approved'
       group by p.id, u.name
       order by p.created_at desc
       limit 50`,
      [user.id]
    );
    return hydratePostComments(result.rows.map((post) => ({ ...post, status: post.ai_moderation_status, source: postTypeLabel(post.post_type), liked_by_me: Boolean(post.liked_by_me) })));
  }
  return data.posts.filter((post) => post.ai_moderation_status === "approved").map((post) => enrichJsonPost(post, user));
}

async function listMyPosts(user) {
  if (pgPool) {
    const result = await pgPool.query(
      `select p.id, p.author_id::text, p.content, p.media_url, p.post_type, p.parent_id, p.ai_moderation_status, p.ai_moderation_reason, p.created_at,
              coalesce(u.name, 'LearnLink user') as author,
              p.post_type as source,
              count(distinct pl.user_id)::int as like_count,
              count(distinct pc.id)::int as comment_count,
              bool_or(pl.user_id = $1) as liked_by_me
       from posts p
       left join users u on u.id = p.author_id
       left join post_likes pl on pl.post_id = p.id
       left join post_comments pc on pc.post_id = p.id
       where p.author_id = $1
       group by p.id, u.name
       order by p.created_at desc
       limit 100`,
      [user.id]
    );
    return hydratePostComments(result.rows.map((post) => ({ ...post, status: post.ai_moderation_status, source: postTypeLabel(post.post_type), liked_by_me: Boolean(post.liked_by_me) })));
  }
  return data.posts
    .filter((post) => post.author_id === user.id)
    .map((post) => enrichJsonPost(post, user));
}

async function hydratePostComments(posts) {
  if (!posts.length) return posts;
  const ids = posts.map((post) => post.id);
  const result = await pgPool.query(
    `select pc.id::text, pc.post_id::text, pc.content, pc.created_at, coalesce(u.name, 'LearnLink user') as author
     from post_comments pc
     left join users u on u.id = pc.user_id
     where pc.post_id = any($1::uuid[])
     order by pc.created_at asc`,
    [ids]
  );
  return posts.map((post) => {
    const comments = result.rows.filter((comment) => comment.post_id === String(post.id)).slice(-10);
    return { ...post, comments };
  });
}

async function togglePostLike(user, postId) {
  const existingPost = await getPostByIdForUser(postId, user);
  if (!existingPost) return undefined;
  if (pgPool) {
    const deleted = await pgPool.query("delete from post_likes where post_id = $1 and user_id = $2 returning post_id", [postId, user.id]);
    if (!deleted.rowCount) {
      await pgPool.query("insert into post_likes (post_id, user_id) values ($1, $2) on conflict do nothing", [postId, user.id]);
    }
    return getPostByIdForUser(postId, user);
  }
  const index = data.post_likes.findIndex((like) => like.post_id === postId && like.user_id === user.id);
  if (index >= 0) {
    data.post_likes.splice(index, 1);
  } else {
    data.post_likes.push({ post_id: postId, user_id: user.id, created_at: new Date().toISOString() });
  }
  await saveJsonData();
  return getPostByIdForUser(postId, user);
}

async function addPostComment(user, postId, body) {
  const content = String(body.content ?? "").trim();
  if (!content) return { error: "comment_required", message: "Comment cannot be empty." };
  const existingPost = await getPostByIdForUser(postId, user);
  if (!existingPost) return { error: "post_not_found", message: "Post was not found." };
  if (pgPool) {
    await pgPool.query("insert into post_comments (post_id, user_id, content) values ($1, $2, $3)", [postId, user.id, content]);
    return { post: await getPostByIdForUser(postId, user) };
  }
  data.post_comments.push({ id: crypto.randomUUID(), post_id: postId, user_id: user.id, content, created_at: new Date().toISOString() });
  await saveJsonData();
  return { post: await getPostByIdForUser(postId, user) };
}

async function editApprovedPost(user, postId, body) {
  const content = String(body.content ?? "").trim();
  const mediaUrls = Array.isArray(body.media_urls) ? body.media_urls.map((item) => String(item).trim()).filter(Boolean) : [];
  if (!content) return { error: "content_required", message: "Post content is required." };
  const moderation = moderatePost(content);
  if (pgPool) {
    const result = await pgPool.query(
      `update posts
       set content = $3,
           media_url = $4,
           ai_moderation_status = $5,
           ai_moderation_reason = $6,
           ai_moderation_checked_at = now(),
           published_at = case when $5 = 'approved' then coalesce(published_at, now()) else null end
       where id = $1 and author_id = $2 and ai_moderation_status = 'approved'
       returning id`,
      [postId, user.id, content, mediaUrls, moderation.status, moderation.reason]
    );
    if (!result.rowCount) return undefined;
    return getPostByIdForUser(postId, user);
  }
  const post = data.posts.find((item) => item.id === postId && item.author_id === user.id && item.ai_moderation_status === "approved");
  if (!post) return undefined;
  post.content = content;
  post.media_url = mediaUrls;
  post.ai_moderation_status = moderation.status;
  post.status = moderation.status;
  post.ai_moderation_reason = moderation.reason;
  post.ai_moderation_checked_at = new Date().toISOString();
  post.published_at = moderation.status === "approved" ? (post.published_at || new Date().toISOString()) : null;
  await saveJsonData();
  return getPostByIdForUser(postId, user);
}

async function getPostByIdForUser(postId, user) {
  if (pgPool) {
    const result = await pgPool.query(
      `select p.id, p.author_id::text, p.content, p.media_url, p.post_type, p.parent_id, p.ai_moderation_status, p.ai_moderation_reason, p.created_at,
              coalesce(u.name, 'LearnLink user') as author,
              count(distinct pl.user_id)::int as like_count,
              count(distinct pc.id)::int as comment_count,
              bool_or(pl.user_id = $2) as liked_by_me
       from posts p
       left join users u on u.id = p.author_id
       left join post_likes pl on pl.post_id = p.id
       left join post_comments pc on pc.post_id = p.id
       where p.id = $1
       group by p.id, u.name`,
      [postId, user.id]
    );
    const posts = result.rows.map((post) => ({ ...post, status: post.ai_moderation_status, source: postTypeLabel(post.post_type), liked_by_me: Boolean(post.liked_by_me) }));
    return (await hydratePostComments(posts))[0];
  }
  const post = data.posts.find((item) => item.id === postId);
  return post ? enrichJsonPost(post, user) : undefined;
}

async function createPost(user, body) {
  const content = String(body.content ?? "").trim();
  if (!content) return undefined;
  const postType = normalizePostType(body.post_type);
  const mediaUrls = Array.isArray(body.media_urls) ? body.media_urls.map((item) => String(item).trim()).filter(Boolean) : [];
  const targetId = String(body.target_id ?? "").trim();
  const target = await resolvePostTarget(user, postType, targetId);
  if (target.error) return { error: target.error, message: target.message };
  const moderation = moderatePost(content);
  const finalModeration = applyTargetApprovalRule(user, postType, target.record, moderation);

  if (pgPool) {
    const result = await pgPool.query(
      `insert into posts (content, media_url, author_id, post_type, parent_id, ai_moderation_status, ai_moderation_reason, ai_moderation_checked_at, published_at)
       values ($1, $2, $3, $4, $5, $6, $7, now(), $8)
       returning id, content, media_url, post_type, parent_id, ai_moderation_status, ai_moderation_reason, created_at`,
      [content, mediaUrls, user.id, postType, target.record?.id ?? null, finalModeration.status, finalModeration.reason, finalModeration.publishedAt]
    );
    const post = result.rows[0];
    return {
      ...post,
      author: user.name,
      source: postTypeLabel(post.post_type),
      status: post.ai_moderation_status,
      like_count: 0,
      comment_count: 0,
      liked_by_me: false,
      comments: []
    };
  }

  const post = {
    id: crypto.randomUUID(),
    author_id: user.id,
    author: user.name,
    source: postTypeLabel(postType),
    status: finalModeration.status,
    content,
    media_url: mediaUrls,
    parent_id: target.record?.id,
    ai_moderation_status: finalModeration.status,
    ai_moderation_reason: finalModeration.reason,
    post_type: postType,
    created_at: new Date().toISOString()
  };
  data.posts.unshift(post);
  await saveJsonData();
  return enrichJsonPost(post, user);
}

function applyTargetApprovalRule(user, postType, target, moderation) {
  if (moderation.status !== "approved") return moderation;
  if (postType === "community_post" && target?.owner_id && target.owner_id !== user.id) {
    return {
      status: "pending",
      reason: "AI approved this community post. The community owner has been notified for final approval.",
      publishedAt: null
    };
  }
  return moderation;
}

async function resolvePostTarget(user, postType, targetId) {
  if (postType === "platform_post") return { record: null };
  if (!targetId) {
    return {
      error: postType === "channel_post" ? "channel_required" : "community_required",
      message: postType === "channel_post" ? "Create or select one of your channels before posting." : "Select a public-posting community before posting."
    };
  }
  if (postType === "channel_post") {
    const channel = await getChannelById(targetId);
    if (!channel) return { error: "channel_not_found", message: "Selected channel was not found." };
    if (channel.owner_id !== user.id) return { error: "channel_owner_required", message: "Only the channel owner can create channel posts." };
    return { record: channel };
  }
  const community = await getCommunityById(targetId);
  if (!community) return { error: "community_not_found", message: "Selected community was not found." };
  if (community.allows_public_posts === false) return { error: "community_posting_closed", message: "This community owner has not allowed everyone to post." };
  return { record: community };
}

async function getChannelById(id) {
  if (pgPool) {
    const result = await pgPool.query("select id::text, name, description, owner_id::text, is_paid, price_monthly from channels where id = $1", [id]);
    return result.rows[0];
  }
  return data.channels.find((channel) => channel.id === id);
}

async function getCommunityById(id) {
  if (pgPool) {
    const result = await pgPool.query("select id::text, name, description, owner_id::text, allows_public_posts, subscriber_count from communities where id = $1", [id]);
    return result.rows[0];
  }
  return data.communities.find((community) => community.id === id);
}

async function listMyChannels(user) {
  if (pgPool) {
    const result = await pgPool.query("select id::text, name, description, owner_id::text, is_paid, price_monthly, created_at from channels where owner_id = $1 order by created_at desc", [user.id]);
    return result.rows;
  }
  return data.channels.filter((channel) => channel.owner_id === user.id);
}

async function createChannel(user, body) {
  const name = String(body.name ?? "").trim();
  const description = String(body.description ?? "").trim() || "Creator channel";
  if (!name) return { error: "channel_name_required", message: "Channel name is required." };
  if (pgPool) {
    const result = await pgPool.query(
      `insert into channels (name, description, owner_id, is_paid, price_monthly)
       values ($1, $2, $3, $4, $5)
       returning id::text, name, description, owner_id::text, is_paid, price_monthly, created_at`,
      [name, description, user.id, Boolean(body.is_paid), Number(body.price_monthly || 0)]
    );
    return { channel: result.rows[0] };
  }
  const channel = { id: crypto.randomUUID(), name, description, owner_id: user.id, is_paid: Boolean(body.is_paid), price_monthly: Number(body.price_monthly || 0), created_at: new Date().toISOString() };
  data.channels.unshift(channel);
  await saveJsonData();
  return { channel };
}

async function searchPostableCommunities(query) {
  const term = String(query ?? "").trim().toLowerCase();
  if (pgPool) {
    const result = await pgPool.query(
      `select id::text, name, description, owner_id::text, allows_public_posts, subscriber_count
       from communities
       where allows_public_posts = true and ($1 = '' or lower(name) like '%' || $1 || '%' or lower(description) like '%' || $1 || '%')
       order by subscriber_count desc, name asc
       limit 25`,
      [term]
    );
    return result.rows;
  }
  return data.communities
    .filter((community) => community.allows_public_posts !== false)
    .filter((community) => !term || `${community.name} ${community.description}`.toLowerCase().includes(term));
}

async function createCommunity(user, body) {
  const name = String(body.name ?? "").trim();
  const description = String(body.description ?? "").trim() || "Community space";
  const allowsPublicPosts = Boolean(body.allows_public_posts);
  if (!name) return { error: "community_name_required", message: "Community name is required." };
  if (pgPool) {
    const result = await pgPool.query(
      `insert into communities (name, description, owner_id, is_public, allows_public_posts, subscriber_count)
       values ($1, $2, $3, true, $4, 0)
       returning id::text, name, description, owner_id::text, allows_public_posts, subscriber_count, created_at`,
      [name, description, user.id, allowsPublicPosts]
    );
    return { community: result.rows[0] };
  }
  const community = { id: crypto.randomUUID(), name, description, owner_id: user.id, allows_public_posts: allowsPublicPosts, subscriber_count: 0, created_at: new Date().toISOString() };
  data.communities.unshift(community);
  await saveJsonData();
  return { community };
}

async function approveOwnedCommunityPost(user, postId) {
  if (pgPool) {
    const result = await pgPool.query(
      `update posts p
       set ai_moderation_status = 'approved',
           ai_moderation_reason = 'Approved by the community owner after AI analysis.',
           published_at = now()
       from communities c
       where p.id = $1 and p.parent_id = c.id and c.owner_id = $2 and p.post_type = 'community_post'
       returning p.id, p.ai_moderation_status, p.ai_moderation_reason`,
      [postId, user.id]
    );
    return result.rows[0];
  }
  const post = data.posts.find((item) => item.id === postId);
  const community = post ? data.communities.find((item) => item.id === post.parent_id) : undefined;
  if (!post || !community || community.owner_id !== user.id) return undefined;
  post.ai_moderation_status = "approved";
  post.status = "approved";
  post.ai_moderation_reason = "Approved by the community owner after AI analysis.";
  await saveJsonData();
  return post;
}

async function listOwnerReviewPosts(user) {
  if (pgPool) {
    const result = await pgPool.query(
      `select p.id, p.content, p.media_url, p.post_type, p.parent_id, p.ai_moderation_status, p.ai_moderation_reason, p.created_at,
              coalesce(author.name, 'LearnLink user') as author,
              c.name as community_name
       from posts p
       join communities c on c.id = p.parent_id
       left join users author on author.id = p.author_id
       where c.owner_id = $1 and p.post_type = 'community_post' and p.ai_moderation_status = 'pending'
       order by p.created_at desc
       limit 100`,
      [user.id]
    );
    return result.rows.map((post) => ({ ...post, status: post.ai_moderation_status, source: `Community: ${post.community_name}` }));
  }
  return data.posts
    .filter((post) => post.post_type === "community_post" && post.ai_moderation_status === "pending")
    .filter((post) => data.communities.find((community) => community.id === post.parent_id && community.owner_id === user.id))
    .map((post) => ({ ...post, source: post.source || postTypeLabel(post.post_type) }));
}

async function searchPlatform(query, user) {
  const term = String(query ?? "").trim().toLowerCase();
  if (!term) {
    return { posts: await listPosts(user), courses: await listTable("courses", "courses"), jobs: await listTable("jobs", "jobs"), communities: await listTable("communities", "communities"), channels: await listTable("channels", "channels") };
  }
  const contains = (item, fields) => fields.some((field) => String(item[field] ?? "").toLowerCase().includes(term));
  const posts = (await listPosts(user)).filter((post) => contains(post, ["author", "source", "content", "post_type"]));
  const courses = (await listTable("courses", "courses")).filter((item) => contains(item, ["title", "description", "category"]));
  const jobs = (await listTable("jobs", "jobs")).filter((item) => contains(item, ["title", "company", "description", "location", "category"]));
  const communities = (await listTable("communities", "communities")).filter((item) => contains(item, ["name", "description"]));
  const channels = (await listTable("channels", "channels")).filter((item) => contains(item, ["name", "description"]));
  return { posts, courses, jobs, communities, channels };
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
    json(res, 200, { posts: await listPosts(user) });
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
    if (!post) {
      json(res, 400, { error: "content_required" });
      return;
    }
    if (post.error) {
      json(res, 400, post);
      return;
    }
    json(res, 202, { post, notification: "local FCM placeholder" });
    return;
  }

  if (req.method === "GET" && req.url === "/posts/mine") {
    const user = await requireAuth(req, res);
    if (!user) return;
    json(res, 200, { posts: await listMyPosts(user) });
    return;
  }

  if (req.method === "GET" && req.url === "/posts/owner-review") {
    const user = await requireAuth(req, res);
    if (!user) return;
    json(res, 200, { posts: await listOwnerReviewPosts(user) });
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/posts/") && req.url.endsWith("/like")) {
    const user = await requireAuth(req, res);
    if (!user) return;
    const postId = req.url.split("/")[2];
    const post = await togglePostLike(user, postId);
    json(res, post ? 200 : 404, post ? { post } : { error: "post_not_found" });
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/posts/") && req.url.endsWith("/comments")) {
    const user = await requireAuth(req, res);
    if (!user) return;
    const postId = req.url.split("/")[2];
    const result = await addPostComment(user, postId, await readJson(req));
    json(res, result.error ? 400 : 201, result);
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/posts/") && req.url.endsWith("/edit")) {
    const user = await requireAuth(req, res);
    if (!user) return;
    const postId = req.url.split("/")[2];
    const result = await editApprovedPost(user, postId, await readJson(req));
    json(res, result ? 200 : 404, result ? { post: result } : { error: "approved_post_not_found_or_not_owner" });
    return;
  }

  if (req.method === "GET" && req.url?.startsWith("/channels/mine")) {
    const user = await requireAuth(req, res);
    if (!user) return;
    json(res, 200, { channels: await listMyChannels(user) });
    return;
  }

  if (req.method === "POST" && req.url === "/channels") {
    const user = await requireAuth(req, res);
    if (!user) return;
    const result = await createChannel(user, await readJson(req));
    json(res, result.error ? 400 : 201, result);
    return;
  }

  if (req.method === "GET" && req.url?.startsWith("/communities/postable")) {
    const user = await requireAuth(req, res);
    if (!user) return;
    const url = requestUrl(req);
    json(res, 200, { communities: await searchPostableCommunities(url.searchParams.get("q")) });
    return;
  }

  if (req.method === "POST" && req.url === "/communities") {
    const user = await requireAuth(req, res);
    if (!user) return;
    const result = await createCommunity(user, await readJson(req));
    json(res, result.error ? 400 : 201, result);
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/posts/") && req.url.endsWith("/approve")) {
    const user = await requireAuth(req, res);
    if (!user) return;
    const postId = req.url.split("/")[2];
    const post = await approveOwnedCommunityPost(user, postId);
    json(res, post ? 200 : 404, post ? { post } : { error: "post_not_found_or_not_owner" });
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
    json(res, 200, { posts: await listPosts(user) });
    return;
  }

  if (req.method === "POST" && req.url === "/community/posts") {
    const user = await requireAuth(req, res);
    if (!user) return;
    const post = await createPost(user, await readJson(req));
    if (!post) {
      json(res, 400, { error: "content_required" });
      return;
    }
    if (post.error) {
      json(res, 400, post);
      return;
    }
    json(res, 202, { post });
    return;
  }

  if (req.method === "GET" && req.url === "/community/posts/mine") {
    const user = await requireAuth(req, res);
    if (!user) return;
    json(res, 200, { posts: await listMyPosts(user) });
    return;
  }

  if (req.method === "GET" && req.url === "/community/posts/owner-review") {
    const user = await requireAuth(req, res);
    if (!user) return;
    json(res, 200, { posts: await listOwnerReviewPosts(user) });
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/community/posts/") && req.url.endsWith("/like")) {
    const user = await requireAuth(req, res);
    if (!user) return;
    const postId = req.url.split("/")[3];
    const post = await togglePostLike(user, postId);
    json(res, post ? 200 : 404, post ? { post } : { error: "post_not_found" });
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/community/posts/") && req.url.endsWith("/comments")) {
    const user = await requireAuth(req, res);
    if (!user) return;
    const postId = req.url.split("/")[3];
    const result = await addPostComment(user, postId, await readJson(req));
    json(res, result.error ? 400 : 201, result);
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/community/posts/") && req.url.endsWith("/edit")) {
    const user = await requireAuth(req, res);
    if (!user) return;
    const postId = req.url.split("/")[3];
    const result = await editApprovedPost(user, postId, await readJson(req));
    json(res, result ? 200 : 404, result ? { post: result } : { error: "approved_post_not_found_or_not_owner" });
    return;
  }

  if (req.method === "GET" && req.url?.startsWith("/community/channels/mine")) {
    const user = await requireAuth(req, res);
    if (!user) return;
    json(res, 200, { channels: await listMyChannels(user) });
    return;
  }

  if (req.method === "POST" && req.url === "/community/channels") {
    const user = await requireAuth(req, res);
    if (!user) return;
    const result = await createChannel(user, await readJson(req));
    json(res, result.error ? 400 : 201, result);
    return;
  }

  if (req.method === "GET" && req.url?.startsWith("/community/communities/postable")) {
    const user = await requireAuth(req, res);
    if (!user) return;
    const url = requestUrl(req);
    json(res, 200, { communities: await searchPostableCommunities(url.searchParams.get("q")) });
    return;
  }

  if (req.method === "POST" && req.url === "/community/communities") {
    const user = await requireAuth(req, res);
    if (!user) return;
    const result = await createCommunity(user, await readJson(req));
    json(res, result.error ? 400 : 201, result);
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/community/posts/") && req.url.endsWith("/approve")) {
    const user = await requireAuth(req, res);
    if (!user) return;
    const postId = req.url.split("/")[3];
    const post = await approveOwnedCommunityPost(user, postId);
    json(res, post ? 200 : 404, post ? { post } : { error: "post_not_found_or_not_owner" });
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

  if (req.method === "GET" && req.url?.startsWith("/search")) {
    const user = await requireAuth(req, res);
    if (!user) return;
    const url = requestUrl(req);
    json(res, 200, await searchPlatform(url.searchParams.get("q"), user));
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
