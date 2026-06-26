import http from "node:http";

const users = new Map();
const sessions = new Map();

const posts = [
  {
    id: "local-post-1",
    author: "Local Backend",
    source: "Community API",
    status: "approved",
    content: "This post is coming from the local LearnLink backend stack.",
    metrics: "Served through gateway on localhost:4000",
    ai_moderation_status: "approved",
    post_type: "platform_post"
  }
];

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

const getUserFromRequest = (req) => {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return token ? sessions.get(token) : undefined;
};

const requireAuth = (req, res) => {
  const user = getUserFromRequest(req);
  if (!user) {
    json(res, 401, { error: "authentication_required" });
    return undefined;
  }
  return user;
};

const createSession = (user) => {
  const token = `local-token-${crypto.randomUUID()}`;
  sessions.set(token, user);
  return token;
};

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
        json(res, 200, { ok: true, service: serviceName });
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
    const name = String(body.name ?? "").trim();

    if (!email || !name) {
      json(res, 400, { error: "name_and_email_required" });
      return true;
    }

    const user = {
      id: crypto.randomUUID(),
      email,
      name,
      roles: body.roles ?? ["student"],
      created_at: new Date().toISOString()
    };
    users.set(email, user);
    const token = createSession(user);
    json(res, 201, { user, token });
    return true;
  }

  if (req.method === "POST" && req.url === "/auth/login") {
    const body = await readJson(req);
    const email = String(body.email ?? "").trim().toLowerCase();
    const user = users.get(email) ?? {
      id: crypto.randomUUID(),
      email,
      name: email ? email.split("@")[0] : "Local user",
      roles: ["student"],
      created_at: new Date().toISOString()
    };
    users.set(user.email, user);
    const token = createSession(user);
    json(res, 200, { user, token });
    return true;
  }

  if (req.method === "GET" && req.url === "/auth/me") {
    const user = requireAuth(req, res);
    if (!user) return true;
    json(res, 200, { user });
    return true;
  }

  return false;
};

createServer(4100, "learnlink-service-community", async (req, res) => {
  if (req.method === "GET" && req.url?.startsWith("/feed/")) {
    const user = requireAuth(req, res);
    if (!user) return;
    json(res, 200, { posts });
    return;
  }

  if (req.method === "POST" && req.url === "/posts") {
    const user = requireAuth(req, res);
    if (!user) return;
    const body = await readJson(req);
    const post = {
      id: crypto.randomUUID(),
      author: user.name,
      source: body.post_type ?? "platform_post",
      status: "approved",
      content: body.content ?? "",
      metrics: "AI moderation approved locally",
      ai_moderation_status: "approved",
      post_type: body.post_type ?? "platform_post"
    };
    posts.unshift(post);
    json(res, 202, { post, notification: "local FCM placeholder" });
    return;
  }

  json(res, 404, { error: "not_found" });
});

createServer(4200, "learnlink-service-courses", async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  json(res, 200, {
    courses: [],
    recommendations: { mode: "local_dev", courses: ["ai-and-data", "career-foundations"] }
  });
});

createServer(4300, "learnlink-service-jobs", async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  json(res, 200, {
    jobs: [],
    premium_features: ["who_viewed_profile", "priority_ranking", "resume_visibility_boost"]
  });
});

createServer(4000, "learnlink-backend-gateway", async (req, res) => {
  if (await handleAuth(req, res)) return;

  if (req.method === "GET" && req.url?.startsWith("/community/feed/")) {
    const user = requireAuth(req, res);
    if (!user) return;
    json(res, 200, { posts });
    return;
  }

  if (req.method === "POST" && req.url === "/community/posts") {
    const user = requireAuth(req, res);
    if (!user) return;
    const body = await readJson(req);
    const post = {
      id: crypto.randomUUID(),
      author: user.name,
      source: body.post_type ?? "platform_post",
      status: "approved",
      content: body.content ?? "",
      metrics: "Created through local gateway",
      ai_moderation_status: "approved",
      post_type: body.post_type ?? "platform_post"
    };
    posts.unshift(post);
    json(res, 202, { post });
    return;
  }

  if (req.method === "GET" && req.url?.startsWith("/courses")) {
    const user = requireAuth(req, res);
    if (!user) return;
    json(res, 200, { courses: [], recommendations: { mode: "local_dev" } });
    return;
  }

  if (req.method === "GET" && req.url?.startsWith("/jobs")) {
    const user = requireAuth(req, res);
    if (!user) return;
    json(res, 200, { jobs: [] });
    return;
  }

  json(res, 404, { error: "not_found" });
});
