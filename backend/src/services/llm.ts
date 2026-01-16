interface CombineResult {
  name: string;
  reasoning: string;
  confidence: number;
  type: "genre" | "artist";
}

interface ElementInput {
  name: string;
  type: string;
  bio?: string;
  tags?: string[];
}

export async function combineElements(
  elementA: ElementInput,
  elementB: ElementInput,
  failedNames: string[] = []
): Promise<CombineResult | null> {
  // genre + genre = genre, otherwise artist
  const outputType = (elementA.type === "genre" && elementB.type === "genre") ? "genre" : "artist";

  const failedNote = failedNames.length > 0
    ? `\n\nDO NOT suggest these (they don't exist or weren't found): ${failedNames.join(", ")}`
    : "";

  const prompt = outputType === "genre"
    ? `You are a music expert. Given two music genres, suggest ONE real subgenre or fusion genre that combines them.

Genre A: ${elementA.name}
Genre B: ${elementB.name}

Requirements:
- Must be a real, recognized genre or subgenre
- Should genuinely combine qualities of both inputs
- Examples: "Rock + Electronic = Synthwave", "Jazz + Hip-Hop = Jazz Rap"
- If no good match exists, respond with {"name": "NO_MATCH"}${failedNote}

Respond with ONLY valid JSON:
{
  "name": "Genre Name",
  "reasoning": "One sentence on why they fit",
  "confidence": 0.0-1.0
}`
    : `You are a music discovery expert. Find an artist that sits at the TRUE intersection of these two elements.

Element A: ${elementA.name} (${elementA.type})${elementA.tags?.length ? `\nTags: ${elementA.tags.slice(0, 5).join(", ")}` : ""}${elementA.bio ? `\nBio: ${elementA.bio.replace(/<[^>]*>/g, "").slice(0, 300)}` : ""}

Element B: ${elementB.name} (${elementB.type})${elementB.tags?.length ? `\nTags: ${elementB.tags.slice(0, 5).join(", ")}` : ""}${elementB.bio ? `\nBio: ${elementB.bio.replace(/<[^>]*>/g, "").slice(0, 300)}` : ""}

Think step by step:
1. What is the core sonic/stylistic quality of Element A?
2. What is the core sonic/stylistic quality of Element B?
3. What would an artist who EQUALLY embodies BOTH qualities sound like?
4. Who is a real artist that fits that exact middle point?

Requirements:
- Must be a real artist with released music
- NOT just "related to both" - must be the MIDDLE GROUND between them
- Avoid obvious/mainstream choices - dig deeper into the intersection
- Think: if you drew a line between A and B, who sits at the center?
- If no good match exists, respond with {"name": "NO_MATCH"}${failedNote}

Respond with ONLY valid JSON:
{
  "name": "Artist Name",
  "reasoning": "How they specifically blend qualities of both A and B",
  "confidence": 0.0-1.0
}`;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: "anthropic/claude-haiku-4.5",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message: string };
  };

  if (data.error) {
    console.error("OpenRouter error:", data.error.message);
    return null;
  }

  const text = data.choices?.[0]?.message?.content ?? "";

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    const parsed = JSON.parse(jsonMatch[0]) as { name: string; reasoning: string; confidence: number };
    if (parsed.name === "NO_MATCH") {
      return null;
    }
    return { ...parsed, type: outputType };
  } catch {
    console.error("Failed to parse LLM response:", text);
    return null;
  }
}
