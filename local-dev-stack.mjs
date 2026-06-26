import http from "node:http";

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

createServer(4100, "learnlink-service-community", async (req, res) => {
  if (req.method === "GET" && req.url?.startsWith("/feed/")) {
    json(res, 200, { posts });
    return;
  }

  if (req.method === "POST" && req.url === "/posts") {
    const body = await readJson(req);
    const post = {
      id: crypto.randomUUID(),
      author: body.author_id ?? "Local user",
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

createServer(4200, "learnlink-service-courses", async (_req, res) => {
  json(res, 200, {
    courses: [],
    recommendations: { mode: "local_dev", courses: ["ai-and-data", "career-foundations"] }
  });
});

createServer(4300, "learnlink-service-jobs", async (_req, res) => {
  json(res, 200, {
    jobs: [],
    premium_features: ["who_viewed_profile", "priority_ranking", "resume_visibility_boost"]
  });
});

createServer(4000, "learnlink-backend-gateway", async (req, res) => {
  if (req.method === "GET" && req.url?.startsWith("/community/feed/")) {
    json(res, 200, { posts });
    return;
  }

  if (req.method === "POST" && req.url === "/community/posts") {
    const body = await readJson(req);
    const post = {
      id: crypto.randomUUID(),
      author: body.author_id ?? "Local user",
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
    json(res, 200, { courses: [], recommendations: { mode: "local_dev" } });
    return;
  }

  if (req.method === "GET" && req.url?.startsWith("/jobs")) {
    json(res, 200, { jobs: [] });
    return;
  }

  json(res, 404, { error: "not_found" });
});

