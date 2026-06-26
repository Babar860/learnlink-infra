INSERT INTO feature_flags (key, value, description) VALUES
  ('FF_SELF_HOST_VIDEO', true, 'true = use third-party video host; false = internal storage'),
  ('FF_PREMIUM_KEY_POINTS', true, 'Enable premium key points feature'),
  ('FF_LIVE_QUIZ_GRADING', true, 'Enable live class quiz auto-grading'),
  ('FF_CHANNEL_CREATION_AUTO', true, 'Auto-grant channel eligibility')
ON CONFLICT (key) DO UPDATE SET value = excluded.value, description = excluded.description, updated_at = now();

INSERT INTO users (id, email, name, roles, onboarding_answers, activity_score, channel_creation_eligible)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'system@learnlink.local', 'LearnLink System', ARRAY['admin'], '{}'::jsonb, 1.000, true)
ON CONFLICT (email) DO NOTHING;

INSERT INTO communities (id, name, description, owner_id, subscriber_count)
VALUES
  ('10000000-0000-0000-0000-000000000001', 'AI and Data Community', 'Public discussion space.', '00000000-0000-0000-0000-000000000001', 128),
  ('10000000-0000-0000-0000-000000000002', 'Career Switchers', 'AI-moderated posts from subscribed members.', '00000000-0000-0000-0000-000000000001', 91),
  ('10000000-0000-0000-0000-000000000003', 'Student Help Desk', 'Ask questions and follow updates.', '00000000-0000-0000-0000-000000000001', 213)
ON CONFLICT (id) DO NOTHING;

INSERT INTO channels (id, name, description, owner_id, is_paid, price_monthly)
VALUES
  ('20000000-0000-0000-0000-000000000001', 'Product Careers Channel', 'Free creator channel.', '00000000-0000-0000-0000-000000000001', false, 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO courses (id, title, description, category, teacher_id, is_paid, price, is_published)
VALUES
  ('30000000-0000-0000-0000-000000000001', 'AI Career Foundations', 'Recommended from onboarding answers.', 'ai-and-data', '00000000-0000-0000-0000-000000000001', false, 0, true),
  ('30000000-0000-0000-0000-000000000002', 'Live Class: Data Skills', 'Organization and grade filters supported.', 'live-class', '00000000-0000-0000-0000-000000000001', false, 0, true),
  ('30000000-0000-0000-0000-000000000003', 'Premium Roadmap', 'Unlocks roadmap plus 15 matching jobs.', 'premium', '00000000-0000-0000-0000-000000000001', true, 2500, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO jobs (id, recruiter_id, title, company, description, location, category, is_active, visibility_boost)
VALUES
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Junior Data Analyst', 'LearnLink Demo', 'Entry-level data role with analytics tasks.', 'Karachi', 'data', true, false),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Frontend Intern', 'Remote Studio', 'Build UI surfaces for a remote product team.', 'Remote', 'engineering', true, false),
  ('40000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Product Associate', 'Growth Lab', 'Support product discovery and launch operations.', 'Hybrid', 'product', true, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO posts (id, content, author_id, post_type, ai_moderation_status, ai_moderation_reason, ai_moderation_checked_at, published_at)
VALUES
  ('50000000-0000-0000-0000-000000000001', 'This post is persisted by the LearnLink PostgreSQL seed data.', '00000000-0000-0000-0000-000000000001', 'platform_post', 'approved', 'Seed content approved.', now(), now())
ON CONFLICT (id) DO NOTHING;
