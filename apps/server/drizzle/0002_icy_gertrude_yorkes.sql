CREATE TABLE "character_choices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"character_id" uuid NOT NULL,
	"choice_key" text NOT NULL,
	"selected" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_classes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"character_id" uuid NOT NULL,
	"class_uid" text NOT NULL,
	"subclass_uid" text,
	"level" integer NOT NULL,
	"order" integer NOT NULL,
	"hit_dice_rolls" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_content_refs" (
	"character_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"ref_path" text NOT NULL,
	CONSTRAINT "character_content_refs_character_id_version_id_ref_path_pk" PRIMARY KEY("character_id","version_id","ref_path")
);
--> statement-breakpoint
CREATE TABLE "character_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"character_id" uuid NOT NULL,
	"actor_user_id" text,
	"command_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"revision_after" integer NOT NULL,
	"reversible" boolean DEFAULT false NOT NULL,
	"action_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_items" (
	"id" text NOT NULL,
	"character_id" uuid NOT NULL,
	"item_uid" text,
	"custom_item" jsonb,
	"quantity" integer DEFAULT 1 NOT NULL,
	"equipped" boolean DEFAULT false NOT NULL,
	"attuned" boolean DEFAULT false NOT NULL,
	"charges_current" integer,
	"container_item_id" text,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "character_items_character_id_id_pk" PRIMARY KEY("character_id","id")
);
--> statement-breakpoint
CREATE TABLE "character_overrides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"character_id" uuid NOT NULL,
	"stat_path" text NOT NULL,
	"value" jsonb NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "character_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"character_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"reason" text NOT NULL,
	"aggregate" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_spells" (
	"id" uuid PRIMARY KEY NOT NULL,
	"character_id" uuid NOT NULL,
	"spell_uid" text NOT NULL,
	"origin" text NOT NULL,
	"known" boolean DEFAULT true NOT NULL,
	"prepared" boolean DEFAULT false NOT NULL,
	"always_prepared" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_state" (
	"character_id" uuid PRIMARY KEY NOT NULL,
	"hp_current" integer DEFAULT 0 NOT NULL,
	"hp_temp" integer DEFAULT 0 NOT NULL,
	"death_saves" jsonb DEFAULT '{"successes":0,"failures":0}'::jsonb NOT NULL,
	"hit_dice_spent" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"spell_slots_used" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pact_slots_used" integer DEFAULT 0 NOT NULL,
	"resources" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"exhaustion" integer DEFAULT 0 NOT NULL,
	"concentration" jsonb,
	"inspiration" boolean DEFAULT false NOT NULL,
	"currency" jsonb DEFAULT '{"cp":0,"sp":0,"ep":0,"gp":0,"pp":0}'::jsonb NOT NULL,
	"active_effects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"toggles" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"combat" jsonb NOT NULL,
	"assumptions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"campaign_id" uuid,
	"ruleset_id" text NOT NULL,
	"name" text NOT NULL,
	"portrait_file_id" uuid,
	"biography" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ability_method" text DEFAULT 'standard' NOT NULL,
	"base_abilities" jsonb NOT NULL,
	"species_uid" text,
	"background_uid" text,
	"xp" integer DEFAULT 0 NOT NULL,
	"hp_mode" text DEFAULT 'fixed' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "command_receipts" (
	"command_id" uuid PRIMARY KEY NOT NULL,
	"actor_user_id" text,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"outcome" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rolls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"requested_by" text,
	"context" jsonb NOT NULL,
	"expression" text NOT NULL,
	"results" jsonb NOT NULL,
	"consumed_by_command_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rolls_consumed_by_command_id_unique" UNIQUE("consumed_by_command_id")
);
--> statement-breakpoint
ALTER TABLE "character_choices" ADD CONSTRAINT "character_choices_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_classes" ADD CONSTRAINT "character_classes_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_content_refs" ADD CONSTRAINT "character_content_refs_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_content_refs" ADD CONSTRAINT "character_content_refs_entry_id_content_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."content_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_content_refs" ADD CONSTRAINT "character_content_refs_version_id_content_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."content_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_events" ADD CONSTRAINT "character_events_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_events" ADD CONSTRAINT "character_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_items" ADD CONSTRAINT "character_items_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_overrides" ADD CONSTRAINT "character_overrides_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_snapshots" ADD CONSTRAINT "character_snapshots_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_spells" ADD CONSTRAINT "character_spells_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_state" ADD CONSTRAINT "character_state_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "character_choices_unique" ON "character_choices" USING btree ("character_id","choice_key");--> statement-breakpoint
CREATE UNIQUE INDEX "character_classes_unique" ON "character_classes" USING btree ("character_id","class_uid");--> statement-breakpoint
CREATE INDEX "character_events_character_idx" ON "character_events" USING btree ("character_id","revision_after");--> statement-breakpoint
CREATE UNIQUE INDEX "character_overrides_unique" ON "character_overrides" USING btree ("character_id","stat_path");--> statement-breakpoint
CREATE INDEX "character_snapshots_character_idx" ON "character_snapshots" USING btree ("character_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "character_spells_unique" ON "character_spells" USING btree ("character_id","spell_uid","origin");--> statement-breakpoint
CREATE INDEX "characters_owner_idx" ON "characters" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "characters_campaign_idx" ON "characters" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "command_receipts_created_idx" ON "command_receipts" USING btree ("created_at");