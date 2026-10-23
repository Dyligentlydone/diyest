import OpenAI from "openai";
import { readFileSync } from "node:fs";

async function main() {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const img = `data:image/png;base64,${readFileSync("../handoff/blueprint-sample-table.png").toString("base64")}`;

  // 1. Sol vision + usage fields
  const res = await client.chat.completions.create({
    model: "gpt-6.1-sol",
    reasoning_effort: "low",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "What object is shown? One word." },
        { type: "image_url", image_url: { url: img, detail: "low" } },
      ],
    }],
  });
  console.log("sol vision:", res.choices[0]?.message?.content);
  console.log("usage:", JSON.stringify(res.usage));

  // 2. streaming on luna
  const stream = await client.chat.completions.create({
    model: "gpt-6-luna",
    reasoning_effort: "low",
    stream: true,
    messages: [{ role: "user", content: "Say hi in JSON: {\"hi\": \"...\"}" }],
  });
  let acc = "", n = 0;
  for await (const c of stream) { acc += c.choices[0]?.delta?.content ?? ""; n++; }
  console.log("luna stream chunks:", n, "→", acc.slice(0, 60));
}
main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
