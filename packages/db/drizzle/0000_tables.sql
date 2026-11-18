CREATE TYPE "public"."agent_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."agent_version_status" AS ENUM('draft', 'published', 'retired');--> statement-breakpoint
CREATE TYPE "public"."budget_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."cadence" AS ENUM('once', 'daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('active', 'archived', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('uploaded', 'processing', 'indexed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('sent', 'accepted', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('member', 'admin');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('streaming', 'complete', 'failed', 'refused');--> statement-breakpoint
CREATE TYPE "public"."price_kind" AS ENUM('input', 'cached_input', 'output');--> statement-breakpoint
CREATE TYPE "public"."refused_reason" AS ENUM('budget_exhausted', 'rate_limited', 'tool_off', 'no_sources', 'no_price');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'skipped', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."schedule_status" AS ENUM('active', 'paused', 'ended');--> statement-breakpoint
CREATE TYPE "public"."share_status" AS ENUM('requested', 'approved', 'declined', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."share_subject_kind" AS ENUM('library', 'agent');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('private', 'workspace');--> statement-breakpoint
CREATE TABLE "agent_version_libraries" (
	"agent_version_id" text NOT NULL,
	"library_id" text NOT NULL,
	CONSTRAINT "agent_version_libraries_agent_version_id_library_id_pk" PRIMARY KEY("agent_version_id","library_id")
);
--> statement-breakpoint
CREATE TABLE "agent_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"instructions" text NOT NULL,
	"model_id" text NOT NULL,
	"max_context_tokens" integer NOT NULL,
	"status" "agent_version_status" NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "agent_versions_agent_version_unique" UNIQUE("agent_id","version"),
	CONSTRAINT "agent_versions_version_positive" CHECK ("agent_versions"."version" >= 1),
	CONSTRAINT "agent_versions_context_positive" CHECK ("agent_versions"."max_context_tokens" > 0)
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"visibility" "visibility" NOT NULL,
	"status" "agent_status" NOT NULL,
	"current_version_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "agents_workspace_slug_unique" UNIQUE("workspace_id","slug")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"month" text NOT NULL,
	"limit_micros" bigint NOT NULL,
	"status" "budget_status" NOT NULL,
	"set_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "budgets_workspace_month_unique" UNIQUE("workspace_id","month"),
	CONSTRAINT "budgets_month_format" CHECK ("budgets"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "budgets_limit_non_negative" CHECK ("budgets"."limit_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"heading_path" text[] NOT NULL,
	"heading_text" text NOT NULL,
	"start_char" integer NOT NULL,
	"end_char" integer NOT NULL,
	"token_count" integer NOT NULL,
	"body" text NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english'::regconfig, heading_text), 'B') || setweight(to_tsvector('english'::regconfig, body), 'D')) STORED,
	CONSTRAINT "chunks_document_ordinal_unique" UNIQUE("document_id","ordinal"),
	CONSTRAINT "chunks_span_ordered" CHECK ("chunks"."end_char" > "chunks"."start_char"),
	CONSTRAINT "chunks_tokens_positive" CHECK ("chunks"."token_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "citations" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"index" integer NOT NULL,
	"chunk_id" text,
	"document_id" text,
	"document_title" text NOT NULL,
	"document_version" integer NOT NULL,
	"start_char" integer NOT NULL,
	"end_char" integer NOT NULL,
	"quote" text NOT NULL,
	CONSTRAINT "citations_message_index_unique" UNIQUE("message_id","index"),
	CONSTRAINT "citations_index_positive" CHECK ("citations"."index" >= 1),
	CONSTRAINT "citations_span_ordered" CHECK ("citations"."end_char" > "citations"."start_char")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"agent_version_id" text NOT NULL,
	"title" text NOT NULL,
	"status" "conversation_status" NOT NULL,
	"message_count" integer NOT NULL,
	"token_total" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_message_at" timestamp with time zone NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "conversations_counts_non_negative" CHECK ("conversations"."message_count" >= 0 and "conversations"."token_total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"library_id" text NOT NULL,
	"title" text NOT NULL,
	"source_name" text NOT NULL,
	"mime" text NOT NULL,
	"byte_size" integer NOT NULL,
	"char_count" integer NOT NULL,
	"body" text NOT NULL,
	"status" "document_status" NOT NULL,
	"error" text,
	"version" integer NOT NULL,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"indexed_at" timestamp with time zone,
	CONSTRAINT "documents_version_positive" CHECK ("documents"."version" >= 1),
	CONSTRAINT "documents_sizes_non_negative" CHECK ("documents"."byte_size" >= 0 and "documents"."char_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"email" text NOT NULL,
	"role" "membership_role" NOT NULL,
	"token_hash" text NOT NULL,
	"status" "invitation_status" NOT NULL,
	"invited_by" text NOT NULL,
	"accepted_user_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "libraries" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"visibility" "visibility" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "libraries_workspace_slug_unique" UNIQUE("workspace_id","slug")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "membership_role" NOT NULL,
	"status" "membership_status" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "memberships_workspace_user_unique" UNIQUE("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"role" "message_role" NOT NULL,
	"body" text NOT NULL,
	"status" "message_status" NOT NULL,
	"refused_reason" "refused_reason",
	"model_id" text,
	"agent_version_id" text,
	"prompt_tokens" integer NOT NULL,
	"context_tokens" integer NOT NULL,
	"completion_tokens" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "messages_conversation_ordinal_unique" UNIQUE("conversation_id","ordinal"),
	CONSTRAINT "messages_tokens_non_negative" CHECK ("messages"."prompt_tokens" >= 0 and "messages"."context_tokens" >= 0 and "messages"."completion_tokens" >= 0),
	CONSTRAINT "messages_refused_has_reason" CHECK (("messages"."status" = 'refused') = ("messages"."refused_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "model_prices" (
	"id" text PRIMARY KEY NOT NULL,
	"model_id" text NOT NULL,
	"kind" "price_kind" NOT NULL,
	"micros_per_1k" integer NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	CONSTRAINT "model_prices_non_negative" CHECK ("model_prices"."micros_per_1k" >= 0),
	CONSTRAINT "model_prices_range_ordered" CHECK ("model_prices"."valid_to" is null or "model_prices"."valid_to" > "model_prices"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"context_tokens" integer NOT NULL,
	"enabled" boolean NOT NULL,
	CONSTRAINT "models_context_positive" CHECK ("models"."context_tokens" > 0)
);
--> statement-breakpoint
CREATE TABLE "scheduled_prompts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"name" text NOT NULL,
	"prompt" text NOT NULL,
	"cadence" "cadence" NOT NULL,
	"at_minute" integer NOT NULL,
	"weekday" integer,
	"day_of_month" integer,
	"timezone" text NOT NULL,
	"next_run_at" timestamp with time zone,
	"status" "schedule_status" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone,
	CONSTRAINT "scheduled_prompts_minute_range" CHECK ("scheduled_prompts"."at_minute" between 0 and 1439),
	CONSTRAINT "scheduled_prompts_weekday_range" CHECK ("scheduled_prompts"."weekday" is null or "scheduled_prompts"."weekday" between 0 and 6),
	CONSTRAINT "scheduled_prompts_day_range" CHECK ("scheduled_prompts"."day_of_month" is null or "scheduled_prompts"."day_of_month" between 1 and 28),
	CONSTRAINT "scheduled_prompts_cadence_fields" CHECK (("scheduled_prompts"."cadence" <> 'weekly' or "scheduled_prompts"."weekday" is not null) and ("scheduled_prompts"."cadence" <> 'monthly' or "scheduled_prompts"."day_of_month" is not null))
);
--> statement-breakpoint
CREATE TABLE "scheduled_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"scheduled_prompt_id" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"status" "run_status" NOT NULL,
	"conversation_id" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "share_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"subject_kind" "share_subject_kind" NOT NULL,
	"subject_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"status" "share_status" NOT NULL,
	"reason" text,
	"decided_by" text,
	"created_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" text,
	"message_id" text,
	"model_id" text NOT NULL,
	"kind" "price_kind" NOT NULL,
	"tokens" integer NOT NULL,
	"micros_per_1k" integer NOT NULL,
	"cost_micros" bigint NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "usage_events_non_negative" CHECK ("usage_events"."tokens" >= 0 and "usage_events"."micros_per_1k" >= 0 and "usage_events"."cost_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_email_lower" CHECK ("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"tools" jsonb NOT NULL,
	"retention_days" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug"),
	CONSTRAINT "workspaces_retention_range" CHECK ("workspaces"."retention_days" between 1 and 3650)
);
--> statement-breakpoint
ALTER TABLE "agent_version_libraries" ADD CONSTRAINT "agent_version_libraries_agent_version_id_agent_versions_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "public"."agent_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_version_libraries" ADD CONSTRAINT "agent_version_libraries_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_current_version_id_agent_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."agent_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_set_by_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_agent_version_id_agent_versions_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "public"."agent_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_user_id_users_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "libraries" ADD CONSTRAINT "libraries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "libraries" ADD CONSTRAINT "libraries_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_agent_version_id_agent_versions_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "public"."agent_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_prices" ADD CONSTRAINT "model_prices_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_prompts" ADD CONSTRAINT "scheduled_prompts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_prompts" ADD CONSTRAINT "scheduled_prompts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_prompts" ADD CONSTRAINT "scheduled_prompts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_runs" ADD CONSTRAINT "scheduled_runs_scheduled_prompt_id_scheduled_prompts_id_fk" FOREIGN KEY ("scheduled_prompt_id") REFERENCES "public"."scheduled_prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_runs" ADD CONSTRAINT "scheduled_runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_requests" ADD CONSTRAINT "share_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_requests" ADD CONSTRAINT "share_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_requests" ADD CONSTRAINT "share_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_owner_idx" ON "agents" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "audit_log_workspace_time_idx" ON "audit_log" USING btree ("workspace_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_kind","entity_id");--> statement-breakpoint
CREATE INDEX "chunks_tsv_idx" ON "chunks" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "conversations_user_idx" ON "conversations" USING btree ("user_id","status","last_message_at");--> statement-breakpoint
CREATE INDEX "documents_library_idx" ON "documents" USING btree ("library_id","status");--> statement-breakpoint
CREATE INDEX "invitations_workspace_idx" ON "invitations" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "libraries_owner_idx" ON "libraries" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "model_prices_model_idx" ON "model_prices" USING btree ("model_id","kind");--> statement-breakpoint
CREATE INDEX "scheduled_prompts_due_idx" ON "scheduled_prompts" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE INDEX "scheduled_runs_prompt_idx" ON "scheduled_runs" USING btree ("scheduled_prompt_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "share_requests_workspace_status_idx" ON "share_requests" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "share_requests_subject_idx" ON "share_requests" USING btree ("subject_kind","subject_id");--> statement-breakpoint
CREATE INDEX "usage_events_workspace_time_idx" ON "usage_events" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE INDEX "usage_events_user_idx" ON "usage_events" USING btree ("user_id","occurred_at");