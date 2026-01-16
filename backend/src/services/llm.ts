interface CombineResult {
  name: string;
  reasoning: string;
  summary: string;
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
  "summary": "~10 words explaining the mix",
  "confidence": 0.0-1.0
}`
    : `You are a music discovery expert. Find an artist at the TRUE intersection of these two elements.

Element A: ${elementA.name} (${elementA.type})${elementA.tags?.length ? `\nTags: ${elementA.tags.slice(0, 5).join(", ")}` : ""}${elementA.bio ? `\nBio: ${elementA.bio.replace(/<[^>]*>/g, "").slice(0, 300)}` : ""}

Element B: ${elementB.name} (${elementB.type})${elementB.tags?.length ? `\nTags: ${elementB.tags.slice(0, 5).join(", ")}` : ""}${elementB.bio ? `\nBio: ${elementB.bio.replace(/<[^>]*>/g, "").slice(0, 300)}` : ""}

Think step by step:

STEP 1 - Brainstorm 5 candidates with confidence scores (0.0-1.0):
Consider: How well do they sit at the MIDDLE POINT (not just related to both)?
- Candidate 1: [name] (confidence: X.X) - why
- Candidate 2: [name] (confidence: X.X) - why
- Candidate 3: [name] (confidence: X.X) - why
- Candidate 4: [name] (confidence: X.X) - why
- Candidate 5: [name] (confidence: X.X) - why

STEP 2 - Reconsider each:
- Is candidate 1 truly the middle ground or just adjacent to one side?
- Is candidate 2 too obvious/mainstream?
- etc.

STEP 3 - Pick the best one.

Requirements:
- Must be a real artist with released music
- NOT just "related to both" - must be the MIDDLE GROUND
- Avoid obvious/mainstream choices
- If no good match exists, respond with {"name": "NO_MATCH"}${failedNote}

After your reasoning, respond with ONLY this JSON:
{
  "name": "Artist Name",
  "reasoning": "How they blend both A and B",
  "summary": "~10 words explaining the mix",
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
      max_tokens: 1024,
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
    const parsed = JSON.parse(jsonMatch[0]) as { name: string; reasoning: string; summary?: string; confidence: number };
    if (parsed.name === "NO_MATCH") {
      return null;
    }
    return { ...parsed, summary: parsed.summary || "", type: outputType };
  } catch {
    console.error("Failed to parse LLM response:", text);
    return null;
  }
}
