CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  roles TEXT[] NOT NULL DEFAULT ARRAY['student'],
  bio TEXT,
  avatar TEXT,
  resume_url TEXT,
  onboarding_answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  organization_id UUID,
  grade TEXT,
  subscription_tier TEXT NOT NULL DEFAULT 'free' CHECK (subscription_tier IN ('free', 'premium')),
  fcm_token TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  activity_score NUMERIC(4,3) NOT NULL DEFAULT 0,
  channel_creation_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auth_sessions (
  token TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE communities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  owner_id UUID REFERENCES users(id),
  is_public BOOLEAN NOT NULL DEFAULT TRUE,
  subscriber_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  owner_id UUID UNIQUE REFERENCES users(id),
  is_paid BOOLEAN NOT NULL DEFAULT FALSE,
  price_monthly INTEGER NOT NULL DEFAULT 0,
  stripe_product_id TEXT,
  organization_id UUID,
  grade TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE follows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  target_id UUID NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('community', 'channel', 'user')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, target_id, target_type)
);

CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content TEXT NOT NULL,
  media_url TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  author_id UUID NOT NULL REFERENCES users(id),
  post_type TEXT NOT NULL CHECK (post_type IN ('platform_post', 'community_post', 'channel_post')),
  parent_id UUID,
  ai_moderation_status TEXT NOT NULL DEFAULT 'pending' CHECK (ai_moderation_status IN ('pending', 'approved', 'rejected', 'removed')),
  ai_moderation_reason TEXT,
  ai_moderation_checked_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE courses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  teacher_id UUID NOT NULL REFERENCES users(id),
  is_paid BOOLEAN NOT NULL DEFAULT FALSE,
  price INTEGER NOT NULL DEFAULT 0,
  prerequisites UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  access_restrictions JSONB NOT NULL DEFAULT '{"organizations":[],"regions":[]}'::jsonb,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id UUID NOT NULL REFERENCES courses(id),
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE lessons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  section_id UUID NOT NULL REFERENCES sections(id),
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  video_url TEXT,
  video_size_bytes BIGINT NOT NULL DEFAULT 0,
  quiz_id UUID
);

CREATE TABLE quizzes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lesson_id UUID,
  timer_seconds INTEGER NOT NULL DEFAULT 0,
  retry_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  retry_count INTEGER NOT NULL DEFAULT 0,
  questions JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE live_classes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  teacher_id UUID NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  course_id UUID REFERENCES courses(id),
  scheduled_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'ended')),
  join_link TEXT NOT NULL,
  organization_id UUID,
  grade TEXT,
  is_open BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE live_class_enrollments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  live_class_id UUID NOT NULL REFERENCES live_classes(id),
  student_id UUID NOT NULL REFERENCES users(id),
  registration_number TEXT,
  validated BOOLEAN NOT NULL DEFAULT FALSE,
  joined_at TIMESTAMPTZ,
  device_fingerprint TEXT
);

CREATE TABLE live_class_quizzes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  live_class_id UUID NOT NULL REFERENCES live_classes(id),
  quiz_id UUID NOT NULL REFERENCES quizzes(id),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ
);

CREATE TABLE live_class_quiz_submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  live_class_quiz_id UUID NOT NULL REFERENCES live_class_quizzes(id),
  student_id UUID NOT NULL REFERENCES users(id),
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  score NUMERIC(6,2)
);

CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recruiter_id UUID NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  description TEXT NOT NULL,
  location TEXT,
  category TEXT,
  apply_url TEXT,
  stripe_payment_intent_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  visibility_boost BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  channel_id UUID NOT NULL REFERENCES channels(id),
  stripe_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agent_execution_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_name TEXT NOT NULL,
  trigger TEXT NOT NULL,
  subject_id UUID,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'ok',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE feature_flags (
  key TEXT PRIMARY KEY,
  value BOOLEAN NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_auth_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX idx_auth_sessions_expires_at ON auth_sessions(expires_at);
CREATE INDEX idx_posts_author_id ON posts(author_id);
CREATE INDEX idx_posts_status_created_at ON posts(ai_moderation_status, created_at DESC);
CREATE INDEX idx_courses_category ON courses(category);
CREATE INDEX idx_jobs_active_category ON jobs(is_active, category);
