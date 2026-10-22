CREATE TABLE "campaign_characters" (
	"campaign_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	CONSTRAINT "campaign_characters_campaign_id_character_id_pk" PRIMARY KEY("campaign_id","character_id")
);
--> statement-breakpoint
CREATE TABLE "campaign_content_sources" (
	"campaign_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"shared_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_content_sources_campaign_id_source_id_pk" PRIMARY KEY("campaign_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "campaign_invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"created_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"max_uses" integer DEFAULT 10 NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_invites_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "campaign_members" (
	"campaign_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'player' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_members_campaign_id_user_id_pk" PRIMARY KEY("campaign_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description_md" text DEFAULT '' NOT NULL,
	"ruleset_id" text NOT NULL,
	"dm_user_id" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "encounter_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"encounter_id" uuid NOT NULL,
	"actor_user_id" text,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"action_id" uuid,
	"version_after" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "encounter_participants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"encounter_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"character_id" uuid,
	"entry_uid" text,
	"version_id" uuid,
	"display_name" text NOT NULL,
	"initiative" real,
	"tiebreak" real DEFAULT 0 NOT NULL,
	"hp_current" integer,
	"hp_max" integer,
	"hp_temp" integer DEFAULT 0 NOT NULL,
	"ac" integer,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"combat" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"visible_to_players" boolean DEFAULT true NOT NULL,
	"defeated" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "encounters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description_md" text DEFAULT '' NOT NULL,
	"dm_notes_md" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"round" integer DEFAULT 0 NOT NULL,
	"turn_index" integer DEFAULT 0 NOT NULL,
	"current_turn_id" text,
	"version" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_characters" ADD CONSTRAINT "campaign_characters_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_characters" ADD CONSTRAINT "campaign_characters_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_characters" ADD CONSTRAINT "campaign_characters_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_content_sources" ADD CONSTRAINT "campaign_content_sources_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_content_sources" ADD CONSTRAINT "campaign_content_sources_source_id_content_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."content_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_content_sources" ADD CONSTRAINT "campaign_content_sources_shared_by_users_id_fk" FOREIGN KEY ("shared_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_invites" ADD CONSTRAINT "campaign_invites_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_invites" ADD CONSTRAINT "campaign_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_members" ADD CONSTRAINT "campaign_members_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_members" ADD CONSTRAINT "campaign_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_dm_user_id_users_id_fk" FOREIGN KEY ("dm_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_events" ADD CONSTRAINT "encounter_events_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_events" ADD CONSTRAINT "encounter_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_participants" ADD CONSTRAINT "encounter_participants_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_participants" ADD CONSTRAINT "encounter_participants_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_characters_character_idx" ON "campaign_characters" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "campaign_content_sources_source_idx" ON "campaign_content_sources" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "campaign_invites_campaign_idx" ON "campaign_invites" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaign_members_user_idx" ON "campaign_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "campaigns_dm_idx" ON "campaigns" USING btree ("dm_user_id");--> statement-breakpoint
CREATE INDEX "encounter_events_encounter_idx" ON "encounter_events" USING btree ("encounter_id","version_after");--> statement-breakpoint
CREATE INDEX "encounter_participants_encounter_idx" ON "encounter_participants" USING btree ("encounter_id");--> statement-breakpoint
CREATE INDEX "encounters_campaign_idx" ON "encounters" USING btree ("campaign_id");