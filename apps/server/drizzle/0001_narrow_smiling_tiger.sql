CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "content_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"uid" text NOT NULL,
	"source_id" uuid NOT NULL,
	"ruleset_id" text NOT NULL,
	"kind" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"head_version_id" uuid,
	"draft_version_id" uuid,
	"search_text" text DEFAULT '' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "content_entries_uid_unique" UNIQUE("uid")
);
--> statement-breakpoint
CREATE TABLE "content_relations" (
	"from_entry_id" uuid NOT NULL,
	"to_uid" text NOT NULL,
	"relation" text NOT NULL,
	CONSTRAINT "content_relations_from_entry_id_to_uid_relation_pk" PRIMARY KEY("from_entry_id","to_uid","relation")
);
--> statement-breakpoint
CREATE TABLE "content_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"license" text NOT NULL,
	"attribution_text" text NOT NULL,
	"version" text NOT NULL,
	"publisher" text,
	"url" text,
	"description" text,
	"owner_user_id" text,
	"visibility" text DEFAULT 'global' NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_sources_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "content_tags" (
	"entry_id" uuid NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "content_tags_entry_id_tag_pk" PRIMARY KEY("entry_id","tag")
);
--> statement-breakpoint
CREATE TABLE "content_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entry_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"data" jsonb NOT NULL,
	"effects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"choices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"automation" jsonb,
	"tests" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"change_note" text,
	"checksum" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_index" (
	"entry_id" uuid PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"rarity" text,
	"requires_attunement" boolean DEFAULT false NOT NULL,
	"magic" boolean DEFAULT false NOT NULL,
	"cost_cp" integer,
	"weight" real,
	"weapon_category" text,
	"armor_category" text
);
--> statement-breakpoint
CREATE TABLE "monster_index" (
	"entry_id" uuid PRIMARY KEY NOT NULL,
	"challenge_rating" real NOT NULL,
	"type" text NOT NULL,
	"size" text NOT NULL,
	"alignment" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rulesets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"edition" text NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spell_index" (
	"entry_id" uuid PRIMARY KEY NOT NULL,
	"level" integer NOT NULL,
	"school" text NOT NULL,
	"casting_time_type" text NOT NULL,
	"ritual" boolean NOT NULL,
	"concentration" boolean NOT NULL,
	"class_uids" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_entries" ADD CONSTRAINT "content_entries_source_id_content_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."content_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_entries" ADD CONSTRAINT "content_entries_ruleset_id_rulesets_id_fk" FOREIGN KEY ("ruleset_id") REFERENCES "public"."rulesets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_entries" ADD CONSTRAINT "content_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_relations" ADD CONSTRAINT "content_relations_from_entry_id_content_entries_id_fk" FOREIGN KEY ("from_entry_id") REFERENCES "public"."content_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_sources" ADD CONSTRAINT "content_sources_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_tags" ADD CONSTRAINT "content_tags_entry_id_content_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."content_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_entry_id_content_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."content_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_index" ADD CONSTRAINT "item_index_entry_id_content_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."content_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monster_index" ADD CONSTRAINT "monster_index_entry_id_content_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."content_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spell_index" ADD CONSTRAINT "spell_index_entry_id_content_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."content_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_entries_source_kind_idx" ON "content_entries" USING btree ("source_id","kind");--> statement-breakpoint
CREATE INDEX "content_entries_kind_name_idx" ON "content_entries" USING btree ("kind","name");--> statement-breakpoint
CREATE INDEX "content_entries_search_idx" ON "content_entries" USING gin (to_tsvector('english', "search_text"));--> statement-breakpoint
CREATE INDEX "content_entries_name_trgm_idx" ON "content_entries" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "content_relations_to_uid_idx" ON "content_relations" USING btree ("to_uid");--> statement-breakpoint
CREATE INDEX "content_tags_tag_idx" ON "content_tags" USING btree ("tag");--> statement-breakpoint
CREATE UNIQUE INDEX "content_versions_entry_version_idx" ON "content_versions" USING btree ("entry_id","version_no");--> statement-breakpoint
CREATE INDEX "item_index_category_idx" ON "item_index" USING btree ("category");--> statement-breakpoint
CREATE INDEX "item_index_rarity_idx" ON "item_index" USING btree ("rarity");--> statement-breakpoint
CREATE INDEX "monster_index_cr_idx" ON "monster_index" USING btree ("challenge_rating");--> statement-breakpoint
CREATE INDEX "monster_index_type_idx" ON "monster_index" USING btree ("type");--> statement-breakpoint
CREATE INDEX "spell_index_level_idx" ON "spell_index" USING btree ("level");--> statement-breakpoint
CREATE INDEX "spell_index_class_uids_idx" ON "spell_index" USING gin ("class_uids");