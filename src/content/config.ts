import { defineCollection, z } from "astro:content";

/**
 * Blog (writing) collection. Schema matches the content_automation publisher's
 * frontmatter contract (scripts/publish_to_web.py), so a `web.md` authored for
 * either site drops in unchanged. Book / foundational-theory essays live here;
 * world-model essays live on mihawk.ai/writing.
 */
const blog = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    description: z.string().default(""),
    date: z.string(),
    authors: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    cover: z.string().optional(),
  }),
});

export const collections = { blog };
