/** The stories' names in the address (`?story=`); apart from the stories themselves so the URL state can
 * know them without importing their text. */
export const STORY_KEYS = ["put-struje", "kilovatsat", "sunce", "odakle-struja", "granice"] as const;
export type StoryKey = (typeof STORY_KEYS)[number];
